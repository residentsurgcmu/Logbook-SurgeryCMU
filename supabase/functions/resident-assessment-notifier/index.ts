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
  if (!clientId || !clientSecret || !refreshToken) throw new Error("Gmail OAuth is not configured");
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: "refresh_token" }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.access_token) throw new Error(payload.error_description || payload.error || "Google OAuth token exchange failed");
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
  if (config.port === 25 || config.port === 587) throw new Error("SMTP_PORT must be 465: Supabase Edge Functions block ports 25 and 587");
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
  throw new Error("Email is not configured: set SMTP_HOST, SMTP_USER and SMTP_PASS secrets");
}

async function sendGmail(to: string, subject: string, html: string) {
  const sender = Deno.env.get("GOOGLE_GMAIL_FROM_EMAIL") || "resident.surgcmu@gmail.com";
  const accessToken = await gmailAccessToken();
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
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.id) throw new Error(payload.error?.message || `Gmail API error ${response.status}`);
  return String(payload.id);
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
// Stop starting new sends after this long so the run returns before the Edge
// Function wall-clock limit; the rest goes to the next run.
const RUN_TIME_BUDGET_MS = 100_000;
// A delivery that failed (send error, or Staff no longer active) waits this
// long before it is retried, so failing rows cannot take every run's slots.
const FAILED_RETRY_AFTER_MS = 6 * 60 * 60 * 1000;

async function deliver(admin: AdminClient, requestId: string, deliveryType: "initial" | "reminder") {
  const { data: request, error: requestError } = await admin.from("resident_assessment_requests")
    .select("id,template_id,resident_id,staff_id,status,submitted_at,procedure_or_activity")
    .eq("id", requestId).maybeSingle();
  if (requestError) throw requestError;
  if (!request || request.status !== "pending") return { sent: false, skipped: true };

  const [{ data: template, error: templateError }, { data: resident, error: residentError }, { data: directory, error: directoryError }] = await Promise.all([
    admin.from("resident_template_definitions").select("template_code").eq("id", request.template_id).single(),
    admin.from("resident_profiles").select("full_name").eq("user_id", request.resident_id).single(),
    admin.from("resident_staff_directory").select("email,full_name,active,auth_user_id").eq("auth_user_id", request.staff_id).maybeSingle(),
  ]);
  if (templateError || residentError || directoryError) throw templateError || residentError || directoryError;
  if (!directory?.active || directory.auth_user_id !== request.staff_id) {
    // Record the failure so deliver_due backs off for FAILED_RETRY_AFTER_MS
    // instead of retrying this request (e.g. Staff deactivated) every run.
    const reason = "Selected Staff is not an active registered account";
    let email = directory?.email || "";
    if (!email) {
      const { data: staffProfile } = await admin.from("resident_profiles").select("email").eq("user_id", request.staff_id).maybeSingle();
      email = staffProfile?.email || "";
    }
    if (email) {
      const { data: failedId } = await admin.rpc("claim_resident_assessment_email_delivery", {
        p_request_id: request.id, p_delivery_type: deliveryType, p_recipient_email: email,
      });
      if (failedId) await admin.from("resident_assessment_email_deliveries").update({ status: "failed", error_message: reason }).eq("id", failedId);
    }
    throw new Error(reason);
  }

  // Claim the row atomically: null means it was already sent or another run
  // (browser deliver_initial vs. cron deliver_due) is sending it right now.
  const { data: deliveryId, error: claimError } = await admin.rpc("claim_resident_assessment_email_delivery", {
    p_request_id: request.id, p_delivery_type: deliveryType, p_recipient_email: directory.email,
  });
  if (claimError) throw claimError;
  if (!deliveryId) return { sent: false, skipped: true };
  const delivery = { id: deliveryId as string };

  if (deliveryType === "reminder") {
    const { error: notificationError } = await admin.from("resident_notifications").upsert({
      recipient_id: request.staff_id,
      request_id: request.id,
      notification_type: "assessment_reminder",
      title: "แบบประเมินรอเกิน 24 ชั่วโมง",
      message: `${template.template_code} ของ ${resident.full_name} ยังรอการประเมิน`,
    }, { onConflict: "request_id,recipient_id,notification_type" });
    if (notificationError) throw notificationError;
  }

  try {
    const reminder = deliveryType === "reminder";
    const messageId = await sendMail(
      directory.email,
      reminder ? `Reminder: ${template.template_code} รอการประเมินครบ 24 ชั่วโมง` : `${template.template_code}: มีแบบประเมินใหม่`,
      emailHtml(directory.full_name, resident.full_name, template.template_code, request.procedure_or_activity, reminder),
    );
    await markSent(admin, delivery.id, messageId);
    return { sent: true, skipped: false };
  } catch (error) {
    if (error instanceof MarkSentError) throw error;
    const message = error instanceof Error ? error.message : "Email delivery failed";
    await admin.from("resident_assessment_email_deliveries").update({ status: "failed", error_message: message.slice(0, 1000) }).eq("id", delivery.id);
    throw error;
  }
}

class MarkSentError extends Error {}

// The email is already out. Marking it 'sent' must not be skipped silently or
// recorded as 'failed', or the same email would be sent again. Retry once; if
// it still fails, the row stays 'sending' and is not reclaimed for 10 minutes.
async function markSent(admin: AdminClient, deliveryId: string, messageId: string) {
  const update = { status: "sent", provider_message_id: messageId, sent_at: new Date().toISOString(), error_message: null };
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const { error } = await admin.from("resident_assessment_email_deliveries").update(update).eq("id", deliveryId);
    if (!error) return;
    if (attempt === 1) throw new MarkSentError(`Email sent but could not be marked as sent: ${error.message}`);
  }
}

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
      const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      // Read every pending request with its delivery rows and keep only the ones
      // whose due email has not been sent yet. Limiting the raw query to the
      // oldest 200 pending rows starved newer requests once more than 200
      // already-reminded requests stayed pending.
      const due: { id: string; type: "initial" | "reminder" }[] = [];
      const pageSize = 500;
      for (let offset = 0; ; offset += pageSize) {
        const { data: page, error } = await admin.from("resident_assessment_requests")
          .select("id,submitted_at,resident_assessment_email_deliveries(delivery_type,status,attempted_at)")
          .eq("status", "pending").order("submitted_at").order("id").range(offset, offset + pageSize - 1);
        if (error) throw error;
        for (const item of page || []) {
          const type = item.submitted_at <= cutoff ? "reminder" : "initial";
          const deliveries = (item.resident_assessment_email_deliveries || []) as { delivery_type: string; status: string; attempted_at: string }[];
          const row = deliveries.find((delivery) => delivery.delivery_type === type);
          if (row?.status === "sent") continue;
          if (row?.status === "failed" && Date.now() - new Date(row.attempted_at).getTime() < FAILED_RETRY_AFTER_MS) continue;
          due.push({ id: item.id, type });
        }
        if (!page || page.length < pageSize) break;
      }
      const batch = due.slice(0, MAX_DELIVERIES_PER_RUN);
      let sent = 0; let processed = 0; const failures: string[] = [];
      const startedAt = Date.now();
      for (const item of batch) {
        if (Date.now() - startedAt > RUN_TIME_BUDGET_MS) break;
        processed += 1;
        try { const result = await deliver(admin, item.id, item.type); if (result.sent) sent += 1; }
        catch (error) { failures.push(`${item.id}: ${error instanceof Error ? error.message : "delivery failed"}`); }
      }
      return json({ ok: failures.length === 0, processed, remaining: due.length - processed, sent, failures });
    }

    if (payload.action !== "deliver_initial" || typeof payload.requestId !== "string") return json({ error: "Invalid action" }, 400);
    const token = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "Authentication required" }, 401);
    const caller = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false } });
    const { data: authData } = await caller.auth.getUser(token);
    if (!authData.user) return json({ error: "Session expired" }, 401);
    const { data: assessmentRequest } = await admin.from("resident_assessment_requests").select("resident_id").eq("id", payload.requestId).maybeSingle();
    if (!assessmentRequest || assessmentRequest.resident_id !== authData.user.id) return json({ error: "Request owner required" }, 403);
    const result = await deliver(admin, payload.requestId, "initial");
    return json({ ok: true, ...result });
  } catch (error) {
    console.error("Resident assessment notification failed", error);
    return json({ error: error instanceof Error ? error.message : "Notification delivery failed" }, 500);
  }
});
