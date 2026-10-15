import React, { useEffect, useState } from "react";
import { fullScoreError, mplError, PGY_LEVELS } from "../examScoring";
import { saveExamStandards } from "../residentApi";
import { MplInputs } from "./ExamMplFields";

const blankRow = (examType = "xray_anatomy") => ({ key: crypto.randomUUID(), examType, partName: "", maxScore: "", mpl: {} });
const toRows = (standards) => {
  const rows = standards.map((item) => ({ key: item.id, examType: item.examType, partName: item.partName, maxScore: item.maxScore, mpl: { ...item.mpl } }));
  if (!rows.some((row) => row.examType === "mcq")) rows.push({ key: crypto.randomUUID(), examType: "mcq", partName: "MCQ", maxScore: "", mpl: {} });
  return rows;
};

export default function ExamStandards({ standards, onSaved }) {
  const [rows, setRows] = useState(() => toRows(standards));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  useEffect(() => setRows(toRows(standards)), [standards]);
  const update = (key, changes) => setRows((current) => current.map((row) => (row.key === key ? { ...row, ...changes } : row)));

  async function save() {
    setError("");
    setMessage("");
    const payload = [];
    for (const row of rows) {
      const name = row.partName.trim();
      const empty = !name && !row.maxScore && !Object.values(row.mpl).some(Boolean);
      if (row.examType === "mcq" && empty) continue;
      if (!name) return setError("กรุณาระบุชื่อ part ให้ครบทุกแถว");
      const maxProblem = fullScoreError(row.maxScore);
      if (maxProblem) return setError(`${name}: ${maxProblem}`);
      for (const pgy of PGY_LEVELS) {
        const problem = mplError(row.mpl[pgy], row.maxScore);
        if (problem) return setError(`${name} PGY ${pgy}: ${problem}`);
      }
      payload.push({ examType: row.examType, partName: name, maxScore: String(row.maxScore).trim(), mpl: row.mpl });
    }
    if (new Set(payload.map((item) => `${item.examType}:${item.partName.toLowerCase()}`)).size !== payload.length)
      return setError("ชื่อ part ห้ามซ้ำกันในประเภทข้อสอบเดียวกัน");
    setBusy(true);
    try {
      await saveExamStandards(payload);
      onSaved(
        payload.map((item) => ({ id: crypto.randomUUID(), examType: item.examType, partName: item.partName, maxScore: item.maxScore, mpl: item.mpl })),
      );
      setMessage("บันทึกเกณฑ์กลางแล้ว มีผลกับรายการสอบที่สร้างหลังจากนี้เท่านั้น");
    } catch (nextError) {
      setError(nextError.message || "บันทึกเกณฑ์ MPL ไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  const section = (examType, title) => (
    <div className="exam-standards-group">
      <h3>{title}</h3>
      {rows.filter((row) => row.examType === examType).map((row) => (
        <div key={row.key} className="exam-standard-row">
          <label>ชื่อ part<input value={row.partName} maxLength="120" disabled={examType === "mcq"} onChange={(event) => update(row.key, { partName: event.target.value })} /></label>
          <label>คะแนนเต็ม<input type="number" inputMode="decimal" min="0.01" step="0.01" value={row.maxScore} onChange={(event) => update(row.key, { maxScore: event.target.value })} /></label>
          <MplInputs values={row.mpl} maxScore={row.maxScore} label={row.partName} onChange={(mpl) => update(row.key, { mpl })} />
          {examType !== "mcq" && <button type="button" className="text-button" onClick={() => setRows((current) => current.filter((item) => item.key !== row.key))}>ลบ</button>}
        </div>
      ))}
      {examType !== "mcq" && <button type="button" className="secondary-button" onClick={() => setRows((current) => [...current, blankRow(examType)])}>เพิ่ม part</button>}
    </div>
  );

  return (
    <section className="resident-panel exam-standards">
      <div className="section-heading">
        <h2>เกณฑ์ MPL ตามชั้นปี</h2>
        <p>ตั้งครั้งเดียวต่อ part ระบบคัดลอกไปไว้กับรายการสอบตอนสร้าง แก้เกณฑ์กลางภายหลังจึงไม่เปลี่ยนผลสอบที่สร้างไปแล้ว ช่อง MPL ที่เว้นว่างจะแสดง "ยังไม่ตั้งเกณฑ์"</p>
      </div>
      {section("xray_anatomy", "X-ray & Anatomy")}
      {section("mcq", "MCQ")}
      {error && <p className="form-error" role="alert">{error}</p>}
      {message && <p className="form-success" role="status">{message}</p>}
      <button type="button" className="primary-button" disabled={busy} onClick={save}>{busy ? "กำลังบันทึก…" : "บันทึกเกณฑ์กลาง"}</button>
    </section>
  );
}
