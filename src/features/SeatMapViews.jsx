import React, { useEffect, useRef, useState } from "react";
import {
  CORRECTION_NOTE_MAX, ENDED_NOTE, MODERATOR_ZONE, STATUS_LABELS, URGENT_NOTE_MAX, URGENT_REASONS, ZONE_INFO,
  bangkokHm, canManageSeats, canPickSeat, eventText, filterPeople, hnHint, holdSecondsLeft, seatAriaLabel, seatCell,
  seatableResidents, seatsByZone, sessionPhase, statusLabel, zoneColumns,
} from "../seatMap";

const thaiDateTime = (iso) => new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Bangkok" }).format(new Date(iso));

export function Modal({ title, onClose, error, children }) {
  const ref = useRef(null);
  useEffect(() => {
    ref.current?.focus();
    const onKey = (event) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  return <div className="seatmap-overlay">
    <div className="seatmap-dialog" role="dialog" aria-modal="true" aria-labelledby="seatmap-dialog-title" tabIndex={-1} ref={ref}>
      <h3 id="seatmap-dialog-title">{title}</h3>
      {children}
      {error && <p className="form-error" role="alert">{error}</p>}
    </div>
  </div>;
}

// A seat is a real button (44 px); its state is a symbol and a label as well as a colour. Which seats are enabled depends on the role.
export function SeatButton({ seat, map, onSeat, showName = true }) {
  const cell = seatCell(seat, map);
  const enabled = canManageSeats(map) || (canPickSeat(map) && (cell.state === "free" || cell.state === "myhold"));
  return <button type="button" className={`seatmap-seat seatmap-seat-${cell.state}`} style={{ gridColumn: seat.col_no, gridRow: seat.row_no }}
    data-seat={seat.seat_code} disabled={!enabled} aria-label={seatAriaLabel(seat, cell)} onClick={() => onSeat(seat)}>
    <strong><span aria-hidden="true">{cell.symbol}</span> {seat.seat_code}</strong>
    {showName && seat.occupant && <span className="seatmap-occupant">{seat.occupant.name}</span>}
    <small>{seat.occupant ? (seat.occupant.pgy ? `PGY ${seat.occupant.pgy}` : "อาจารย์") : cell.label}</small>
  </button>;
}

export function ZoneGrid({ zone, map, onSeat, showName = true }) {
  const seats = seatsByZone(map.seats)[zone] || [];
  return <div className={`seatmap-grid seatmap-grid-${zone}`} style={{ gridTemplateColumns: `repeat(${zoneColumns(seats)}, minmax(0, 1fr))` }}>
    {seats.map((seat) => <SeatButton key={seat.seat_code} seat={seat} map={map} onSeat={onSeat} showName={showName} />)}
  </div>;
}

function MiniSeat({ seat, map }) {
  const cell = seatCell(seat, map);
  return <span className={`seatmap-mini seatmap-mini-${cell.state}`} style={{ gridColumn: seat.col_no, gridRow: seat.row_no }} aria-hidden="true">{cell.symbol}</span>;
}

// The phone overview: one picture of the whole room, no names. Tap a zone to open it.
export function MiniRoom({ map, activeZone, onZone }) {
  const groups = seatsByZone(map.seats);
  const free = (zone) => groups[zone].filter((seat) => !seat.occupant).length;
  return <div className="seatmap-mini-room">
    <button type="button" className="seatmap-mini-moderator" aria-pressed={activeZone === "M"} onClick={() => onZone("M")}>M1 · {MODERATOR_ZONE.name}</button>
    <div className="seatmap-mini-zones">
      {ZONE_INFO.map(({ zone, name, hint }) => <button key={zone} type="button" className="seatmap-zone-button" aria-pressed={activeZone === zone}
        aria-label={`เปิด${name} ว่าง ${free(zone)} ที่`} onClick={() => onZone(zone)}>
        <span className="seatmap-zone-name">{name}</span><small>{hint}</small>
        <span className="seatmap-mini-grid" style={{ gridTemplateColumns: `repeat(${zoneColumns(groups[zone])}, minmax(0, 1fr))` }}>
          {groups[zone].map((seat) => <MiniSeat key={seat.seat_code} seat={seat} map={map} />)}
        </span>
      </button>)}
    </div>
    <p className="seatmap-hint">แตะโซนเพื่อดูชื่อและเลือกที่นั่ง · เลือกได้ทุกโซน ไม่จำกัดชั้นปี</p>
  </div>;
}

export function DesktopRoom({ map, onSeat }) {
  return <div className="seatmap-desktop-room">
    <div className="seatmap-screen">จอ / หน้าห้อง</div>
    <p className="seatmap-hint">มองจากด้านหลังห้อง · หน้าห้องอยู่ด้านบน</p>
    <div className="seatmap-moderator"><ZoneGrid zone="M" map={map} onSeat={onSeat} /><span>{MODERATOR_ZONE.name}</span></div>
    <div className="seatmap-room">
      {ZONE_INFO.map(({ zone, name, hint }) => <div key={zone} className={`seatmap-room-zone seatmap-room-zone-${zone}`}>
        <div className="seatmap-zone-title"><strong>{name}</strong><small>{hint}</small></div>
        <ZoneGrid zone={zone} map={map} onSeat={onSeat} />
      </div>)}
    </div>
  </div>;
}

export function PersonalCard({ map, busy, onRelease, onReserve, onUrgent, onCorrection, onCertify }) {
  const phase = sessionPhase(map);
  const { me, session } = map;
  const messages = {
    ended: `การประชุมนี้จบแล้ว · ${ENDED_NOTE}`,
    "not-open-yet": `ผังจะเปิดเวลา ${bangkokHm(session.starts_at)} น.`,
    "not-in-room": "สแกน QR ที่ห้องประชุมก่อนจึงเลือกที่นั่งได้",
    pick: "เลือกที่นั่งจากผังด้านล่าง",
    reserve: "คุณอยู่ที่นั่งเสริม · เลือกที่นั่งจากผังได้ทุกเมื่อ",
    seated: `ที่นั่ง ${me.seat}`,
    staff: "คุณอยู่ในห้อง · แตะที่นั่งเพื่อจัดที่ให้ Resident",
    admin: "ผู้ดูแล · แตะที่นั่งเพื่อจัดที่ให้ Resident",
  };
  return <section className="seatmap-personal" aria-label="สถานะของคุณ">
    <strong className="seatmap-personal-status">{messages[phase] || ""}</strong>
    {me.checked_in_at && <p>เข้าห้องเวลา {bangkokHm(me.checked_in_at)} น.</p>}
    {me.urgent_state === "pending" && <p className="seatmap-note">แจ้งภารกิจจำเป็นแล้ว · รออาจารย์ตรวจสอบ</p>}
    {me.urgent_state === "approved" && <p className="seatmap-note">อาจารย์อนุมัติภารกิจจำเป็นของคุณแล้ว</p>}
    <div className="seatmap-actions">
      {phase === "seated" && <button type="button" className="secondary-button" disabled={busy} onClick={onRelease}>คืนที่นั่ง</button>}
      {me.role === "resident" && ["seated", "pick"].includes(phase) && <button type="button" className="secondary-button" disabled={busy} onClick={onReserve}>ใช้พื้นที่นั่งเสริม</button>}
      {me.role === "resident" && phase !== "not-open-yet" && <button type="button" className="secondary-button" onClick={onUrgent}>แจ้งภารกิจจำเป็น</button>}
      {me.role === "staff" && phase === "staff" && <button type="button" className="secondary-button" disabled={busy} onClick={onCertify}>รับรองผังที่นั่ง</button>}
      {me.role !== "admin" && <button type="button" className="link-button" onClick={onCorrection}>ขอแก้ไขข้อมูลการเข้าร่วม</button>}
    </div>
    {me.role === "staff" && phase === "staff" && <p className="seatmap-hint">ยืนยันว่าผังตรงกับสิ่งที่คุณเห็นในขณะนี้ ไม่ใช่การรับรองว่าอยู่ครบทั้งการประชุม</p>}
    {me.role === "resident" && phase === "not-in-room" && <p className="seatmap-hint">แจ้งภารกิจจำเป็นได้แม้ยังไม่ได้เข้าห้อง (ไม่ใส่ข้อมูลผู้ป่วยหรือ HN)</p>}
  </section>;
}

export function PeopleTab({ map, query, onQuery, status, onStatus }) {
  const ended = map.session.ended;
  const options = Object.keys(STATUS_LABELS).filter((key) => map.me.role !== "resident" || !["absent", "urgent"].includes(key));
  // the server already withholds absent and urgent people from Residents; this is a second guard
  const visible = map.me.role === "resident" ? map.people.filter((person) => !["absent", "urgent"].includes(person.status)) : map.people;
  const people = filterPeople(visible, query, status);
  return <section className="seatmap-people">
    <p className="seatmap-hint">Resident ในห้อง {map.counts.residents_in_room} / {map.counts.residents_total} · ที่นั่งที่มีผู้ใช้ {map.counts.seats_taken} / {map.counts.seats_total}</p>
    <div className="seatmap-filters">
      <label>ค้นหาผู้เข้าร่วม<input value={query} onChange={(event) => onQuery(event.target.value)} placeholder="ชื่อ" /></label>
      <label>สถานะ<select value={status} onChange={(event) => onStatus(event.target.value)}>
        <option value="all">ทุกสถานะ</option>
        {options.map((key) => <option key={key} value={key}>{STATUS_LABELS[key]}</option>)}
      </select></label>
    </div>
    {people.length ? <ul className="seatmap-roster">{people.map((person) => <li key={person.user_id}>
      <span className="seatmap-roster-name"><strong>{person.name}</strong><small>{person.role === "staff" ? "อาจารย์" : `PGY ${person.pgy ?? "—"}`}</small></span>
      <span className="seatmap-roster-status">{person.seat_code ? `ที่นั่ง ${person.seat_code}` : statusLabel(person.status, ended)}</span>
    </li>)}</ul> : <p className="muted-empty">ไม่พบผู้เข้าร่วมตามคำค้น</p>}
  </section>;
}

export function HistoryTab({ events }) {
  if (!events) return <p role="status">กำลังโหลด…</p>;
  if (!events.length) return <p className="muted-empty">ยังไม่มีรายการของคุณในรอบนี้ ลองสแกน QR แล้วเลือกที่นั่งได้เลย</p>;
  return <ul className="seatmap-history">{events.map((event, index) => <li key={`${event.at}-${index}`}><time dateTime={event.at}>{thaiDateTime(event.at)}</time><span>{eventText(event)}</span></li>)}</ul>;
}

export function HoldDialog({ seat, from, expiresAt, offsetMs, busy, error, onConfirm, onCancel }) {
  const [left, setLeft] = useState(() => holdSecondsLeft(expiresAt, offsetMs));
  useEffect(() => {
    const timer = window.setInterval(() => setLeft(holdSecondsLeft(expiresAt, offsetMs)), 250);
    return () => window.clearInterval(timer);
  }, [expiresAt, offsetMs]);
  return <Modal title={`ยืนยันที่นั่ง ${seat.seat_code}`} onClose={onCancel} error={error}>
    <p>{from ? `ย้ายจาก ${from} ไป ${seat.seat_code}` : `ที่นั่ง ${seat.seat_code}`}</p>
    <p role="timer">{left > 0 ? `กันที่ให้คุณอีก ${left} วินาที` : "หมดเวลาถือที่นั่ง กรุณาเลือกใหม่"}</p>
    <div className="seatmap-dialog-actions">
      <button type="button" className="secondary-button" onClick={onCancel}>{left > 0 ? "ยกเลิก" : "ปิด"}</button>
      <button type="button" className="primary-button" disabled={busy || left === 0} onClick={onConfirm}>ยืนยันที่นั่งนี้</button>
    </div>
  </Modal>;
}

export function ManageDialog({ seat, map, busy, error, onSet, onRelease, onClose }) {
  const [residentId, setResidentId] = useState("");
  const candidates = seatableResidents(map);
  const occupant = seat.occupant;
  return <Modal title={`จัดที่นั่ง ${seat.seat_code}`} onClose={onClose} error={error}>
    {occupant ? <>
      <p><strong>{occupant.name}</strong> · {occupant.pgy ? `PGY ${occupant.pgy}` : "อาจารย์"}</p>
      {occupant.role === "resident" && <button type="button" className="secondary-button" disabled={busy} onClick={() => onRelease(occupant.user_id)}>คืนที่นั่งของ Resident นี้</button>}
    </> : <>
      <label>เลือก Resident ที่อยู่ในห้อง
        <select value={residentId} onChange={(event) => setResidentId(event.target.value)}>
          <option value="">— เลือก —</option>
          {candidates.map((person) => <option key={person.user_id} value={person.user_id}>{person.name}{person.seat_code ? ` (ตอนนี้ ${person.seat_code})` : ""}</option>)}
        </select>
      </label>
      <p className="seatmap-hint">เลือกได้เฉพาะ Resident ที่สแกน QR แล้ว ถ้ายังไม่สแกน ให้เขาส่งคำขอแก้ไขข้อมูล</p>
      <button type="button" className="primary-button" disabled={busy || !residentId} onClick={() => onSet(residentId)}>จัดที่นั่งนี้</button>
    </>}
    <div className="seatmap-dialog-actions"><button type="button" className="secondary-button" onClick={onClose}>ปิด</button></div>
  </Modal>;
}

export function UrgentDialog({ busy, error, onSubmit, onCancel }) {
  const [reason, setReason] = useState(URGENT_REASONS[0]);
  const [note, setNote] = useState("");
  const unsafe = hnHint(note);
  return <Modal title="แจ้งภารกิจจำเป็น" onClose={onCancel} error={error}>
    <p>เลือกเหตุผลสั้น ๆ ไม่ใส่ข้อมูลผู้ป่วยหรือ HN · แจ้งย้อนหลังได้ประมาณ 48 ชั่วโมงหลังจบประชุม · ที่นั่งเดิมจะถูกคืน อาจารย์จะตรวจสอบกับตารางปฏิบัติงาน</p>
    <label>เหตุผล<select value={reason} onChange={(event) => setReason(event.target.value)}>{URGENT_REASONS.map((item) => <option key={item}>{item}</option>)}</select></label>
    <label>หมายเหตุสั้น ๆ (ไม่บังคับ)<textarea value={note} maxLength={URGENT_NOTE_MAX} onChange={(event) => setNote(event.target.value)} placeholder="เช่น ปฏิบัติงานตามตารางเวร" /></label>
    {unsafe && <p className="form-error" role="alert">กรุณาลบ HN หรือเลขยาวที่อาจระบุตัวผู้ป่วย</p>}
    <div className="seatmap-dialog-actions">
      <button type="button" className="secondary-button" onClick={onCancel}>ยกเลิก</button>
      <button type="button" className="primary-button" disabled={busy || unsafe} onClick={() => onSubmit({ reason, note })}>บันทึกภารกิจ</button>
    </div>
  </Modal>;
}

export function CorrectionDialog({ busy, error, onSubmit, onCancel }) {
  const [note, setNote] = useState("");
  const unsafe = hnHint(note);
  return <Modal title="ขอแก้ไขข้อมูลการเข้าร่วม" onClose={onCancel} error={error}>
    <p>บอกข้อมูลที่ควรแก้ไขและเหตุผลสั้น ๆ ไม่แนบข้อมูลผู้ป่วย อาจารย์จะตรวจสอบ</p>
    <label>รายละเอียด<textarea value={note} maxLength={CORRECTION_NOTE_MAX} onChange={(event) => setNote(event.target.value)} placeholder="เช่น เข้าห้องก่อนเริ่ม แต่ลืมสแกน QR" /></label>
    {unsafe && <p className="form-error" role="alert">กรุณาลบ HN หรือเลขยาวที่อาจระบุตัวผู้ป่วย</p>}
    <div className="seatmap-dialog-actions">
      <button type="button" className="secondary-button" onClick={onCancel}>ยกเลิก</button>
      <button type="button" className="primary-button" disabled={busy || unsafe || !note.trim()} onClick={() => onSubmit({ note })}>ส่งคำขอ</button>
    </div>
  </Modal>;
}

const COUNT_LABELS = [
  ["residents_attended", "Resident เข้าห้อง"], ["before_on_time", "เข้าก่อนเวลา"], ["after_on_time", "เข้าหลังเวลา"], ["staff_attended", "อาจารย์เข้าห้อง"],
  ["seated", "มีที่นั่ง"], ["reserve", "ที่นั่งเสริม"], ["urgent_pending", "ภารกิจจำเป็น รอตรวจ"], ["correction_pending", "คำขอแก้ไข รอตรวจ"], ["certifications", "รับรองผัง"],
];

// The requests of a session. Staff get the buttons (D7); nobody can decide their own request; without onReview the list is read-only.
export function RequestList({ requests, busy, onReview, ownerId }) {
  if (!requests?.length) return <p className="muted-empty">ไม่มีคำขอ</p>;
  const stateText = (request) => (request.state === "pending" ? "รอตรวจ"
    : `${request.state === "approved" ? "อนุมัติแล้ว" : "ไม่อนุมัติ"}${request.reviewed_by_name ? ` โดย ${request.reviewed_by_name}` : ""}`);
  return <ul className="seatmap-requests">{requests.map((request) => <li key={request.id}>
    <span><strong>{request.name}</strong> · {request.kind === "urgent" ? `ภารกิจจำเป็น: ${request.reason}` : "ขอแก้ไขข้อมูล"}{request.note ? ` · ${request.note}` : ""}<small>{thaiDateTime(request.created_at)} · {stateText(request)}</small></span>
    {onReview && request.state === "pending" && request.user_id !== ownerId && <span className="seatmap-actions">
      <button type="button" className="primary-button" disabled={busy} onClick={() => onReview(request.id, "approved")}>อนุมัติ</button>
      <button type="button" className="secondary-button" disabled={busy} onClick={() => onReview(request.id, "rejected")}>ไม่อนุมัติ</button>
    </span>}
    {onReview && request.state === "pending" && request.user_id === ownerId && <small>คำขอของคุณ · ให้อาจารย์ท่านอื่นตรวจ</small>}
  </li>)}</ul>;
}

export function AdminReportView({ report }) {
  return <div className="seatmap-report">
    <p className="seatmap-hint">ข้อมูลประกอบ ไม่ใช่คะแนนหรือเกณฑ์ลงโทษ · การคืนที่นั่งอัตโนมัติไม่ใช่หลักฐานว่าอยู่จนจบ</p>
    <dl className="seatmap-counts">{COUNT_LABELS.map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{report.counts?.[key] ?? 0}</dd></div>)}</dl>
    <h4>คำขอ</h4>
    <p className="seatmap-hint">อาจารย์ (Staff) เป็นผู้อนุมัติคำขอ Admin ดูได้อย่างเดียว</p>
    <RequestList requests={report.requests} />
    {report.events?.length > 0 && <details><summary>บันทึกเหตุการณ์ทั้งหมด ({report.events.length})</summary>
      <ul className="seatmap-history">{report.events.map((event) => <li key={event.id}><time dateTime={event.at}>{thaiDateTime(event.at)}</time><span>{event.actor_name}{event.subject_name && event.subject_name !== event.actor_name ? ` → ${event.subject_name}` : ""} · {event.kind}{event.seat_code ? ` ${event.seat_code}` : ""}</span></li>)}</ul>
    </details>}
  </div>;
}
