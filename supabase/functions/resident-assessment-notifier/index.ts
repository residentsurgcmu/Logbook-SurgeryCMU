import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2.57.4";

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
  if (!directory?.active || directory.auth_user_id !== request.staff_id) throw new Error("Selected Staff is not an active registered account");

  const { data: existing, error: existingError } = await admin.from("resident_assessment_email_deliveries")
    .select("id,status").eq("request_id", request.id).eq("delivery_type", deliveryType).maybeSingle();
  if (existingError) throw existingError;
  if (existing?.status === "sent") return { sent: false, skipped: true };
  const attempt = { request_id: request.id, delivery_type: deliveryType, recipient_email: directory.email, status: "sending", attempted_at: new Date().toISOString(), error_message: null };
  const { data: delivery, error: deliveryError } = await admin.from("resident_assessment_email_deliveries")
    .upsert(attempt, { onConflict: "request_id,delivery_type" }).select("id").single();
  if (deliveryError) throw deliveryError;

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
    const messageId = await sendGmail(
      directory.email,
      reminder ? `Reminder: ${template.template_code} รอการประเมินครบ 24 ชั่วโมง` : `${template.template_code}: มีแบบประเมินใหม่`,
      emailHtml(directory.full_name, resident.full_name, template.template_code, request.procedure_or_activity, reminder),
    );
    await admin.from("resident_assessment_email_deliveries").update({ status: "sent", provider_message_id: messageId, sent_at: new Date().toISOString() }).eq("id", delivery.id);
    return { sent: true, skipped: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Email delivery failed";
    await admin.from("resident_assessment_email_deliveries").update({ status: "failed", error_message: message.slice(0, 1000) }).eq("id", delivery.id);
    throw error;
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
      const expected = Deno.env.get("RESIDENT_REMINDER_CRON_SECRET") || "";
      if (!expected || request.headers.get("x-reminder-secret") !== expected) return json({ error: "Unauthorized" }, 401);
      const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { data: pending, error } = await admin.from("resident_assessment_requests").select("id,submitted_at").eq("status", "pending").order("submitted_at").limit(200);
      if (error) throw error;
      let sent = 0; const failures: string[] = [];
      for (const item of pending || []) {
        const type = item.submitted_at <= cutoff ? "reminder" : "initial";
        try { const result = await deliver(admin, item.id, type); if (result.sent) sent += 1; }
        catch (error) { failures.push(`${item.id}: ${error instanceof Error ? error.message : "delivery failed"}`); }
      }
      return json({ ok: failures.length === 0, processed: (pending || []).length, sent, failures });
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
