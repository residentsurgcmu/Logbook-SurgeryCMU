import { supabase } from "./supabase";
import { residentTemplates } from "./generated/residentTemplates";
import { normalizeResidentEmail, passwordResetRedirect } from "./residentAuth";

const fail = (error) => { if (error) throw error; };
const mapProfile = (row) => ({ id: row.user_id, name: row.full_name, email: row.email, pgy: row.pgy, active: row.active });

export async function signIn({ email, password }) {
  const { data, error } = await supabase.auth.signInWithPassword({ email: normalizeResidentEmail(email), password });
  fail(error);
  return data.user;
}

export async function signOut() { const { error } = await supabase.auth.signOut(); fail(error); }
export async function updatePassword(password) { const { error } = await supabase.auth.updateUser({ password }); fail(error); }
export function onAuthChange(listener) { return supabase.auth.onAuthStateChange((event, session) => listener(event, session)); }

export async function getResidentSession() {
  const { data, error } = await supabase.auth.getSession();
  fail(error);
  return data.session;
}

export async function requestPasswordReset(email) {
  const configuredAppUrl = import.meta.env.VITE_APP_URL?.trim();
  const appUrl = configuredAppUrl || window.location.origin;
  const { error } = await supabase.auth.resetPasswordForEmail(normalizeResidentEmail(email), {
    redirectTo: passwordResetRedirect(appUrl),
  });
  fail(error);
  // Do not reveal whether this email is a valid Resident, Staff, or Admin account.
  return "หากอีเมลนี้มีบัญชีในระบบ ระบบจะส่งลิงก์ตั้งรหัสผ่านใหม่ให้ กรุณาตรวจ Inbox และ Junk mail";
}

export async function loadResidentWorkspace() {
  // An anonymous browser has no stored session. Treat that as the normal
  // sign-in state rather than surfacing Supabase's "Auth session missing".
  const session = await getResidentSession();
  if (!session) return null;
  const { data: authData, error: authError } = await supabase.auth.getUser(session.access_token);
  fail(authError);
  if (!authData.user) return null;
  const [{ data: role, error: roleError }, { data: profile, error: profileError }] = await Promise.all([
    supabase.from("resident_user_roles").select("role,active").eq("user_id", authData.user.id).maybeSingle(),
    supabase.from("resident_profiles").select("*").eq("user_id", authData.user.id).maybeSingle(),
  ]);
  fail(roleError); fail(profileError);
  if (!role?.active || !profile?.active) return { unauthorized: true, email: authData.user.email || "" };
  const directoryQuery = role.role === "admin"
    ? supabase.from("resident_staff_directory").select("email,full_name,unit_name,active,auth_user_id,invited_at").order("unit_name").order("full_name")
    : Promise.resolve({ data: [], error: null });
  const [{ data: templates, error: templatesError }, { data: assessments, error: assessmentsError }, { data: profiles, error: profilesError }, { data: assignments, error: assignmentsError }, { data: staffDirectory, error: staffDirectoryError }] = await Promise.all([
    supabase.from("resident_template_definitions").select("*,resident_template_criteria(*)").eq("active", true).order("template_code"),
    supabase.from("resident_assessments").select("*,resident_template_definitions(template_code,title,template_type),resident_assessment_scores(*,resident_template_criteria(criterion_code,criterion_text,sort_order))").order("assessment_date", { ascending: false }),
    supabase.from("resident_profiles").select("*").eq("active", true).order("full_name"),
    supabase.from("resident_evaluator_assignments").select("*").eq("active", true),
    directoryQuery,
  ]);
  fail(templatesError); fail(assessmentsError); fail(profilesError); fail(assignmentsError); fail(staffDirectoryError);
  return { user: { ...mapProfile(profile), role: role.role }, templates: (templates || []).map((template) => ({ ...template, criteria: (template.resident_template_criteria || []).sort((a, b) => a.sort_order - b.sort_order) })), assessments: assessments || [], profiles: (profiles || []).map(mapProfile), assignments: assignments || [], staffDirectory: staffDirectory || [] };
}

export async function syncSourceTemplates() {
  for (const source of residentTemplates) {
    const { data: template, error } = await supabase.from("resident_template_definitions").upsert({ template_code: source.code, template_type: source.type, title: source.title, source_file: source.sourceFile, source_hash: source.sourceHash, score_options: source.scoreOptions, active: true }, { onConflict: "template_code" }).select().single();
    fail(error);
    const criteria = source.criteria.map((criterion) => ({ template_id: template.id, criterion_code: criterion.code, section_title: criterion.section, criterion_text: criterion.label, sort_order: criterion.sortOrder, active: true }));
    const { error: criteriaError } = await supabase.from("resident_template_criteria").upsert(criteria, { onConflict: "template_id,criterion_code" });
    fail(criteriaError);
  }
}

export async function createAssessment(form) {
  const { data, error } = await supabase.rpc("create_resident_assessment", {
    p_template_id: form.templateId, p_resident_id: form.residentId, p_assessment_date: form.date,
    p_clinical_context: form.context.trim(), p_procedure_or_activity: form.activity.trim(),
    p_overall_outcome: form.outcome.trim(), p_overall_comment: form.comment.trim(), p_scores: form.scores,
  });
  fail(error); return data;
}

export async function saveAssignment(staffId, residentId) {
  const { error } = await supabase.from("resident_evaluator_assignments").upsert({ evaluator_id: staffId, resident_id: residentId, active: true }, { onConflict: "evaluator_id,resident_id" });
  fail(error);
}

export async function provisionAccount(payload) {
  const { data, error } = await supabase.functions.invoke("resident-admin", { body: { action: "provision_account", ...payload } });
  fail(error); if (!data?.ok) throw new Error(data?.error || "Could not provision account"); return data;
}

export async function inviteStaff(email) {
  const { data, error } = await supabase.functions.invoke("resident-admin", { body: { action: "invite_staff", email: normalizeResidentEmail(email) } });
  fail(error); if (!data?.ok) throw new Error(data?.error || "Could not provision account"); return data;
}
