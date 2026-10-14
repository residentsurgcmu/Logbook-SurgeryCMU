import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { seatAriaLabel, seatCell } from "../src/seatMap.js";
import { CAMERA_PRESETS, ROOM_3D, seatPosition, seatSummary, seatVisual, summaryText } from "../src/seatMap3d.js";

const seat = (seat_code, zone, row_no, col_no, extra = {}) => ({ seat_code, zone, row_no, col_no, held: false, occupant: null, ...extra });
// The 37 seats exactly as the migration seeds them.
const seeded = () => {
  const list = [seat("M1", "M", 1, 1)];
  for (let n = 1; n <= 12; n += 1) {
    list.push(seat(`L${n}`, "L", Math.floor((n - 1) / 3) + 1, ((n - 1) % 3) + 1));
    list.push(seat(`C${n}`, "C", Math.floor((n + 1) / 2), n % 2 === 1 ? 1 : 2));
    list.push(seat(`R${n}`, "R", Math.floor((n - 1) / 3) + 1, ((n - 1) % 3) + 1));
  }
  return list;
};
const mapOf = (seats, meHold = null) => ({
  session: { open: true, ended: false },
  me: { user_id: "me", role: "resident", in_room: true, hold: meHold },
  seats,
});

test("the 37 seeded seats get 37 distinct positions inside the room", () => {
  const seen = new Set();
  for (const s of seeded()) {
    const p = seatPosition(s);
    assert.ok(p, `${s.seat_code} has a position`);
    assert.ok(p.x >= 0 && p.x <= ROOM_3D.width, `${s.seat_code} x inside the room`);
    assert.ok(p.z >= -2 && p.z <= ROOM_3D.depth, `${s.seat_code} z inside the room`);
    seen.add(`${p.x.toFixed(3)},${p.z.toFixed(3)}`);
  }
  assert.equal(seen.size, 37);
});

test("left is left and right is right as seen from the back of the room; the moderator is at the front", () => {
  const x = (code) => seatPosition(seeded().find((s) => s.seat_code === code)).x;
  const z = (code) => seatPosition(seeded().find((s) => s.seat_code === code)).z;
  assert.ok(x("L1") < x("C1") && x("C1") < x("C2") && x("C2") < x("R1"));
  assert.ok(x("L1") < x("L3") && x("R1") < x("R3"));
  assert.ok(z("L1") < z("L10"), "higher row numbers are nearer the back");
  assert.ok(z("M1") < z("L1"), "moderator is in front of the first row");
  // central table sits between the two columns of C seats
  assert.ok(x("C1") < ROOM_3D.table.x && ROOM_3D.table.x + ROOM_3D.table.w < x("C2"));
});

test("a seat outside the known room has no position instead of throwing", () => {
  for (const odd of [seat("X1", "X", 1, 1), seat("L99", "L", 99, 1), seat("L1", "L", 1, 9), seat("C1", "C", 1, 3), seat("M2", "M", 2, 1), seat("L0", "L", 0, 1), seat("L1", "L", 1.5, 1), seat("L1", "L", undefined, 1)]) {
    assert.equal(seatPosition(odd), null, JSON.stringify(odd));
  }
});

test("seatVisual follows seatCell for free / taken / mine / held / my hold and never loses the symbol and label", () => {
  const cases = [
    [seat("L1", "L", 1, 1), "free", "--success"],
    [seat("L2", "L", 1, 2, { occupant: { user_id: "u2", name: "A" } }), "taken", "--text-muted"],
    [seat("L3", "L", 1, 3, { occupant: { user_id: "me", name: "Me" } }), "mine", "--accent"],
    [seat("L4", "L", 2, 1, { held: true }), "held", "--warning"],
    [seat("L5", "L", 2, 2, { held: true }), "myhold", "--accent"],
  ];
  for (const [s, state, token] of cases) {
    const map = mapOf([s], s.seat_code === "L5" ? { seat_code: "L5" } : null);
    const visual = seatVisual(s, map);
    assert.equal(visual.state, state);
    assert.equal(visual.state, seatCell(s, map).state);
    assert.equal(visual.colorToken, token);
    assert.equal(visual.label, seatCell(s, map).label);
    assert.ok(visual.label.length > 0);
  }
});

test("the summary counts free, taken (including mine) and held seats and survives an empty or missing map", () => {
  const map = mapOf([
    seat("L1", "L", 1, 1),
    seat("L2", "L", 1, 2, { occupant: { user_id: "u2", name: "A" } }),
    seat("L3", "L", 1, 3, { occupant: { user_id: "me", name: "Me" } }),
    seat("L4", "L", 2, 1, { held: true }),
    seat("ZZ", "Z", 1, 1),
  ]);
  assert.deepEqual(seatSummary(map), { free: 2, taken: 2, held: 1, total: 5 }, "unplaceable seats still count");
  assert.deepEqual(seatSummary(mapOf([])), { free: 0, taken: 0, held: 0, total: 0 });
  assert.deepEqual(seatSummary(undefined), { free: 0, taken: 0, held: 0, total: 0 });
  assert.deepEqual(seatSummary({}), { free: 0, taken: 0, held: 0, total: 0 });
  assert.equal(summaryText({ free: 20, taken: 15, held: 0, total: 37 }), "ว่าง 20 · มีผู้นั่ง 15 จากทั้งหมด 37 ที่");
  assert.equal(summaryText({ free: 19, taken: 15, held: 1, total: 37 }), "ว่าง 19 · มีผู้นั่ง 15 · กำลังยืนยัน 1 จากทั้งหมด 37 ที่");
  assert.match(summaryText(seatSummary(undefined)), /ว่าง 0/);
});

test("camera presets stay above the floor and look at the room", () => {
  assert.deepEqual(CAMERA_PRESETS.map((p) => p.id), ["oblique", "top", "back"]);
  for (const p of CAMERA_PRESETS) {
    assert.ok(p.label.length > 0);
    assert.equal(p.position.length, 3);
    assert.equal(p.target.length, 3);
    assert.ok([...p.position, ...p.target].every(Number.isFinite));
    assert.ok(p.position[1] > 0.5, `${p.id} camera is above the floor`);
    assert.ok(p.target[0] >= 0 && p.target[0] <= ROOM_3D.width, `${p.id} looks at the room`);
  }
});

test("a name only ever comes from seat.occupant (same text as the 2D aria label)", () => {
  const taken = seat("L2", "L", 1, 2, { occupant: { user_id: "u2", name: "A" } });
  const free = seat("L1", "L", 1, 1);
  const map = mapOf([free, taken]);
  assert.match(seatAriaLabel(taken, seatCell(taken, map)), /A/);
  assert.doesNotMatch(seatAriaLabel(free, seatCell(free, map)), / · /);
});

test("the module is pure: no React, no three.js, no network", async () => {
  const source = await readFile(new URL("../src/seatMap3d.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /from "react"|from "three|supabase|fetch\(/);
});
