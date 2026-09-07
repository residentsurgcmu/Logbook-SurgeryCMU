import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (request) => {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const authorization = request.headers.get("Authorization") || "";
  const token = authorization.replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "Authentication required" }, 401);
  const url = Deno.env.get("SUPABASE_URL")!;
  const publishableKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const callerClient = createClient(url, publishableKey, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false } });
  const { data: callerData } = await callerClient.auth.getUser(token);
  if (!callerData.user) return json({ error: "Session expired" }, 401);
  const adminClient = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: callerRole } = await adminClient.from("resident_user_roles").select("role,active").eq("user_id", callerData.user.id).maybeSingle();
  if (!callerRole?.active || callerRole.role !== "admin") return json({ error: "Admin role required" }, 403);

  try {
    const { email, fullName, role, pgy, appUrl } = await request.json();
    if (!["resident", "evaluator", "admin"].includes(role) || typeof email !== "string" || typeof fullName !== "string") throw new Error("Invalid account data");
    if (role === "resident" && ![1, 2, 3, 4].includes(Number(pgy))) throw new Error("Resident PGY must be 1–4");
    const normalizedEmail = email.trim().toLowerCase();
    const { data: existing } = await adminClient.from("resident_profiles").select("user_id").eq("email", normalizedEmail).maybeSingle();
    let userId = existing?.user_id;
    let invitationSent = false;
    if (!userId) {
      const { data, error } = await adminClient.auth.admin.inviteUserByEmail(normalizedEmail, {
        data: { full_name: fullName.trim() },
        redirectTo: typeof appUrl === "string" ? `${appUrl.replace(/\/$/, "")}/` : undefined,
      });
      if (error || !data.user) throw error || new Error("Could not invite account");
      userId = data.user.id;
      invitationSent = true;
    }
    const { error: profileError } = await adminClient.from("resident_profiles").upsert({ user_id: userId, email: normalizedEmail, full_name: fullName.trim(), pgy: role === "resident" ? Number(pgy) : null, active: true }, { onConflict: "user_id" });
    if (profileError) throw profileError;
    const { error: roleError } = await adminClient.from("resident_user_roles").upsert({ user_id: userId, role, active: true }, { onConflict: "user_id" });
    if (roleError) throw roleError;
    return json({ ok: true, userId, invitationSent });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Could not save account" }, 400);
  }
});
