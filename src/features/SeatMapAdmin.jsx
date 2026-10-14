import React, { useState } from "react";
import { bangkokHm, onTimeIso, seatErrorMessage } from "../seatMap";
import { adminConfigureSeat, adminSeatReport } from "../seatMapApi";
import { AdminReportView } from "./SeatMapViews";

// One block inside each round card on "MM & Grand Round": turn the seat map on, set the on-time time, read the report (requests read-only: Staff decide them).
// It never polls: the Admin presses a button to read the report.
export function SeatAdminPanel({ session, config, canConfigure, onChanged }) {
  const [time, setTime] = useState(() => (config ? bangkokHm(config.on_time_at) : ""));
  const [report, setReport] = useState(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  async function run(name, work) {
    setBusy(name); setError("");
    try { await work(); } catch (nextError) { setError(seatErrorMessage(nextError)); } finally { setBusy(""); }
  }
  const open = () => run("open", async () => { await adminConfigureSeat(session.id); await onChanged?.(); });
  const saveTime = () => run("time", async () => { await adminConfigureSeat(session.id, null, onTimeIso(session.starts_at, time)); await onChanged?.(); });
  const loadReport = () => run("report", async () => setReport(await adminSeatReport(session.id)));

  return <section className="round-seat-admin" aria-label="ผังที่นั่ง">
    <h4>ผังที่นั่งของรอบนี้</h4>
    {!config && <>
      <p>ยังไม่ได้เปิดผังที่นั่ง รอบนี้เช็คชื่อด้วย QR อย่างเดียวเหมือนเดิม</p>
      {canConfigure && <button type="button" className="primary-button" disabled={Boolean(busy)} onClick={open}>{busy === "open" ? "กำลังเปิด…" : "เปิดผังที่นั่งของรอบนี้"}</button>}
    </>}
    {config && <>
      <p>เปิดผัง <strong>{config.layout_name}</strong> · นั่งแล้ว {config.seated} คน · คำขอรอตรวจ {config.pending_requests}</p>
      {canConfigure && <div className="seatmap-filters">
        <label>เวลา "ตรงเวลา" (น.)<input type="time" value={time} onChange={(event) => setTime(event.target.value)} /></label>
        <button type="button" className="secondary-button" disabled={Boolean(busy) || !time} onClick={saveTime}>{busy === "time" ? "กำลังบันทึก…" : "บันทึกเวลา"}</button>
      </div>}
      <p className="seatmap-hint">"ตรงเวลา" คือเช็คชื่อเข้าห้องก่อนเวลานี้ ใช้เป็นข้อมูลประกอบ ไม่ใช่เกณฑ์ลงโทษ</p>
      <button type="button" className="secondary-button" disabled={Boolean(busy)} onClick={loadReport}>{busy === "report" ? "กำลังโหลด…" : report ? "โหลดรายงานใหม่" : "ดูรายงานผังที่นั่ง"}</button>
      {report && <AdminReportView report={report} />}
    </>}
    {error && <p className="form-error" role="alert">{error}</p>}
  </section>;
}
