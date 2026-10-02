import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  splitCaseImageFiles,
  validateCaseForm,
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
  uploadCaseImages,
} from "../residentCasesApi";
import { exportCaseDeck } from "../casePptxExport";
import { caseExportRange, filterCasesForExport, validateExportRange } from "../caseExcel";
import { exportCasesExcel } from "../caseExcelExport";
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
  const [stage, setStage] = useState("");
  const [pending, setPending] = useState([]); // [{ file, url }] previews, uploaded after save
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

  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    const problem = validateCaseForm(form);
    if (problem) return setError(problem);
    setBusy(true);
    setError("");
    setConflict(false);
    setStage("save");
    let caseId;
    try {
      if (initial) {
        await updateAdmissionCase(initial.id, initial.updated_at, form);
        caseId = initial.id;
      } else {
        caseId = await createAdmissionCase(form);
      }
    } catch (nextError) {
      setConflict(isCaseConflict(nextError));
      setError(caseErrorMessage(nextError));
      setBusy(false);
      setStage("");
      return;
    }
    // The case is saved from here on: never save it again (a retry would create
    // a duplicate), so image problems are reported on the case detail instead.
    let failureNotice = "";
    if (pending.length) {
      setStage("upload");
      const { failed } = await uploadCaseImages(caseId, pending.map((item) => item.file));
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
                <img src={item.url} alt={`ภาพที่ ${index + 1}`} />
                <figcaption>ภาพที่ {index + 1} <button type="button" className="link-button" disabled={busy} onClick={() => removePending(index)}>เอาออก</button></figcaption>
              </figure>
            ))}
          </div>
        ) : (
          <p className="case-muted">ยังไม่ได้เลือกภาพ · ภาพจะอัปโหลดหลังกดบันทึก (ระบบย่อภาพและลบ EXIF/GPS ให้)</p>
        )}
      </div>
      <div className="button-row case-actions">
        <button type="button" className="secondary-button" onClick={onClose}>ยกเลิก</button>
        <button type="submit" className="primary-button" disabled={busy}>{stage === "upload" ? "กำลังอัปโหลดภาพ…" : busy ? "กำลังบันทึก…" : "บันทึก"}</button>
      </div>
    </form>
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

  const fields = [["Management", row.management], ["Operation", row.operation]];
  return (
    <>
      <p className="case-muted">{caseSexLabel(row.sex)} {row.age_years} ปี · {row.unit_name} · รับไว้ {thaiDate(row.admit_date)} · Owner: {personName(people, row.owner_id)}</p>
      {row.deleted_at && <p className="form-error" role="status">เคสนี้ถูกลบ (ซ่อนจากผู้ใช้อื่น) · Admin ลบถาวรได้จากปุ่มด้านล่าง</p>}
      <p><CaseStatusChip status={row.status} /> <small className="case-muted">แก้ล่าสุด {thaiDateTime(row.updated_at)} โดย {personName(people, row.updated_by)}</small></p>
      {notice && <p className="form-error" role="status">{notice}</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
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
                {item.url ? <img src={item.url} alt={item.caption || `ภาพ ${index + 1}`} /> : <div className="case-media-empty">โหลดภาพไม่สำเร็จ</div>}
                <figcaption>{item.caption || `ภาพ ${index + 1}`}
                  {canDeleteMedia(user, item) && <button type="button" className="link-button" disabled={busy} onClick={() => { if (window.confirm("ลบภาพนี้?")) run(async () => { await deleteCaseMedia(item.id); await reloadMedia(); await onChanged(); }); }}> ลบ</button>}
                </figcaption>
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

function ExcelExportDialog({ cases, people, onClose }) {
  const [preset, setPreset] = useState("month");
  const [range, setRange] = useState(() => caseExportRange("month"));
  const [unit, setUnit] = useState("all");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const problem = validateExportRange(range.from, range.to);
  const rows = problem ? [] : filterCasesForExport(cases || [], { ...range, unit });
  const choose = (key) => {
    setPreset(key);
    if (key !== "custom") setRange(caseExportRange(key));
  };
  const setDate = (key) => (event) => {
    setPreset("custom");
    setRange((current) => ({ ...current, [key]: event.target.value }));
  };
  async function download() {
    if (busy || problem || !rows.length) return;
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
            {CASE_UNITS.map((name) => <option key={name}>{name}</option>)}
          </select>
        </label>
      </div>
      {(problem || error) && <p className="form-error" role="alert">{problem || error}</p>}
      {!problem && <p className="case-muted">พบ {rows.length} เคสในช่วงนี้</p>}
      <div className="button-row case-actions">
        <button type="button" className="secondary-button" onClick={onClose}>ยกเลิก</button>
        <button type="button" className="primary-button" disabled={busy || Boolean(problem) || !rows.length} onClick={download}>{busy ? "กำลังสร้างไฟล์…" : "ดาวน์โหลด .xlsx"}</button>
      </div>
    </div>
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
        <div className="button-row">
          <button type="button" className="secondary-button" disabled={!cases?.length} onClick={() => setDialog({ type: "excel" })}>Export Excel</button>
          <button type="button" className="primary-button" onClick={() => setDialog({ type: "form" })}><PlusIcon size={16} /> เพิ่มเคส</button>
        </div>
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
          <CaseForm user={user} people={people} initial={dialog.id ? current : null} onSaved={async (caseId, notice) => { await load(); setDialog({ type: "detail", id: caseId, notice }); }} onReload={load} onClose={() => setDialog(null)} />
        </CaseModal>
      )}
      {dialog?.type === "excel" && (
        <CaseModal title="Export Excel · New admissions" onClose={() => setDialog(null)}>
          <ExcelExportDialog cases={cases} people={people} onClose={() => setDialog(null)} />
        </CaseModal>
      )}
      {dialog?.type === "detail" && current && (
        <CaseModal title={`${current.case_code} · ${current.diagnosis}`} onClose={() => setDialog(null)}>
          <CaseDetail user={user} people={people} row={current} notice={dialog.notice} onEdit={() => setDialog({ type: "form", id: current.id })} onPresent={onPresent} onChanged={load} onClose={() => setDialog(null)} />
        </CaseModal>
      )}
    </section>
  );
}
