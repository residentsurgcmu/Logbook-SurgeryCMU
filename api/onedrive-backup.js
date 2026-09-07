import { createClient } from "@supabase/supabase-js";
import ExcelJS from "exceljs";

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function send(res, status, payload) {
  res.status(status).setHeader("Content-Type", "application/json; charset=utf-8").send(JSON.stringify(payload));
}

function bangkokTimestamp() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date()).reduce((value, part) => ({ ...value, [part.type]: part.value }), {});
  return `${parts.year}-${parts.month}-${parts.day}_${parts.hour}${parts.minute}${parts.second}`;
}

function styleHeader(sheet) {
  const row = sheet.getRow(1);
  row.height = 28;
  row.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF9F1239" } };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  });
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.autoFilter = { from: "A1", to: `${sheet.getColumn(sheet.columnCount).letter}1` };
}

async function makeWorkbook(entries, students, activities, events) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Surgery Logbook Year 4";
  workbook.created = new Date();
  const studentMap = new Map(students.map((student) => [student.id, student]));
  const activityMap = new Map(activities.map((activity) => [activity.id, activity]));

  const logbook = workbook.addWorksheet("Logbook");
  logbook.columns = [
    ["activity_date", "วันที่", 14], ["student_code", "รหัสนักศึกษา", 16], ["student_name", "ชื่อนักศึกษา", 28],
    ["activity", "กิจกรรม", 38], ["week", "สัปดาห์", 10], ["unit", "หน่วย/Ward", 22],
    ["case", "รหัสเคสแบบปกปิด", 20], ["diagnosis", "Diagnosis/ประสบการณ์", 32], ["procedure", "Procedure/หัวข้อ", 32],
    ["supervisor", "ผู้ควบคุม", 25], ["status", "สถานะ", 14], ["approved_at", "อนุมัติเมื่อ", 22],
    ["comment", "ความคิดเห็น", 34], ["revision", "Revision", 10], ["sync", "OneDrive sync", 14],
  ].map(([key, header, width]) => ({ key, header, width }));
  entries.forEach((entry) => {
    const student = studentMap.get(entry.student_id) || {};
    const activity = activityMap.get(entry.activity_type) || {};
    logbook.addRow({
      activity_date: entry.activity_date,
      student_code: student.student_code || "",
      student_name: student.full_name || entry.student_id,
      activity: activity.title_th || entry.activity_type,
      week: entry.week_number || "",
      unit: entry.unit_name || "",
      case: entry.patient_reference || "",
      diagnosis: entry.diagnosis || "",
      procedure: entry.procedure_name || entry.activity_title || "",
      supervisor: entry.supervisor_name || "",
      status: entry.status,
      approved_at: entry.approved_at || "",
      comment: entry.approver_comment || "",
      revision: entry.revision,
      sync: entry.onedrive_sync_status,
    });
  });
  styleHeader(logbook);

  const audit = workbook.addWorksheet("Approval Audit");
  audit.columns = [
    { key: "created", header: "เวลา", width: 24 }, { key: "entry", header: "Entry ID", width: 38 },
    { key: "student", header: "Student ID", width: 38 }, { key: "actor", header: "Actor ID", width: 38 },
    { key: "from", header: "จากสถานะ", width: 16 }, { key: "to", header: "เป็นสถานะ", width: 16 },
    { key: "comment", header: "ความคิดเห็น", width: 40 }, { key: "revision", header: "Revision", width: 10 },
  ];
  events.forEach((event) => audit.addRow({ created: event.created_at, entry: event.entry_id, student: event.student_id, actor: event.actor_id, from: event.from_status || "", to: event.to_status, comment: event.comment || "", revision: event.revision }));
  styleHeader(audit);

  const manifest = workbook.addWorksheet("Manifest");
  manifest.addRows([
    ["รายการ", "ค่า"],
    ["Generated at", new Date().toISOString()],
    ["Timezone", "Asia/Bangkok"],
    ["Students", students.length],
    ["Logbook entries", entries.length],
    ["Approval events", events.length],
    ["Source", "Supabase PostgreSQL with Row Level Security"],
  ]);
  manifest.getColumn(1).width = 24;
  manifest.getColumn(2).width = 54;
  styleHeader(manifest);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

async function graphToken() {
  const clientId = process.env.MICROSOFT_CLIENT_ID;
  const clientSecret = process.env.MICROSOFT_CLIENT_SECRET;
  const refreshToken = process.env.MICROSOFT_REFRESH_TOKEN;
  const delegated = Boolean(refreshToken);
  const tenantId = process.env.MICROSOFT_TENANT_ID || (delegated ? "consumers" : "");
  if (!tenantId || !clientId || !clientSecret) throw new Error("ยังไม่ได้ตั้งค่า Microsoft App บน Vercel");
  const body = delegated
    ? new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        scope: "offline_access https://graph.microsoft.com/Files.ReadWrite",
        grant_type: "refresh_token",
      })
    : new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        scope: "https://graph.microsoft.com/.default",
        grant_type: "client_credentials",
      });
  const response = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.access_token) throw new Error(payload.error_description || "Microsoft Entra ไม่ออก access token");
  return { accessToken: payload.access_token, delegated };
}

function driveRoot(delegated, accountId) {
  if (delegated) return "https://graph.microsoft.com/v1.0/me/drive";
  if (!accountId) throw new Error("ยังไม่ได้ระบุ ONEDRIVE_ACCOUNT_ID ของบัญชีภาควิชา");
  return `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(accountId)}/drive`;
}

async function ensureFolder(token, root) {
  const endpoint = `${root}/root/children`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Logbook-Year4", folder: {}, "@microsoft.graph.conflictBehavior": "fail" }),
  });
  if (response.ok || response.status === 409) return;
  const payload = await response.json().catch(() => ({}));
  throw new Error(payload.error?.message || `สร้างโฟลเดอร์ OneDrive ไม่สำเร็จ (${response.status})`);
}

async function uploadWorkbook(token, root, fileName, buffer) {
  const endpoint = `${root}/root:/Logbook-Year4/${encodeURIComponent(fileName)}:/content`;
  const response = await fetch(endpoint, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": XLSX_MIME },
    body: buffer,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error?.message || `อัปโหลด OneDrive ไม่สำเร็จ (${response.status})`);
  return payload;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return send(res, 405, { error: "Method not allowed" });
  try {
    const accessToken = req.headers.authorization?.replace(/^Bearer\s+/i, "");
    if (!accessToken) return send(res, 401, { error: "กรุณาเข้าสู่ระบบก่อนสำรองข้อมูล" });
    const supabaseUrl = process.env.VITE_SUPABASE_URL;
    const supabaseKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
    if (!supabaseUrl || !supabaseKey) throw new Error("ยังไม่ได้ตั้งค่า Supabase environment บน Vercel");
    const supabase = createClient(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: userData, error: userError } = await supabase.auth.getUser(accessToken);
    if (userError || !userData.user) return send(res, 401, { error: "Session หมดอายุ กรุณาเข้าสู่ระบบใหม่" });
    const { data: caller, error: callerError } = await supabase.from("profiles").select("role,active").eq("id", userData.user.id).single();
    if (callerError || caller?.role !== "staff" || !caller.active) return send(res, 403, { error: "เฉพาะ Staff เท่านั้นที่สำรองข้อมูลทั้งหมดได้" });

    const [studentResult, entryResult, activityResult, eventResult] = await Promise.all([
      supabase.from("profiles").select("id,student_code,full_name").eq("role", "student").eq("active", true),
      supabase.from("year4_logbook_entries").select("*").order("activity_date", { ascending: false }),
      supabase.from("year4_activity_definitions").select("id,title_th"),
      supabase.from("year4_approval_events").select("*").order("created_at", { ascending: false }),
    ]);
    const queryError = [studentResult.error, entryResult.error, activityResult.error, eventResult.error].find(Boolean);
    if (queryError) throw queryError;

    const timestamp = bangkokTimestamp();
    const fileName = `Year4_Logbook_Backup_${timestamp}.xlsx`;
    const buffer = await makeWorkbook(entryResult.data, studentResult.data, activityResult.data, eventResult.data);
    const auth = await graphToken();
    const root = driveRoot(auth.delegated, process.env.ONEDRIVE_ACCOUNT_ID);
    await ensureFolder(auth.accessToken, root);
    const uploaded = await uploadWorkbook(auth.accessToken, root, fileName, buffer);

    const approvedIds = entryResult.data.filter((entry) => entry.status === "approved").map((entry) => entry.id);
    if (approvedIds.length) {
      await supabase.from("year4_logbook_entries").update({ onedrive_sync_status: "synced", onedrive_item_id: uploaded.id, onedrive_synced_at: new Date().toISOString() }).in("id", approvedIds);
    }
    return send(res, 200, {
      ok: true,
      fileName,
      itemId: uploaded.id,
      webUrl: uploaded.webUrl || "",
      timestamp,
      authMode: auth.delegated ? "delegated" : "application",
    });
  } catch (error) {
    console.error("OneDrive backup failed", error);
    return send(res, 500, { error: `สำรองข้อมูลไม่สำเร็จ: ${error.message}` });
  }
}
