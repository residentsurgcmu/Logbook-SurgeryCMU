import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2.57.4";
import nodemailer from "npm:nodemailer@6.9.16";

const APP_URL = (Deno.env.get("APP_URL") || "https://resident-surgery-logbook.vercel.app").replace(/\/$/, "");
const corsHeaders = {
  "Access-Control-Allow-Origin": APP_URL,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-reminder-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...corsHeaders } });

function htmlEscape(value: unknown) {
  return String(value ?? "").replace(/[&<>\"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character] || character));
}

function base64Url(value: string) {
  const bytes = new TextEncoder().encode(value); let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function encodeSubject(value: string) {
  const bytes = new TextEncoder().encode(value); let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return `=?UTF-8?B?${btoa(binary)}?=`;
}

async function gmailAccessToken() {
  const clientId = Deno.env.get("GOOGLE_GMAIL_CLIENT_ID") || "";
  const clientSecret = Deno.env.get("GOOGLE_GMAIL_CLIENT_SECRET") || "";
  const refreshToken = Deno.env.get("GOOGLE_GMAIL_REFRESH_TOKEN") || "";
  if (!clientId || !clientSecret || !refreshToken) throw Object.assign(new Error("Gmail OAuth is not configured"), { notConfigured: true });
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: "refresh_token" }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.access_token) throw new Error(payload?.error_description || payload?.error || "Google OAuth token exchange failed");
  return String(payload.access_token);
}

// Preferred transport: the same Gmail SMTP account (App Password) that
// Supabase Auth uses. Supabase Edge Functions block outbound ports 25 and 587,
// so use implicit TLS on 465.
function smtpConfig() {
  const host = Deno.env.get("SMTP_HOST") || "";
  const user = Deno.env.get("SMTP_USER") || "";
  const pass = Deno.env.get("SMTP_PASS") || "";
  if (!host || !user || !pass) return null;
  const port = Number(Deno.env.get("SMTP_PORT") || "465");
  return { host, port, user, pass, from: Deno.env.get("SMTP_FROM") || user };
}

async function sendSmtp(config: NonNullable<ReturnType<typeof smtpConfig>>, to: string, subject: string, html: string) {
  if (config.port === 25 || config.port === 587) throw Object.assign(new Error("SMTP_PORT must be 465: Supabase Edge Functions block ports 25 and 587"), { notConfigured: true });
  const transport = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: true,
    auth: { user: config.user, pass: config.pass },
  });
  const info = await transport.sendMail({
    from: { name: "Resident Surgery Assessment", address: config.from },
    to,
    subject,
    html,
  });
  return String(info.messageId || "smtp");
}

async function sendMail(to: string, subject: string, html: string) {
  const smtp = smtpConfig();
  if (smtp) return await sendSmtp(smtp, to, subject, html);
  if (Deno.env.get("GOOGLE_GMAIL_REFRESH_TOKEN")) return await sendGmail(to, subject, html);
  throw Object.assign(new Error("Email is not configured: set SMTP_HOST, SMTP_USER and SMTP_PASS secrets"), { notConfigured: true });
}

async function sendGmail(to: string, subject: string, html: string) {
  const sender = Deno.env.get("GOOGLE_GMAIL_FROM_EMAIL") || "resident.surgcmu@gmail.com";
  const accessToken = await gmailAccessToken().catch((cause: unknown) => {
    // No messages.send call has happened, so a token error is safe to retry.
    throw Object.assign(new Error("Google OAuth token exchange failed", { cause }), { gmailBeforeSend: true });
  });
  const raw = [
    `From: Resident Surgery Assessment <${sender}>`,
    `To: ${to}`,
    `Subject: ${encodeSubject(subject)}`,
    "MIME-Version: 1.0",
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    html,
  ].join("\r\n");
  const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ raw: base64Url(raw) }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw Object.assign(new Error(payload?.error?.message || `Gmail API error ${response.status}`), { gmailHttpStatus: response.status });
  if (typeof payload?.id !== "string" || !payload.id.trim()) {
    // Gmail may have accepted the message. Do not attach a retryable HTTP failure marker.
    throw new Error("Gmail returned success without a verifiable message ID");
  }
  return payload.id;
}

function emailHtml(staffName: string, residentName: string, templateCode: string, activity: string, reminder: boolean) {
  return `<!doctype html><html lang="th"><body style="margin:0;background:#f5f7f5;font-family:Arial,sans-serif;color:#202124">
    <div style="max-width:600px;margin:32px auto;background:#fff;border:1px solid #dfe5df;border-radius:12px;padding:32px">
      <h1 style="margin:0 0 20px;color:#155426;font-size:24px">${reminder ? "แจ้งเตือน: แบบประเมินยังรอดำเนินการ" : "มีแบบประเมิน EPA/PBA ใหม่"}</h1>
      <p>เรียน ${htmlEscape(staffName)},</p>
      <p>${htmlEscape(residentName)} ส่ง <strong>${htmlEscape(templateCode)}</strong> ให้ท่านประเมิน</p>
      <p><strong>ชื่อกิจกรรม:</strong> ${htmlEscape(activity)}</p>
      ${reminder ? "<p>รายการนี้ส่งมาแล้วอย่างน้อย 24 ชั่วโมงและยังไม่มีผลการประเมิน</p>" : ""}
      <p style="margin:26px 0"><a href="${APP_URL}" style="display:inline-block;background:#155426;color:#fff;text-decoration:none;padding:12px 18px;border-radius:8px;font-weight:700">เข้าสู่ระบบเพื่อประเมิน</a></p>
      <p style="font-size:12px;color:#667085">อีเมลนี้ไม่แสดงชื่อ HN หรือรายละเอียดที่ระบุตัวผู้ป่วย</p>
    </div>
  </body></html>`;
}

type AdminClient = ReturnType<typeof createClient>;

// Emails sent per cron run (every 15 minutes); anything left over is picked
// up by the next run because only unsent deliveries are selected.
const MAX_DELIVERIES_PER_RUN = 200;
// RC-NOTIF-V1 (I03): the database only lets this version reserve e-mail; every run checks in first and does
// nothing while e-mail is paused (resident_notification_mail_control).
const WORKER_VERSION = "rc-notif-v1-impl-v3";
async function checkIn(admin: AdminClient) {
  const { data, error } = await admin.rpc("rc_notif_worker_checkin", { p_version: WORKER_VERSION });
  if (error || typeof data?.paused !== "boolean") throw new Error("rc_notif_worker_checkin unavailable"); // fail closed
  return data as { paused: boolean };
}
// Stop starting new sends after this long so the run returns before the Edge
// Function wall-clock limit; the rest goes to the next run.
const RUN_TIME_BUDGET_MS = 100_000;
// A delivery that failed (send error, or Staff no longer active) waits this
// long before it is retried, so failing rows cannot take every run's slots.
const FAILED_RETRY_AFTER_MS = 6 * 60 * 60 * 1000;

// RC-NOTIF-V1: every decision is made in the database.
// 1. reminder: the web reminder is created first, independent of the e-mail claim and of SMTP;
// 2. claim = reservation only (it already refuses suppressed/terminal deliveries);
// 3. rc_notif_authorize_email_attempt = permission for ONE attempt, checked right before SMTP
//    (request still pending, same active Staff, notification setting); any error = no send;
// 4. the outcome is reported for that attempt only: sent | failed_before_smtp (SMTP never accepted the
//    message → retried later) | uncertain (sending started, result unknown → never retried automatically).
type Outcome = "sent" | "failed_before_smtp" | "uncertain";

// SMTP/Gmail errors where the server certainly did NOT accept the message.
function failedBeforeAcceptance(error: unknown): boolean {
  const e = error as { code?: string; command?: string; responseCode?: number; gmailHttpStatus?: number; gmailBeforeSend?: boolean; notConfigured?: boolean };
  if (e?.notConfigured || e?.gmailBeforeSend) return true;
  if (typeof e?.gmailHttpStatus === "number") return true;            // Gmail API answered with an error status
  if (typeof e?.responseCode === "number" && e.responseCode >= 400) return true;  // SMTP answered with a rejection
  if (["CONN", "EHLO", "HELO", "STARTTLS", "AUTH PLAIN", "AUTH LOGIN", "AUTH XOAUTH2", "MAIL FROM", "RCPT TO"].includes(String(e?.command || ""))) return true;
  if (["ECONNECTION", "EDNS", "EAUTH", "ECONNREFUSED", "ENOTFOUND"].includes(String(e?.code || ""))) return true;
  return false;                                                        // anything else: the result is unknown
}

async function finishAttempt(admin: AdminClient, attemptId: string, outcome: Outcome, messageId: string | null, errorText: string | null) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const { data, error } = await admin.rpc("rc_notif_finish_email_attempt", {
      p_attempt_id: attemptId, p_outcome: outcome, p_provider_message_id: messageId, p_error: errorText ? errorText.slice(0, 1000) : null,
    });
    if (!error) return data;
    if (attempt === 1) throw new MarkSentError(`E-mail attempt ${outcome} but the outcome could not be recorded: ${error.message}`);
  }
}

async function deliver(admin: AdminClient, requestId: string, deliveryType: "initial" | "reminder") {
  let webError: string | null = null;
  if (deliveryType === "reminder") {
    const { error } = await admin.rpc("rc_notif_ensure_web_reminder", { p_request_id: requestId });
    if (error) webError = `web reminder: ${error.message}`;
  }
  // reservation with an explicit reason; a database error means "unavailable" → no send, retried by a later run
  const { data: reservation, error: claimError } = await admin.rpc("rc_notif_reserve_email", {
    p_request_id: requestId, p_delivery_type: deliveryType,
  });
  if (claimError) throw claimError;
  if (!reservation?.delivery_id) return { sent: false, skipped: true, reason: reservation?.reason || "unknown", webError };
  const deliveryId = reservation.delivery_id;
  const { data: permission, error: authError } = await admin.rpc("rc_notif_authorize_email_attempt", { p_delivery_id: deliveryId });
  if (authError) throw authError;                       // cannot decide → do not send
  if (!permission?.allowed) return { sent: false, skipped: true, reason: permission?.reason, webError };
  const reminder = deliveryType === "reminder";
  let messageId: string;
  try {
    messageId = await sendMail(
      permission.to,
      reminder ? `Reminder: ${permission.template_code} รอการประเมินครบ 24 ชั่วโมง` : `${permission.template_code}: มีแบบประเมินใหม่`,
      emailHtml(permission.staff_name, permission.resident_name, permission.template_code, permission.activity, reminder),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Email delivery failed";
    await finishAttempt(admin, permission.attempt_id, failedBeforeAcceptance(error) ? "failed_before_smtp" : "uncertain", null, message);
    throw error;
  }
  await finishAttempt(admin, permission.attempt_id, "sent", messageId, null);
  return { sent: true, skipped: false, webError };
}

class MarkSentError extends Error {}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!supabaseUrl || !anonKey || !serviceKey) return json({ error: "Function configuration is incomplete" }, 503);
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  try {
    const payload = await request.json().catch(() => ({}));
    if (payload.action === "deliver_due") {
      // The cron job reads its secret from Supabase Vault; verify it against
      // Vault too, so no extra Edge Function secret is required. An explicit
      // RESIDENT_REMINDER_CRON_SECRET env value is still accepted.
      const provided = request.headers.get("x-reminder-secret") || "";
      const expected = Deno.env.get("RESIDENT_REMINDER_CRON_SECRET") || "";
      let authorized = Boolean(provided) && Boolean(expected) && provided === expected;
      if (!authorized && provided) {
        const { data: matches, error: secretError } = await admin.rpc("resident_reminder_secret_matches", { p_secret: provided });
        if (secretError) throw secretError;
        authorized = matches === true;
      }
      if (!authorized) return json({ error: "Unauthorized" }, 401);
      const control = await checkIn(admin);
      if (control.paused) return json({ ok: true, paused: true, workerVersion: WORKER_VERSION, processed: 0, sent: 0, failures: [] });
      const { data: due, error: dueError } = await admin.rpc("rc_notif_due_email_work", {
        p_limit: MAX_DELIVERIES_PER_RUN, p_failed_retry_after: `${FAILED_RETRY_AFTER_MS / 1000} seconds`,
      });
      if (dueError) throw dueError;
      const work = ((due || []) as { request_id: string; delivery_type: "initial" | "reminder" }[]).map((row) => ({ id: row.request_id, type: row.delivery_type }));
      const batch = work;
      let sent = 0; let processed = 0; const failures: string[] = [];
      const startedAt = Date.now();
      for (const item of batch) {
        if (Date.now() - startedAt > RUN_TIME_BUDGET_MS) break;
        processed += 1;
        try { const result = await deliver(admin, item.id, item.type); if (result.sent) sent += 1; if (result.webError) failures.push(`${item.id}: ${result.webError}`); }
        catch (error) { failures.push(`${item.id}: ${error instanceof Error ? error.message : "delivery failed"}`); }
      }
      return json({ ok: failures.length === 0, processed, remaining: work.length - processed, sent, failures });
    }

    if (payload.action !== "deliver_initial" || typeof payload.requestId !== "string") return json({ error: "Invalid action" }, 400);
    const token = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "Authentication required" }, 401);
    const caller = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false } });
    const { data: authData } = await caller.auth.getUser(token);
    if (!authData.user) return json({ error: "Session expired" }, 401);
    // RC-02a-1: a deactivated account cannot trigger e-mail (both flags must be on, D-022).
    const [{ data: callerRole }, { data: callerProfile }] = await Promise.all([
      admin.from("resident_user_roles").select("active").eq("user_id", authData.user.id).maybeSingle(),
      admin.from("resident_profiles").select("active").eq("user_id", authData.user.id).maybeSingle(),
    ]);
    if (!callerRole?.active || !callerProfile?.active) return json({ error: "Active account required" }, 403);
    const { data: assessmentRequest } = await admin.from("resident_assessment_requests").select("resident_id").eq("id", payload.requestId).maybeSingle();
    if (!assessmentRequest || assessmentRequest.resident_id !== authData.user.id) return json({ error: "Request owner required" }, 403);
    const control = await checkIn(admin);
    if (control.paused) return json({ ok: true, paused: true, workerVersion: WORKER_VERSION });   // picked up by deliver_due after e-mail resumes
    const result = await deliver(admin, payload.requestId, "initial");
    return json({ ok: true, ...result });
  } catch (error) {
    console.error("Resident assessment notification failed", error);
    return json({ error: error instanceof Error ? error.message : "Notification delivery failed", workerVersion: WORKER_VERSION }, 500);
  }
});
