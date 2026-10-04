import React, { useMemo } from "react";
import {
  AlertIcon,
  BookIcon,
  ChartIcon,
  CheckIcon,
  ChevronIcon,
  ClipboardIcon,
  ClockIcon,
  PlusIcon,
  ScanIcon,
  UserIcon,
} from "../components/Icons";
import { STALE_PENDING_DAYS, TARGET_ASSESSMENTS_PER_FORM, buildDashboard } from "../residentAnalytics";

const readableDateTime = (value) =>
  value
    ? new Intl.DateTimeFormat("th-TH", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "Asia/Bangkok",
      }).format(new Date(value))
    : "—";

const ageLabel = (days) => (days < 1 ? "วันนี้" : `${days} วัน`);

function AgeChip({ days }) {
  const stale = days >= STALE_PENDING_DAYS;
  return (
    <span className={`age-chip${stale ? " stale" : ""}`}>
      {stale && <AlertIcon size={13} />}
      {ageLabel(days)}
      {stale && <span className="visually-hidden"> ค้างนาน</span>}
    </span>
  );
}

function HomeHero({ role, name, pendingCount, onNavigate }) {
  if (role === "admin") return null;
  const staff = role === "staff";
  return (
    <section className="home-hero" aria-label="งานหลัก">
      <div>
        <h2>{staff ? (pendingCount ? `มี ${pendingCount} รายการรอคุณประเมิน` : "ไม่มีรายการรอประเมิน") : `สวัสดี ${name}`}</h2>
        <p>
          {staff
            ? "เลือกรายการจากคิวด้านล่าง หรือสแกน QR ของ Resident เพื่อเริ่มประเมินทันที"
            : pendingCount
              ? `มี ${pendingCount} รายการที่กำลังรอ Staff ประเมิน`
              : "ส่งแบบประเมินให้ Staff เมื่อทำหัตถการหรือกิจกรรมเสร็จ"}
        </p>
      </div>
      <div className="home-hero-actions">
        {staff ? (
          <>
            <button type="button" className="secondary-button with-icon" onClick={() => onNavigate("scan")}>
              <ScanIcon size={18} /> สแกน QR
            </button>
            <button type="button" className="primary-button with-icon" onClick={() => onNavigate("pending")}>
              <ClipboardIcon size={18} /> คิวรอประเมิน
            </button>
          </>
        ) : (
          <button type="button" className="primary-button with-icon" onClick={() => onNavigate("request")}>
            <PlusIcon size={18} /> ส่งแบบประเมิน
          </button>
        )}
      </div>
    </section>
  );
}

export default function ResidentDashboard({ workspace, onNavigate, onOpenRequest, onNavigateHistory }) {
  const dashboard = useMemo(() => buildDashboard(workspace), [workspace]);
  const names = new Map(
    (workspace.allProfiles || workspace.profiles).map((profile) => [profile.id, profile.name]),
  );
  const role = workspace.user.role;
  const cards =
    role === "admin"
      ? [
          ["Resident", dashboard.residents.length, UserIcon],
          ["Staff ที่เชื่อมบัญชี", dashboard.activeStaff, BookIcon],
          ["รอประเมิน", dashboard.pending.length, ClockIcon],
          ["ประเมินแล้ว", dashboard.completed, CheckIcon],
        ]
      : role === "staff"
        ? [
            ["รอฉันประเมิน", dashboard.pending.length, ClockIcon],
            ["ฉันประเมินแล้ว", dashboard.completed, CheckIcon],
            [
              "Resident ที่เกี่ยวข้อง",
              new Set(workspace.requests.map((item) => item.resident_id)).size,
              UserIcon,
            ],
            [`รอเกิน ${STALE_PENDING_DAYS} วัน`, dashboard.stalePending.length, AlertIcon],
          ]
        : [
            ["ส่งแล้วทั้งหมด", workspace.requests.length, BookIcon],
            ["รอ Staff ประเมิน", dashboard.pending.length, ClockIcon],
            ["ประเมินแล้ว", dashboard.completed, CheckIcon],
            [
              `แบบที่ครบ ${TARGET_ASSESSMENTS_PER_FORM} ครั้ง`,
              `${dashboard.typeTotals.reduce((sum, item) => sum + item.targetMet, 0)}/${workspace.templates.length}`,
              ChartIcon,
            ],
          ];
  return (
    <div className="dashboard-stack">
      <HomeHero
        role={role}
        name={workspace.user.name}
        pendingCount={role === "staff" ? dashboard.pending.length : workspace.requests.filter((item) => item.status === "pending").length}
        onNavigate={onNavigate}
      />
      <section className="dashboard-summary" aria-label="สรุปภาพรวม">
        {cards.map(([label, value, Icon]) => {
          const focus =
            role === "staff" && label === "Resident ที่เกี่ยวข้อง"
              ? "related"
              : role === "staff" && label === "ฉันประเมินแล้ว"
                ? "completed"
                : null;
          const Element = focus ? "button" : "div";
          return (
            <Element
              className={`metric-item${focus ? " metric-link" : ""}`}
              key={label}
              {...(focus
                ? {
                    type: "button",
                    onClick: () => onNavigateHistory?.(focus),
                    "aria-label": `ดู${label}`,
                  }
                : {})}
            >
              <span className="metric-icon">
                <Icon size={22} />
              </span>
              <div>
                <small>{label}</small>
                <strong>{typeof value === "number" ? value.toLocaleString("th-TH") : value}</strong>
              </div>
            </Element>
          );
        })}
      </section>
      <div className="dashboard-columns">
        <section className="resident-panel queue-panel" aria-labelledby="queue-title">
          <div className="panel-title-row">
            <div>
              <h2 id="queue-title">{role === "staff" ? "รอฉันประเมิน" : role === "admin" ? `ค้างเกิน ${STALE_PENDING_DAYS} วัน` : "รอ Staff ประเมิน"}</h2>
              <p>
                {role === "staff"
                  ? "เรียงจากรายการที่รอนานที่สุด"
                  : role === "admin"
                    ? "คำขอที่ Staff ยังไม่ได้ประเมินเกินกำหนด"
                    : "แบบประเมินที่ส่งแล้วและยังไม่ได้รับการประเมิน"}
              </p>
            </div>
            <ClockIcon size={22} />
          </div>
          {(() => {
            const rows = (role === "admin" ? dashboard.stalePending : dashboard.pendingQueue).slice(0, 5);
            const total = (role === "admin" ? dashboard.stalePending : dashboard.pendingQueue).length;
            if (!rows.length)
              return (
                <div className="empty-state">
                  <span className="empty-state-icon"><CheckIcon size={22} /></span>
                  <strong>{role === "admin" ? "ไม่มีรายการค้างนาน" : role === "staff" ? "ไม่มีรายการรอประเมิน" : "ยังไม่มีรายการที่รอ"}</strong>
                  <p>
                    {role === "resident"
                      ? "เมื่อส่งแบบประเมินให้ Staff รายการจะแสดงที่นี่"
                      : "เมื่อมีคำขอใหม่ รายการจะแสดงที่นี่"}
                  </p>
                  {role === "resident" && (
                    <button type="button" className="primary-button with-icon" onClick={() => onNavigate("request")}>
                      <PlusIcon size={18} /> ส่งแบบประเมิน
                    </button>
                  )}
                </div>
              );
            return (
              <>
                <ul className="queue-list">
                  {rows.map(({ request, ageDays }) => (
                    <li key={request.id} className="queue-item">
                      <div className="queue-item-main">
                        <strong>
                          {request.resident_template_definitions?.template_code || "—"}
                          {role !== "resident" && ` · ${names.get(request.resident_id) || "—"}`}
                        </strong>
                        <span>
                          {request.procedure_or_activity || request.resident_template_definitions?.title || "—"}
                          {role !== "staff" && ` · Staff: ${names.get(request.staff_id) || "—"}`}
                        </span>
                      </div>
                      <AgeChip days={ageDays} />
                      {role === "staff" && (
                        <button type="button" className="primary-button queue-action" onClick={() => onOpenRequest(request)}>
                          ประเมิน
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
                {role === "staff" && total > rows.length && (
                  <button type="button" className="text-button queue-more" onClick={() => onNavigate("pending")}>
                    ดูทั้งหมด ({total}) <ChevronIcon size={16} />
                  </button>
                )}
              </>
            );
          })()}
        </section>
        <section className="resident-panel activity-panel">
          <div className="panel-title-row">
            <div>
              <h2>กิจกรรมล่าสุด</h2>
              <p>Timestamp ของการส่งและการประเมิน</p>
            </div>
            <ClockIcon size={22} />
          </div>
          {dashboard.recent.length ? (
            <div className="activity-list">
              {dashboard.recent.map((item) => (
                <div key={item.id}>
                  <span
                    className={
                      item.kind === "ส่งแบบประเมิน"
                        ? "activity-dot pending"
                        : "activity-dot completed"
                    }
                  />
                  <p>
                    <strong>{item.kind}</strong>
                    <br />
                    {item.code} · {names.get(item.residentId) || "—"}
                  </p>
                  <time>{readableDateTime(item.at)}</time>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-state">
              <span className="empty-state-icon"><BookIcon size={22} /></span>
              <strong>ยังไม่มีกิจกรรม</strong>
              <p>การส่งและการประเมินจะแสดงที่นี่</p>
            </div>
          )}
        </section>
      </div>
      <section className="resident-panel progress-panel" aria-labelledby="progress-title">
        <div className="panel-title-row">
          <div>
            <h2 id="progress-title">{role === "resident" ? "ความก้าวหน้าเทียบเป้า" : "สัดส่วนคำขอที่ประเมินเสร็จ"}</h2>
            <p>
              {role === "resident"
                ? `เป้าหมาย: แต่ละแบบ EPA/PBA ได้รับการประเมิน ${TARGET_ASSESSMENTS_PER_FORM} ครั้ง (นับแบบละไม่เกิน ${TARGET_ASSESSMENTS_PER_FORM} ครั้ง)`
                : "ประเมินเสร็จ ÷ (ประเมินเสร็จ + ยังรอ) แยกตามประเภทแบบประเมิน"}
            </p>
          </div>
          <ChartIcon size={22} />
        </div>
        {dashboard.typeTotals.map((item) => {
          const percent = role === "resident" ? item.targetPercent : item.completionPercent;
          return (
            <div className="progress-row" key={item.type}>
              <div>
                <strong>{item.type}</strong>
                <span>
                  {role === "resident"
                    ? `ครบเป้า ${item.targetMet} จาก ${item.templates} แบบ · ประเมินแล้ว ${item.targetDone} จาก ${item.targetTotal} ครั้ง`
                    : `${item.templates} แบบ · ประเมินแล้ว ${item.completed} · รอ ${item.pending}`}
                </span>
              </div>
              <div
                className="progress-track"
                role="progressbar"
                aria-label={`${item.type} ${role === "resident" ? "ความก้าวหน้าเทียบเป้า" : "สัดส่วนที่ประเมินเสร็จ"}`}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={percent}
              >
                <i style={{ width: `${percent}%` }} />
              </div>
              <b>{role === "resident" ? `${item.targetDone}/${item.targetTotal}` : `${percent}%`}</b>
            </div>
          );
        })}
      </section>
      {role === "admin" && (
        <section className="resident-panel">
          <div className="panel-title-row">
            <div>
              <h2>สถานะ Resident</h2>
              <p>สรุปผลรายคนเพื่อใช้ติดตาม ไม่รวมข้อมูลระบุตัวผู้ป่วย</p>
            </div>
          </div>
          <div className="resident-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Resident</th>
                  <th>PGY</th>
                  <th>ประเมินแล้ว</th>
                  <th>รอประเมิน</th>
                  <th>สถานะ</th>
                </tr>
              </thead>
              <tbody>
                {dashboard.residentRows.length ? (
                  dashboard.residentRows.map((resident) => (
                    <tr key={resident.id}>
                      <td>
                        <strong>{resident.name}</strong>
                      </td>
                      <td>PGY {resident.pgy}</td>
                      <td>{resident.completed}</td>
                      <td>{resident.pending}</td>
                      <td>
                        <span
                          className={`status-chip ${resident.pending ? "pending" : "completed"}`}
                        >
                          {resident.pending ? "มีรายการรอ" : "ปกติ"}
                        </span>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan="5" className="table-empty">
                      ยังไม่มี Resident ที่เปิดใช้งาน
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
