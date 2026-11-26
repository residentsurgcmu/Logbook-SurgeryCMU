import React, { useEffect, useId, useState } from "react";
import { managedExamsApi } from "../residentApi";
import { buildMySpaceXray } from "../mySpaceXray";
import { thaiDate } from "../residentAssessmentRules";

const reasonText = {
  unmapped: "ยังไม่มีข้อมูล",
  absent: "ขาดสอบ",
  awaiting: "ยังไม่ครบ",
  invalid: "คะแนนหรือคะแนนเต็มไม่ครบ",
};
const percent = (n) => new Intl.NumberFormat("th-TH", { maximumFractionDigits: 1 }).format(n);

function point(index, radius) {
  const angle = -Math.PI / 2 + index * Math.PI / 4;
  return [160 + radius * Math.cos(angle), 147 + radius * Math.sin(angle)];
}

function Radar({ axes }) {
  const labelId = useId();
  const points = axes.map(({ value }, i) => value == null ? null : point(i, value * 1.06));
  return <svg className="ms-xray-radar" viewBox="0 0 320 300" role="img" aria-labelledby={labelId}>
    <title id={labelId}>กราฟคะแนน X-ray Anatomy; ดูตัวเลขและสถานะรายแกนในตารางด้านล่าง</title>
    {[26.5, 53, 79.5, 106].map((radius) => <polygon key={radius} className="ms-xray-grid" points={axes.map((_, i) => point(i, radius).join(",")).join(" ")} />)}
    {axes.map(({ axis, value }, i) => {
      const [x, y] = point(i, 106), [lx, ly] = point(i, 129);
      const next = points[(i + 1) % axes.length], here = points[i];
      return <g key={axis}>
        <line className={value == null ? "ms-xray-grid ms-xray-missing" : "ms-xray-grid"} x1={160} y1={147} x2={x} y2={y} />
        {here && next && <line className="ms-xray-segment" x1={here[0]} y1={here[1]} x2={next[0]} y2={next[1]} />}
        {here && <circle className="ms-xray-dot" cx={here[0]} cy={here[1]} r={3.5} />}
        <text x={lx} y={ly} textAnchor="middle">{axis}</text>
        <text className="ms-xray-tick" x={lx} y={ly + 15} textAnchor="middle">{value == null ? "—" : `${percent(value)}%`}</text>
      </g>;
    })}
  </svg>;
}

function OwnXrayResults({ userId }) {
  const [result, setResult] = useState({ loading: true });
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const control = new AbortController();
    setResult({ loading: true });
    managedExamsApi.read("own", { signal: control.signal }).then(({ rows }) => {
      if (!control.signal.aborted) setResult({ radar: buildMySpaceXray(rows, userId) });
    }).catch(() => { if (!control.signal.aborted) setResult({ error: true }); });
    return () => control.abort();
  }, [userId, reload]);

  if (result.loading) return <p className="ms-muted" role="status">กำลังโหลดผลสอบ…</p>;
  if (result.error) return <div><p className="ms-error" role="alert">โหลดผลสอบไม่สำเร็จ</p><button type="button" className="ms-link" onClick={() => setReload((value) => value + 1)}>ลองใหม่</button></div>;
  if (!result.radar) return <p className="ms-empty">ยังไม่มีผล X-ray Anatomy ที่ประกาศสำหรับคุณ</p>;
  return <XrayRadarResult radar={result.radar} />;
}

export function XrayRadarResult({ radar }) {
  if (!radar) return <p className="ms-empty">ไม่พบผล X-ray Anatomy ที่ประกาศสำหรับผู้สอบในช่วงที่เลือก</p>;
  const { title, date, axes, unmapped } = radar;
  return <>
    <p className="ms-muted">{title} · สอบ {thaiDate(date)}</p>
    <Radar axes={axes} />
    <p className="ms-muted">แสดงเฉพาะ X-ray Anatomy ครั้งล่าสุดที่ประกาศ · ยังไม่คำนวณ Overall การฝึก</p>
    {unmapped > 0 && <p className="ms-muted">มี {unmapped} ส่วนสอบที่ยังไม่ได้ผูกกับแกน จึงยังไม่นำมาคิด</p>}
    <table className="ms-xray-table">
      <thead><tr><th scope="col">แกน</th><th scope="col">คะแนน / เต็ม</th><th scope="col">ผลบนกราฟ</th></tr></thead>
      <tbody>{axes.map(({ axis, score, max, value, reason }) => value == null ?
        <tr key={axis}><th scope="row">{axis}</th><td colSpan={2}>{reasonText[reason]}</td></tr> :
        <tr key={axis}><th scope="row">{axis}</th><td>{score} / {max}</td><td>{percent(value)}%</td></tr>)}</tbody>
    </table>
  </>;
}

export default function MySpaceXrayRadar({ userId }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return <section className="ms-card" aria-labelledby={`${id}-title`}>
    <div className="ms-card-heading"><h2 id={`${id}-title`}>แผนผังการฝึก · นำร่อง</h2>
      <button className="ms-link" type="button" aria-expanded={open} aria-controls={`${id}-scores`} onClick={() => setOpen((value) => !value)}>{open ? "ซ่อนกราฟ" : "เปิดกราฟคะแนน"}</button>
    </div>
    <div id={`${id}-scores`}>{open ? <OwnXrayResults key={userId} userId={userId} /> : <p className="ms-muted">X-ray Anatomy · ซ่อนคะแนนจนกว่าจะเปิดดู</p>}</div>
  </section>;
}
