import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2.57.4";

const appUrl = (Deno.env.get("APP_URL") || "https://resident-surgery-logbook.vercel.app").replace(/\/$/, "");
const corsHeaders = {
  "Access-Control-Allow-Origin": appUrl,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json", ...corsHeaders },
});

const resetPasswordUrl = () => `${appUrl}/reset-password`;
const normalizedEmail = (value: unknown) => typeof value === "string" ? value.trim().toLowerCase() : "";
const normalizedText = (value: unknown) => typeof value === "string" ? value.trim() : "";
const hasLength = (value: string, minimum: number, maximum: number) => value.length >= minimum && value.length <= maximum;
const isUuid = (value: unknown) => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const authorization = request.headers.get("Authorization") || "";
  const token = authorization.replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "Authentication required" }, 401);

  const url = Deno.env.get("SUPABASE_URL") || "";
  const publishableKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!url || !publishableKey || !serviceKey) return json({ error: "Function configuration is incomplete" }, 500);

  const callerClient = createClient(url, publishableKey, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false } });
  const { data: callerData } = await callerClient.auth.getUser(token);
  if (!callerData.user) return json({ error: "Session expired" }, 401);
  const adminClient = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: callerRole, error: callerRoleError } = await adminClient.from("resident_user_roles").select("role,active").eq("user_id", callerData.user.id).maybeSingle();
  if (callerRoleError) return json({ error: "Could not verify caller role" }, 500);
  if (!callerRole?.active || callerRole.role !== "admin") return json({ error: "Admin role required" }, 403);

  // Invite a new Auth user, or link the Auth account that already exists for
  // this email (e.g. Staff who had a login in the retired Year 4 system).
  // An existing account gets a set-password link instead of an invitation.
  const inviteOrLinkUser = async (inviteEmail: string, fullName: string) => {
    const { data: invitation, error: invitationError } = await adminClient.auth.admin.inviteUserByEmail(inviteEmail, {
      data: { full_name: fullName },
      redirectTo: resetPasswordUrl(),
    });
    if (!invitationError && invitation?.user) return { userId: invitation.user.id, invitationSent: true, linkedExistingAccount: false };
    const alreadyRegistered = invitationError && (
      (invitationError as { code?: string }).code === "email_exists"
      || (invitationError as { status?: number }).status === 422
      || /already (been )?registered|already exists/i.test(invitationError.message)
    );
    if (!alreadyRegistered) throw invitationError || new Error("Could not invite account");
    const { data: existingUserId, error: lookupError } = await adminClient.rpc("admin_find_auth_user_id", { p_email: inviteEmail });
    if (lookupError) throw lookupError;
    if (!existingUserId) throw invitationError;
    const { error: resetError } = await adminClient.auth.resetPasswordForEmail(inviteEmail, { redirectTo: resetPasswordUrl() });
    if (resetError) console.warn("Could not send set-password email to linked account", resetError.message);
    return { userId: existingUserId as string, invitationSent: false, linkedExistingAccount: true };
  };

  const ensureStaffAccess = async (userId: string, staffEmail: string, fullName: string) => {
    const { error: profileError } = await adminClient.from("resident_profiles").upsert({ user_id: userId, email: staffEmail, full_name: fullName, pgy: null, active: true }, { onConflict: "user_id" });
    if (profileError) throw profileError;
    const { error: roleError } = await adminClient.from("resident_user_roles").upsert({ user_id: userId, role: "staff", active: true }, { onConflict: "user_id" });
    if (roleError) throw roleError;
  };

  try {
    const payload = await request.json();
    const action = payload?.action;
    const email = normalizedEmail(payload?.email);

    if (action === "delete_assessment") {
      const assessmentId = payload?.assessmentId;
      const residentId = payload?.residentId;
      const password = typeof payload?.password === "string" ? payload.password : "";
      if (!isUuid(assessmentId) || !isUuid(residentId)) return json({ error: "ข้อมูลหัตถการหรือ Resident ไม่ถูกต้อง" }, 400);
      if (!password) return json({ error: "กรุณากรอกรหัสผ่าน Admin" }, 400);
      if (!callerData.user.email) return json({ error: "ไม่พบอีเมลของบัญชี Admin" }, 400);

      const passwordClient = createClient(url, publishableKey, { auth: { persistSession: false, autoRefreshToken: false } });
      const { error: passwordError } = await passwordClient.auth.signInWithPassword({
        email: callerData.user.email,
        password,
      });
      if (passwordError) return json({ error: "รหัสผ่าน Admin ไม่ถูกต้อง" }, 401);
      // Clear only the temporary in-memory session; keep the browser session active.
      await passwordClient.auth.signOut({ scope: "local" }).catch(() => {});

      const { data: deletedCount, error: deleteError } = await adminClient.rpc("admin_delete_resident_assessment", {
        p_assessment_id: assessmentId,
        p_resident_id: residentId,
      });
      if (deleteError) {
        if (deleteError.message.includes("Assessment was not found")) return json({ error: "ไม่พบหัตถการของ Resident ที่เลือก" }, 404);
        throw deleteError;
      }
      return json({ ok: true, deletedCount });
    }

    if (action === "invite_staff") {
      if (!email) throw new Error("Invalid Staff email");
      const { data: directory, error: directoryError } = await adminClient
        .from("resident_staff_directory")
        .select("email,full_name,active,auth_user_id")
        .eq("email", email)
        .maybeSingle();
      if (directoryError) throw directoryError;
      if (!directory?.active) throw new Error("This email is not an active approved Staff account");
      if (directory.auth_user_id) return json({ ok: true, invitationSent: false, alreadyProvisioned: true });

      const { userId, invitationSent, linkedExistingAccount } = await inviteOrLinkUser(directory.email, directory.full_name);
      const { error: profileError } = await adminClient.from("resident_profiles").upsert({ user_id: userId, email: directory.email, full_name: directory.full_name, pgy: null, active: true }, { onConflict: "user_id" });
      if (profileError) throw profileError;
      const { error: roleError } = await adminClient.from("resident_user_roles").upsert({ user_id: userId, role: "staff", active: true }, { onConflict: "user_id" });
      if (roleError) throw roleError;
      const { error: linkError } = await adminClient.from("resident_staff_directory").update({ auth_user_id: userId, invited_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("email", directory.email);
      if (linkError) throw linkError;
      return json({ ok: true, invitationSent, linkedExistingAccount });
    }

    if (action !== "provision_account") throw new Error("Invalid action");
    const { role, pgy } = payload;
    const fullName = normalizedText(payload?.fullName);
    const unitName = normalizedText(payload?.unitName);
    if (!["resident", "staff", "admin"].includes(role) || !email || !hasLength(fullName, 2, 160)) throw new Error("Invalid account data");
    if (role === "resident" && ![1, 2, 3, 4].includes(Number(pgy))) throw new Error("Resident PGY must be 1–4");
    if (role === "staff" && !hasLength(unitName, 2, 80)) throw new Error("Staff unit must be 2–80 characters");

    const { data: directory, error: directoryError } = await adminClient
      .from("resident_staff_directory")
      .select("email,full_name,unit_name,active,auth_user_id")
      .eq("email", email)
      .maybeSingle();
    if (directoryError) throw directoryError;

    const { data: existing, error: existingError } = await adminClient.from("resident_profiles").select("user_id").eq("email", email).maybeSingle();
    if (existingError) throw existingError;
    const { data: existingRole, error: existingRoleError } = existing
      ? await adminClient.from("resident_user_roles").select("role,active").eq("user_id", existing.user_id).maybeSingle()
      : { data: null, error: null };
    if (existingRoleError) throw existingRoleError;

    if (role === "staff") {
      if (existingRole && existingRole.role !== "staff") {
        throw new Error("This email already belongs to a Resident or Admin account");
      }
      if (directory && !directory.active) throw new Error("This Staff directory entry is inactive");

      let staffDirectory = directory;
      if (!staffDirectory) {
        const { data: createdDirectory, error: createDirectoryError } = await adminClient
          .from("resident_staff_directory")
          .insert({ email, full_name: fullName, unit_name: unitName, active: true })
          .select("email,full_name,unit_name,active,auth_user_id")
          .single();
        if (createDirectoryError) throw createDirectoryError;
        staffDirectory = createdDirectory;
      }

      if (staffDirectory.auth_user_id) {
        if (existing && existing.user_id !== staffDirectory.auth_user_id) {
          throw new Error("Staff directory account does not match the existing account");
        }
        const { data: linkedRole, error: linkedRoleError } = await adminClient
          .from("resident_user_roles")
          .select("role,active")
          .eq("user_id", staffDirectory.auth_user_id)
          .maybeSingle();
        if (linkedRoleError) throw linkedRoleError;
        if (linkedRole && linkedRole.role !== "staff") {
          throw new Error("Staff directory account has an incompatible role");
        }
        // Re-adding a linked Staff also repairs a missing/inactive profile or role.
        await ensureStaffAccess(staffDirectory.auth_user_id, staffDirectory.email, staffDirectory.full_name);
        return json({ ok: true, userId: staffDirectory.auth_user_id, invitationSent: false, alreadyProvisioned: true });
      }

      const userId = existing?.user_id;
      if (userId) {
        // The profile existed without an active Staff role (e.g. created by an
        // older flow). Linking the directory alone left the account unable to
        // sign in, so grant the Staff profile and role here as well.
        await ensureStaffAccess(userId, staffDirectory.email, staffDirectory.full_name);
        const { error: linkError } = await adminClient
          .from("resident_staff_directory")
          .update({ auth_user_id: userId, invited_at: new Date().toISOString(), updated_at: new Date().toISOString() })
          .eq("email", staffDirectory.email);
        if (linkError) throw linkError;
        return json({ ok: true, userId, invitationSent: false, alreadyProvisioned: true });
      }

      const { userId: invitedUserId, invitationSent, linkedExistingAccount } = await inviteOrLinkUser(staffDirectory.email, staffDirectory.full_name);
      await ensureStaffAccess(invitedUserId, staffDirectory.email, staffDirectory.full_name);
      const { error: linkError } = await adminClient.from("resident_staff_directory").update({ auth_user_id: invitedUserId, invited_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("email", staffDirectory.email);
      if (linkError) throw linkError;
      return json({ ok: true, userId: invitedUserId, invitationSent, linkedExistingAccount });
    }

    if (directory) throw new Error("Staff accounts must be invited from the approved Staff directory");
    let userId = existing?.user_id;
    let invitationSent = false;
    let linkedExistingAccount = false;
    if (!userId) {
      ({ userId, invitationSent, linkedExistingAccount } = await inviteOrLinkUser(email, fullName));
    }
    const { error: profileError } = await adminClient.from("resident_profiles").upsert({ user_id: userId, email, full_name: fullName, pgy: role === "resident" ? Number(pgy) : null, active: true }, { onConflict: "user_id" });
    if (profileError) throw profileError;
    const { error: roleError } = await adminClient.from("resident_user_roles").upsert({ user_id: userId, role, active: true }, { onConflict: "user_id" });
    if (roleError) throw roleError;
    return json({ ok: true, userId, invitationSent, linkedExistingAccount });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Could not save account" }, 400);
  }
});
