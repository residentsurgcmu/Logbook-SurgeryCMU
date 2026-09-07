import { createClient } from "@supabase/supabase-js";
import ExcelJS from "exceljs";
import { OAuth2Client } from "google-auth-library";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || "https://daiamyswpjkkgbrmovgl.supabase.co";
const SUPABASE_KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || "sb_publishable_T3VyrBrK6N71sjOGUQeJAg_Zx4tv5uI";
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const FOLDER_MIME = "application/vnd.google-apps.folder";

function response(res, status, payload) {
  res.status(status).setHeader("Content-Type", "application/json; charset=utf-8").send(JSON.stringify(payload));
}

function bangkokTimestamp() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date()).reduce((result, part) => ({ ...result, [part.type]: part.value }), {});
  return `${parts.year}-${parts.month}-${parts.day}_${parts.hour}${parts.minute}${parts.second}`;
}

function formatJson(value) {
  return Object.entries(value || {}).map(([key, item]) => `${key}: ${item}`).join(" | ");
}

function addSheet(workbook, title, columns, rows) {
  const sheet = workbook.addWorksheet(title, { views: [{ state: "frozen", ySplit: 1 }] });
  sheet.columns = columns.map((column) => ({ header: column.header, key: column.key, width: column.width || 16 }));
  rows.forEach((row) => sheet.addRow(row));
  const header = sheet.getRow(1);
  header.height = 25;
  header.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF9F1239" } };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  });
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber > 1) row.alignment = { vertical: "top", wrapText: true };
  });
  sheet.autoFilter = { from: "A1", to: `${sheet.getColumn(columns.length).letter}1` };
  return sheet;
}

async function workbookBuffer(type, rows, profiles) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Breast & Endocrine Surgery CMU";
  workbook.created = new Date();
  const person = (id) => profiles.get(id) || {};

  if (type === "Logbook") {
    addSheet(workbook, "Logbook", [
      { key: "date", header: "Date", width: 14 }, { key: "fellow", header: "Fellow", width: 25 },
      { key: "operation", header: "Operation 1", width: 34 }, { key: "operation2", header: "Operation 2", width: 34 },
      { key: "operation3", header: "Operation 3", width: 34 }, { key: "participation", header: "Role", width: 14 },
      { key: "supervisor", header: "Supervisor", width: 25 }, { key: "reference", header: "Case reference", width: 18 },
      { key: "diagnosis", header: "Diagnosis", width: 28 }, { key: "note", header: "Note", width: 34 },
      { key: "recordedBy", header: "Recorded by", width: 25 }, { key: "createdAt", header: "Created at", width: 22 },
    ], rows.map((row) => ({
      date: row.procedure_date, fellow: person(row.fellow_id).full_name || row.fellow_id,
      operation: row.operation, operation2: row.operation_2 || "", operation3: row.operation_3 || "",
      participation: row.participation, supervisor: row.supervisor_name,
      reference: row.patient_reference || "", diagnosis: row.diagnosis || "", note: row.note || "",
      recordedBy: person(row.recorded_by).full_name || row.recorded_by, createdAt: row.created_at,
    })));
  } else {
    addSheet(workbook, type, [
      { key: "date", header: "Date", width: 14 }, { key: "fellow", header: "Fellow", width: 25 },
      { key: "template", header: "Template", width: 12 }, { key: "title", header: "Title", width: 36 },
      { key: "supervisor", header: "Supervisor", width: 25 }, { key: "assessor", header: "Assessed by", width: 25 },
      { key: "level", header: "Global level", width: 14 }, { key: "reference", header: "Activity reference", width: 20 },
      { key: "scores", header: "Checklist scores", width: 42 }, { key: "itemComments", header: "Item comments", width: 42 },
      { key: "comments", header: "Summary comments", width: 38 }, { key: "createdAt", header: "Created at", width: 22 },
    ], rows.map((row) => ({
      date: row.assessment_date, fellow: person(row.fellow_id).full_name || row.fellow_id,
      template: row.template_id, title: row.template_title, supervisor: row.supervisor_name,
      assessor: person(row.assessor_id).full_name || row.assessor_id, level: row.global_level,
      reference: row.activity_reference || "", scores: formatJson(row.scores), itemComments: formatJson(row.item_comments),
      comments: row.comments || "", createdAt: row.created_at,
    })));
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

async function driveRequest(token, url, options = {}) {
  const result = await fetch(url, { ...options, headers: { Authorization: `Bearer ${token}`, ...(options.headers || {}) } });
  const payload = await result.json().catch(() => ({}));
  if (!result.ok) throw new Error(payload.error?.message || `Google Drive API error ${result.status}`);
  return payload;
}

async function createFolder(token, name, parentId) {
  return driveRequest(token, "https://www.googleapis.com/drive/v3/files?fields=id,name,webViewLink&supportsAllDrives=true", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, mimeType: FOLDER_MIME, ...(parentId ? { parents: [parentId] } : {}) }),
  });
}

async function getBackupRoot(token) {
  if (process.env.GOOGLE_DRIVE_BACKUP_FOLDER_ID) return { id: process.env.GOOGLE_DRIVE_BACKUP_FOLDER_ID };
  const name = process.env.GOOGLE_DRIVE_BACKUP_ROOT_NAME || "Breast Training Backups";
  const query = encodeURIComponent(`name = '${name.replaceAll("'", "\\'")}' and mimeType = '${FOLDER_MIME}' and trashed = false`);
  const list = await driveRequest(token, `https://www.googleapis.com/drive/v3/files?q=${query}&spaces=drive&fields=files(id,name,webViewLink)&pageSize=1`);
  return list.files?.[0] || createFolder(token, name);
}

async function uploadWorkbook(token, folderId, name, buffer) {
  const boundary = `breast_training_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const metadata = Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name, mimeType: XLSX_MIME, parents: [folderId] })}\r\n--${boundary}\r\nContent-Type: ${XLSX_MIME}\r\n\r\n`);
  const ending = Buffer.from(`\r\n--${boundary}--`);
  const result = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink&supportsAllDrives=true", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": `multipart/related; boundary=${boundary}` },
    body: Buffer.concat([metadata, buffer, ending]),
  });
  const payload = await result.json().catch(() => ({}));
  if (!result.ok) throw new Error(payload.error?.message || `Google Drive upload error ${result.status}`);
  return payload;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return response(res, 405, { error: "Method not allowed" });
  try {
    const accessToken = req.headers.authorization?.replace(/^Bearer\s+/i, "");
    if (!accessToken) return response(res, 401, { error: "กรุณาเข้าสู่ระบบก่อนสำรองข้อมูล" });

    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: userData, error: userError } = await supabase.auth.getUser(accessToken);
    if (userError || !userData.user) return response(res, 401, { error: "Session หมดอายุ กรุณาเข้าสู่ระบบใหม่" });
    const { data: caller, error: profileError } = await supabase.from("profiles").select("id,role,active").eq("id", userData.user.id).single();
    if (profileError || caller?.role !== "staff" || !caller.active) return response(res, 403, { error: "เฉพาะ Staff เท่านั้นที่สำรองข้อมูลทั้งหมดได้" });

    const [profileResult, logbookResult, epaResult, pbaResult] = await Promise.all([
      supabase.from("profiles").select("id,full_name,email"),
      supabase.from("logbook_entries").select("*").order("procedure_date", { ascending: false }),
      supabase.from("epa_assessments").select("*").order("assessment_date", { ascending: false }),
      supabase.from("pba_assessments").select("*").order("assessment_date", { ascending: false }),
    ]);
    const queryError = [profileResult.error, logbookResult.error, epaResult.error, pbaResult.error].find(Boolean);
    if (queryError) throw queryError;

    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;
    if (!clientId || !clientSecret || !refreshToken) {
      return response(res, 503, { error: "ยังไม่ได้เชื่อม Google Drive สำหรับระบบสำรอง กรุณาตั้งค่า OAuth บน Vercel" });
    }
    const oauth = new OAuth2Client(clientId, clientSecret);
    oauth.setCredentials({ refresh_token: refreshToken });
    const tokenResult = await oauth.getAccessToken();
    if (!tokenResult.token) throw new Error("Google OAuth did not return an access token");

    const timestamp = bangkokTimestamp();
    const profiles = new Map(profileResult.data.map((profile) => [profile.id, profile]));
    const files = await Promise.all([
      workbookBuffer("EPA", epaResult.data, profiles),
      workbookBuffer("PBA", pbaResult.data, profiles),
      workbookBuffer("Logbook", logbookResult.data, profiles),
    ]);
    const root = await getBackupRoot(tokenResult.token);
    const batchFolder = await createFolder(tokenResult.token, timestamp, root.id);
    const types = ["EPA", "PBA", "Logbook"];
    const uploaded = [];
    for (let index = 0; index < types.length; index += 1) {
      const category = await createFolder(tokenResult.token, types[index], batchFolder.id);
      uploaded.push(await uploadWorkbook(tokenResult.token, category.id, `${types[index]}_Backup_${timestamp}.xlsx`, files[index]));
    }
    return response(res, 200, {
      ok: true, timestamp, fileCount: uploaded.length,
      folderUrl: batchFolder.webViewLink || `https://drive.google.com/drive/folders/${batchFolder.id}`,
    });
  } catch (error) {
    console.error("Backup failed", error);
    return response(res, 500, { error: `สำรองข้อมูลไม่สำเร็จ: ${error.message}` });
  }
}
