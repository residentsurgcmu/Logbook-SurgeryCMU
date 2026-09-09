import React, { useMemo } from "react";
import { BookIcon, ChartIcon, CheckIcon, ClockIcon, UserIcon } from "../components/Icons";
import { buildDashboard } from "../residentAnalytics";

const readableDateTime = (value) => value ? new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Bangkok" }).format(new Date(value)) : "—";

export default function ResidentDashboard({ workspace }) {
  const dashboard = useMemo(() => buildDashboard(workspace), [workspace]);
  const names = new Map(workspace.profiles.map((profile) => [profile.id, profile.name]));
  const role = workspace.user.role;
  const cards = role === "admin" ? [
    ["Resident", dashboard.residents.length, UserIcon], ["Staff ที่เชื่อมบัญชี", dashboard.activeStaff, BookIcon],
    ["รอประเมิน", dashboard.pending.length, ClockIcon], ["ประเมินแล้ว", dashboard.completed, CheckIcon],
  ] : role === "staff" ? [
    ["รอฉันประเมิน", dashboard.pending.length, ClockIcon], ["ฉันประเมินแล้ว", dashboard.completed, CheckIcon],
    ["Resident ที่เกี่ยวข้อง", new Set(workspace.requests.map((item) => item.resident_id)).size, UserIcon], ["EPA/PBA ในระบบ", workspace.templates.length, BookIcon],
  ] : [
    ["ส่งแล้วทั้งหมด", workspace.requests.length, BookIcon], ["รอ Staff ประเมิน", dashboard.pending.length, ClockIcon],
    ["ประเมินแล้ว", dashboard.completed, CheckIcon], ["EPA/PBA ในระบบ", workspace.templates.length, ChartIcon],
  ];
  return <div className="dashboard-stack">
    <section className="dashboard-summary" aria-label="สรุปภาพรวม">{cards.map(([label, value, Icon]) => <div className="metric-item" key={label}><span className="metric-icon"><Icon size={22} /></span><div><small>{label}</small><strong>{value.toLocaleString("th-TH")}</strong></div></div>)}</section>
    <div className="dashboard-columns">
      <section className="resident-panel progress-panel"><div className="panel-title-row"><div><h2>ความคืบหน้า EPA / PBA</h2><p>จำนวนผลประเมินและรายการรอดำเนินการจากข้อมูลปัจจุบัน</p></div><ChartIcon size={22} /></div>{dashboard.typeTotals.map((item) => { const total = item.completed + item.pending; const percent = total ? Math.round(item.completed / total * 100) : 0; return <div className="progress-row" key={item.type}><div><strong>{item.type}</strong><span>{item.templates} แบบ · ประเมินแล้ว {item.completed} · รอ {item.pending}</span></div><div className="progress-track"><i style={{ width: `${percent}%` }} /></div><b>{percent}%</b></div>; })}</section>
      <section className="resident-panel activity-panel"><div className="panel-title-row"><div><h2>กิจกรรมล่าสุด</h2><p>Timestamp ของการส่งและการประเมิน</p></div><ClockIcon size={22} /></div>{dashboard.recent.length ? <div className="activity-list">{dashboard.recent.map((item) => <div key={item.id}><span className={item.kind === "ส่งแบบประเมิน" ? "activity-dot pending" : "activity-dot completed"} /><p><strong>{item.kind}</strong><br />{item.code} · {names.get(item.residentId) || "—"}</p><time>{readableDateTime(item.at)}</time></div>)}</div> : <p className="muted-empty">ยังไม่มีกิจกรรม</p>}</section>
    </div>
    {role === "admin" && <section className="resident-panel"><div className="panel-title-row"><div><h2>สถานะ Resident</h2><p>สรุปผลรายคนเพื่อใช้ติดตาม ไม่รวมข้อมูลระบุตัวผู้ป่วย</p></div></div><div className="resident-table-wrap"><table><thead><tr><th>Resident</th><th>PGY</th><th>ประเมินแล้ว</th><th>รอประเมิน</th><th>สถานะ</th></tr></thead><tbody>{dashboard.residentRows.length ? dashboard.residentRows.map((resident) => <tr key={resident.id}><td><strong>{resident.name}</strong></td><td>PGY {resident.pgy}</td><td>{resident.completed}</td><td>{resident.pending}</td><td><span className={`status-chip ${resident.pending ? "pending" : "completed"}`}>{resident.pending ? "มีรายการรอ" : "ปกติ"}</span></td></tr>) : <tr><td colSpan="5" className="table-empty">ยังไม่มี Resident ที่เปิดใช้งาน</td></tr>}</tbody></table></div></section>}
  </div>;
}
