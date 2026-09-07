import React, { useState } from "react";
import { essentialProcedures, participationOptions } from "../data";
import { PlusIcon } from "../components/Icons";

const today = () => new Date().toISOString().slice(0, 10);
const MANUAL_OPERATION = "__manual__";
const emptyForm = (user) => ({
  date: today(), hn: "", diagnosis: "", procedureId: essentialProcedures[0].id,
  procedureId2: "", procedureId3: "", customOperation: "", customOperation2: "", customOperation3: "", participation: "Surgeon",
  supervisor: user.role === "staff" ? user.name : "", note: "",
});

const operationFor = (procedureId) => essentialProcedures.find((item) => item.id === procedureId)?.operation || "";
const resolvedOperation = (procedureId, customOperation) => procedureId === MANUAL_OPERATION
  ? customOperation.trim()
  : operationFor(procedureId);

const OperationField = ({ number, procedureId, customOperation, optional = false, onProcedureChange, onCustomChange }) => (
  <div className="span-2 operation-field">
    <label>Operation {number} <span className={optional ? "field-optional" : "field-required"}>{optional ? "ไม่บังคับ" : "จำเป็น"}</span>
      <select value={procedureId} onChange={(event) => onProcedureChange(event.target.value)} required={!optional}>
        {optional && <option value="">— ไม่มี Operation เพิ่มเติม —</option>}
        {essentialProcedures.map((procedure) => <option key={procedure.id} value={procedure.id}>{procedure.operation}</option>)}
        <option value={MANUAL_OPERATION}>อื่น ๆ — กรอก Operation เอง</option>
      </select>
    </label>
    {procedureId === MANUAL_OPERATION && (
      <label className="manual-operation-label">ชื่อ Operation ที่ต้องการบันทึก
        <input value={customOperation} onChange={(event) => onCustomChange(event.target.value)} placeholder="เช่น Total thyroidectomy" maxLength="200" required />
        <small>บันทึกเฉพาะใน Logbook และไม่นำไปนับใน Essential Procedure</small>
      </label>
    )}
  </div>
);

const formFromRecord = (record) => ({
  id: record.id,
  date: record.date,
  hn: record.hn,
  diagnosis: record.diagnosis,
  procedureId: record.procedureId || MANUAL_OPERATION,
  procedureId2: record.operation2 ? (record.procedureId2 || MANUAL_OPERATION) : "",
  procedureId3: record.operation3 ? (record.procedureId3 || MANUAL_OPERATION) : "",
  customOperation: record.procedureId ? "" : record.operation,
  customOperation2: record.procedureId2 ? "" : record.operation2 || "",
  customOperation3: record.procedureId3 ? "" : record.operation3 || "",
  participation: record.participation,
  supervisor: record.supervisor,
  note: record.note || "",
});

export default function Logbook({ user, records, onSave, onUpdate }) {
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState(() => emptyForm(user));
  const isEditing = Boolean(form.id);

  function openNewForm() {
    setForm(emptyForm(user));
    setError("");
    setShowForm(true);
  }

  function openEditForm(record) {
    setForm(formFromRecord(record));
    setError("");
    setShowForm(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function closeForm() {
    setForm(emptyForm(user));
    setError("");
    setShowForm(false);
  }

  async function submit(event) {
    event.preventDefault();
    const selections = [
      { procedureId: form.procedureId, customOperation: form.customOperation },
      { procedureId: form.procedureId2, customOperation: form.customOperation2 },
      { procedureId: form.procedureId3, customOperation: form.customOperation3 },
    ];
    const procedureIds = selections.map((item) => item.procedureId).filter((id) => id && id !== MANUAL_OPERATION);
    if (new Set(procedureIds).size !== procedureIds.length) {
      setError("กรุณาเลือก Operation แต่ละบรรทัดไม่ให้ซ้ำกัน");
      return;
    }
    const operations = selections.map((item) => resolvedOperation(item.procedureId, item.customOperation));
    if (!operations[0] || selections.some((item, index) => item.procedureId === MANUAL_OPERATION && !operations[index])) {
      setError("กรุณากรอกชื่อ Operation ที่เลือกแบบกรอกเอง");
      return;
    }
    const normalizedOperations = operations.filter(Boolean).map((operation) => operation.toLocaleLowerCase());
    if (new Set(normalizedOperations).size !== normalizedOperations.length) {
      setError("กรุณาระบุ Operation แต่ละบรรทัดไม่ให้ซ้ำกัน");
      return;
    }
    setSaving(true); setError("");
    try {
      const payload = {
        ...form,
        procedureId: form.procedureId === MANUAL_OPERATION ? "" : form.procedureId,
        procedureId2: form.procedureId2 === MANUAL_OPERATION ? "" : form.procedureId2,
        procedureId3: form.procedureId3 === MANUAL_OPERATION ? "" : form.procedureId3,
        operation: operations[0],
        operation2: operations[1],
        operation3: operations[2],
      };
      if (isEditing) await onUpdate(payload);
      else await onSave(payload);
      closeForm();
    } catch (nextError) {
      setError(nextError.message || "ไม่สามารถบันทึก Logbook ได้");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="page-heading">
        <div><h1>Logbook</h1><p>บันทึกประสบการณ์ผ่าตัดและหัตถการของ Fellow</p></div>
        <button className="primary-button with-icon" onClick={showForm && !isEditing ? closeForm : openNewForm}><PlusIcon size={18} />บันทึกเคส</button>
      </div>
      {showForm && (
        <form className="content-panel record-form" onSubmit={submit}>
          <div className="form-section-heading"><h2>{isEditing ? "แก้ไข Logbook" : "บันทึกเคสใหม่"}</h2>{isEditing && <p>แก้ไขได้เฉพาะ Logbook ของบัญชี Fellow นี้</p>}</div>
          <div className="form-grid">
            <label>วันที่<input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} required /></label>
            <label>HN<input value={form.hn} onChange={(e) => setForm({ ...form, hn: e.target.value })} placeholder="Hospital number" required /></label>
            <label className="span-2">Diagnosis<input value={form.diagnosis} onChange={(e) => setForm({ ...form, diagnosis: e.target.value })} required /></label>
            <OperationField number="1" procedureId={form.procedureId} customOperation={form.customOperation} onProcedureChange={(procedureId) => setForm({ ...form, procedureId, customOperation: procedureId === MANUAL_OPERATION ? form.customOperation : "" })} onCustomChange={(customOperation) => setForm({ ...form, customOperation })} />
            <OperationField number="2" optional procedureId={form.procedureId2} customOperation={form.customOperation2} onProcedureChange={(procedureId2) => setForm({ ...form, procedureId2, customOperation2: procedureId2 === MANUAL_OPERATION ? form.customOperation2 : "" })} onCustomChange={(customOperation2) => setForm({ ...form, customOperation2 })} />
            <OperationField number="3" optional procedureId={form.procedureId3} customOperation={form.customOperation3} onProcedureChange={(procedureId3) => setForm({ ...form, procedureId3, customOperation3: procedureId3 === MANUAL_OPERATION ? form.customOperation3 : "" })} onCustomChange={(customOperation3) => setForm({ ...form, customOperation3 })} />
            <label>บทบาท<select value={form.participation} onChange={(e) => setForm({ ...form, participation: e.target.value })}>{participationOptions.map((option) => <option key={option}>{option}</option>)}</select></label>
            <label>อาจารย์ผู้ควบคุม<input value={form.supervisor} onChange={(e) => setForm({ ...form, supervisor: e.target.value })} required /></label>
            <label className="span-2">หมายเหตุ<textarea value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} rows="3" /></label>
          </div>
          <div className="privacy-note">หลีกเลี่ยงการระบุชื่อผู้ป่วยในหมายเหตุ และใช้งานบนอุปกรณ์ที่ได้รับอนุญาตเท่านั้น</div>
          {error && <div className="form-error" role="alert">{error}</div>}
          <div className="form-actions"><button type="button" className="secondary-button" onClick={closeForm}>ยกเลิก</button><button className="primary-button" type="submit" disabled={saving}>{saving ? "กำลังบันทึก…" : isEditing ? "บันทึกการแก้ไข" : "บันทึกลง Logbook"}</button></div>
        </form>
      )}
      <section className="content-panel data-panel">
        {records.length === 0 ? <div className="empty-state"><h3>ยังไม่มีข้อมูลใน Logbook</h3><p>Workbook ต้นทางมีเฉพาะโครงสร้าง จึงยังไม่มีเคสถูกนำมาแสดง</p></div> : (
          <div className="data-table-wrap"><table><thead><tr><th>วันที่</th><th>HN</th><th>Diagnosis</th><th>Operations</th><th>บทบาท</th><th>อาจารย์ผู้ควบคุม</th>{user.role === "fellow" && <th>จัดการ</th>}</tr></thead><tbody>{records.map((item) => <tr key={item.id}><td>{item.date}</td><td>{item.hn}</td><td>{item.diagnosis}</td><td><ol className="operation-list">{(item.operations || [item.operation]).map((operation) => <li key={operation}>{operation}</li>)}</ol></td><td>{item.participation}</td><td>{item.supervisor}</td>{user.role === "fellow" && <td><button type="button" className="text-button table-action" onClick={() => openEditForm(item)}>แก้ไข</button></td>}</tr>)}</tbody></table></div>
        )}
      </section>
    </>
  );
}
