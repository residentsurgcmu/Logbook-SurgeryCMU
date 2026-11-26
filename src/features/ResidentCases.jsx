import { isCaseHn, sealPilotHn } from "../caseHnPilotCrypto";
import CaseHnExport from "./CaseHnExport";
import CaseHnPilot, { caseHnPilotEnabled, pinnedKeyId } from "./CaseHnPilot";
import CasePhoto from "./CasePhoto";
import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { admissionWeek, archiveRange, caseMatchesSearch, groupAdmissionWeeks } from "../admissionHistory";
import { PencilIcon, PlusIcon } from "../components/Icons";
import {
  CASE_LIMITS,
  CASE_MIN_ADMIT_DATE,
  CASE_SEXES,
  CASE_TYPES,
  CASE_UNITS,
  canDeleteCase,
  canDeleteMedia,
  canEditCase,
  caseErrorMessage,
  caseSexLabel,
  caseTypeLabel,
  caseTreatmentField,
  caseFormForSave,
  caseUnitLabel,
  isCaseConflict,
  splitCaseImageFiles,
  validateCaseForm,
} from "../residentCases";
import { bangkokIsoDate } from "../roundSchedule";
import {
  createAdmissionCase,
  hnPilotCreateAction,
  hnPilotWebExport,
  deleteCaseMedia,
  loadAdmissionCases,
  loadCaseMedia,
  renameCaseMedia,
  loadCasePeople,
  loadCasesByIds,
  purgeAdmissionCase,
  purgeCaseMedia,
  softDeleteAdmissionCase,
  updateAdmissionCase,
  uploadCaseImages,
} from "../residentCasesApi";
import { exportCaseDeck } from "../casePptxExport";
import { caseExportRange, filterCasesForExport, validateExportRange } from "../caseExcel";
import { exportCasesExcel } from "../caseExcelExport";
import { CaseModal, CaseTreatmentSummary, CaseTypeChip, CaseTypeDot, CaseTypeLegend, PrivacyNotice, personName, thaiDate, thaiDateTime } from "./CaseParts";

const emptyForm = (user) => ({
  admit_date: bangkokIsoDate(),
  age_years: "",
  sex: "",
  diagnosis: "",
  management: "",
  operation: "",
  unit_name: "",
  status: "admit",
  treatment_type: "",
  owner_id: user.role === "resident" ? user.id : "",
});
const caseToForm = (row) => ({
  admit_date: row.admit_date,
  age_years: String(row.age_years),
  sex: row.sex,
  diagnosis: row.diagnosis,
  management: row.management ?? "",
  operation: row.operation ?? "",
  unit_name: row.unit_name,
  status: row.status,
  treatment_type: row.treatment_type || "",
  owner_id: row.owner_id,
});

function CaseForm({ user, people, initial, hnRequired, onSaved, onReload, onClose }) {
  const [form, setForm] = useState(() => (initial ? caseToForm(initial) : emptyForm(user)));
  const treatmentField = caseTreatmentField(form.treatment_type);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [stage, setStage] = useState("");
  const [pending, setPending] = useState([]); // [{ file, url }] previews, uploaded after save
  const hnInput = useRef(null);
  const requestId = useRef(null);
  const retryPayload = useRef(null);
  const hnCloseLocked = useRef(false);
  const [retryLocked, setRetryLocked] = useState(false);
  const [existingMedia, setExistingMedia] = useState(null);
  const [savedCaptions, setSavedCaptions] = useState({});
  const [mediaBusy, setMediaBusy] = useState(false);
  const [mediaRevision, setMediaRevision] = useState(0);
  useEffect(() => {
    if (!initial?.id) return;
    let alive = true;
    loadCaseMedia(initial.id).then(items => { if (alive) setExistingMedia(items); })
      .catch(() => { if (alive) setError("โหลดรูปเดิมไม่สำเร็จ"); });
    return () => { alive = false; };
  }, [initial?.id, mediaRevision]);
  async function changeMedia(item, remove) {
    if (busy || mediaBusy) return;
    if (remove && !window.confirm("ลบรูปนี้ออกจากเคส?")) return;
    setMediaBusy(true);
    setError("");
    try {
      if (remove) {
        await deleteCaseMedia(item.id);
        setExistingMedia(current => current.filter(photo => photo.id !== item.id));
      } else {
        const next = savedCaptions[item.id].trim();
        await renameCaseMedia(item.id, item.caption, next);
        setExistingMedia(current => current.map(photo => photo.id === item.id ? { ...photo, caption: next } : photo));
      }
      setSavedCaptions(current => { const next = { ...current }; delete next[item.id]; return next; });
      onReload();
    } catch { setError("แก้ไขรูปไม่สำเร็จ กรุณาโหลดรูปล่าสุดก่อนลองอีกครั้ง"); }
    finally { setMediaBusy(false); }
  }
  const pendingRef = useRef(pending);
  pendingRef.current = pending;
  useEffect(() => () => pendingRef.current.forEach((item) => URL.revokeObjectURL(item.url)), []);
  function pick(event) {
    const { accepted, rejected } = splitCaseImageFiles(event.target.files, pending.length);
    event.target.value = "";
    setPending((current) => [...current, ...accepted.map((file) => ({ file, url: URL.createObjectURL(file) }))]);
    setError(rejected.map((item) => item.message).join(" · "));
  }
  function removePending(index) {
    setPending((current) => {
      URL.revokeObjectURL(current[index].url);
      return current.filter((_, position) => position !== index);
    });
  }
  const owners = useMemo(
    () => people.filter((person) => person.role === "resident" && (person.active || person.user_id === form.owner_id)),
    [people, form.owner_id],
  );
  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));

  function closeForm() {
    if (!mediaBusy && (!hnRequired || !hnCloseLocked.current)) onClose();
  }

  async function submit(event) {
    event.preventDefault();
    if (busy || mediaBusy) return;
    const payload = caseFormForSave(form, initial);
    const problem = validateCaseForm(payload, new Date(), { requireType: !initial, requireTreatmentDetail: true });
    if (problem) return setError(problem);
    if (hnRequired && !retryPayload.current && !isCaseHn(hnInput.current?.value.trim())) {
      hnInput.current?.focus();
      return setError("กรุณากรอก HN ให้ครบ 7 หลัก");
    }
    if (hnRequired) hnCloseLocked.current = true;
    setBusy(true);
    setError("");
    setConflict(false);
    setStage("save");
    let caseId;
    try {
      if (initial) {
        await updateAdmissionCase(initial.id, initial.updated_at, payload);
        caseId = initial.id;
      } else if (hnRequired) {
        if (!retryPayload.current) {
          const hn = hnInput.current.value.trim();
          hnInput.current.value = "";
          const id = requestId.current ??= globalThis.crypto.randomUUID();
          const reserved = await hnPilotCreateAction("reserve", { p_case_id: id });
          const sealed = await sealPilotHn({
            publicKey: reserved.publicKey, configuredKey: pinnedKeyId, caseUuid: id, caseCode: reserved.caseCode, hn,
          });
          const { owner_id: _ownerId, ...fields } = payload;
          retryPayload.current = Object.freeze({
            p_case_id: id, p_fields: fields, p_key_id: sealed.keyId, p_ciphertext: sealed.ciphertext,
          });
        }
        caseId = (await hnPilotCreateAction("save", retryPayload.current)).id;
      } else {
        caseId = await createAdmissionCase(payload);
      }
    } catch (nextError) {
      setConflict(!hnRequired && isCaseConflict(nextError));
      if (hnRequired) {
        if (retryPayload.current && (retryLocked || !nextError?.code || !/^(22|23|42|P0)/.test(nextError.code))) {
          setRetryLocked(true);
          setError("ยังยืนยันการบันทึกไม่ได้ กดบันทึกอีกครั้งเพื่อตรวจคำขอเดิม ไม่ต้องกรอก HN ซ้ำ");
        } else {
          retryPayload.current = null;
          requestId.current = null;
          hnCloseLocked.current = false;
          setRetryLocked(false);
          setError("บันทึกเคส Grand Rounds ไม่สำเร็จ ตรวจข้อมูลและกรอก HN ใหม่ หากยังไม่ผ่านให้ติดต่อผู้ดูแล");
        }
      } else {
        setError(caseErrorMessage(nextError));
      }
      setBusy(false);
      setStage("");
      return;
    }
    // The case (with its Type) is saved from here on: never save it again (a retry would create
    // a duplicate), so image problems are reported on the case detail instead.
    let failureNotice = "";
    if (pending.length) {
      setStage("upload");
      const { failed } = await uploadCaseImages(caseId, pending.map((item) => item.file), pending.map(item => item.caption));
      if (failed.length) {
        const reasons = failed.map((item) => `ภาพที่ ${item.position}: ${caseErrorMessage(item.error)}`).join(" · ");
        failureNotice = `บันทึกเคสแล้ว แต่อัปโหลดภาพไม่สำเร็จ ${failed.length} จาก ${pending.length} ภาพ (${reasons}) กรุณาลองใหม่ด้วยปุ่ม "อัปโหลดภาพ"`;
      }
    }
    try {
      await onSaved(caseId, failureNotice);
    } finally {
      setBusy(false);
      setStage("");
    }
  }

  const fields = (
    <form className="case-form" noValidate onSubmit={submit}>
      {hnRequired ? <p className="case-muted">กรอก HN ในช่องที่กำหนดเท่านั้น ห้ามใส่ชื่อหรือข้อมูลระบุตัวผู้ป่วยในช่องอื่นหรือภาพแนบ</p> : <PrivacyNotice />}
      {error && <p className="form-error" role="alert">{error}</p>}
      {conflict && (
        <div className="button-row">
          <button type="button" className="secondary-button" onClick={async () => { await onReload(); onClose(); }}>โหลดข้อมูลล่าสุดและปิด</button>
        </div>
      )}
      <fieldset className="case-grid" style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }} disabled={busy || retryLocked}>
        {hnRequired && <label className="case-full">HN ผู้ป่วย (จำเป็น)
          <input ref={hnInput} inputMode="numeric" autoComplete="off" spellCheck={false} required
            aria-describedby="case-create-hn-note" placeholder="ตัวเลข 7 หลัก" />
          <small id="case-create-hn-note">กรอก HN ในช่องนี้เท่านั้น ระบบจะเข้ารหัสก่อนส่ง</small>
        </label>}
        <label>วันที่รับ<input type="date" value={form.admit_date} min={CASE_MIN_ADMIT_DATE} max={bangkokIsoDate()} onChange={set("admit_date")} required /></label>
        <label>อายุ (ปี)<input type="number" inputMode="numeric" min={0} max={120} step={1} value={form.age_years} onChange={set("age_years")} required /></label>
        <label>เพศ<select aria-label="เพศ" required value={form.sex} onChange={set("sex")}><option value="" disabled>เลือกเพศ</option>{CASE_SEXES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>หน่วย<select aria-label="หน่วย" required value={form.unit_name} onChange={set("unit_name")}><option value="" disabled>เลือกหน่วย</option>{CASE_UNITS.map((unit) => <option key={unit} value={unit}>{caseUnitLabel(unit)}</option>)}</select></label>
        <label className="case-full">Diagnosis<input maxLength={CASE_LIMITS.diagnosis} value={form.diagnosis} onChange={set("diagnosis")} required /></label>
        <label className="case-full">{initial ? "Type" : "Type (จำเป็น)"}<select value={form.treatment_type} onChange={set("treatment_type")} aria-required={!initial}><option value="">{initial ? "ยังไม่ระบุ" : "เลือก Type"}</option>{CASE_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        {treatmentField === "operation" && <>
          <label className="case-full">Operation (จำเป็น)<input required maxLength={CASE_LIMITS.operation} value={form.operation} onChange={set("operation")} /></label>
          <label className="case-full">Note / Management เพิ่มเติม (ไม่บังคับ)<textarea rows={2} maxLength={CASE_LIMITS.management} value={form.management} onChange={set("management")} /></label>
        </>}
        {treatmentField === "management" && <label className="case-full">Management (จำเป็น)<textarea required rows={2} maxLength={CASE_LIMITS.management} value={form.management} onChange={set("management")} /></label>}
        <label>Owner (Resident)
          <select value={form.owner_id} onChange={set("owner_id")} disabled={hnRequired} required>
            <option value="">เลือก Resident</option>
            {owners.map((person) => <option key={person.user_id} value={person.user_id}>{person.full_name}</option>)}
          </select>
        </label>
      </fieldset>
      {initial && <section className="case-form-images" aria-label="รูปเดิมของเคส">
        <div className="case-images-head"><strong>รูปเดิมของเคส</strong><button type="button" className="secondary-button" disabled={busy || mediaBusy} onClick={() => setMediaRevision(n => n + 1)}>โหลดรูปล่าสุด</button></div>
        <p className="case-muted">บันทึกป้ายกำกับและลบรูปมีผลทันที · ห้ามใส่ข้อมูลระบุตัวผู้ป่วย</p>
        <div className="case-media">
          {existingMedia?.map((item, index) => <figure key={item.id}>
            <CasePhoto src={item.url} label={item.caption || `รูปเดิมที่ ${index + 1}`} photos={existingMedia} startIndex={index} onRefresh={() => setMediaRevision(n => n + 1)} />
            <label>ป้ายกำกับรูปเดิมที่ {index + 1}<input value={savedCaptions[item.id] ?? item.caption ?? ""} maxLength={200}
              disabled={!canDeleteMedia(user, item) || busy || mediaBusy} onChange={e => setSavedCaptions({ ...savedCaptions, [item.id]: e.target.value })} /></label>
            {canDeleteMedia(user, item) && <div className="button-row">
              <button type="button" className="secondary-button" disabled={busy || mediaBusy || savedCaptions[item.id] == null || savedCaptions[item.id].trim() === (item.caption || "")} onClick={() => changeMedia(item, false)}>บันทึกป้ายกำกับ</button>
              <button type="button" className="secondary-button" disabled={busy || mediaBusy} onClick={() => changeMedia(item, true)}>ลบรูปนี้</button>
            </div>}
          </figure>)}
          {!existingMedia?.length && <p className="case-muted">{existingMedia ? "ยังไม่มีรูปเดิม" : "กำลังโหลดรูปเดิม…"}</p>}
        </div>
      </section>}
      <div className="case-form-images">
        <div className="case-images-head">
          <strong>ภาพแนบ {pending.length ? `(${pending.length})` : ""}</strong>
          <label className="secondary-button case-upload-button">
            เลือกภาพ
            <input className="case-file-input" type="file" accept="image/jpeg,image/png,image/webp" multiple disabled={busy} onChange={pick} />
          </label>
        </div>
        {pending.length ? (
          <div className="case-media">
            {pending.map((item, index) => (
              <figure key={item.url}>
                <CasePhoto src={item.url} label={`ภาพที่ ${index + 1}`} photos={pending} startIndex={index} />
                <label>ป้ายกำกับภาพใหม่ที่ {index + 1}<input value={item.caption || ""} maxLength={200} disabled={busy || retryLocked}
                  onChange={e => { const caption = e.target.value; setPending(all => all.map(p => p.url === item.url ? { ...p, caption } : p)); }} /></label>
                <figcaption>ภาพที่ {index + 1} <button type="button" className="link-button" disabled={busy} onClick={() => removePending(index)}>เอาออก</button></figcaption>
              </figure>
            ))}
          </div>
        ) : (
          <p className="case-muted">ยังไม่ได้เลือกภาพ · ภาพจะอัปโหลดหลังกดบันทึก (ระบบย่อภาพและลบ EXIF/GPS ให้)</p>
        )}
      </div>
      <div className="button-row case-actions">
        <button type="button" className="secondary-button" onClick={closeForm} disabled={busy || retryLocked}>ยกเลิก</button>
        <button type="submit" className="primary-button" disabled={busy || mediaBusy}>{stage === "upload" ? "กำลังอัปโหลดภาพ…" : busy ? "กำลังบันทึก…" : "บันทึก"}</button>
      </div>
    </form>
  );
  return (
    <CaseModal title={initial ? `แก้ไข ${initial.case_code}` : hnRequired ? "เพิ่มเคส Grand Rounds" : "เพิ่มเคสใหม่"}
      closeDisabled={mediaBusy || (hnRequired && (busy || retryLocked))} onClose={closeForm}>
      {fields}
    </CaseModal>
  );
}

function CaseDetail({ user, people, row, notice, onEdit, onPresent, onChanged, onClose }) {
  const [media, setMedia] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const reloadMedia = useCallback(async () => {
    try {
      setMedia(await loadCaseMedia(row.id));
    } catch (nextError) {
      setError(caseErrorMessage(nextError));
    }
  }, [row.id]);
  useEffect(() => { reloadMedia(); }, [reloadMedia]);

  async function run(action) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (nextError) {
      setError(caseErrorMessage(nextError));
    } finally {
      setBusy(false);
    }
  }
  async function onFiles(event) {
    const { accepted, rejected } = splitCaseImageFiles(event.target.files);
    event.target.value = "";
    if (!accepted.length) return setError(rejected.map((item) => item.message).join(" · "));
    await run(async () => {
      const { failed } = await uploadCaseImages(row.id, accepted);
      await reloadMedia();
      await onChanged();
      const problems = [
        ...rejected.map((item) => item.message),
        ...failed.map((item) => `ภาพที่อัปโหลดลำดับ ${item.position}: ${caseErrorMessage(item.error)}`),
      ];
      if (problems.length) throw new Error(problems.join(" · "));
    });
  }

  const fields = [
    [row.treatment_type === "operative" ? "Note / Management เพิ่มเติม" : "Management", row.management],
    ["Operation", row.operation],
  ];
  return (
    <>
      <p className="case-muted">{caseSexLabel(row.sex)} {row.age_years} ปี · {caseUnitLabel(row.unit_name)} · รับไว้ {thaiDate(row.admit_date)} · Owner: {personName(people, row.owner_id)}</p>
      {row.deleted_at && <p className="form-error" role="status">เคสนี้ถูกลบ (ซ่อนจากผู้ใช้อื่น) · Admin ลบถาวรได้จากปุ่มด้านล่าง</p>}
      <p><CaseTypeChip type={row.treatment_type} /> <small className="case-muted">แก้ล่าสุด {thaiDateTime(row.updated_at)} โดย {personName(people, row.updated_by)}</small></p>
      {notice && <p className="form-error" role="status">{notice}</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
      {caseHnPilotEnabled && user.role === "resident" && row.owner_id === user.id && !row.deleted_at && (
        <CaseHnPilot key={`${user.id}:${row.id}`} actorId={user.id} caseUuid={row.id} caseCode={row.case_code} />
      )}
      <div className="case-split">
        <div>
          {fields.map(([label, value]) => <div className="case-field" key={label}><small>{label}</small>{value || "ยังไม่ระบุ"}</div>)}
          <div className="button-row">
            <button type="button" className="secondary-button" disabled={!canEditCase(user, row)} onClick={onEdit}>แก้ไขข้อมูล</button>
            {!row.deleted_at && <button type="button" className="primary-button" onClick={() => onPresent({ id: row.id, admit_date: row.admit_date })}>นำเสนอเคสนี้</button>}
            {!row.deleted_at && (
              <button type="button" className="secondary-button" disabled={busy} onClick={async () => {
                let missing = 0;
                await run(async () => { missing = await exportCaseDeck(row, people); });
                if (missing) setError(`ดาวน์โหลด PowerPoint แล้ว แต่ใส่ภาพไม่ได้ ${missing} ภาพ`);
              }}>Export PowerPoint</button>
            )}
            {canDeleteCase(user, row) && (
              <button type="button" className="danger-button" disabled={busy} onClick={() => { if (window.confirm("ลบเคสนี้? (ซ่อนจากทุกคนยกเว้น Admin)")) run(async () => { await softDeleteAdmissionCase(row.id, row.updated_at); await onChanged(); onClose(); }); }}>ลบเคส</button>
            )}
            {user.role === "admin" && (
              <button type="button" className="danger-button" disabled={busy} onClick={() => { if (window.confirm("ลบถาวรพร้อมภาพและโน้ตทั้งหมด ไม่สามารถกู้คืนได้ ยืนยัน?")) run(async () => { await purgeAdmissionCase(row.id); await onChanged(); onClose(); }); }}>ลบถาวร</button>
            )}
          </div>
        </div>
        <div>
          <div className="case-images-head">
            <strong>ภาพแนบ ({media?.length ?? "…"})</strong>
            {canEditCase(user, row) && (
              <label className="primary-button case-upload-button">
                {busy ? "กำลังอัปโหลด…" : "อัปโหลดภาพ"}
                <input className="case-file-input" type="file" accept="image/jpeg,image/png,image/webp" multiple disabled={busy} onChange={onFiles} />
              </label>
            )}
          </div>
          <p className="case-muted">ระบบย่อภาพและลบ EXIF/GPS ก่อนอัปโหลด · อย่าถ่ายติดใบหน้า/ป้ายชื่อ</p>
          <div className="case-media">
            {(media || []).map((item, index) => (
              <figure key={item.id}>
                <CasePhoto src={item.url} label={item.caption || `ภาพ ${index + 1}`} onRefresh={reloadMedia} photos={media} startIndex={index} />
                <figcaption>{item.caption || `ภาพ ${index + 1}`}</figcaption>
                {user.role === "admin" ? (
                  <button type="button" className="danger-button case-media-delete" disabled={busy} onClick={() => { if (window.confirm("ลบภาพนี้ถาวร? ไฟล์จะถูกลบออกจากระบบและกู้คืนไม่ได้")) run(async () => { await purgeCaseMedia(item.id); await reloadMedia(); await onChanged(); }); }}>ลบถาวร</button>
                ) : canDeleteMedia(user, item) ? (
                  <button type="button" className="danger-button case-media-delete" disabled={busy} onClick={() => { if (window.confirm("ลบภาพนี้? (Admin ยังลบถาวรได้ภายหลัง)")) run(async () => { await deleteCaseMedia(item.id); await reloadMedia(); await onChanged(); }); }}>ลบ</button>
                ) : null}
              </figure>
            ))}
            {media?.length === 0 && <div className="case-media-empty">ยังไม่มีภาพแนบ</div>}
          </div>
        </div>
      </div>
    </>
  );
}

const EXPORT_PRESETS = [["week", "สัปดาห์นี้"], ["month", "เดือนนี้"], ["last-month", "เดือนที่แล้ว"], ["custom", "กำหนดเอง"]];

function ExcelExportDialog({ people, onClose }) {
  const [preset, setPreset] = useState("month");
  const [range, setRange] = useState(() => caseExportRange("month"));
  const [unit, setUnit] = useState("all");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const problem = validateExportRange(range.from, range.to);
  const [loaded, setLoaded] = useState(null);
  const rangeKey = `${range.from}/${range.to}`;
  const rows = problem || loaded?.key !== rangeKey ? null : filterCasesForExport(loaded.rows, { ...range, unit });
  useEffect(() => {
    if (problem) return;
    const request = new AbortController();
    setLoaded(null);
    setError("");
    loadAdmissionCases({ from: range.from, to: range.to, signal: request.signal }).then((rows) => {
      if (!request.signal.aborted) setLoaded({ key: rangeKey, rows });
    }).catch((failure) => {
      if (!request.signal.aborted) setError(caseErrorMessage(failure));
    });
    return () => request.abort();
  }, [range.from, range.to, rangeKey, problem]);

  const choose = (key) => {
    setPreset(key);
    if (key !== "custom") setRange(caseExportRange(key));
  };
  const setDate = (key) => (event) => {
    setPreset("custom");
    setRange((current) => ({ ...current, [key]: event.target.value }));
  };
  async function download() {
    if (busy || problem || !rows?.length) return;
    setBusy(true);
    setError("");
    try {
      await exportCasesExcel(rows, people, { ...range, unit });
      onClose();
    } catch (nextError) {
      setError(caseErrorMessage(nextError));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="case-form">
      <p className="case-muted">เลือกช่วงวันที่รับ (admit date) · ไฟล์มี 2 ชีต: รายการเคส และข้ออภิปราย · ไม่รวมเคสที่ถูกลบ</p>
      <div className="button-row case-presets">
        {EXPORT_PRESETS.map(([key, label]) => (
          <button key={key} type="button" className={preset === key ? "primary-button" : "secondary-button"} aria-pressed={preset === key} onClick={() => choose(key)}>{label}</button>
        ))}
      </div>
      <div className="case-grid">
        <label>ตั้งแต่วันที่<input type="date" value={range.from} onChange={setDate("from")} /></label>
        <label>ถึงวันที่<input type="date" value={range.to} onChange={setDate("to")} /></label>
        <label className="case-full">หน่วย
          <select value={unit} onChange={(event) => setUnit(event.target.value)}>
            <option value="all">ทุกหน่วย</option>
            {CASE_UNITS.map((name) => <option key={name} value={name}>{caseUnitLabel(name)}</option>)}
          </select>
        </label>
      </div>
      {(problem || error) && <p className="form-error" role="alert">{problem || error}</p>}
      {!problem && !error && <p className="case-muted" role="status">{rows ? `พบ ${rows.length} เคสในช่วงนี้` : "กำลังโหลดเคสสำหรับส่งออก…"}</p>}
      <div className="button-row case-actions">
        <button type="button" className="secondary-button" onClick={onClose}>ยกเลิก</button>
        <button type="button" className="primary-button" disabled={busy || Boolean(problem) || !rows?.length} onClick={download}>{busy ? "กำลังสร้างไฟล์…" : "ดาวน์โหลด .xlsx"}</button>
      </div>
    </div>
  );
}

function AdmissionCaseList({ rows, view, people, user, onPresent, openCase }) {
  return <>
      {view === "cards" ? (
        <div className="case-cards">
          {rows.map((row) => (
            <article key={row.id} className={`case-card${row.deleted_at ? " case-row-deleted" : ""}`}>
              <button type="button" className="case-card-open" onClick={() => openCase("detail", row)} aria-label={`เปิด ${row.case_code} ${row.diagnosis}`}>
                <div className="case-card-top"><span>{row.case_code}</span><CaseTypeChip type={row.treatment_type} /></div>
                <strong>{row.diagnosis}</strong>
                <small>{caseSexLabel(row.sex)} · {row.age_years} ปี · {caseUnitLabel(row.unit_name)}</small>
                <small>รับไว้ {thaiDate(row.admit_date)} · Owner: {personName(people, row.owner_id)}</small>
                {row.media_count ? <small>ภาพแนบ {row.media_count}</small> : null}
              </button>
              {!row.deleted_at && (
                <div className="case-card-actions">
                  <button type="button" className="secondary-button" onClick={() => openCase("detail", row)}>เปิดเคส / ภาพ</button>
                  <button type="button" className="secondary-button" onClick={() => onPresent({ id: row.id, admit_date: row.admit_date })}>เปิด Deck</button>
                </div>
              )}
            </article>
          ))}
        </div>
      ) : (
      <div className="admission-table-layout">
        <CaseTypeLegend />
        <div className="resident-table-wrap admission-table-wrap">
          <table className="case-table admission-table">
            <thead><tr><th>เคส / วันที่รับ</th><th>Diagnosis</th><th>Management / Operation</th><th>หน่วย / Owner</th><th>Type</th><th>ภาพ</th><th /></tr></thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className={row.deleted_at ? "case-row-deleted" : undefined}>
                  <td data-label="เคส"><div className="case-cell"><strong>{row.case_code}</strong><br /><small>{thaiDate(row.admit_date)}</small></div></td>
                  <td data-label="Diagnosis"><div className="case-cell"><button type="button" className="link-button" onClick={() => openCase("detail", row)}>{row.diagnosis}</button><br /><small>{caseSexLabel(row.sex)} · {row.age_years} ปี</small></div></td>
                  <td data-label="Management / Operation"><CaseTreatmentSummary row={row} /></td>
                  <td data-label="หน่วย / Owner"><div className="case-cell">{caseUnitLabel(row.unit_name)}<br /><small>{personName(people, row.owner_id)}</small></div></td>
                  <td data-label="Type"><div className="case-table-indicators"><CaseTypeDot type={row.treatment_type} />{row.deleted_at && <span className="case-status case-status-deleted">ถูกลบ</span>}</div></td>
                  <td data-label="ภาพ">{row.media_count}</td>
                  <td><button type="button" className="secondary-button case-edit-icon" aria-label={`แก้ไขเคส ${row.case_code}`} disabled={!canEditCase(user, row)} title={canEditCase(user, row) ? "แก้ไขเคส" : row.deleted_at ? "เคสที่ถูกลบแก้ไขไม่ได้" : "Resident แก้ได้เฉพาะเคสที่ตนสร้างหรือเป็น Owner"} onClick={() => openCase("form", row)}><PencilIcon size={16} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      )}
  </>;
}

export default function ResidentCases(props) {
  return <ResidentCasesPage key={`${props.user.id}/${props.user.role}`} {...props} />;
}

function ResidentCasesPage({ user, onPresent }) {
  const [week, setWeek] = useState(() => admissionWeek(bangkokIsoDate()));
  const [cases, setCases] = useState(null);
  const [revision, setRevision] = useState(0);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [archiveWeeks, setArchiveWeeks] = useState(4);
  const [archiveState, setArchiveState] = useState(null);
  const currentPanelId = useId();
  const archivePanelId = useId();

  const [people, setPeople] = useState([]);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [unit, setUnit] = useState("all");
  const [wideView, setWideView] = useState("table");
  const listPanel = useRef(null);
  const [wide, setWide] = useState(false);
  const view = wide ? wideView : "cards";
  useEffect(() => {
    const panel = listPanel.current;
    // Reserve room for the archive inset so both sections use the same layout.
    const resize = new ResizeObserver(([entry]) => setWide(entry.contentRect.width >= 990));
    resize.observe(panel);
    return () => resize.disconnect();
  }, []);
  const [showDeleted, setShowDeleted] = useState(false);
  const [pilotActor, setPilotActor] = useState(null);
  useEffect(() => {
    if (!caseHnPilotEnabled || user.role !== "resident") return;
    let stale = false;
    hnPilotCreateAction("status").then((value) => {
      if (!stale) setPilotActor(value?.eligible ? user.id : null);
    }).catch(() => { if (!stale) setPilotActor(null); });
    return () => { stale = true; };
  }, [user.id, user.role]);
  const [exportPermission, setExportPermission] = useState(null);
  useEffect(() => {
    setExportPermission(null);
    if (!caseHnPilotEnabled) return;
    let current = true;
    hnPilotWebExport("status").then((value) => {
      if (current && value?.allowed) setExportPermission({ id: user.id, role: user.role });
    }).catch(() => {});
    return () => { current = false; };
  }, [user.id, user.role]);
  const canExportHn = exportPermission?.id === user.id && exportPermission?.role === user.role;
  const [dialog, setDialog] = useState(null);
  const [saveNotice, setSaveNotice] = useState("");

  const includeDeleted = user.role === "admin" && showDeleted;
  useEffect(() => {
    const refreshWeek = () => {
      const next = admissionWeek(bangkokIsoDate());
      setWeek((current) => current.from === next.from ? current : next);
    };
    window.addEventListener("focus", refreshWeek);
    const timer = setInterval(refreshWeek, 60_000);
    return () => { window.removeEventListener("focus", refreshWeek); clearInterval(timer); };
  }, []);
  const load = useCallback(() => { setRevision((n) => n + 1); }, []);
  useEffect(() => {
    const request = new AbortController();
    setCases(null);
    setError("");
    Promise.all([
      loadAdmissionCases({ ...week, includeDeleted, signal: request.signal }),
      loadCasePeople(),
    ]).then(([rows, ppl]) => {
      if (request.signal.aborted) return;
      setCases(rows);
      setPeople(ppl);
    }).catch((nextError) => {
      if (!request.signal.aborted) setError(caseErrorMessage(nextError));
    });
    return () => request.abort();
  }, [week, includeDeleted, revision]);

  const needle = search.trim().toLowerCase();
  const searching = Boolean(needle);
  const archiveVisible = archiveOpen || searching;
  const { from: archiveFrom, to: archiveTo } = archiveRange(week.from, needle ? 0 : archiveWeeks);
  const archiveKey = JSON.stringify([archiveFrom, archiveTo, includeDeleted, revision]);
  const archive = archiveState?.key === archiveKey ? archiveState : null;
  useEffect(() => {
    if (!archiveVisible) return;
    const request = new AbortController();
    loadAdmissionCases({
      from: archiveFrom, to: archiveTo, includeDeleted,
      signal: request.signal,
    }).then((rows) => {
      if (!request.signal.aborted) setArchiveState({ key: archiveKey, rows });
    }).catch((nextError) => {
      if (!request.signal.aborted) setArchiveState({ key: archiveKey, error: caseErrorMessage(nextError) });
    });
    return () => request.abort();
  }, [archiveVisible, archiveFrom, archiveTo, archiveKey, includeDeleted]);

  const matches = (row) =>
    (typeFilter === "all" || (typeFilter === "unset" ? !row.treatment_type : row.treatment_type === typeFilter)) &&
    (unit === "all" || row.unit_name === unit) &&
    (!needle || caseMatchesSearch(row, needle, personName(people, row.owner_id)));
  const currentRows = (cases || []).filter(matches);
  const archiveGroups = groupAdmissionWeeks((archive?.rows || []).filter(matches));
  const current = dialog?.row;
  const live = (cases || []).filter((row) => !row.deleted_at);
  const count = (key) => live.filter((row) => (key === "unset" ? !row.treatment_type : row.treatment_type === key)).length;
  const openCase = (type, row) => setDialog({ type, id: row.id, row });
  const listProps = { view, people, user, onPresent, openCase };
  const afterSave = async (caseId, notice) => {
    setSaveNotice("");
    load();
    try {
      const [row] = await loadCasesByIds([caseId]);
      if (!row) throw new Error("Saved case no longer available");
      setDialog({ type: "detail", id: caseId, row, notice });
    } catch {
      setDialog(null);
      setSaveNotice(["บันทึกเคสแล้ว แต่เปิดรายละเอียดไม่ได้ กรุณาค้นหาจากรายการเคส", notice].filter(Boolean).join(" · "));
    }
  };

  return (
    <section ref={listPanel} className="resident-panel case-list-page">
      <div className="panel-title-row admission-title">
        <h1>เคสรับใหม่</h1>
        <div className="button-row admission-create">
          <button type="button" className="primary-button" onClick={() => setDialog({ type: "form" })}><PlusIcon size={16} /> เพิ่มเคส</button>
          {pilotActor === user.id && <button type="button" className="secondary-button"
            onClick={() => setDialog({ type: "form", hnRequired: true, actorId: user.id })}>
            <PlusIcon size={16} /> เพิ่มเคส Grand Rounds · ใช้ HN
          </button>}
        </div>
      </div>
      {error && <p className="form-error" role="alert">{error} <button type="button" className="link-button" onClick={load}>ลองใหม่</button></p>}
      {saveNotice && <p className="form-error" role="status">{saveNotice}</p>}
      <p className="admission-compact-stats">
        รอบนี้ {cases ? live.length : "…"} เคส · {cases ? count("operative") : "…"} Operative · {cases ? count("conservative") : "…"} Non-operative
        {count("unset") > 0 && ` · ไม่ระบุ ${count("unset")}`}
      </p>
      <div className="case-stats admission-wide-stats">
        <div><small>เคสรอบปัจจุบัน</small><strong>{cases ? live.length : "…"}</strong></div>
        <div><small>{caseTypeLabel("operative")}</small><strong>{cases ? count("operative") : "…"}</strong></div>
        <div><small>{caseTypeLabel("conservative")}</small><strong>{cases ? count("conservative") : "…"}</strong></div>
        <div><small>ยังไม่ระบุ Type</small><strong>{cases ? count("unset") : "…"}</strong></div>
      </div>
      <div className="admission-tools">
        <label className="admission-search">ค้นหาเคส<input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Diagnosis, รหัสเคส หรือผู้รับผิดชอบ" /></label>
        <details className="admission-tools-more">
          <summary>ตัวกรองและส่งออก{(typeFilter !== "all" || unit !== "all" || showDeleted) && " · กำลังกรอง"}</summary>
          <div className="history-filters">
            <label>Type<select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}><option value="all">ทุก Type</option>{CASE_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}<option value="unset">ยังไม่ระบุ</option></select></label>
            <label>หน่วย<select value={unit} onChange={(event) => setUnit(event.target.value)}><option value="all">ทุกหน่วย</option>{CASE_UNITS.map((name) => <option key={name} value={name}>{caseUnitLabel(name)}</option>)}</select></label>
            {wide && <div className="case-view-switch" role="group" aria-label="รูปแบบการแสดงเคส">
              <button type="button" className={view === "table" ? "active" : ""} aria-pressed={view === "table"} onClick={() => setWideView("table")}>Table</button>
              <button type="button" className={view === "cards" ? "active" : ""} aria-pressed={view === "cards"} onClick={() => setWideView("cards")}>Flashcards</button>
            </div>}
            {user.role === "admin" && (
              <label className="case-check"><input type="checkbox" checked={showDeleted} onChange={(event) => setShowDeleted(event.target.checked)} /> แสดงเคสที่ถูกลบ</label>
            )}
          </div>
          <div className="button-row admission-exports">
            <button type="button" className="secondary-button" onClick={() => setDialog({ type: "excel" })}>Export Excel</button>
            {canExportHn && <button type="button" className="secondary-button"
              onClick={() => setDialog({ type: "hnExport", permission: exportPermission })}>ส่งออกไฟล์ Grand Rounds</button>}
          </div>
        </details>
      </div>
      {!searching && <div className="case-view-switch admission-period" role="group" aria-label="ช่วงรายการเคส">
        <button type="button" className={!archiveOpen ? "active" : ""} aria-pressed={!archiveOpen} aria-controls={currentPanelId} onClick={() => setArchiveOpen(false)}>รอบปัจจุบัน</button>
        <button type="button" className={archiveOpen ? "active" : ""} aria-pressed={archiveOpen} aria-controls={archivePanelId} onClick={() => setArchiveOpen(true)}>เคสย้อนหลัง</button>
      </div>}
      <section id={currentPanelId} className="admission-current" hidden={archiveOpen && !searching}>
        <h3>เคสรอบปัจจุบัน · {thaiDate(week.from)} – {thaiDate(week.to)}</h3>
        {!cases && !error && <p className="case-muted" role="status">กำลังโหลดเคสรอบนี้…</p>}
        {cases && currentRows.length === 0 && <p className="case-muted">{cases.length ? "ไม่พบเคสที่ตรงกับเงื่อนไขในรอบนี้" : "ยังไม่มีเคสในรอบนี้"}</p>}
        {currentRows.length > 0 && <AdmissionCaseList rows={currentRows} {...listProps} />}
      </section>
      <section id={archivePanelId} className="admission-archive" hidden={!archiveVisible}>
        <h3 className="admission-archive-heading">เคสย้อนหลัง{searching && " · ผลการค้นหา"}</h3>
        <div className="admission-archive-body">
          {archiveVisible && <>
            {archive?.error ? <p className="form-error" role="alert">{archive.error} <button className="link-button" type="button" onClick={() => setRevision((n) => n + 1)}>ลองใหม่</button></p>
              : !archive ? <p role="status">กำลังโหลดเคสย้อนหลัง…</p>
              : archiveGroups.length === 0 ? <p className="case-muted">{needle ? "ไม่พบเคสย้อนหลังที่ตรงกับคำค้น" : "ไม่พบเคสที่ตรงกับเงื่อนไขในช่วงที่โหลด"}</p>
              : archiveGroups.map((group) => <details className="admission-week" key={`${Boolean(needle)}/${group.from}`} open={Boolean(needle) || undefined}>
                <summary>{thaiDate(group.from)} – {thaiDate(group.to)} · {group.rows.length} เคส</summary>
                <AdmissionCaseList rows={group.rows} {...listProps} />
              </details>)}
            {!needle && !archive?.error && archive && archiveFrom > CASE_MIN_ADMIT_DATE && <button type="button" className="secondary-button"
              onClick={() => setArchiveWeeks((n) => n + 4)}>โหลดย้อนหลังอีก 4 สัปดาห์</button>}
          </>}
        </div>
      </section>
      {dialog?.type === "form" && (!dialog.hnRequired || dialog.actorId === user.id) && (!dialog.id || current) && (
        <CaseForm user={user} people={people} hnRequired={dialog.hnRequired} initial={dialog.id ? current : null} onSaved={afterSave} onReload={load} onClose={() => setDialog(null)} />
      )}
      {dialog?.type === "hnExport" && canExportHn && dialog.permission === exportPermission && (
        <CaseModal className="case-modal--hn-export" title="ส่งออกไฟล์ Grand Rounds" onClose={() => setDialog(null)}>
          <CaseHnExport keyId={pinnedKeyId} />
        </CaseModal>
      )}
      {dialog?.type === "excel" && (
        <CaseModal title="Export Excel · New admissions" onClose={() => setDialog(null)}>
          <ExcelExportDialog people={people} onClose={() => setDialog(null)} />
        </CaseModal>
      )}
      {dialog?.type === "detail" && current && (
        <CaseModal title={`${current.case_code} · ${current.diagnosis}`} onClose={() => setDialog(null)}>
          <CaseDetail user={user} people={people} row={current} notice={dialog.notice} onEdit={() => openCase("form", current)} onPresent={onPresent} onChanged={load} onClose={() => setDialog(null)} />
        </CaseModal>
      )}
    </section>
  );
}
