import { supabase } from "./supabase";
import { appUrl } from "./appConfig";
import { year4Activities } from "./year4Data";

function throwIfError(error) {
  if (error) throw error;
}

function throwAuthEmailError(error) {
  if (!error) return;
  if (error.code === "over_email_send_rate_limit" || /email rate limit/i.test(error.message || "")) {
    throw new Error("ระบบส่งอีเมลกำลังมีคำขอจำนวนมาก กรุณารอประมาณ 1 นาทีแล้วลองอีกครั้งเพียงครั้งเดียว");
  }
  throw error;
}

const mapProfile = (row) => ({
  id: row.id,
  name: row.full_name,
  email: row.email,
  role: row.role,
  active: row.active !== false,
  studentCode: row.student_code || "",
  studentGroup: row.student_group || "",
  cohortYear: row.cohort_year || null,
  qrToken: row.qr_token || "",
  avatarPath: row.avatar_path || "",
});

const mapCurriculum = (row) => ({
  id: row.id, code: row.code, classYear: row.class_year, academicYear: row.academic_year,
  name: row.name, passPercent: row.pass_percent, status: row.status,
  sourceFilename: row.source_filename || "", version: row.version,
});

const mapEnrollment = (row, curricula = new Map()) => {
  const curriculum = curricula.get(row.curriculum_id);
  return {
    id: row.id, studentId: row.student_id, curriculumId: row.curriculum_id,
    classYear: curriculum?.classYear || null, academicYear: curriculum?.academicYear || null,
    curriculumName: curriculum?.name || "", passPercent: curriculum?.passPercent || 80, groupCode: row.group_code,
    rotationId: row.rotation_id || "", status: row.status,
    activatedAt: row.activated_at, completedAt: row.completed_at,
  };
};

const curriculumActivityFieldOverrides = {
  "ipd-patient-care": ["week", "patient", "diagnosis", "unit", "detail"],
  "opd-attendance": ["week", "unit", "detail"],
  "opd-examined-case": ["patient", "unit", "detail"],
  "major-operation-observe": ["week", "patient", "diagnosis", "procedure", "detail"],
  "major-operation-assist": ["patient", "diagnosis", "procedure", "detail"],
  "minor-operation": ["patient", "diagnosis", "procedure", "detail"],
  "major-trauma-first-aid": ["patient", "diagnosis", "procedure", "detail"],
  "wound-suture": ["patient", "diagnosis", "unit", "detail"],
  "foley-catheter": ["patient", "diagnosis", "unit", "detail"],
  "cvp-measurement": ["patient", "diagnosis", "unit", "detail"],
  "er-duty": ["detail"],
  "resident-teaching": ["week", "title", "detail"],
};

const mapActivity = (row, curricula = new Map()) => {
  const classYear = curricula.get(row.curriculum_id)?.classYear || null;
  // Activity codes such as foley-catheter exist in more than one curriculum.
  // Choose the curriculum-specific layout first, then always add every field
  // required by the published database definition so a required field is never
  // hidden from a student.
  const curriculumFields = classYear === 4
    ? year4Activities.find((item) => item.id === row.activity_code)?.fields
    : curriculumActivityFieldOverrides[row.activity_code];
  const requiredFields = [
    row.requires_week && "week",
    row.requires_patient && "patient",
    row.requires_procedure && "procedure",
    "supervisor",
    "detail",
  ].filter(Boolean);

  return {
    id: row.activity_code,
    definitionId: row.id,
    curriculumId: row.curriculum_id,
    classYear,
    title: row.title_th,
    group: row.group_name,
    target: row.target_count,
    unit: row.target_unit,
    sortOrder: row.sort_order,
    fields: [...new Set([...(curriculumFields || []), ...requiredFields])],
    active: row.active,
  };
};

const mapEntry = (row, profiles = new Map(), enrollments = new Map()) => ({
  id: row.id,
  studentId: row.student_id,
  activityType: row.activity_type,
  date: row.activity_date,
  weekNumber: row.week_number,
  unitName: row.unit_name || "",
  patientReference: row.patient_reference || "",
  diagnosis: row.diagnosis || "",
  procedureName: row.procedure_name || "",
  participation: row.participation || "",
  activityTitle: row.activity_title || "",
  supervisorName: row.supervisor_name || "",
  selectedApproverId: row.selected_approver_email || "",
  selectedApproverName: profiles.get(row.selected_approver_email)?.name || "",
  detail: row.detail || "",
  status: row.status,
  submittedAt: row.submitted_at,
  approvedAt: row.approved_at,
  approvedBy: row.approved_by,
  approverName: profiles.get(row.approved_by)?.name || "",
  approverComment: row.approver_comment || "",
  revision: row.revision,
  oneDriveSyncStatus: row.onedrive_sync_status,
  oneDriveSyncedAt: row.onedrive_synced_at,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  academicYear: row.academic_year,
  enrollmentId: row.enrollment_id || "",
  curriculumId: enrollments.get(row.enrollment_id)?.curriculumId || "",
  enrollmentGroup: enrollments.get(row.enrollment_id)?.groupCode || "",
  classYear: enrollments.get(row.enrollment_id)?.classYear || null,
  curriculumActivityId: row.curriculum_activity_id || "",
  rotationId: row.curriculum_rotation_id || row.rotation_id || "",
});

const mapRotation = (row, curricula = new Map()) => ({
  id: row.id,
  curriculumId: row.curriculum_id,
  classYear: curricula.get(row.curriculum_id)?.classYear || null,
  academicYear: curricula.get(row.curriculum_id)?.academicYear || null,
  groupCode: row.group_code,
  name: row.name,
  startDate: row.start_date,
  endDate: row.end_date,
  status: row.status,
});

const mapCertification = (row) => ({
  id: row.id,
  studentId: row.student_id,
  enrollmentId: row.enrollment_id || "",
  academicYear: row.academic_year,
  rotationId: row.curriculum_rotation_id || row.rotation_id || "",
  selectedCertifierEmail: row.selected_certifier_email,
  status: row.status,
  submittedAt: row.submitted_at,
  certifiedBy: row.certified_by,
  certifiedAt: row.certified_at,
  certifierNote: row.certifier_note || "",
});

export async function signInYear4({ email, password, role }) {
  const normalizedEmail = email.trim().toLowerCase();
  const { error } = await supabase.auth.signInWithPassword({ email: normalizedEmail, password });
  throwIfError(error);
  const profile = await getCurrentYear4Profile();
  if (profile && !profile.active) {
    await supabase.auth.signOut();
    throw new Error("บัญชีนี้ถูกปิดใช้งาน กรุณาติดต่อ Admin");
  }
  if (!profile || profile.role !== role) {
    await supabase.auth.signOut();
    throw new Error("บทบาทผู้ใช้งานไม่ตรงกับบัญชีที่ได้รับอนุญาต");
  }
  return profile;
}

export async function activateYear4Account({ email, password, role, fullName = "", studentCode = "", studentGroup = "" }) {
  const normalizedEmail = email.trim().toLowerCase();
  const { data, error } = await supabase.auth.signUp({
    email: normalizedEmail,
    password,
    options: {
      emailRedirectTo: appUrl,
      data: {
        requested_role: role,
        full_name: fullName.trim(),
        student_code: studentCode.trim(),
        student_group: studentGroup.trim(),
      },
    },
  });
  if (error?.message === "Database error saving new user" || error?.code === "unexpected_failure") {
    throw new Error(role === "staff" || role === "admin"
      ? `อีเมล ${role === "admin" ? "Admin" : "Staff"} ไม่อยู่ในรายชื่อที่ได้รับอนุญาต กรุณาติดต่อผู้ดูแลระบบ`
      : "ไม่สามารถสร้างบัญชี Student ได้ กรุณาตรวจว่าระบบเปิดรับนักศึกษารุ่นปัจจุบันแล้ว");
  }
  throwAuthEmailError(error);
  if (data.user?.identities?.length === 0) {
    return { profile: null, message: "อีเมลนี้มีบัญชีแล้ว กรุณาเข้าสู่ระบบหรือใช้เมนูลืมรหัสผ่าน" };
  }
  if (!data.session) {
    return { profile: null, message: "สร้างบัญชีแล้ว กรุณากดลิงก์ยืนยันที่ส่งไปทางอีเมลก่อนเข้าสู่ระบบ" };
  }
  const profile = await getCurrentYear4Profile();
  if (profile?.role !== role) {
    await supabase.auth.signOut();
    throw new Error("บทบาทผู้ใช้งานไม่ตรงกับรายชื่อที่ได้รับอนุญาต");
  }
  return { profile, message: "เปิดใช้งานบัญชีสำเร็จ" };
}

export async function getCurrentYear4Profile() {
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) return null;
  const { data, error } = await supabase
    .from("profiles")
    .select("id,email,full_name,role,active,student_code,student_group,cohort_year,qr_token,avatar_path")
    .eq("id", userData.user.id)
    .single();
  throwIfError(error);
  return mapProfile(data);
}

export async function signOutYear4() {
  const { error } = await supabase.auth.signOut();
  throwIfError(error);
}

export async function requestYear4PasswordReset(email) {
  const redirectTo = `${appUrl}/reset-password`;
  const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), { redirectTo });
  throwAuthEmailError(error);
  return "หากอีเมลนี้มีบัญชีอยู่ ระบบจะส่งลิงก์เปลี่ยนรหัสผ่านให้ กรุณารอ 1–2 นาทีแล้วตรวจ Inbox และ Junk mail";
}

export async function updateYear4Password(password) {
  const { data, error } = await supabase.auth.getSession();
  throwIfError(error);
  if (!data.session) throw new Error("ลิงก์ไม่ถูกต้องหรือหมดอายุ กรุณาขอลิงก์ใหม่");
  const result = await supabase.auth.updateUser({ password });
  throwIfError(result.error);
}

export function subscribeToYear4Auth(callback) {
  const { data } = supabase.auth.onAuthStateChange((event, session) => callback(event, session));
  return () => data.subscription.unsubscribe();
}

export async function loadYear4Record(profile) {
  const canViewAllStudents = profile.role === "staff" || profile.role === "admin";
  const profileQuery = canViewAllStudents
    ? supabase.from("profiles").select("id,email,full_name,role,active,student_code,student_group,cohort_year,qr_token,avatar_path").eq("role", "student").eq("active", true).order("student_code")
    : supabase.from("profiles").select("id,email,full_name,role,active,student_code,student_group,cohort_year,qr_token,avatar_path").eq("id", profile.id);
  const eventsQuery = profile.role === "admin"
    ? supabase.from("year4_approval_events").select("*").order("created_at", { ascending: false })
    : Promise.resolve({ data: [], error: null });
  const [profilesResult, staffResult, staffProfilesResult, entriesResult, eventsResult, rotationsResult, certificationsResult, curriculaResult, activitiesResult, approversResult, enrollmentsResult] = await Promise.all([
    profileQuery,
    // RLS already exposes only active Staff rows. Keep this query limited to
    // the two columns granted to authenticated users; filtering on protected
    // role/active columns makes PostgREST reject the whole request with 403.
    supabase.from("user_directory").select("email,full_name").order("full_name"),
    supabase.from("profiles").select("id,email,full_name,role,active,student_code,student_group,cohort_year,qr_token,avatar_path").eq("role", "staff").eq("active", true),
    supabase.from("year4_logbook_entries").select("*").order("activity_date", { ascending: false }).order("updated_at", { ascending: false }),
    eventsQuery,
    supabase.from("curriculum_rotations").select("*").order("start_date", { ascending: false }).order("group_code"),
    supabase.from("year4_logbook_certifications").select("*").order("submitted_at", { ascending: false }),
    supabase.from("curricula").select("*").order("academic_year", { ascending: false }).order("class_year"),
    supabase.from("curriculum_activities").select("*").eq("active", true).order("sort_order"),
    supabase.from("curriculum_staff_approvers").select("curriculum_id,staff_email,unit_name").eq("active", true),
    supabase.from("student_enrollments").select("*").order("activated_at", { ascending: false }),
  ]);
  throwIfError(profilesResult.error);
  throwIfError(staffResult.error);
  throwIfError(staffProfilesResult.error);
  throwIfError(entriesResult.error);
  throwIfError(eventsResult.error);
  throwIfError(rotationsResult.error);
  throwIfError(certificationsResult.error);
  throwIfError(curriculaResult.error);
  throwIfError(activitiesResult.error);
  throwIfError(approversResult.error);
  throwIfError(enrollmentsResult.error);
  const curricula = (curriculaResult.data || []).map(mapCurriculum);
  const curriculumMap = new Map(curricula.map((item) => [item.id, item]));
  const enrollments = (enrollmentsResult.data || []).map((row) => mapEnrollment(row, curriculumMap));
  const enrollmentMap = new Map(enrollments.map((item) => [item.id, item]));
  const activeEnrollmentMap = new Map(enrollments.filter((item) => item.status === "active").map((item) => [item.studentId, item]));
  const students = profilesResult.data.map(mapProfile).map((student) => {
    const activeEnrollment = activeEnrollmentMap.get(student.id) || null;
    return { ...student, activeEnrollment, classYear: activeEnrollment?.classYear || 4, academicYear: activeEnrollment?.academicYear || student.cohortYear, studentGroup: activeEnrollment?.groupCode || student.studentGroup };
  });
  const approversByEmail = new Map();
  (approversResult.data || []).forEach((item) => {
    const current = approversByEmail.get(item.staff_email) || [];
    current.push({ curriculumId: item.curriculum_id, unitName: item.unit_name });
    approversByEmail.set(item.staff_email, current);
  });
  const staff = staffResult.data.map((row) => ({ id: row.email, email: row.email, name: row.full_name, role: "staff", curriculumAssignments: approversByEmail.get(row.email) || [] }));
  const activeStaffProfiles = staffProfilesResult.data.map(mapProfile);
  const profileMap = new Map([
    ...students.map((person) => [person.id, person]),
    ...activeStaffProfiles.map((person) => [person.id, person]),
    ...staff.map((person) => [person.email, person]),
  ]);
  profileMap.set(profile.id, profile);
  return {
    students,
    staff,
    curricula,
    activities: (activitiesResult.data || []).map((row) => mapActivity(row, curriculumMap)),
    enrollments,
    entries: entriesResult.data.map((row) => mapEntry(row, profileMap, enrollmentMap)),
    approvalEvents: eventsResult.data || [],
    rotations: (rotationsResult.data || []).map((row) => mapRotation(row, curriculumMap)),
    certifications: (certificationsResult.data || []).map(mapCertification),
  };
}

function entryPayload(profile, item, status, staff = []) {
  const selectedStaff = staff.find((person) => person.id === item.selectedApproverId);
  if (!selectedStaff) throw new Error("กรุณาเลือก Staff ผู้อนุมัติจากรายชื่อ");
  return {
    student_id: profile.id,
    recorded_by: profile.id,
    activity_type: item.activityType,
    activity_date: item.date,
    week_number: item.weekNumber || null,
    unit_name: item.unitName?.trim() || null,
    patient_reference: item.patientReference?.trim() || null,
    diagnosis: item.diagnosis?.trim() || null,
    procedure_name: item.procedureName?.trim() || null,
    participation: item.participation || null,
    activity_title: item.activityTitle?.trim() || null,
    supervisor_name: selectedStaff.name,
    selected_approver_id: null,
    selected_approver_email: selectedStaff.email,
    detail: item.detail?.trim() || null,
    status,
    submitted_at: null,
    approved_at: null,
    approved_by: null,
    approver_comment: null,
    onedrive_sync_status: "not_required",
    academic_year: profile.activeEnrollment?.academicYear || profile.academicYear || profile.cohortYear,
    enrollment_id: profile.activeEnrollment?.id,
  };
}

export async function saveYear4Rotation(profile, rotation) {
  if (profile.role !== "admin") throw new Error("เฉพาะ Admin เท่านั้นที่จัดการ rotation ได้");
  const payload = {
    curriculum_id: rotation.curriculumId, group_code: rotation.groupCode.trim(), name: rotation.name.trim(),
    start_date: rotation.startDate, end_date: rotation.endDate, status: rotation.status, created_by: profile.id,
  };
  const query = rotation.id
    ? supabase.from("curriculum_rotations").update(payload).eq("id", rotation.id)
    : supabase.from("curriculum_rotations").insert(payload);
  const { data, error } = await query.select().single();
  throwIfError(error);
  return mapRotation(data, new Map());
}

export async function submitYear4Certification(profile, selectedCertifierEmail, rotationId = null) {
  if (profile.role !== "student") throw new Error("เฉพาะ Student เท่านั้นที่ส่ง Logbook เพื่อรับรองได้");
  const { data, error } = await supabase.from("year4_logbook_certifications").upsert({
    student_id: profile.id, academic_year: profile.activeEnrollment?.academicYear || profile.academicYear || profile.cohortYear,
    enrollment_id: profile.activeEnrollment?.id, curriculum_rotation_id: rotationId || null,
    selected_certifier_email: selectedCertifierEmail, status: "submitted",
  }, { onConflict: "enrollment_id" }).select().single();
  throwIfError(error);
  return mapCertification(data);
}

export async function reviewYear4Certification(profile, certification, status, note) {
  if (profile.role !== "staff") throw new Error("เฉพาะ Staff เท่านั้นที่รับรอง Logbook ได้");
  const { data, error } = await supabase.from("year4_logbook_certifications").update({ status, certifier_note: note.trim() || null })
    .eq("id", certification.id).eq("status", "submitted").eq("selected_certifier_email", profile.email).select().single();
  throwIfError(error);
  return mapCertification(data);
}

export async function createYear4Entry(profile, item, status, staff) {
  if (profile.role !== "student") throw new Error("เฉพาะ Student เท่านั้นที่บันทึก Logbook ได้");
  const { data, error } = await supabase.from("year4_logbook_entries").insert(entryPayload(profile, item, status, staff)).select().single();
  throwIfError(error);
  const enrollmentMap = new Map(profile.activeEnrollment ? [[profile.activeEnrollment.id, profile.activeEnrollment]] : []);
  return mapEntry(data, new Map(staff.map((person) => [person.id, person])), enrollmentMap);
}

export async function updateYear4Entry(profile, item, status, staff) {
  if (profile.role !== "student") throw new Error("เฉพาะ Student เท่านั้นที่แก้ไข Logbook ได้");
  const payload = entryPayload(profile, item, status, staff);
  payload.revision = (item.revision || 1) + (item.status === "rejected" && status === "submitted" ? 1 : 0);
  const { data, error } = await supabase
    .from("year4_logbook_entries")
    .update(payload)
    .eq("id", item.id)
    .eq("student_id", profile.id)
    .in("status", ["draft", "rejected"])
    .select()
    .single();
  throwIfError(error);
  const enrollmentMap = new Map(profile.activeEnrollment ? [[profile.activeEnrollment.id, profile.activeEnrollment]] : []);
  return mapEntry(data, new Map(staff.map((person) => [person.id, person])), enrollmentMap);
}

export async function reviewYear4Entry(profile, entry, decision, comment) {
  if (profile.role !== "staff") throw new Error("เฉพาะ Staff เท่านั้นที่อนุมัติรายการได้");
  if (![profile.id, profile.email].includes(entry.selectedApproverId)) throw new Error("รายชื่ออาจารย์ approve ไม่ตรงกับที่ระบุในหัตถการ");
  if (!['approved', 'rejected'].includes(decision)) throw new Error("สถานะการประเมินไม่ถูกต้อง");
  if (decision === "rejected" && !comment.trim()) throw new Error("กรุณาระบุเหตุผลที่ส่งกลับแก้ไข");
  const { data, error } = await supabase
    .from("year4_logbook_entries")
    .update({
      status: decision,
      approved_by: decision === "approved" ? profile.id : null,
      approved_at: null,
      approver_comment: comment.trim() || null,
      onedrive_sync_status: decision === "approved" ? "pending" : "not_required",
    })
    .eq("id", entry.id)
    .eq("status", "submitted")
    .eq("selected_approver_email", profile.email)
    .select()
    .single();
  throwIfError(error);
  return mapEntry(data, new Map([[profile.id, profile]]));
}

export async function getYear4StudentPhotoUrl(avatarPath) {
  if (!avatarPath) return "";
  const { data, error } = await supabase.storage.from("student-avatars").createSignedUrl(avatarPath, 60 * 60);
  throwIfError(error);
  return data.signedUrl;
}

export async function uploadYear4StudentPhoto(profile, file) {
  if (profile.role !== "student") throw new Error("เฉพาะ Student เท่านั้นที่เพิ่มรูปได้");
  if (!file) throw new Error("กรุณาเลือกไฟล์รูปภาพ");
  const allowedTypes = new Map([["image/jpeg", "jpg"], ["image/png", "png"], ["image/webp", "webp"]]);
  const extension = allowedTypes.get(file.type);
  if (!extension) throw new Error("รองรับเฉพาะไฟล์ JPG, PNG หรือ WebP");
  if (file.size > 5 * 1024 * 1024) throw new Error("ไฟล์รูปต้องมีขนาดไม่เกิน 5 MB");

  const avatarPath = `${profile.id}/profile.${extension}`;
  const uploadResult = await supabase.storage.from("student-avatars").upload(avatarPath, file, {
    upsert: true,
    contentType: file.type,
    cacheControl: "3600",
  });
  throwIfError(uploadResult.error);
  const profileResult = await supabase.from("profiles").update({ avatar_path: avatarPath }).eq("id", profile.id);
  throwIfError(profileResult.error);
  return { avatarPath, url: await getYear4StudentPhotoUrl(avatarPath) };
}

export async function backupYear4ToGoogleDrive(profile) {
  if (profile?.role !== "admin") throw new Error("เฉพาะ Admin เท่านั้นที่สำรองข้อมูลได้");
  const { data, error } = await supabase.auth.getSession();
  throwIfError(error);
  if (!data.session?.access_token) throw new Error("กรุณาเข้าสู่ระบบใหม่ก่อนสำรองข้อมูล");
  const response = await fetch("/api/google-drive-backup", {
    method: "POST",
    headers: { Authorization: `Bearer ${data.session.access_token}` },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "ไม่สามารถสำรองข้อมูลไป Google Drive ได้");
  return payload;
}

export async function deleteYear4AdminData(profile, filter, password) {
  if (profile.role !== "admin") throw new Error("เฉพาะ Admin เท่านั้นที่ลบข้อมูลได้");
  if (!password) throw new Error("กรุณากรอกรหัสผ่าน Admin");
  const { data, error } = await supabase.functions.invoke("admin-data", {
    body: {
      action: "delete_logbook",
      scope: filter.scope,
      studentId: filter.studentId || null,
      studentGroup: filter.studentGroup || null,
      curriculumId: filter.curriculumId && filter.curriculumId !== "all" ? filter.curriculumId : null,
      password,
    },
  });
  if (error) {
    const context = error.context;
    const payload = context && typeof context.json === "function" ? await context.json().catch(() => ({})) : {};
    throw new Error(payload.error || error.message || "ไม่สามารถลบข้อมูลได้");
  }
  return data;
}

export async function deleteYear4AdminAvatars(profile, filter, password) {
  if (profile.role !== "admin") throw new Error("เฉพาะ Admin เท่านั้นที่ลบรูปนักศึกษาได้");
  if (!password) throw new Error("กรุณากรอกรหัสผ่าน Admin");
  if (!["student", "group"].includes(filter.scope)) throw new Error("กรุณาเลือกนักศึกษารายคนหรือกลุ่ม Student");
  const { data, error } = await supabase.functions.invoke("admin-data", {
    body: {
      action: "delete_avatars",
      scope: filter.scope,
      studentId: filter.studentId || null,
      studentGroup: filter.studentGroup || null,
      password,
    },
  });
  if (error) {
    const context = error.context;
    const payload = context && typeof context.json === "function" ? await context.json().catch(() => ({})) : {};
    throw new Error(payload.error || error.message || "ไม่สามารถลบรูปนักศึกษาได้");
  }
  return data;
}

export async function deleteYear4AdminEntry(profile, entryId, studentId, password) {
  if (profile.role !== "admin") throw new Error("เฉพาะ Admin เท่านั้นที่ลบหัตถการได้");
  if (!password) throw new Error("กรุณากรอกรหัสผ่าน Admin");
  const { data, error } = await supabase.functions.invoke("admin-data", { body: { action: "delete_logbook_entry", scope: "student", entryId, studentId, password } });
  if (error) {
    const context = error.context;
    const payload = context && typeof context.json === "function" ? await context.json().catch(() => ({})) : {};
    throw new Error(payload.error || error.message || "ไม่สามารถลบหัตถการได้");
  }
  return data;
}

export async function upsertYear4Staff(profile, staff, password) {
  if (profile.role !== "admin") throw new Error("เฉพาะ Admin เท่านั้นที่เพิ่ม Staff ได้");
  if (!password) throw new Error("กรุณากรอกรหัสผ่าน Admin");
  const { data, error } = await supabase.functions.invoke("admin-data", {
    body: {
      action: "upsert_staff",
      password,
      staffFirstName: staff.firstName,
      staffLastName: staff.lastName,
      staffEmail: staff.email,
      staffAssignments: staff.assignments,
    },
  });
  if (error) return edgeError(error, "ไม่สามารถเพิ่ม Staff ได้");
  return data;
}

export async function upsertYear4Student(profile, student, password) {
  if (profile.role !== "admin") throw new Error("เฉพาะ Admin เท่านั้นที่เพิ่มหรือแก้ไข Student ได้");
  if (!password) throw new Error("กรุณากรอกรหัสผ่าน Admin");
  const { data, error } = await supabase.functions.invoke("admin-data", {
    body: {
      action: "upsert_student",
      password,
      studentId: student.id || null,
      studentFirstName: student.firstName,
      studentLastName: student.lastName,
      studentCode: student.studentCode,
      studentEmail: student.email,
      studentGroup: student.studentGroup,
      curriculumId: student.curriculumId,
    },
  });
  if (error) return edgeError(error, "ไม่สามารถเพิ่มหรือแก้ไข Student ได้");
  return data;
}

export async function deleteYear4Students(profile, studentIds, password) {
  if (profile.role !== "admin") throw new Error("เฉพาะ Admin เท่านั้นที่ลบบัญชี Student ได้");
  if (!password) throw new Error("กรุณากรอกรหัสผ่าน Admin");
  if (!studentIds.length) throw new Error("กรุณาเลือก Student ที่ต้องการลบ");
  const { data, error } = await supabase.functions.invoke("admin-data", {
    body: { action: "delete_students", studentIds, password },
  });
  if (error) return edgeError(error, "ไม่สามารถลบบัญชี Student ได้");
  return data;
}

function edgeError(error, fallback) {
  const context = error?.context;
  return context && typeof context.json === "function"
    ? context.json().catch(() => ({})).then((payload) => { throw new Error(payload.error || error.message || fallback); })
    : Promise.reject(new Error(error?.message || fallback));
}

export async function saveCurriculum(profile, curriculum) {
  if (profile.role !== "admin") throw new Error("เฉพาะ Admin เท่านั้นที่จัดการ Curriculum ได้");
  const payload = {
    code: curriculum.code.trim().toLowerCase(), class_year: Number(curriculum.classYear), academic_year: Number(curriculum.academicYear),
    name: curriculum.name.trim(), pass_percent: Number(curriculum.passPercent || 80), status: curriculum.status || "draft",
    source_filename: curriculum.sourceFilename?.trim() || null, version: Number(curriculum.version || 1), created_by: profile.id,
  };
  const query = curriculum.id ? supabase.from("curricula").update(payload).eq("id", curriculum.id) : supabase.from("curricula").insert(payload);
  const { data, error } = await query.select().single();
  throwIfError(error);
  return mapCurriculum(data);
}

export async function replaceCurriculumActivities(profile, curriculumId, activities) {
  if (profile.role !== "admin") throw new Error("เฉพาะ Admin เท่านั้นที่นำเข้ากิจกรรมได้");
  const rows = activities.map((activity, index) => ({
    activity_code: activity.id.trim().toLowerCase(), title_th: activity.title.trim(),
    group_name: activity.group.trim(), target_count: activity.target ? Number(activity.target) : null,
    target_unit: activity.unit?.trim() || "ครั้ง", sort_order: Number(activity.sortOrder || index + 1),
    requires_patient: activity.fields?.includes("patient") || false, requires_procedure: activity.fields?.includes("procedure") || false,
    requires_week: activity.fields?.includes("week") || false,
  }));
  if (!rows.length) throw new Error("ไฟล์ Curriculum ไม่มีรายการกิจกรรม");
  const { data, error } = await supabase.rpc("admin_replace_curriculum_activities", { p_curriculum_id: curriculumId, p_activities: rows });
  throwIfError(error);
  return data;
}

export async function publishCurriculum(profile, curriculumId) {
  if (profile.role !== "admin") throw new Error("เฉพาะ Admin เท่านั้นที่ Publish Curriculum ได้");
  const { data, error } = await supabase.from("curricula").update({ status: "published" }).eq("id", curriculumId).eq("status", "draft").select().single();
  throwIfError(error);
  return mapCurriculum(data);
}
