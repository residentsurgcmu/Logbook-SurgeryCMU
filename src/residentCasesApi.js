import { supabase } from "./supabase";
import { fetchAllRows } from "./supabasePaging";
import { CASE_IMAGE_MAX_BYTES, CASE_IMAGE_MAX_EDGE, CASE_IMAGE_QUALITY, caseImagePath, scaledSize, validateCaseImageFile } from "./residentCases";

const MEDIA_BUCKET = "resident-case-media";
const SIGNED_URL_SECONDS = 10 * 60;
const CASE_COLUMNS = "id,case_code,admit_date,age_years,sex,diagnosis,management,operation,unit_name,status,owner_id,created_by,updated_by,created_at,updated_at,deleted_at";
const fail = (error) => {
  if (error) throw error;
};

const caseArgs = (form) => ({
  p_admit_date: form.admit_date,
  p_age_years: Number(form.age_years),
  p_sex: form.sex,
  p_diagnosis: String(form.diagnosis || "").trim(),
  p_management: form.management || "",
  p_operation: form.operation || "",
  p_unit_name: form.unit_name,
  p_status: form.status,
  p_owner_id: form.owner_id,
});

// Names only (no email), including deactivated accounts so old authors resolve.
export async function loadCasePeople() {
  const { data, error } = await supabase.rpc("list_resident_case_people");
  fail(error);
  return data || [];
}

export async function loadAdmissionCases({ from, to, includeDeleted = false } = {}) {
  const { data, error } = await fetchAllRows(() => {
    let query = supabase
      .from("resident_admission_cases")
      .select(`${CASE_COLUMNS},resident_case_media(id,deleted_at)`);
    // RLS only returns soft-deleted rows to Admin; they ask for them explicitly.
    if (!includeDeleted) query = query.is("deleted_at", null);
    if (from) query = query.gte("admit_date", from);
    if (to) query = query.lte("admit_date", to);
    return query.order("admit_date", { ascending: false }).order("case_code", { ascending: false });
  });
  fail(error);
  return (data || []).map(({ resident_case_media: media, ...row }) => ({
    ...row,
    media_count: (media || []).filter((item) => !item.deleted_at).length,
  }));
}

export async function createAdmissionCase(form) {
  const { data, error } = await supabase.rpc("create_resident_admission_case", caseArgs(form));
  fail(error);
  return data;
}

export async function updateAdmissionCase(caseId, expectedUpdatedAt, form) {
  const { data, error } = await supabase.rpc("update_resident_admission_case", {
    p_case_id: caseId,
    p_expected_updated_at: expectedUpdatedAt,
    ...caseArgs(form),
  });
  fail(error);
  return data;
}

export async function softDeleteAdmissionCase(caseId, expectedUpdatedAt) {
  const { error } = await supabase.rpc("soft_delete_resident_admission_case", {
    p_case_id: caseId,
    p_expected_updated_at: expectedUpdatedAt,
  });
  fail(error);
}

// Admin only. The rows are already gone; removing the image files is cleanup,
// so a failure there is reported to the console and does not fail the purge.
export async function purgeAdmissionCase(caseId) {
  const { data: paths, error } = await supabase.rpc("admin_purge_resident_admission_case", { p_case_id: caseId });
  fail(error);
  if (paths?.length) {
    const { error: removeError } = await supabase.storage.from(MEDIA_BUCKET).remove(paths);
    if (removeError) console.warn("Could not remove purged case images", removeError);
  }
}

export async function loadCaseMedia(caseId) {
  const { data, error } = await supabase
    .from("resident_case_media")
    .select("id,storage_path,caption,created_by,created_at")
    .eq("case_id", caseId)
    .is("deleted_at", null)
    .order("created_at", { ascending: true })
    .order("id");
  fail(error);
  const rows = data || [];
  if (!rows.length) return [];
  const { data: signed, error: signError } = await supabase.storage
    .from(MEDIA_BUCKET)
    .createSignedUrls(rows.map((row) => row.storage_path), SIGNED_URL_SECONDS);
  fail(signError);
  const urls = new Map((signed || []).map((item) => [item.path, item.signedUrl]));
  return rows.map((row) => ({ ...row, url: urls.get(row.storage_path) || "" }));
}

// Re-encoding through a canvas drops EXIF/GPS metadata and bounds the size.
export async function prepareCaseImage(file) {
  const problem = validateCaseImageFile(file);
  if (problem) throw new Error(problem);
  const bitmap = await createImageBitmap(file);
  try {
    const { width, height } = scaledSize(bitmap.width, bitmap.height, CASE_IMAGE_MAX_EDGE);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    context.fillStyle = "#fff";
    context.fillRect(0, 0, width, height);
    context.drawImage(bitmap, 0, 0, width, height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", CASE_IMAGE_QUALITY));
    if (!blob) throw new Error("ไม่สามารถประมวลผลภาพนี้ได้");
    if (blob.size > CASE_IMAGE_MAX_BYTES) throw new Error("ภาพหลังบีบอัดยังใหญ่เกิน 5 MB");
    return blob;
  } finally {
    bitmap.close?.();
  }
}

// The caption is never taken from the file name: phone/camera file names can
// carry patient identifiers.
export async function uploadCaseImage(caseId, file, caption = "") {
  const blob = await prepareCaseImage(file);
  const path = caseImagePath(caseId);
  const { error: uploadError } = await supabase.storage
    .from(MEDIA_BUCKET)
    .upload(path, blob, { contentType: "image/jpeg", upsert: false });
  fail(uploadError);
  try {
    const { data, error } = await supabase.rpc("add_resident_case_media", {
      p_case_id: caseId,
      p_storage_path: path,
      p_caption: caption || "",
    });
    fail(error);
    return data;
  } catch (error) {
    await supabase.storage.from(MEDIA_BUCKET).remove([path]);
    throw error;
  }
}

// Uploads one at a time so a single bad image never loses the others.
export async function uploadCaseImages(caseId, files) {
  const uploaded = [];
  const failed = [];
  for (const [index, file] of files.entries()) {
    try {
      uploaded.push(await uploadCaseImage(caseId, file));
    } catch (error) {
      failed.push({ position: index + 1, error });
    }
  }
  return { uploaded, failed };
}

export async function deleteCaseMedia(mediaId) {
  const { error } = await supabase.rpc("delete_resident_case_media", { p_media_id: mediaId });
  fail(error);
}

export async function loadCaseNotes(caseId) {
  const { data, error } = await supabase
    .from("resident_case_notes")
    .select("id,case_id,author_id,body,created_at,edited_at")
    .eq("case_id", caseId)
    .is("deleted_at", null)
    .order("created_at", { ascending: true })
    .order("id");
  fail(error);
  return data || [];
}

export async function addCaseNote(caseId, body) {
  const { data, error } = await supabase.rpc("add_resident_case_note", { p_case_id: caseId, p_body: body });
  fail(error);
  return data;
}

export async function editCaseNote(noteId, body) {
  const { error } = await supabase.rpc("edit_resident_case_note", { p_note_id: noteId, p_body: body });
  fail(error);
}

export async function deleteCaseNote(noteId) {
  const { error } = await supabase.rpc("delete_resident_case_note", { p_note_id: noteId });
  fail(error);
}
