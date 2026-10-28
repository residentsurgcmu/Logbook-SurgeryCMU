import assert from "node:assert/strict";
import test from "node:test";
import {
  SEAT_POLL_MS, HOLD_SECONDS, ENDED_NOTE, STATUS_LABELS,
  seatErrorMessage, statusLabel, seatsByZone, zoneColumns, seatCell, seatAriaLabel, canPickSeat, canManageSeats, sessionPhase,
  seatableResidents, filterPeople, hnHint, shouldPoll, pickDefaultSession, serverOffsetMs, holdSecondsLeft, bangkokHm, onTimeIso, eventText, canReviewRequests, isOwnRequest,
} from "../src/seatMap.js";

const seat = (seat_code, zone, row_no, col_no, extra = {}) => ({ seat_code, zone, row_no, col_no, held: false, occupant: null, ...extra });
const person = (user_id, name, role, status, extra = {}) => ({ user_id, name, pgy: role === "resident" ? 2 : null, role, status, seat_code: null, checked_in_at: null, on_time: null, ...extra });
const mapOf = ({ role = "resident", in_room = true, seat: mySeat = null, reserve = false, hold = null, open = true, ended = false, seats, people = [] } = {}) => ({
  session: { id: "s1", starts_at: "2026-10-16T01:45:00Z", ends_at: "2026-10-16T05:00:00Z", effective_end: "2026-10-16T05:00:00Z", on_time_at: "2026-10-16T02:00:00Z", now: "2026-10-16T02:10:00Z", open, ended },
  me: { user_id: "me", role, in_room, checked_in_at: in_room ? "2026-10-16T01:50:00Z" : null, on_time: in_room ? true : null, seat: mySeat, reserve, hold, urgent_state: null, status: "room" },
  seats: seats || [seat("C1", "C", 1, 1), seat("C2", "C", 1, 2), seat("L1", "L", 1, 1), seat("M1", "M", 1, 1)],
  people, counts: { seats_total: 4, seats_taken: 0, residents_total: 48, residents_in_room: 1 },
});

test("constants match the spec", () => {
  assert.equal(SEAT_POLL_MS, 8000);
  assert.equal(HOLD_SECONDS, 60);
  assert.equal(ENDED_NOTE, "การคืนที่นั่งไม่ใช่หลักฐานว่าอยู่จนจบ");
});

test("every database error becomes plain Thai, never raw English", () => {
  const cases = {
    "Scan the room QR before choosing a seat": /สแกน QR/,
    "Check in with the room QR first": /สแกน QR/,
    "Seat is not available": /ที่นั่งไม่พร้อม กรุณาเลือกอีกครั้ง/,
    "Seat hold expired. Choose the seat again": /หมดเวลาถือที่นั่ง/,
    "Seat does not exist": /ไม่พบที่นั่ง/,
    "Seat map is closed": /ปิดการเลือกที่นั่ง/,
    "Seat map is not open for this session": /ไม่ได้เปิดผัง/,
    "You do not have a seat": /ยังไม่มีที่นั่ง/,
    "Already in the reserve area": /ที่นั่งเสริมแล้ว/,
    "Reason is not valid": /เหตุผล/,
    "Note is too long": /ยาวเกิน/,
    "Remove numbers that could identify a patient": /HN/,
    "You already reported urgent duty for this session": /แจ้งภารกิจจำเป็น/,
    "You already have a correction request waiting": /คำขอแก้ไข/,
    "Active Resident account required": /Resident/,
    "Active Resident or Staff account required": /Resident หรืออาจารย์/,
    "Active Staff account required": /อาจารย์/,
    "Active Admin account required": /Admin/,
    "You cannot review your own request": /ตรวจคำขอของตัวเอง/,
    "Staff who checked in, or Admin, required": /เช็คชื่อเข้าห้อง/,
    "This Resident has not scanned the room QR. Ask them to send a correction request": /ยังไม่ได้สแกน/,
    "This Resident has no seat": /ไม่มีที่นั่ง/,
    "Resident not found": /ไม่พบ Resident/,
    "Layout cannot change after seating started": /เปลี่ยนผัง/,
    "On-time must be inside the session window": /ช่วงเวลา/,
    "Request not found or already reviewed": /ตรวจไปแล้ว/,
    "Session not found, cancelled or closed": /ไม่พบรอบ/,
    "Active account required": /เข้าสู่ระบบ/,
  };
  for (const [english, thai] of Object.entries(cases)) {
    const text = seatErrorMessage({ message: english });
    assert.match(text, thai, english);
    assert.doesNotMatch(text, /[A-Za-z]{4,}\s+[A-Za-z]{3,}/, `${english} leaked English: ${text}`);
  }
  assert.match(seatErrorMessage({ message: "something unknown happened" }), /ไม่สำเร็จ/);
  assert.match(seatErrorMessage(null), /ไม่สำเร็จ/);
});

test("seats are grouped by zone and ordered by row then column", () => {
  const groups = seatsByZone([seat("C2", "C", 1, 2), seat("C3", "C", 2, 1), seat("C1", "C", 1, 1), seat("M1", "M", 1, 1)]);
  assert.deepEqual(groups.C.map((s) => s.seat_code), ["C1", "C2", "C3"]);
  assert.deepEqual(groups.L, []);
  assert.equal(zoneColumns(groups.C), 2);
  assert.equal(zoneColumns([]), 1);
});

test("a seat cell is never only a colour: it has a symbol and a label", () => {
  const map = mapOf({ hold: { seat_code: "C2", expires_at: "x" } });
  assert.deepEqual(seatCell(seat("C1", "C", 1, 1), map), { state: "free", symbol: "", label: "ว่าง" });
  assert.equal(seatCell(seat("C1", "C", 1, 1, { occupant: { user_id: "me", name: "ก" } }), map).symbol, "★");
  assert.equal(seatCell(seat("C1", "C", 1, 1, { occupant: { user_id: "other", name: "ข" } }), map).state, "taken");
  assert.equal(seatCell(seat("C1", "C", 1, 1, { occupant: { user_id: "other", name: "ข" } }), map).symbol, "●");
  assert.equal(seatCell(seat("C1", "C", 1, 1, { held: true }), map).state, "held");
  assert.equal(seatCell(seat("C2", "C", 1, 2, { held: true }), map).state, "myhold");
  assert.equal(seatCell(seat("C1", "C", 1, 1, { held: true }), map).symbol, "…");
  assert.match(seatAriaLabel(seat("C1", "C", 1, 1, { occupant: { user_id: "other", name: "ข" } }), { label: "มีผู้นั่งแล้ว" }), /ที่นั่ง C1 มีผู้นั่งแล้ว · ข/);
});

test("who may pick and who may manage seats", () => {
  assert.equal(canPickSeat(mapOf()), true);
  assert.equal(canPickSeat(mapOf({ in_room: false })), false);
  assert.equal(canPickSeat(mapOf({ open: false })), false);
  assert.equal(canPickSeat(mapOf({ ended: true, open: false })), false);
  assert.equal(canPickSeat(mapOf({ role: "staff" })), true);
  assert.equal(canManageSeats(mapOf({ role: "staff" })), true);
  assert.equal(canManageSeats(mapOf({ role: "staff", in_room: false })), false);
  assert.equal(canManageSeats(mapOf({ role: "admin", in_room: false })), true);
  assert.equal(canManageSeats(mapOf({ role: "admin", ended: true, open: false })), false);
  assert.equal(canManageSeats(mapOf({ role: "resident" })), false);
});

test("only Staff decide requests, and never their own", () => {
  assert.equal(canReviewRequests(mapOf({ role: "staff" })), true);
  assert.equal(canReviewRequests(mapOf({ role: "admin" })), false);
  assert.equal(canReviewRequests(mapOf({ role: "resident" })), false);
  assert.equal(isOwnRequest({ user_id: "me" }, mapOf({ role: "staff" })), true);
  assert.equal(isOwnRequest({ user_id: "other" }, mapOf({ role: "staff" })), false);
});

test("the phase decides what the personal card says", () => {
  assert.equal(sessionPhase(null), "loading");
  assert.equal(sessionPhase(mapOf({ ended: true, open: false })), "ended");
  assert.equal(sessionPhase(mapOf({ open: false, in_room: false })), "not-open-yet");
  assert.equal(sessionPhase(mapOf({ in_room: false })), "not-in-room");
  assert.equal(sessionPhase(mapOf()), "pick");
  assert.equal(sessionPhase(mapOf({ reserve: true })), "reserve");
  assert.equal(sessionPhase(mapOf({ seat: "C1" })), "seated");
  assert.equal(sessionPhase(mapOf({ role: "staff" })), "pick");
  assert.equal(sessionPhase(mapOf({ role: "staff", in_room: false })), "not-in-room");
  assert.equal(sessionPhase(mapOf({ role: "admin", in_room: false })), "admin");
});

test("labels: the ended wording never claims anyone stayed to the end", () => {
  assert.equal(statusLabel("absent"), "ยังไม่เข้าร่วม");
  assert.equal(statusLabel("seat", true), "เคยเข้าร่วม · จบประชุม");
  assert.equal(statusLabel("urgent", true), STATUS_LABELS.urgent);
  assert.equal(statusLabel("nonsense"), "—");
});

test("Staff can pick only Residents who are in the room; the list is sorted by name", () => {
  const map = mapOf({ role: "staff", people: [person("1", "ข", "resident", "room"), person("2", "ก", "resident", "absent"), person("3", "ค", "staff", "staff"), person("4", "ง", "resident", "seat")] });
  assert.deepEqual(seatableResidents(map).map((p) => p.user_id), ["4", "1"].sort((a, b) => ({ 1: "ข", 4: "ง" }[a].localeCompare({ 1: "ข", 4: "ง" }[b], "th"))));
});

test("the people list filters by name and status", () => {
  const people = [person("1", "สมชาย ใจดี", "resident", "room"), person("2", "สมหญิง", "resident", "seat"), person("3", "Anan", "staff", "staff")];
  assert.equal(filterPeople(people, "สม", "all").length, 2);
  assert.equal(filterPeople(people, "สม", "seat").length, 1);
  assert.equal(filterPeople(people, "  anan ", "all").length, 1);
  assert.equal(filterPeople(people, "", "all").length, 3);
});

test("the screen warns about patient-like numbers the same way the database rejects them", () => {
  for (const text of ["HN 123456", "HN 12 34 56", "12-34-56", "๑๒๓๔๕๖", "12.34.56.7"]) assert.equal(hnHint(text), true, text);
  for (const text of ["ผ่าตัดห้อง 3", "room 12, 3 cases", "", null]) assert.equal(hnHint(text), false, String(text));
});

test("polling stops when the tab is hidden, a dialog is open or the session ended", () => {
  assert.equal(shouldPoll({ hidden: false, dialogOpen: false, ended: false }), true);
  assert.equal(shouldPoll({ hidden: true, dialogOpen: false, ended: false }), false);
  assert.equal(shouldPoll({ hidden: false, dialogOpen: true, ended: false }), false);
  assert.equal(shouldPoll({ hidden: false, dialogOpen: false, ended: true }), false);
});

test("the default session is the live one, else the next, else the latest", () => {
  const mk = (id, start, end) => ({ session_id: id, starts_at: start, effective_end: end });
  const past = mk("past", "2026-10-09T01:45:00Z", "2026-10-09T05:00:00Z");
  const live = mk("live", "2026-10-16T01:45:00Z", "2026-10-16T05:00:00Z");
  const next = mk("next", "2026-10-23T01:45:00Z", "2026-10-23T05:00:00Z");
  assert.equal(pickDefaultSession([past, live, next], Date.parse("2026-10-16T02:00:00Z")), "live");
  assert.equal(pickDefaultSession([past, live, next], Date.parse("2026-10-16T00:50:00Z")), "live");
  assert.equal(pickDefaultSession([past, next], Date.parse("2026-10-16T12:00:00Z")), "next");
  assert.equal(pickDefaultSession([past, mk("older", "2026-10-02T01:45:00Z", "2026-10-02T05:00:00Z")], Date.parse("2026-10-16T12:00:00Z")), "past");
  assert.equal(pickDefaultSession([], Date.now()), "");
});

test("the countdown follows the server clock, not the phone clock", () => {
  const map = mapOf();
  const offset = serverOffsetMs(map, Date.parse("2026-10-16T02:09:50Z")); // phone is 10 s behind the server
  assert.equal(offset, 10000);
  assert.equal(holdSecondsLeft("2026-10-16T02:11:00Z", offset, Date.parse("2026-10-16T02:09:55Z")), 55);
  assert.equal(holdSecondsLeft("2026-10-16T02:11:00Z", offset, Date.parse("2026-10-16T02:11:30Z")), 0);
});

test("times are shown in Bangkok time and the on-time value is built on the session's Bangkok date", () => {
  assert.equal(bangkokHm("2026-10-16T01:45:00Z"), "08:45");
  assert.equal(bangkokHm("2026-10-15T17:05:00Z"), "00:05");
  assert.equal(bangkokHm(""), "");
  assert.equal(onTimeIso("2026-10-16T01:45:00Z", "09:00"), "2026-10-16T09:00:00+07:00");
  assert.equal(onTimeIso("2026-10-15T17:30:00Z", "09:00"), "2026-10-16T09:00:00+07:00");
});

test("the history describes what happened in plain Thai", () => {
  assert.equal(eventText({ kind: "confirm", seat_code: "C1", detail: {} }), "นั่งที่ C1");
  assert.equal(eventText({ kind: "move", seat_code: "L2", detail: { from: "C1" } }), "ย้ายจาก C1 ไป L2");
  assert.equal(eventText({ kind: "release", seat_code: "L2", detail: {} }), "คืนที่นั่ง L2");
  assert.equal(eventText({ kind: "staff_set", seat_code: "R6", detail: {} }), "อาจารย์จัดที่นั่ง R6 ให้");
  assert.equal(eventText({ kind: "review", seat_code: null, detail: { decision: "approved" } }), "อาจารย์อนุมัติคำขอของคุณ");
  assert.equal(eventText({ kind: "review", seat_code: null, detail: { decision: "rejected" } }), "อาจารย์ไม่อนุมัติคำขอของคุณ");
  assert.equal(eventText({ kind: "weird" }), "—");
});

test("phone mini map: stretched zone buttons must not blow the square seats past their zone (iPhone overflow)", async () => {
  const { readFile } = await import("node:fs/promises");
  const css = await readFile(new URL("../src/seatMap.css", import.meta.url), "utf8");
  const views = await readFile(new URL("../src/features/SeatMapViews.jsx", import.meta.url), "utf8");
  const zone = css.match(/\.seatmap-zone-button \{([^}]*)\}/)?.[1] || "";
  const grid = css.match(/\.seatmap-mini-grid \{([^}]*)\}/)?.[1] || "";
  assert.match(zone, /align-content: start/, "a zone button stretched to the tallest sibling keeps its content at the top");
  assert.match(grid, /align-content: start/, "grid rows must not stretch: aspect-ratio would turn tall rows into wide columns");
  assert.match(views, /repeat\(\$\{zoneColumns\(groups\[zone\]\)\}, minmax\(0, 1fr\)\)/, "mini grid columns can shrink below their content");
});
