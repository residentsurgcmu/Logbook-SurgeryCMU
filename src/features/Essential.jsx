import React, { useMemo, useState } from "react";
import { essentialProcedures, essentialRoles } from "../data";
import { getLatestProcedureDate } from "../logbookUtils";

export function getRoleProgress(procedure, logbook, role) {
  const completed = logbook.filter((item) => {
    const procedureIds = item.procedureIds || [item.procedureId, item.procedureId2, item.procedureId3].filter(Boolean);
    return procedureIds.includes(procedure.id) && item.participation === role;
  }).length;
  const target = procedure.targets.find((item) => item.role === role)?.count ?? null;
  return { completed, target, remaining: target === null ? null : Math.max(target - completed, 0) };
}

export function getProcedureProgress(procedure, logbook) {
  const preferred = procedure.targets.find((target) => target.role === "Surgeon") || procedure.targets[0] || null;
  const metrics = preferred ? getRoleProgress(procedure, logbook, preferred.role) : {
    completed: logbook.filter((item) => (item.procedureIds || [item.procedureId, item.procedureId2, item.procedureId3].filter(Boolean)).includes(procedure.id)).length,
    target: null,
    remaining: null,
  };
  return {
    ...procedure,
    ...metrics,
    targetRole: preferred?.role ?? null,
    percent: metrics.target ? Math.min(Math.round((metrics.completed / metrics.target) * 100), 100) : 0,
  };
}

const RoleMetric = ({ metric }) => (
  <span className="role-metric">
    <strong>{metric.completed}</strong>
    <small>{metric.target === null ? "เป้าหมาย —" : `เป้า ${metric.target} · เหลือ ${metric.remaining}`}</small>
  </span>
);

export default function Essential({ logbook }) {
  const [category, setCategory] = useState("Essential — Common");
  const categories = [...new Set(essentialProcedures.map((procedure) => procedure.category))];
  const rows = useMemo(() => essentialProcedures
    .filter((procedure) => procedure.category === category)
    .map((procedure, originalIndex) => ({ ...procedure, originalIndex, latestDate: getLatestProcedureDate(procedure.id, logbook) }))
    .sort((left, right) => right.latestDate.localeCompare(left.latestDate) || left.originalIndex - right.originalIndex), [category, logbook]);
  return (
    <>
      <div className="page-heading"><div><h1>Essential Procedure</h1><p>ดึงจำนวนเคสจาก Operation และแยกตามบทบาทใน Logbook โดยอัตโนมัติ</p></div></div>
      <div className="subtabs" role="tablist">{categories.map((item) => <button key={item} className={category === item ? "active" : ""} onClick={() => setCategory(item)}>{item}</button>)}</div>
      <section className="content-panel procedure-panel role-procedure-panel">
        <div className="role-procedure-table">
          <div className="role-procedure-row table-head"><span>Operation</span>{essentialRoles.map((role) => <span key={role}>{role}</span>)}</div>
          {rows.map((item) => (
            <div className="role-procedure-row" key={item.id}>
              <span><strong>{item.operation}</strong><small>{item.latestDate ? `บันทึกล่าสุด ${item.latestDate}` : item.targets.length ? "ยังไม่มีบันทึก · แสดง ทำแล้ว / เป้าหมาย / คงเหลือ" : "ยังไม่มีบันทึก · Experience as available"}</small></span>
              {essentialRoles.map((role) => <RoleMetric key={role} metric={getRoleProgress(item, logbook, role)} />)}
            </div>
          ))}
        </div>
      </section>
      <p className="source-note">เป้าหมายอ้างอิงจาก Essential Procedure ต้นทาง และนับ Surgeon, Supervisor, Assist และ Observe แยกจากกัน</p>
    </>
  );
}
