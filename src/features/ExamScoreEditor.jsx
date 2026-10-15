import React, { useEffect, useMemo, useState } from "react";
import {
  examOutcome, missingMplCount, mplError, mplFor, mplMapKey, mplRowsToState, outcomeLabel,
  PGY_LEVELS, resultKey, scoresDiffer, stateToMplRows,
} from "../examScoring";
import { deleteResidentExamDraft, listExamMpl, saveResidentExamScores, setResidentExamPublication } from "../residentApi";
import ExamExportButton from "./ExamExportButton";
import { MplInputs } from "./ExamMplFields";

const thaiDate = (value) =>
  new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeZone: "Asia/Bangkok" }).format(new Date(`${value}T12:00:00+07:00`));

export default function ExamScoreEditor({ event, onRefresh, onDeleted, scoreError }) {
  const partList = useMemo(
    () => (event.type === "mcq" ? [{ id: null, name: "MCQ", maxScore: event.maxScore }] : event.parts),
    [event],
  );
  const expectedCells = useMemo(
    () => event.participants.flatMap((participant) => partList.map((part) => ({ resident: participant, part }))),
    [event, partList],
  );
  const [scores, setScores] = useState({});
  const [mplState, setMplState] = useState({});
  const [mplDirty, setMplDirty] = useState(false);
  const [reload, setReload] = useState(0);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    const initial = {};
    expectedCells.forEach(({ resident, part }) => {
      const current = event.results.get(resultKey(resident.id, part.id));
      initial[resultKey(resident.id, part.id)] = current?.score == null ? "" : String(current.score);
    });
    setScores(initial);
    setError("");
    setMessage("");
  }, [event.id, event.status]);

  useEffect(() => {
    let alive = true;
    listExamMpl(event.id)
      .then((rows) => { if (alive) { setMplState(mplRowsToState(rows)); setMplDirty(false); } })
      .catch((nextError) => alive && setError(nextError.message || "โหลดเกณฑ์ MPL ไม่สำเร็จ"));
    return () => { alive = false; };
  }, [event.id, event.status, reload]);

  const disabled = event.status !== "draft" || Boolean(busy);
  const unsaved = mplDirty || expectedCells.some(({ resident, part }) => scoresDiffer(scores[resultKey(resident.id, part.id)], event.results.get(resultKey(resident.id, part.id))?.score));
  const setScore = (key, value) => setScores((current) => ({ ...current, [key]: value }));
  const setPartMpl = (partId, values) => {
    setMplState((current) => {
      const next = { ...current };
      PGY_LEVELS.forEach((pgy) => { next[mplMapKey(partId, pgy)] = values[pgy] ?? ""; });
      return next;
    });
    setMplDirty(true);
  };

  const payload = (requireComplete) => {
    const records = [];
    for (const { resident, part } of expectedCells) {
      const score = scores[resultKey(resident.id, part.id)] ?? "";
      if (String(score).trim() === "") {
        if (requireComplete) throw new Error("กรุณากรอกคะแนนให้ครบทุก Resident ก่อนเผยแพร่");
        continue;
      }
      const problem = scoreError(score, part.maxScore);
      if (problem) throw new Error(`คะแนนของ ${resident.name || "Resident"} (${part.name}): ${problem}`);
      records.push({ residentId: resident.id, partId: part.id, score: String(score).trim() });
    }
    return records;
  };
  const checkMpl = () => {
    for (const part of partList) {
      for (const pgy of PGY_LEVELS) {
        const problem = mplError(mplState[mplMapKey(part.id, pgy)], part.maxScore);
        if (problem) throw new Error(`${part.name} PGY ${pgy}: ${problem}`);
      }
    }
  };
  async function persist(requireComplete) {
    checkMpl();
    const records = payload(requireComplete);
    // One call: the server replaces the MPL (when changed) and saves the scores in one transaction.
    await saveResidentExamScores(event.id, records, mplDirty ? stateToMplRows(mplState) : null);
  }
  async function save() {
    setBusy("save"); setError(""); setMessage("");
    try {
      await persist(false);
      await onRefresh();
      setReload((value) => value + 1);
      setMessage("บันทึก Draft แล้ว");
    } catch (nextError) {
      setError(nextError.message || "บันทึกผลสอบไม่สำเร็จ");
    } finally { setBusy(""); }
  }
  async function publish() {
    setBusy("publish"); setError(""); setMessage("");
    try {
      const missing = missingMplCount(expectedCells.map(({ resident, part }) => ({ pgy: resident.pgy, partId: part.id })), mplState);
      checkMpl();
      payload(true);
      if (missing > 0 && !window.confirm(`มี ${missing} ช่องที่ยังไม่ตั้งเกณฑ์ MPL (จะแสดงว่า "ยังไม่ตั้งเกณฑ์") เผยแพร่ต่อหรือไม่?`)) {
        setBusy("");
        return;
      }
      await persist(true);
      await setResidentExamPublication(event.id, true);
      await onRefresh();
      setReload((value) => value + 1);
      setMessage("เผยแพร่ผลสอบแล้ว");
    } catch (nextError) {
      setError(nextError.message || "เผยแพร่ผลสอบไม่สำเร็จ");
    } finally { setBusy(""); }
  }
  async function returnToDraft() {
    if (!window.confirm("นำผลสอบกลับเป็น Draft เพื่อแก้ไข? Resident และ Staff จะไม่เห็นผลจนเผยแพร่อีกครั้ง")) return;
    setBusy("draft"); setError(""); setMessage("");
    try {
      await setResidentExamPublication(event.id, false);
      await onRefresh();
      setMessage("นำผลสอบกลับเป็น Draft แล้ว");
    } catch (nextError) {
      setError(nextError.message || "ไม่สามารถนำกลับ Draft ได้");
    } finally { setBusy(""); }
  }

  async function removeDraft() {
    if (!window.confirm(`ลบ Draft "${event.title}" วันที่ ${thaiDate(event.date)} (${event.participants.length} คน)? คะแนนและเกณฑ์ MPL ของรายการนี้จะหายถาวร`)) return;
    setBusy("delete"); setError(""); setMessage("");
    try {
      await deleteResidentExamDraft(event.id);
      await onDeleted?.({ title: event.title });
    } catch (nextError) {
      setError(nextError.message || "ลบ Draft ไม่สำเร็จ");
      setBusy("");
    }
  }

  return (
    <section className="resident-panel exam-editor">
      <div className="section-heading">
        <h2>{event.title}</h2>
        <p>{event.type === "mcq" ? "MCQ" : "X-ray & Anatomy"} · {thaiDate(event.date)} · <span className={`status-chip ${event.status}`}>{event.status === "published" ? "เผยแพร่แล้ว" : "Draft"}</span></p>
      </div>
      <div className="exam-mpl-panel">
        <h3>เกณฑ์ MPL ของรอบนี้</h3>
        {partList.map((part) => (
          <div key={part.id || "mcq"} className="exam-mpl-part">
            <strong>{part.name}{part.maxScore != null ? ` (เต็ม ${part.maxScore})` : ""}</strong>
            <MplInputs
              values={Object.fromEntries(PGY_LEVELS.map((pgy) => [pgy, mplFor(mplState, part.id, pgy)]))}
              maxScore={part.maxScore}
              disabled={disabled}
              label={part.name}
              onChange={(values) => setPartMpl(part.id, values)}
            />
          </div>
        ))}
      </div>
      <div className="resident-table-wrap">
        <table className="exam-editor-table">
          <thead>
            <tr>
              <th>Resident</th><th>PGY</th>
              {partList.map((part) => <th key={part.id || "mcq"}>{part.name}{part.maxScore != null ? ` / ${part.maxScore}` : ""}</th>)}
            </tr>
          </thead>
          <tbody>
            {event.participants.map((participant) => (
              <tr key={participant.id}>
                <td>{participant.name}</td>
                <td>{participant.pgy ? `PGY ${participant.pgy}` : "—"}</td>
                {partList.map((part) => {
                  const key = resultKey(participant.id, part.id);
                  const score = scores[key] ?? "";
                  const outcome = examOutcome(score, mplFor(mplState, part.id, participant.pgy));
                  const hasScore = String(score).trim() !== "";
                  return (
                    <td key={key}>
                      <input aria-label={`คะแนน ${part.name} ของ ${participant.name}`} type="number" inputMode="decimal" min="0" max={part.maxScore ?? undefined} step="0.01" value={score} disabled={disabled} onChange={(inputEvent) => setScore(key, inputEvent.target.value)} />
                      {hasScore && <span className={`exam-outcome ${outcome || "none"}`}>{outcomeLabel(outcome, "computed")}</span>}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted-empty">ป้ายผ่าน/ไม่ผ่านที่เห็นขณะพิมพ์เป็นตัวอย่าง ค่าจริงคำนวณและเก็บโดยระบบตอนกดบันทึก</p>
      {error && <p className="form-error" role="alert">{error}</p>}
      {message && <p className="form-success" role="status">{message}</p>}
      <div className="button-row">
        {event.status === "draft"
          ? <><button type="button" className="secondary-button" disabled={Boolean(busy)} onClick={save}>{busy === "save" ? "กำลังบันทึก…" : "บันทึก Draft"}</button><button type="button" className="primary-button" disabled={Boolean(busy)} onClick={publish}>{busy === "publish" ? "กำลังเผยแพร่…" : "เผยแพร่ผลสอบ"}</button></>
          : <button type="button" className="secondary-button" disabled={Boolean(busy)} onClick={returnToDraft}>{busy === "draft" ? "กำลังดำเนินการ…" : "นำกลับ Draft เพื่อแก้ไข"}</button>}
        <ExamExportButton event={event} disabled={Boolean(busy) || unsaved} hint={unsaved ? "มีข้อมูลที่ยังไม่บันทึก กดบันทึก Draft ก่อนส่งออก Excel" : ""} />
        {event.status === "draft" && <button type="button" className="danger-button" disabled={Boolean(busy)} onClick={removeDraft}>{busy === "delete" ? "กำลังลบ…" : "ลบ Draft นี้"}</button>}
      </div>
    </section>
  );
}
