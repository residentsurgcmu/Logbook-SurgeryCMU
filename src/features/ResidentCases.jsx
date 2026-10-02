import React, { useCallback, useEffect, useMemo, useState } from "react";
import { PlusIcon } from "../components/Icons";
import {
  CASE_LIMITS,
  CASE_MIN_ADMIT_DATE,
  CASE_SEXES,
  CASE_STATUSES,
  CASE_UNITS,
  canDeleteCase,
  canDeleteMedia,
  canEditCase,
  caseErrorMessage,
  caseSexLabel,
  isCaseConflict,
  validateCaseForm,
  validateCaseImageFile,
} from "../residentCases";
import { bangkokIsoDate } from "../roundSchedule";
import {
  createAdmissionCase,
  deleteCaseMedia,
  loadAdmissionCases,
  loadCaseMedia,
  loadCasePeople,
  purgeAdmissionCase,
  softDeleteAdmissionCase,
  updateAdmissionCase,
  uploadCaseImage,
} from "../residentCasesApi";
import { CaseModal, CaseStatusChip, PrivacyNotice, personName, thaiDate, thaiDateTime } from "./CaseParts";

const emptyForm = (user) => ({
  admit_date: bangkokIsoDate(),
  age_years: "",
  sex: "male",
  diagnosis: "",
  management: "",
  operation: "",
  unit_name: CASE_UNITS[0],
  status: "admit",
  owner_id: user.role === "resident" ? user.id : "",
});
const caseToForm = (row) => ({
  admit_date: row.admit_date,
  age_years: String(row.age_years),
  sex: row.sex,
  diagnosis: row.diagnosis,
  management: row.management,
  operation: row.operation,
  unit_name: row.unit_name,
  status: row.status,
  owner_id: row.owner_id,
});

function CaseForm({ user, people, initial, onSaved, onReload, onClose }) {
  const [form, setForm] = useState(() => (initial ? caseToForm(initial) : emptyForm(user)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const owners = useMemo(
    () => people.filter((person) => person.role === "resident" && (person.active || person.user_id === form.owner_id)),
    [people, form.owner_id],
  );
  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));

  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    const problem = validateCaseForm(form);
    if (problem) return setError(problem);
    setBusy(true);
    setError("");
    setConflict(false);
    try {
      if (initial) await updateAdmissionCase(initial.id, initial.updated_at, form);
      else await createAdmissionCase(form);
      await onSaved();
    } catch (nextError) {
      setConflict(isCaseConflict(nextError));
      setError(caseErrorMessage(nextError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="case-form" noValidate onSubmit={submit}>
      <PrivacyNotice />
      {error && <p className="form-error" role="alert">{error}</p>}
      {conflict && (
        <div className="button-row">
          <button type="button" className="secondary-button" onClick={async () => { await onReload(); onClose(); }}>โหลดข้อมูลล่าสุดและปิด</button>
        </div>
      )}
      <div className="case-grid">
        <label>วันที่รับ<input type="date" value={form.admit_date} min={CASE_MIN_ADMIT_DATE} max={bangkokIsoDate()} onChange={set("admit_date")} required /></label>
        <label>อายุ (ปี)<input type="number" inputMode="numeric" min={0} max={120} step={1} value={form.age_years} onChange={set("age_years")} required /></label>
        <label>เพศ<select value={form.sex} onChange={set("sex")}>{CASE_SEXES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>หน่วย<select value={form.unit_name} onChange={set("unit_name")}>{CASE_UNITS.map((unit) => <option key={unit}>{unit}</option>)}</select></label>
        <label className="case-full">Diagnosis<input maxLength={CASE_LIMITS.diagnosis} value={form.diagnosis} onChange={set("diagnosis")} required /></label>
        <label className="case-full">Management<textarea rows={2} maxLength={CASE_LIMITS.management} value={form.management} onChange={set("management")} /></label>
        <label className="case-full">Operation<input maxLength={CASE_LIMITS.operation} value={form.operation} onChange={set("operation")} /></label>
        <label>สถานะ<select value={form.status} onChange={set("status")}>{CASE_STATUSES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>Owner (Resident)
          <select value={form.owner_id} onChange={set("owner_id")} required>
            <option value="">เลือก Resident</option>
            {owners.map((person) => <option key={person.user_id} value={person.user_id}>{person.full_name}</option>)}
          </select>
        </label>
      </div>
      <div className="button-row case-actions">
        <button type="button" className="secondary-button" onClick={onClose}>ยกเลิก</button>
        <button type="submit" className="primary-button" disabled={busy}>{busy ? "กำลังบันทึก…" : "บันทึก"}</button>
      </div>
    </form>
  );
}

function CaseDetail({ user, people, row, onEdit, onPresent, onChanged, onClose }) {
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
  async function onFile(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const problem = validateCaseImageFile(file);
    if (problem) return setError(problem);
    await run(async () => { await uploadCaseImage(row.id, file); await reloadMedia(); await onChanged(); });
  }

  const fields = [["Management", row.management], ["Operation", row.operation]];
  return (
    <>
      <p className="case-muted">{caseSexLabel(row.sex)} {row.age_years} ปี · {row.unit_name} · รับไว้ {thaiDate(row.admit_date)} · Owner: {personName(people, row.owner_id)}</p>
      {row.deleted_at && <p className="form-error" role="status">เคสนี้ถูกลบ (ซ่อนจากผู้ใช้อื่น) · Admin ลบถาวรได้จากปุ่มด้านล่าง</p>}
      <p><CaseStatusChip status={row.status} /> <small className="case-muted">แก้ล่าสุด {thaiDateTime(row.updated_at)} โดย {personName(people, row.updated_by)}</small></p>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="case-split">
        <div>
          {fields.map(([label, value]) => <div className="case-field" key={label}><small>{label}</small>{value || "ยังไม่ระบุ"}</div>)}
          <div className="button-row">
            <button type="button" className="secondary-button" disabled={!canEditCase(user, row)} onClick={onEdit}>แก้ไขข้อมูล</button>
            {!row.deleted_at && <button type="button" className="primary-button" onClick={() => onPresent({ id: row.id, admit_date: row.admit_date })}>นำเสนอเคสนี้</button>}
            {canDeleteCase(user, row) && (
              <button type="button" className="danger-button" disabled={busy} onClick={() => { if (window.confirm("ลบเคสนี้? (ซ่อนจากทุกคนยกเว้น Admin)")) run(async () => { await softDeleteAdmissionCase(row.id, row.updated_at); await onChanged(); onClose(); }); }}>ลบเคส</button>
            )}
            {user.role === "admin" && (
              <button type="button" className="danger-button" disabled={busy} onClick={() => { if (window.confirm("ลบถาวรพร้อมภาพและโน้ตทั้งหมด ไม่สามารถกู้คืนได้ ยืนยัน?")) run(async () => { await purgeAdmissionCase(row.id); await onChanged(); onClose(); }); }}>ลบถาวร</button>
            )}
          </div>
        </div>
        <div>
          <strong>ภาพแนบ ({media?.length ?? "…"})</strong>
          <div className="case-media">
            {(media || []).map((item, index) => (
              <figure key={item.id}>
                {item.url ? <img src={item.url} alt={item.caption || `ภาพ ${index + 1}`} /> : <div className="case-media-empty">โหลดภาพไม่สำเร็จ</div>}
                <figcaption>{item.caption || `ภาพ ${index + 1}`}
                  {canDeleteMedia(user, item) && <button type="button" className="link-button" disabled={busy} onClick={() => { if (window.confirm("ลบภาพนี้?")) run(async () => { await deleteCaseMedia(item.id); await reloadMedia(); await onChanged(); }); }}> ลบ</button>}
                </figcaption>
              </figure>
            ))}
            {media?.length === 0 && <div className="case-media-empty">ยังไม่มีภาพแนบ</div>}
          </div>
          <label className="case-upload">เพิ่มภาพ<input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy || !canEditCase(user, row)} onChange={onFile} /></label>
          <p className="case-muted">ระบบย่อภาพและลบ EXIF/GPS ก่อนอัปโหลด · อย่าถ่ายติดใบหน้า/ป้ายชื่อ</p>
        </div>
      </div>
    </>
  );
}

export default function ResidentCases({ user, onPresent }) {
  const [cases, setCases] = useState(null);
  const [people, setPeople] = useState([]);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [unit, setUnit] = useState("all");
  const [showDeleted, setShowDeleted] = useState(false);
  const [dialog, setDialog] = useState(null); // { type: "form" | "detail", id? }

  const load = useCallback(async () => {
    try {
      const [rows, ppl] = await Promise.all([
        loadAdmissionCases({ includeDeleted: user.role === "admin" && showDeleted }),
        loadCasePeople(),
      ]);
      setCases(rows);
      setPeople(ppl);
      setError("");
    } catch (nextError) {
      setError(caseErrorMessage(nextError));
    }
  }, [user.role, showDeleted]);
  useEffect(() => { load(); }, [load]);

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (cases || []).filter((row) =>
      (status === "all" || row.status === status) &&
      (unit === "all" || row.unit_name === unit) &&
      (!needle || `${row.diagnosis} ${row.case_code}`.toLowerCase().includes(needle)));
  }, [cases, search, status, unit]);
  const current = dialog?.id ? (cases || []).find((row) => row.id === dialog.id) : null;
  const live = (cases || []).filter((row) => !row.deleted_at);
  const count = (key) => live.filter((row) => row.status === key).length;

  return (
    <section className="resident-panel">
      <div className="panel-title-row">
        <div><h2>เคสรับใหม่ของภาควิชา</h2><p>ทุกคนที่ active เห็นเคสร่วมกัน · ห้ามบันทึกข้อมูลระบุตัวผู้ป่วย</p></div>
        <button type="button" className="primary-button" onClick={() => setDialog({ type: "form" })}><PlusIcon size={16} /> เพิ่มเคส</button>
      </div>
      {error && <p className="form-error" role="alert">{error} <button type="button" className="link-button" onClick={load}>ลองใหม่</button></p>}
      <div className="case-stats">
        <div><small>เคสทั้งหมด</small><strong>{cases ? live.length : "…"}</strong></div>
        <div><small>Admit อยู่</small><strong>{cases ? count("admit") : "…"}</strong></div>
        <div><small>รออัปเดตสถานะ</small><strong>{cases ? count("pending_update") : "…"}</strong></div>
      </div>
      <div className="history-filters">
        <label>ค้นหา<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Diagnosis หรือรหัสเคส" /></label>
        <label>สถานะ<select value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">ทุกสถานะ</option>{CASE_STATUSES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>หน่วย<select value={unit} onChange={(event) => setUnit(event.target.value)}><option value="all">ทุกหน่วย</option>{CASE_UNITS.map((name) => <option key={name}>{name}</option>)}</select></label>
        {user.role === "admin" && (
          <label className="case-check"><input type="checkbox" checked={showDeleted} onChange={(event) => setShowDeleted(event.target.checked)} /> แสดงเคสที่ถูกลบ</label>
        )}
      </div>
      <div className="resident-table-wrap">
        <table>
          <thead><tr><th>เคส / วันที่รับ</th><th>Diagnosis</th><th>หน่วย / Owner</th><th>สถานะ</th><th>ภาพ</th><th /></tr></thead>
          <tbody>
            {visible.map((row) => (
              <tr key={row.id} className={row.deleted_at ? "case-row-deleted" : undefined}>
                <td><strong>{row.case_code}</strong><br /><small>{thaiDate(row.admit_date)}</small></td>
                <td><button type="button" className="link-button" onClick={() => setDialog({ type: "detail", id: row.id })}>{row.diagnosis}</button><br /><small>{caseSexLabel(row.sex)} · {row.age_years} ปี</small></td>
                <td>{row.unit_name}<br /><small>{personName(people, row.owner_id)}</small></td>
                <td><CaseStatusChip status={row.status} />{!row.deleted_at ? null : <> <span className="case-status case-status-deleted">ถูกลบ</span></>}</td>
                <td>{row.media_count}</td>
                <td><button type="button" className="secondary-button" disabled={!canEditCase(user, row)} title={canEditCase(user, row) ? "" : row.deleted_at ? "เคสที่ถูกลบแก้ไขไม่ได้" : "Resident แก้ได้เฉพาะเคสที่ตนสร้างหรือเป็น Owner"} onClick={() => setDialog({ type: "form", id: row.id })}>แก้ไข</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        {cases && visible.length === 0 && <p className="case-muted">ไม่พบเคสที่ตรงกับเงื่อนไข</p>}
        {!cases && !error && <p className="case-muted">กำลังโหลดเคส…</p>}
      </div>
      {dialog?.type === "form" && (!dialog.id || current) && (
        <CaseModal title={dialog.id ? `แก้ไข ${current.case_code}` : "เพิ่มเคสใหม่"} onClose={() => setDialog(null)}>
          <CaseForm user={user} people={people} initial={dialog.id ? current : null} onSaved={async () => { await load(); setDialog(null); }} onReload={load} onClose={() => setDialog(null)} />
        </CaseModal>
      )}
      {dialog?.type === "detail" && current && (
        <CaseModal title={`${current.case_code} · ${current.diagnosis}`} onClose={() => setDialog(null)}>
          <CaseDetail user={user} people={people} row={current} onEdit={() => setDialog({ type: "form", id: current.id })} onPresent={onPresent} onChanged={load} onClose={() => setDialog(null)} />
        </CaseModal>
      )}
    </section>
  );
}
