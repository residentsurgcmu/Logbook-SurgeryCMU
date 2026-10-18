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
  // RC-02a-1: an account is usable only when both the role and the profile are active (D-022).
  const [{ data: callerRole, error: callerRoleError }, { data: callerProfile, error: callerProfileError }] = await Promise.all([
    adminClient.from("resident_user_roles").select("role,active").eq("user_id", callerData.user.id).maybeSingle(),
    adminClient.from("resident_profiles").select("active").eq("user_id", callerData.user.id).maybeSingle(),
  ]);
  if (callerRoleError || callerProfileError) return json({ error: "Could not verify caller role" }, 500);
  if (!callerRole?.active || !callerProfile?.active || callerRole.role !== "admin") return json({ error: "Admin role required" }, 403);

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

  // RC-02a-1 / D-011: an existing account is never overwritten. The database function creates the
  // profile, role and (for Staff) the Staff list link in one transaction, under a per-email lock,
  // and refuses with ACCOUNT_EXISTS if this person already has a profile or a role.
  const accountExists = (userId?: string | null) => json({ error: "ACCOUNT_EXISTS", code: "ACCOUNT_EXISTS", userId: userId || null }, 409);
  // Release safety (G0 B-R02): while the owner has paused account writes, refuse before any invitation e-mail.
  const PAUSED_MESSAGE = "ระบบบัญชีพักชั่วคราวระหว่างปรับปรุง กรุณาลองใหม่ภายหลัง";
  const accountsPaused = () => json({ error: PAUSED_MESSAGE, code: "ACCOUNTS_PAUSED" }, 503);
  const isPaused = async () => {
    const { data, error } = await adminClient.rpc("resident_accounts_paused");
    if (error) throw error;
    return data === true;
  };
  const createAccount = async (userId: string, accountEmail: string, fullName: string, accountRole: string, accountPgy: number | null, accountUnit: string | null) => {
    const { error } = await adminClient.rpc("admin_provision_account_internal", {
      p_actor_id: callerData.user!.id,
      p_user_id: userId,
      p_email: accountEmail,
      p_full_name: fullName,
      p_role: accountRole,
      p_pgy: accountPgy,
      p_unit_name: accountUnit,
    });
    if (!error) return null;
    if (error.message.includes("ACCOUNTS_PAUSED")) return accountsPaused();
    const existing = /ACCOUNT_EXISTS:\s*([0-9a-f-]{36})/i.exec(error.message);
    if (existing || error.message.includes("ACCOUNT_EXISTS")) return accountExists(existing?.[1] || userId);
    throw error;
  };
  const existingProfileId = async (accountEmail: string) => {
    const { data, error } = await adminClient.from("resident_profiles").select("user_id").eq("email", accountEmail).maybeSingle();
    if (error) throw error;
    return (data?.user_id as string | undefined) || null;
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
      if (await isPaused()) return accountsPaused();
      const { data: directory, error: directoryError } = await adminClient
        .from("resident_staff_directory")
        .select("email,full_name,unit_name,active,auth_user_id")
        .eq("email", email)
        .maybeSingle();
      if (directoryError) throw directoryError;
      if (!directory?.active) throw new Error("This email is not an active approved Staff account");
      const profileId = await existingProfileId(directory.email);
      if (directory.auth_user_id) {
        // Already linked: nothing is written. A linked entry without a profile (old data) gets one created.
        if (profileId) return json({ ok: true, invitationSent: false, alreadyProvisioned: true });
        const refused = await createAccount(directory.auth_user_id, directory.email, directory.full_name, "staff", null, directory.unit_name);
        return refused || json({ ok: true, userId: directory.auth_user_id, invitationSent: false, alreadyProvisioned: true });
      }
      if (profileId) return accountExists(profileId);

      const { userId, invitationSent, linkedExistingAccount } = await inviteOrLinkUser(directory.email, directory.full_name);
      const refused = await createAccount(userId, directory.email, directory.full_name, "staff", null, directory.unit_name);
      return refused || json({ ok: true, userId, invitationSent, linkedExistingAccount });
    }

    if (action !== "provision_account") throw new Error("Invalid action");
    const { role, pgy } = payload;
    const fullName = normalizedText(payload?.fullName);
    const unitName = normalizedText(payload?.unitName);
    if (!["resident", "staff", "admin"].includes(role) || !email || !hasLength(fullName, 2, 160)) throw new Error("Invalid account data");
    if (role === "resident" && ![1, 2, 3, 4].includes(Number(pgy))) throw new Error("Resident PGY must be 1–4");
    if (role === "staff" && !hasLength(unitName, 2, 80)) throw new Error("Staff unit must be 2–80 characters");

    // Checked before any invitation so an existing person never gets an e-mail from a refused add.
    if (await isPaused()) return accountsPaused();
    const profileId = await existingProfileId(email);
    if (profileId) return accountExists(profileId);

    const { data: directory, error: directoryError } = await adminClient
      .from("resident_staff_directory")
      .select("email,full_name,unit_name,active,auth_user_id")
      .eq("email", email)
      .maybeSingle();
    if (directoryError) throw directoryError;
    if (role !== "staff" && directory) throw new Error("Staff accounts must be invited from the approved Staff directory");
    if (role === "staff" && directory && !directory.active) throw new Error("This Staff directory entry is inactive");

    if (role === "staff" && directory?.auth_user_id) {
      // Linked Staff list entry without a profile (old data): create it, never overwrite.
      const refused = await createAccount(directory.auth_user_id, email, directory.full_name, "staff", null, directory.unit_name);
      return refused || json({ ok: true, userId: directory.auth_user_id, invitationSent: false, alreadyProvisioned: true });
    }

    const { userId, invitationSent, linkedExistingAccount } = await inviteOrLinkUser(email, role === "staff" && directory ? directory.full_name : fullName);
    const refused = await createAccount(userId, email, fullName, role, role === "resident" ? Number(pgy) : null, role === "staff" ? unitName : null);
    return refused || json({ ok: true, userId, invitationSent, linkedExistingAccount });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Could not save account" }, 400);
  }
});
