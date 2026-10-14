import assert from "node:assert/strict";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

globalThis.window = { location: { pathname: "/", search: "" } };
const server = await createServer({ root: fileURLToPath(new URL("../", import.meta.url)), server: { middlewareMode: true, hmr: false, ws: false }, appType: "custom" });
try {
  const V = await server.ssrLoadModule("/src/features/SeatMapViews.jsx");
  const h = React.createElement;
  const render = (Component, props) => renderToStaticMarkup(h(Component, props));

  const seats = [];
  const add = (code, zone, row, col, extra = {}) => seats.push({ seat_code: code, zone, row_no: row, col_no: col, held: false, occupant: null, ...extra });
  add("M1", "M", 1, 1);
  for (let n = 1; n <= 12; n += 1) add(`L${n}`, "L", Math.ceil(n / 3), ((n - 1) % 3) + 1);
  for (let n = 1; n <= 12; n += 1) add(`C${n}`, "C", Math.ceil(n / 2), n % 2 ? 1 : 2);
  for (let n = 1; n <= 12; n += 1) add(`R${n}`, "R", Math.ceil(n / 3), ((n - 1) % 3) + 1);
  const taken = (code, id, name, pgy = 3) => { const seat = seats.find((s) => s.seat_code === code); seat.occupant = { user_id: id, name, pgy, role: "resident", seated_at: "2026-10-16T02:00:00Z" }; };
  taken("C1", "other", "สมชาย ทดสอบ"); taken("L2", "me", "ฉัน ทดสอบ", 2);
  seats.find((s) => s.seat_code === "L5").held = true;
  const base = (role, overrides = {}) => ({
    session: { id: "s1", starts_at: "2026-10-16T01:45:00Z", ends_at: "2026-10-16T05:00:00Z", effective_end: "2026-10-16T05:00:00Z", on_time_at: "2026-10-16T02:00:00Z", now: "2026-10-16T02:10:00Z", open: true, ended: false },
    me: { user_id: "me", role, in_room: true, checked_in_at: "2026-10-16T01:50:00Z", on_time: true, seat: "L2", reserve: false, hold: null, urgent_state: null, status: "seat" },
    seats, people: [
      { user_id: "other", name: "สมชาย ทดสอบ", pgy: 3, role: "resident", status: "seat", seat_code: "C1", checked_in_at: null, on_time: null },
      { user_id: "me", name: "ฉัน ทดสอบ", pgy: 2, role: "resident", status: "seat", seat_code: "L2", checked_in_at: "2026-10-16T01:50:00Z", on_time: true },
      { user_id: "gone", name: "ไม่มา ทดสอบ", pgy: 2, role: "resident", status: "absent", seat_code: null, checked_in_at: null, on_time: null },
    ],
    counts: { seats_total: 37, seats_taken: 2, residents_total: 48, residents_in_room: 2 }, ...overrides,
  });
  const noop = () => {};

  // the mini-map never shows names; the zone detail and the desktop room do
  const map = base("resident");
  const mini = render(V.MiniRoom, { map, activeZone: "L", onZone: noop });
  assert.ok(mini.includes("โซนซ้าย") && mini.includes("โต๊ะกลาง") && mini.includes("โซนขวา") && mini.includes("M1"));
  assert.ok(!mini.includes("สมชาย") && !mini.includes("ฉัน ทดสอบ"), "mini-map shows no names");
  assert.ok(mini.includes("★") && mini.includes("●") && mini.includes("…"), "symbols, not colour alone");
  const zone = render(V.ZoneGrid, { zone: "C", map, onSeat: noop, showName: true });
  assert.ok(zone.includes("สมชาย ทดสอบ") && zone.includes("grid-template-columns:repeat(2"), "central table is two columns with names");
  assert.ok(zone.includes('style="grid-column:2;grid-row:6" data-seat="C12"'), "C12 sits in column 2, row 6");
  const desktop = render(V.DesktopRoom, { map, onSeat: noop });
  assert.ok(desktop.includes("จอ / หน้าห้อง") && desktop.includes("Moderator") && (desktop.match(/data-seat=/g) || []).length === 37, "desktop room has all 37 seats");
  assert.ok(!desktop.includes("@"), "no e-mail anywhere");

  // seat buttons are enabled only for what the role may do
  const free = (html, code) => !new RegExp(`data-seat="${code}"[^>]*disabled`).test(html) && !new RegExp(`disabled[^>]*data-seat="${code}"`).test(html);
  const resident = render(V.DesktopRoom, { map, onSeat: noop });
  assert.ok(free(resident, "C3") && !free(resident, "C1"), "a Resident can tap a free seat, not an occupied one");
  const staffMap = base("staff", { me: { ...map.me, role: "staff", seat: null } });
  assert.ok(free(render(V.DesktopRoom, { map: staffMap, onSeat: noop }), "C1"), "Staff in the room can tap any seat");
  const outside = base("resident", { me: { ...map.me, in_room: false, seat: null } });
  assert.ok(!free(render(V.DesktopRoom, { map: outside, onSeat: noop }), "C3"), "nobody who has not scanned can tap");
  const ended = base("resident", { session: { ...map.session, open: false, ended: true } });
  assert.ok(!free(render(V.DesktopRoom, { map: ended, onSeat: noop }), "C3"), "nothing can be tapped after the end");

  // the personal card says the right thing in each phase
  const card = (m) => render(V.PersonalCard, { map: m, busy: false, onRelease: noop, onReserve: noop, onUrgent: noop, onCorrection: noop, onCertify: noop });
  assert.ok(card(map).includes("ที่นั่ง L2") && card(map).includes("คืนที่นั่ง"));
  assert.ok(card(outside).includes("สแกน QR ที่ห้องประชุมก่อน"));
  assert.ok(card(ended).includes("การคืนที่นั่งไม่ใช่หลักฐานว่าอยู่จนจบ"));
  assert.ok(card(staffMap).includes("รับรองผังที่นั่ง") && card(staffMap).includes("ไม่ใช่การรับรองว่าอยู่ครบทั้งการประชุม"));
  assert.ok(!card(map).includes("รับรองผังที่นั่ง"), "only Staff can certify");

  // the people list: a Resident never sees an absent person; Staff do
  const peopleProps = (m) => ({ map: m, query: "", onQuery: noop, status: "all", onStatus: noop });
  const residentPeople = { ...map, people: map.people.filter((p) => p.status !== "absent") };
  assert.ok(!render(V.PeopleTab, peopleProps(residentPeople)).includes("ไม่มา ทดสอบ"));
  assert.ok(render(V.PeopleTab, peopleProps(staffMap)).includes("ไม่มา ทดสอบ"));
  assert.ok(!render(V.PeopleTab, peopleProps(map)).includes(">ยังไม่เข้าร่วม</option>"), "Residents are not offered the absent filter");
  assert.ok(render(V.PeopleTab, peopleProps(staffMap)).includes(">ยังไม่เข้าร่วม</option>"), "Staff are");

  // dialogs
  const hold = render(V.HoldDialog, { seat: seats.find((s) => s.seat_code === "C3"), from: "L2", expiresAt: "2026-10-16T02:11:00Z", offsetMs: 0, busy: false, error: "", onConfirm: noop, onCancel: noop });
  assert.ok(hold.includes("role=\"dialog\"") && hold.includes("ย้ายจาก L2 ไป C3") && hold.includes("ยืนยันที่นั่งนี้"));
  const urgent = render(V.UrgentDialog, { busy: false, error: "", onSubmit: noop, onCancel: noop });
  for (const reason of ["ผ่าตัด", "ผู้ป่วยฉุกเฉิน", "อยู่เวร", "อื่น ๆ"]) assert.ok(urgent.includes(reason));
  assert.ok(urgent.includes("ไม่ใส่ข้อมูลผู้ป่วยหรือ HN") && urgent.includes('maxLength="160"'));
  const manage = render(V.ManageDialog, { seat: seats.find((s) => s.seat_code === "C3"), map: staffMap, busy: false, error: "", onSet: noop, onRelease: noop, onClose: noop });
  assert.ok(manage.includes("จัดที่นั่งนี้"));
  const manageTaken = render(V.ManageDialog, { seat: seats.find((s) => s.seat_code === "C1"), map: staffMap, busy: false, error: "", onSet: noop, onRelease: noop, onClose: noop });
  assert.ok(manageTaken.includes("คืนที่นั่งของ Resident นี้") && manageTaken.includes("สมชาย ทดสอบ"));

  // history and the Admin report
  assert.ok(render(V.HistoryTab, { events: [{ at: "2026-10-16T02:00:00Z", kind: "confirm", seat_code: "C1", detail: {} }] }).includes("นั่งที่ C1"));
  assert.ok(render(V.HistoryTab, { events: [] }).includes("ยังไม่มีรายการ"));
  const report = { counts: { residents_attended: 4, before_on_time: 3, after_on_time: 1, staff_attended: 1, urgent_pending: 1, urgent_approved: 0, urgent_rejected: 0, correction_pending: 1, correction_approved: 0, correction_rejected: 0, seated: 3, reserve: 0, certifications: 1 },
    requests: [{ id: "q1", kind: "urgent", reason: "ผ่าตัด", note: "ห้อง 3", state: "pending", name: "สมชาย", created_at: "2026-10-16T02:00:00Z" }], people: [], events: [] };
  const admin = render(V.AdminReportView, { report });
  assert.ok(admin.includes("เข้าก่อนเวลา") && !admin.includes(">อนุมัติ</button>") && admin.includes("Admin ดูได้อย่างเดียว") && admin.includes("ข้อมูลประกอบ ไม่ใช่คะแนนหรือเกณฑ์ลงโทษ"), "Admin sees the requests read-only");
  const fixture = [
    { id: "q1", kind: "urgent", reason: "ผ่าตัด", note: "ห้อง 3", state: "pending", user_id: "other", name: "สมชาย", created_at: "2026-10-16T02:00:00Z" },
    { id: "q2", kind: "correction", reason: null, note: "ลืมสแกน", state: "pending", user_id: "me", name: "ฉัน", created_at: "2026-10-16T02:05:00Z" },
    { id: "q3", kind: "urgent", reason: "อยู่เวร", note: null, state: "approved", user_id: "x", name: "ก", created_at: "2026-10-16T01:00:00Z", reviewed_by_name: "อ.ตัวอย่าง" },
  ];
  const queue = render(V.RequestList, { requests: fixture, busy: false, onReview: noop, ownerId: "me" });
  assert.equal((queue.match(/>อนุมัติ<\/button>/g) || []).length, 1, "Staff can approve only another person's pending request");
  assert.ok(queue.includes("คำขอของคุณ · ให้อาจารย์ท่านอื่นตรวจ") && queue.includes("อนุมัติแล้ว โดย อ.ตัวอย่าง"));
  assert.ok(!render(V.RequestList, { requests: fixture, busy: false, ownerId: "me" }).includes(">อนุมัติ</button>"), "without onReview there are no buttons");
  console.log("seat map render check: OK");
} finally { await server.close(); }
