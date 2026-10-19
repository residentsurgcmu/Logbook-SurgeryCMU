// RC04-API-2. Managed exams stay separate from the legacy score/absence rules.
export const STATE_LABELS = Object.freeze({ scored: "มีคะแนน", absent: "ขาดสอบ", awaiting: "ยังไม่สอบ", unknown: "ยังไม่มีข้อมูล" });
export const OVERALL_LABELS = Object.freeze({ all_passed: "ผ่านทุกส่วน", failed_some: "ไม่ผ่านอย่างน้อย 1 ส่วน", incomplete: "ยังไม่ครบ", not_ready: "ข้อมูลยังไม่พร้อมประกาศ" });
export function managedCellLabel(cell) {
  if (!cell || !(cell.value_state in STATE_LABELS)) throw new Error("สถานะคะแนนไม่ครบ กรุณาโหลดข้อมูลใหม่");
  if (cell.value_state !== "scored") return STATE_LABELS[cell.value_state];
  if (cell.outcome === "pass") return "ผ่าน";
  if (cell.outcome === "fail") return "ไม่ผ่าน";
  return "ยังไม่ตั้งเกณฑ์";
}
const canonical = (x) => Array.isArray(x) ? x.map(canonical) : x && typeof x === "object"
  ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, canonical(x[k])])) : x;
export function managedAttempt(previous, operation, args, makeId = () => crypto.randomUUID()) {
  const fingerprint = JSON.stringify(canonical({ operation, args }));
  return previous?.fingerprint === fingerprint ? previous : { operation, args: structuredClone(args), fingerprint, requestId: makeId() };
}
const MESSAGES = {
  RC04_FORBIDDEN: "บัญชีนี้ไม่มีสิทธิ์ใช้งาน กรุณาเข้าสู่ระบบใหม่",
  RC04_REVISION_CONFLICT: "ข้อมูลถูกแก้ไขแล้ว กรุณาโหลดใหม่และตรวจอีกครั้ง",
  RC04_PUBLISHED_REVISION_CONFLICT: "ผลประกาศเปลี่ยนแล้ว กรุณาโหลดใหม่",
  RC04_NOT_WORKING: "ฉบับนี้ประกาศแล้ว หากต้องแก้ไขให้เริ่มฉบับแก้",
  RC04_PREVIEW_EXPIRED: "ตัวอย่างหมดอายุ กรุณาตรวจไฟล์ใหม่",
  RC04_PREVIEW_CONSUMED: "ตัวอย่างนี้ถูกบันทึกแล้ว กรุณาโหลดข้อมูลใหม่",
  RC04_READ_SET_EXPIRED: "ชุดอ่านหมดอายุ กรุณาโหลดใหม่ทั้งชุด",
  RC04_READ_SET_NOT_FOUND: "ชุดอ่านใช้ไม่ได้ กรุณาโหลดใหม่ทั้งชุด",
  RC04_NOT_REVIEWED: "กรุณาตรวจข้อมูลและกดตรวจแล้วก่อนประกาศ",
  RC04_NOT_READY: "ยังมีข้อมูลหรือเกณฑ์ไม่ครบ จึงยังประกาศไม่ได้",
  RC04_REASON_REQUIRED: "กรุณาระบุเหตุผลที่แก้ข้อมูล",
  RC04_LIMIT: "ข้อมูลเกินขีดจำกัด (ผู้สอบ 200 คน ส่วนสอบ 50 ส่วน หรือช่องนำเข้า 10,000 ช่อง)",
};
export function managedError(error) {
  const code = String(error?.message || "").match(/\bRC04_[A-Z_]+/)?.[0];
  const e = new Error(MESSAGES[code] || (code ? "ระบบปฏิเสธข้อมูล กรุณาตรวจรายการและโหลดใหม่" : "ติดต่อระบบไม่สำเร็จ กรุณาลองอีกครั้งด้วยรายการเดิม"));
  e.code = code || error?.code || "RC04_CONNECTION";
  e.uncertain = !code && !String(error?.code || "").startsWith("PGRST");
  return e;
}
const MUTATIONS = new Set(["create_managed_exam", "update_working_revision", "commit_import", "mark_reviewed", "publish_revision", "begin_correction"]);
function invalid() { const e = new Error("ระบบส่งข้อมูลไม่ครบ กรุณาลองรายการเดิมอีกครั้ง"); e.uncertain = true; throw e; }
const object = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
export function createManagedExamsApi(client) {
  // Keep an unresolved receipt key through component switches. Cleared on a definite response.
  // Memory only; no scores or identifiers are persisted to browser storage.
  const unresolved = new Map();
  let actor = null, actorEpoch = 0;
  async function rpc(name, args) {
    let response;
    try { response = await client.rpc(`rc04_${name}`, args); } catch (error) { throw managedError(error); }
    const { data, error } = response;
    if (error) throw managedError(error);
    if (data === null || data === undefined) invalid();
    return data;
  }
  return {
    setActor(id) { if (actor !== id) { unresolved.clear(); actor = id; actorEpoch++; } },
    actorToken() { return actorEpoch; },
    assertActor(token) { if (token !== actorEpoch) throw new DOMException("บัญชีหรือรอบงานเปลี่ยนแล้ว", "AbortError"); },
    async mutate(operation, attempt) {
      if (!MUTATIONS.has(operation) || operation !== attempt.operation) invalid();
      if (unresolved.size && !unresolved.has(attempt.fingerprint)) {
        const e = new Error("ยังยืนยันรายการก่อนหน้าไม่ได้ กรุณาตรวจผลรายการเดิมก่อนทำรายการใหม่");
        e.uncertain = true; e.recoveryAttempt = unresolved.values().next().value; throw e;
      }
      const retained = unresolved.get(attempt.fingerprint) || attempt;
      unresolved.set(attempt.fingerprint, retained);
      const startedActor = actor, startedEpoch = actorEpoch;
      let data;
      try { data = await rpc(operation, { ...retained.args, p_request_id: retained.requestId }); }
      catch (e) { if (actorEpoch === startedEpoch && !e.uncertain) unresolved.delete(attempt.fingerprint); throw e; }
      if (actor !== startedActor || actorEpoch !== startedEpoch) { const e = new Error("บัญชีที่ใช้งานเปลี่ยนแล้ว กรุณาโหลดข้อมูลใหม่"); e.code = "RC04_FORBIDDEN"; e.uncertain = false; throw e; }
      if (!object(data)) invalid();
      if (operation === "create_managed_exam" && (!data.exam_id || !data.revision_id || !Number.isInteger(data.version))) invalid();
      if (["update_working_revision", "commit_import", "begin_correction"].includes(operation) && (!data.revision_id || !Number.isInteger(data.version))) invalid();
      if (operation === "mark_reviewed" && !Number.isInteger(data.checked_version)) invalid();
      if (operation === "publish_revision" && !data.published_revision_id) invalid();
      unresolved.delete(attempt.fingerprint); return data;
    },
    async list() { const data = await rpc("admin_list_exams", { p_academic_year: null }); if (!Array.isArray(data)) invalid(); return data; },
    async get(examId, revisionId) {
      const data = await rpc("admin_get_revision", { p_exam_id: examId, p_revision_id: revisionId });
      if (!data.exam || data.exam.exam_id !== examId || data.exam.revision_id !== revisionId || !Array.isArray(data.roster) || !Array.isArray(data.parts) || !Array.isArray(data.cells)) invalid();
      if (!Number.isInteger(data.exam.version) || !object(data.validation) || !object(data.validation.counts) || !Array.isArray(data.validation.blockers) || typeof data.importable !== "boolean") invalid();
      if (["cells", "scored", "absent", "awaiting", "unknown", "criteria_missing"].some((key) => !Number.isInteger(data.validation.counts[key]) || data.validation.counts[key] < 0)) invalid();
      return data;
    },
    async preview(args) {
      const data = await rpc("preview_import", args);
      if (typeof data.ok !== "boolean" || !Array.isArray(data.errors)) invalid();
      if (data.ok && (!data.preview_id || !data.delta_fingerprint || !Array.isArray(data.diff) || !Array.isArray(data.warnings))) invalid();
      return data;
    },
    // Never return any partial page. The caller can retry this whole operation after failure.
    async read(scope, { examId = null, revisionId = null, year = null, signal } = {}) {
      const startedEpoch = actorEpoch;
      const current = () => { signal?.throwIfAborted(); if (startedEpoch !== actorEpoch) throw new DOMException("บัญชีหรือรอบงานเปลี่ยนแล้ว", "AbortError"); };
      current();
      const manifest = await rpc("open_read_set", { p_scope: scope, p_exam_id: examId, p_revision_id: revisionId, p_academic_year: year });
      current();
      if (!manifest.manifest_id || !Array.isArray(manifest.entries)) invalid();
      const entries = new Map(manifest.entries.map((e) => [e.exam_id, e]));
      if (entries.size !== manifest.entries.length || manifest.entries.some((e) => !e.revision_id)) invalid();
      let cursor = null; const rows = [], seen = new Set(), cursors = new Set();
      for (let page = 0; page < 1000; page++) {
        current();
        const data = await rpc("read_page", { p_manifest_id: manifest.manifest_id, p_cursor: cursor, p_limit: 500 });
        current();
        if (data.manifest_id !== manifest.manifest_id || !Array.isArray(data.rows) || data.rows.length !== data.row_count || typeof data.done !== "boolean") invalid();
        for (const row of data.rows) {
          const entry = entries.get(row.exam_id);
          const key = `${row.revision_id}/${row.resident_id}/${row.part_id}`;
          if (!entry || entry.revision_id !== row.revision_id || seen.has(key) || !["scored", "absent", "awaiting"].includes(row.value_state)) invalid();
          if ((row.value_state === "scored" && (!Number.isFinite(row.score) || !["pass", "fail"].includes(row.outcome))) ||
              (row.value_state !== "scored" && (row.score !== null || row.outcome !== null)) || !OVERALL_LABELS[row.overall?.status]) invalid();
          seen.add(key); rows.push(row);
        }
        if (data.done) { current(); return { manifest, rows }; }
        if (!object(data.next_cursor) || !data.rows.length) invalid();
        const token = JSON.stringify(data.next_cursor);
        if (cursors.has(token)) invalid();
        cursors.add(token); cursor = data.next_cursor;
      }
      invalid();
    },
  };
}
export function groupManagedRows(rows) {
  const groups = new Map();
  for (const row of rows) {
    const key = `${row.exam_id}/${row.revision_id}`;
    if (!groups.has(key)) groups.set(key, { ...row, residents: new Map(), parts: new Map() });
    const exam = groups.get(key);
    exam.parts.set(row.part_id, { id: row.part_id, name: row.part_name, sort: row.part_sort_order });
    if (!exam.residents.has(row.resident_id)) exam.residents.set(row.resident_id, { id: row.resident_id, name: row.reference_name, pgy: row.pgy_at_exam, overall: row.overall, cells: new Map() });
    exam.residents.get(row.resident_id).cells.set(row.part_id, row);
  }
  return [...groups.values()].map((e) => ({ ...e, residents: [...e.residents.values()], parts: [...e.parts.values()].sort((a, b) => a.sort - b.sort) }));
}
