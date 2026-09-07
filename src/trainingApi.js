import { supabase } from "./supabase";

function throwIfError(error) {
  if (error) throw error;
}

function throwActivationError(error) {
  if (!error) return;

  // Supabase intentionally returns a generic 500 when the auth.users trigger
  // rejects an address that is not present in our private allowlist.
  if (error.message === "Database error saving new user" || error.code === "unexpected_failure") {
    throw new Error("ไม่สามารถเปิดใช้งานบัญชีได้ กรุณาตรวจว่าอีเมลตรงกับรายชื่อ Staff/Fellow ทุกตัวอักษร (รวม . และ _) หรือติดต่อผู้ดูแลระบบ");
  }

  throw error;
}

const mapProfile = (row) => ({
  id: row.id,
  name: row.full_name,
  email: row.email,
  role: row.role,
});

const mapLogbook = (row) => {
  const procedureIds = [row.procedure_id, row.procedure_id_2, row.procedure_id_3].filter(Boolean);
  const operations = [row.operation, row.operation_2, row.operation_3].filter(Boolean);
  return {
    id: row.id,
    date: row.procedure_date,
    hn: row.patient_reference || "",
    diagnosis: row.diagnosis || "",
    procedureId: row.procedure_id || "",
    procedureId2: row.procedure_id_2 || "",
    procedureId3: row.procedure_id_3 || "",
    procedureIds,
    operation: row.operation,
    operation2: row.operation_2 || "",
    operation3: row.operation_3 || "",
    operations,
    operationSummary: operations.join(" + "),
    participation: row.participation,
    supervisor: row.supervisor_name,
    note: row.note || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

const mapAssessment = (row) => ({
  id: row.id,
  type: row.template_id.startsWith("EPA") ? "EPA" : "PBA",
  templateId: row.template_id,
  templateTitle: row.template_title,
  date: row.assessment_date,
  caseRef: row.activity_reference || "",
  scores: row.scores || {},
  itemComments: row.item_comments || {},
  globalLevel: String(row.global_level),
  comments: row.comments || "",
  assessor: row.profiles?.full_name || "Staff",
  supervisorName: row.supervisor_name,
});

const mapTopic = (row) => ({
  id: row.id,
  date: row.topic_date,
  title: row.title,
  category: "Learning activity",
  status: row.status,
  note: row.detail || "",
});

export async function signInWithPassword({ email, password, role }) {
  const result = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
  throwIfError(result.error);
  const profile = await getCurrentProfile();
  if (!profile || profile.role !== role) {
    await supabase.auth.signOut();
    throw new Error("บทบาทผู้ใช้งานไม่ตรงกับบัญชีที่ลงทะเบียน");
  }
  return profile;
}

export async function activateAccount({ email, password, role }) {
  const normalizedEmail = email.trim().toLowerCase();
  const result = await supabase.auth.signUp({
    email: normalizedEmail,
    password,
    options: { data: { requested_role: role } },
  });
  throwActivationError(result.error);
  if (result.data.user?.identities?.length === 0) {
    return { profile: null, message: "อีเมลนี้มีบัญชีแล้ว กรุณาเข้าสู่ระบบหรือใช้เมนูลืมรหัสผ่าน" };
  }
  if (!result.data.session) {
    return { profile: null, message: "สร้างบัญชีแล้ว กรุณายืนยันอีเมลก่อนเข้าสู่ระบบ" };
  }
  const profile = await getCurrentProfile();
  if (profile?.role !== role) {
    await supabase.auth.signOut();
    throw new Error("บทบาทผู้ใช้งานไม่ตรงกับรายชื่อที่ได้รับอนุญาต");
  }
  return { profile, message: "เปิดใช้งานบัญชีสำเร็จ" };
}

export async function getCurrentProfile() {
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) return null;
  const { data, error } = await supabase.from("profiles").select("id,email,full_name,role").eq("id", userData.user.id).single();
  throwIfError(error);
  return mapProfile(data);
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  throwIfError(error);
}

export async function requestPasswordReset(email) {
  const normalizedEmail = email.trim().toLowerCase();
  const redirectTo = `${window.location.origin}/reset-password`;
  const { error } = await supabase.auth.resetPasswordForEmail(normalizedEmail, { redirectTo });
  throwIfError(error);
  return "ส่งลิงก์เปลี่ยนรหัสผ่านแล้ว กรุณาตรวจ Inbox และ Junk mail";
}

export async function updatePassword(password) {
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  throwIfError(sessionError);
  if (!sessionData.session) {
    throw new Error("ลิงก์เปลี่ยนรหัสผ่านไม่ถูกต้องหรือหมดอายุ กรุณาขอลิงก์ใหม่จากหน้าเข้าสู่ระบบ");
  }
  const { error } = await supabase.auth.updateUser({ password });
  throwIfError(error);
}

export function subscribeToAuthChanges(callback) {
  const { data } = supabase.auth.onAuthStateChange((event, session) => callback(event, session));
  return () => data.subscription.unsubscribe();
}

export async function loadTrainingRecord(profile) {
  let fellowId = profile.id;
  let fellowName = profile.name;
  if (profile.role === "staff") {
    const { data, error } = await supabase.from("profiles").select("id,full_name").eq("role", "fellow").eq("active", true).order("created_at").limit(1).maybeSingle();
    throwIfError(error);
    fellowId = data?.id || null;
    fellowName = data?.full_name || "Fellow ยังไม่เปิดใช้งานบัญชี";
  }

  if (!fellowId) {
    return { fellowId: null, fellowName, logbook: [], epaAssessments: [], pbaAssessments: [], topics: [] };
  }

  const [logbook, epa, pba, topics] = await Promise.all([
    supabase.from("logbook_entries").select("*").eq("fellow_id", fellowId).order("procedure_date", { ascending: false }).order("updated_at", { ascending: false }),
    supabase.from("epa_assessments").select("*,profiles!epa_assessments_assessor_id_fkey(full_name)").eq("fellow_id", fellowId).order("assessment_date", { ascending: false }),
    supabase.from("pba_assessments").select("*,profiles!pba_assessments_assessor_id_fkey(full_name)").eq("fellow_id", fellowId).order("assessment_date", { ascending: false }),
    supabase.from("topics").select("*").eq("fellow_id", fellowId).order("topic_date", { ascending: false }),
  ]);
  [logbook.error, epa.error, pba.error, topics.error].forEach(throwIfError);
  return {
    fellowId,
    fellowName,
    logbook: logbook.data.map(mapLogbook),
    epaAssessments: epa.data.map(mapAssessment),
    pbaAssessments: pba.data.map(mapAssessment),
    topics: topics.data.map(mapTopic),
  };
}

export async function createLogbookEntry(profile, fellowId, item) {
  const { data, error } = await supabase.from("logbook_entries").insert({
    fellow_id: fellowId,
    recorded_by: profile.id,
    procedure_id: item.procedureId || null,
    operation: item.operation,
    procedure_id_2: item.procedureId2 || null,
    operation_2: item.operation2 || null,
    procedure_id_3: item.procedureId3 || null,
    operation_3: item.operation3 || null,
    procedure_date: item.date,
    patient_reference: item.hn || null,
    diagnosis: item.diagnosis || null,
    participation: item.participation,
    supervisor_name: item.supervisor,
    note: item.note || null,
  }).select().single();
  throwIfError(error);
  return mapLogbook(data);
}

export async function updateLogbookEntry(profile, item) {
  if (profile.role !== "fellow") {
    throw new Error("เฉพาะ Fellow เท่านั้นที่แก้ไข Logbook ผ่านหน้านี้ได้");
  }

  const { data, error } = await supabase.from("logbook_entries").update({
    procedure_id: item.procedureId || null,
    operation: item.operation,
    procedure_id_2: item.procedureId2 || null,
    operation_2: item.operation2 || null,
    procedure_id_3: item.procedureId3 || null,
    operation_3: item.operation3 || null,
    procedure_date: item.date,
    patient_reference: item.hn || null,
    diagnosis: item.diagnosis || null,
    participation: item.participation,
    supervisor_name: item.supervisor,
    note: item.note || null,
  }).eq("id", item.id).eq("fellow_id", profile.id).select().single();
  throwIfError(error);
  return mapLogbook(data);
}

export async function createAssessment(profile, fellowId, type, item) {
  const table = type === "EPA" ? "epa_assessments" : "pba_assessments";
  const { data, error } = await supabase.from(table).insert({
    fellow_id: fellowId,
    assessor_id: profile.id,
    supervisor_name: item.supervisorName,
    template_id: item.templateId,
    template_title: item.templateTitle,
    assessment_date: item.date,
    activity_reference: item.caseRef || null,
    scores: item.scores,
    item_comments: item.itemComments,
    global_level: Number(item.globalLevel),
    comments: item.comments || null,
  }).select("*,profiles!" + (type === "EPA" ? "epa_assessments_assessor_id_fkey" : "pba_assessments_assessor_id_fkey") + "(full_name)").single();
  throwIfError(error);
  return mapAssessment(data);
}

export async function createTopic(profile, fellowId, item) {
  const { data, error } = await supabase.from("topics").insert({
    fellow_id: fellowId,
    recorded_by: profile.id,
    topic_date: item.date,
    title: item.title,
    detail: [item.category, item.note].filter(Boolean).join(" · ") || null,
    status: item.status,
  }).select().single();
  throwIfError(error);
  return mapTopic(data);
}

export async function backupTrainingData() {
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  throwIfError(sessionError);
  const accessToken = sessionData.session?.access_token;
  if (!accessToken) throw new Error("กรุณาเข้าสู่ระบบใหม่ก่อนสำรองข้อมูล");

  const response = await fetch("/api/backup", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "ไม่สามารถสำรองข้อมูลไปยัง Google Drive ได้");
  return payload;
}
