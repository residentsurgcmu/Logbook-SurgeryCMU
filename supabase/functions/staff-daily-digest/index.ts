import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const APP_URL = "https://logbook-surgery-website.vercel.app";
const BANGKOK_TIME_ZONE = "Asia/Bangkok";

function bangkokDate() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: BANGKOK_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function htmlEscape(value: unknown) {
  return String(value ?? "").replace(/[&<>\"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character] || character));
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

function emailHtml(staffName: string, items: Array<Record<string, string>>) {
  const rows = items.map((item) => `<tr><td>${htmlEscape(item.studentName)}</td><td>${htmlEscape(item.activity)}</td><td>${htmlEscape(item.date)}</td><td>${htmlEscape(item.waiting)}</td></tr>`).join("");
  return `<!doctype html><html lang="th"><body style="font-family:Arial,sans-serif;color:#202124;line-height:1.55">
    <h2 style="color:#155426">รายการ Logbook รออนุมัติ</h2>
    <p>เรียน ${htmlEscape(staffName)},</p>
    <p>มี ${items.length} รายการที่นักศึกษาระบุท่านเป็นผู้อนุมัติ และค้างเกิน 48 ชั่วโมง</p>
    <table style="border-collapse:collapse;width:100%"><thead><tr><th align="left">นักศึกษา</th><th align="left">กิจกรรม</th><th align="left">วันที่ส่ง</th><th align="left">ระยะเวลาค้าง</th></tr></thead><tbody>${rows}</tbody></table>
    <p style="margin-top:20px"><a href="${APP_URL}" style="display:inline-block;padding:10px 14px;background:#155426;color:#fff;text-decoration:none;border-radius:6px">เข้าสู่ระบบเพื่อตรวจและอนุมัติ</a></p>
    <p style="font-size:12px;color:#6b7280">อีเมลนี้ไม่แสดง HN, diagnosis หรือรายละเอียดผู้ป่วย</p>
  </body></html>`;
}

function base64Url(value: string) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function encodeSubject(value: string) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return `=?UTF-8?B?${btoa(binary)}?=`;
}

async function gmailAccessToken(clientId: string, clientSecret: string, refreshToken: string) {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: "refresh_token" }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.access_token) throw new Error(payload.error_description || payload.error || "Google OAuth token exchange failed");
  return String(payload.access_token);
}

async function sendGmail(accessToken: string, fromEmail: string, toEmail: string, subject: string, html: string) {
  const raw = [
    `From: Surgery CMU Logbook <${fromEmail}>`,
    `To: ${toEmail}`,
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
  return payload;
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const expectedSecret = Deno.env.get("DIGEST_CRON_SECRET") || "";
  const suppliedSecret = request.headers.get("x-digest-secret") || "";
  if (!expectedSecret || suppliedSecret !== expectedSecret) return new Response("Unauthorized", { status: 401 });

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const googleClientId = Deno.env.get("GOOGLE_GMAIL_CLIENT_ID") || "";
  const googleClientSecret = Deno.env.get("GOOGLE_GMAIL_CLIENT_SECRET") || "";
  const googleRefreshToken = Deno.env.get("GOOGLE_GMAIL_REFRESH_TOKEN") || "";
  const sender = Deno.env.get("GOOGLE_GMAIL_FROM_EMAIL") || "edusurgcmu@gmail.com";
  if (!supabaseUrl || !serviceRoleKey || !googleClientId || !googleClientSecret || !googleRefreshToken || !sender) {
    return Response.json({ ok: false, error: "Digest function is not configured" }, { status: 503 });
  }
  const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
  const deliveryDate = bangkokDate();
  // Daily reminders are intentionally limited to the current operational
  // curriculum. Historical enrollments remain available to Admin, but must
  // never trigger a current Staff email.
  const { data: activeEnrollments, error: enrollmentError } = await supabase
    .from("student_enrollments")
    .select("id,curriculum:curricula!inner(class_year,academic_year,status)")
    .eq("status", "active")
    .eq("curriculum.class_year", 5)
    .eq("curriculum.academic_year", 2569)
    .eq("curriculum.status", "published");
  if (enrollmentError) return Response.json({ ok: false, error: enrollmentError.message }, { status: 500 });
  const activeEnrollmentIds = (activeEnrollments || []).map((item) => item.id);
  if (!activeEnrollmentIds.length) return Response.json({ ok: true, deliveryDate, sent: 0, skipped: 0 });
  const { data: pendingEntries, error: entriesError } = await supabase.from("year4_logbook_entries")
    .select("id,student_id,activity_type,activity_date,submitted_at,selected_approver_email,enrollment_id")
    .in("enrollment_id", activeEnrollmentIds).eq("status", "submitted").not("selected_approver_email", "is", null).lte("submitted_at", cutoff);
  if (entriesError) return Response.json({ ok: false, error: entriesError.message }, { status: 500 });
  const entries = pendingEntries || [];
  if (!entries.length) return Response.json({ ok: true, deliveryDate, sent: 0, skipped: 0 });

  const studentIds = [...new Set(entries.map((item) => item.student_id))];
  const activityCodes = [...new Set(entries.map((item) => item.activity_type))];
  const [studentsResult, activitiesResult, staffResult] = await Promise.all([
    supabase.from("profiles").select("id,full_name").in("id", studentIds),
    supabase.from("curriculum_activities").select("activity_code,title_th").in("activity_code", activityCodes).eq("active", true),
    supabase.from("user_directory").select("email,full_name").eq("role", "staff").eq("active", true),
  ]);
  if (studentsResult.error || activitiesResult.error || staffResult.error) {
    return Response.json({ ok: false, error: studentsResult.error?.message || activitiesResult.error?.message || staffResult.error?.message }, { status: 500 });
  }
  const studentNames = new Map((studentsResult.data || []).map((student) => [student.id, student.full_name]));
  const activityNames = new Map((activitiesResult.data || []).map((activity) => [activity.activity_code, activity.title_th]));
  const staff = new Map((staffResult.data || []).map((item) => [item.email, item.full_name]));
  const byStaff = new Map<string, typeof entries>();
  entries.forEach((entry) => {
    if (!staff.has(entry.selected_approver_email)) return;
    const group = byStaff.get(entry.selected_approver_email) || [];
    group.push(entry); byStaff.set(entry.selected_approver_email, group);
  });

  let accessToken = "";
  try { accessToken = await gmailAccessToken(googleClientId, googleClientSecret, googleRefreshToken); }
  catch (error) { return Response.json({ ok: false, error: errorMessage(error, "Google OAuth token exchange failed") }, { status: 502 }); }
  let sent = 0; let skipped = 0; const failures: string[] = [];
  for (const [staffEmail, staffEntries] of byStaff) {
    const { data: existing, error: existingError } = await supabase.from("staff_digest_deliveries")
      .select("id,status").eq("staff_email", staffEmail).eq("delivery_date", deliveryDate).maybeSingle();
    if (existingError) { failures.push(`${staffEmail}: ${existingError.message}`); continue; }
    if (existing) { skipped += 1; continue; }
    const { data: delivery, error: deliveryError } = await supabase.from("staff_digest_deliveries").insert({
      staff_email: staffEmail, delivery_date: deliveryDate, entry_ids: staffEntries.map((item) => item.id), entry_count: staffEntries.length, status: "sending",
    }).select("id").single();
    if (deliveryError) { skipped += 1; continue; }
    const payload = staffEntries.map((entry) => ({
      studentName: studentNames.get(entry.student_id) || "นักศึกษา",
      activity: activityNames.get(entry.activity_type) || entry.activity_type,
      date: entry.activity_date,
      waiting: `${Math.floor((Date.now() - new Date(entry.submitted_at).getTime()) / 3_600_000)} ชั่วโมง`,
    }));
    let result: Record<string, unknown>;
    try {
      result = await sendGmail(accessToken, sender, staffEmail, `Logbook Surgery CMU: ${payload.length} รายการรออนุมัติ`, emailHtml(staff.get(staffEmail) || staffEmail, payload));
    } catch (error) {
      const message = errorMessage(error, "Gmail API error");
      failures.push(`${staffEmail}: ${message}`);
      await supabase.from("staff_digest_deliveries").update({ status: "failed", error_message: message.slice(0, 1000) }).eq("id", delivery.id);
      continue;
    }
    await supabase.from("staff_digest_deliveries").update({ status: "sent", provider_message_id: String(result.id || "") || null, sent_at: new Date().toISOString() }).eq("id", delivery.id);
    sent += 1;
  }
  return Response.json({ ok: failures.length === 0, deliveryDate, sent, skipped, failures });
});
