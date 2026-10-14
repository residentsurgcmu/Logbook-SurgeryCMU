# Seat map 3D view (phase 1, view only) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "ผัง 2D | ผัง 3D" switch to the seat-map tab so every role (Resident, Staff, Admin) can look at the Friday meeting room as a rotatable, zoomable 3D picture, view only.

**Architecture:** A pure module `src/seatMap3d.js` turns `(zone, row_no, col_no)` into room coordinates and seat states into colours/summary text (tested with `node --test`). `src/features/SeatMap3D.jsx` draws the scene with three.js (scene built once, seats updated in place, drawn on demand). `src/features/SeatMap3DGate.jsx` loads it with `React.lazy` inside an error boundary so a missing WebGL or a failed chunk falls back to 2D. `SeatMap.jsx` only gets the switch. The 3D view reads the same `map` object as 2D: no new RPC, no database change.

**Tech Stack:** React 19, Vite 8, `three` (new, exact-pinned from npm; `OrbitControls` from `three/examples/jsm/controls/OrbitControls.js`), `node --test`.

**Spec:** `docs/superpowers/specs/2026-10-14-seat-map-3d-phase1-design.md`

## Global Constraints
- No database change, no migration, no new RPC, no change to `src/seatMapApi.js`, `SeatMapViews.jsx` (2D) or `supabase/`.
- `three` is added from npm with an exact version (no `^`, no "latest"); no CDN script, no model files.
- three.js and the 3D scene load only through `import()` (the main chunk must not grow).
- 2D is the default every time the panel opens; 3D is view only (no seat pick/hold/release in 3D).
- 3D shows only what 2D shows for that role; names only through `seatAriaLabel` / `seat.occupant`; never read `people`, `checked_in_at`, `on_time` or `counts` in the 3D code.
- State is never colour alone: symbol (`★ ● …`) and label always present (existing `seatCell`).
- Colours come from `tokens.css` variable names; text on screen ≥ 1rem.
- Fallback message exactly: `แสดงผัง 3D ไม่ได้บนอุปกรณ์นี้ ใช้ผัง 2D แทน`
- No names or e-mail addresses in any file (public repository).
- Commit messages end with these two lines (exact):
  `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_012nLZNNp4Thf1pxbRq9Vzmh`
- Do not push, open a PR or merge: the owner decides. Work on local branch `feat/seat-map-3d`.

## Review Focus
1. A seat whose zone / row / col is outside the known room (e.g. a second layout) → `seatPosition` returns `null`, the scene skips it, nothing throws, and it is still counted in the summary. (Task 1 tests)
2. `map` with no seats / undefined (just loaded) → summary is zeros and the text still renders. (Task 1 tests)
3. WebGL unavailable, context creation throws, or the lazy chunk fails to load → the view returns to 2D with the fallback message; the page does not break. (Task 2 wiring tests + Task 3 manual check with WebGL disabled)
4. The 8 s poll replaces `map` while the user is rotating or has a tooltip open → seats update in place, the camera is not reset, the renderer is created once. (Task 2 wiring tests + Task 3 manual check)
5. A Resident must not learn more from 3D than from 2D: the 3D code never touches `people`, `checked_in_at`, `on_time`, `counts`. (Task 2 wiring test)
6. Unmount / React StrictMode double mount → listeners, observer, geometries, materials and renderer are disposed, and the context is not force-lost (a lost context cannot be re-acquired on the same canvas). (Task 2 wiring test)

---

## File structure
- Create `src/seatMap3d.js` — pure: `ROOM_3D`, `seatPosition`, `seatVisual`, `seatSummary`, `summaryText`, `CAMERA_PRESETS`.
- Create `src/features/SeatMap3D.jsx` — three.js scene component (default export). Only imported through `import()`.
- Create `src/features/SeatMap3DGate.jsx` — `React.lazy` + `Suspense` + error boundary (default export).
- Modify `src/features/SeatMap.jsx` — switch + gate mount.
- Modify `src/seatMap.css` — styles for the switch, stage, tooltip, presets.
- Modify `package.json` / `package-lock.json` — `three`.
- Create `tests/seat-map-3d.test.mjs` — pure tests + source-text wiring tests.
- Modify `docs/handoff.md`, `CLAUDE.md` — status notes (Task 4).

---

### Task 1: Pure geometry, colour and summary module

**Files:**
- Create: `src/seatMap3d.js`
- Test: `tests/seat-map-3d.test.mjs`

**Interfaces:**
- Consumes: `seatCell(seat, map)` from `src/seatMap.js` → `{state, symbol, label}` with `state` one of `free | taken | mine | held | myhold`.
- Produces (used by Task 2):
  - `ROOM_3D = { seat, width, depth, table: {x, z, w, d}, screen: {x, z, w, h}, moderator: {x, z} }`
  - `seatPosition(seat) → {x, z} | null` (seat centre; `null` for anything outside the known room)
  - `seatVisual(seat, map) → {state, symbol, label, colorToken}` (`colorToken` is a CSS variable name such as `"--success"`)
  - `seatSummary(map) → {free, taken, held, total}` and `summaryText(summary) → string`
  - `CAMERA_PRESETS = [{id, label, position:[x,y,z], target:[x,y,z]}]` with ids `oblique`, `top`, `back`.
  - Coordinates: x to the right as seen from the back of the room (L zone at small x), z grows toward the back of the room, front = negative z, y is up.

- [ ] **Step 1: Create branch and commit the docs**

```bash
cd /Users/chagkrit/Downloads/Logbook-SurgeryCMU-git
git checkout -b feat/seat-map-3d
git add docs/handoff.md docs/superpowers/specs/2026-10-14-seat-map-3d-phase1-design.md docs/superpowers/plans/2026-10-14-seat-map-3d-phase1.md
git commit -m "docs: seat map 3D phase 1 spec and plan; correct handoff (production SQL was applied after deploy)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>" -m "Claude-Session: https://claude.ai/code/session_012nLZNNp4Thf1pxbRq9Vzmh"
```

- [ ] **Step 2: Write the failing tests**

Create `tests/seat-map-3d.test.mjs`:

```js
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
  const me = { user_id: "me" };
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
  assert.equal(me.user_id, "me");
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
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `node --test tests/seat-map-3d.test.mjs`
Expected: FAIL (cannot find module `../src/seatMap3d.js`).

- [ ] **Step 4: Write the implementation**

Create `src/seatMap3d.js`:

```js
// Pure geometry and colour rules for the 3D seat map (phase 1, view only). No React, no three.js: `node --test` checks everything here.
// The database stores only (zone, row_no, col_no); the real room size lives here as front-end constants. Edit this file to match the room.
// Axes: x to the right as seen from the back of the room, z toward the back (front of the room is negative z), y up. Units are roughly metres.
import { seatCell } from "./seatMap.js";

const SEAT = 0.7;
const PITCH = 0.9;
const ZONE_GAP = 1.3;
const TABLE_W = 1.0;
const TABLE_PAD = 0.1;
const C_X = 3 * PITCH + ZONE_GAP;
const C_WIDTH = SEAT + TABLE_PAD + TABLE_W + TABLE_PAD + SEAT;
const R_X = C_X + C_WIDTH + ZONE_GAP;
const WIDTH = R_X + 2 * PITCH + SEAT;
const DEPTH = 5 * PITCH + SEAT;

export const ROOM_3D = {
  seat: SEAT,
  width: WIDTH,
  depth: DEPTH,
  table: { x: C_X + SEAT + TABLE_PAD, z: -0.1, w: TABLE_W, d: DEPTH + 0.2 },
  screen: { x: WIDTH / 2, z: -3, w: 4, h: 1.4 },
  moderator: { x: WIDTH / 2, z: -1.6 },
};

// Seat centre, or null for a seat the room model does not know (another layout, bad data): the scene skips it, the summary still counts it.
export function seatPosition(seat) {
  const { zone, row_no: row, col_no: col } = seat || {};
  if (!Number.isInteger(row) || !Number.isInteger(col) || row < 1 || col < 1) return null;
  const z = (row - 1) * PITCH + SEAT / 2;
  if (zone === "M") return row === 1 && col === 1 ? { x: ROOM_3D.moderator.x, z: ROOM_3D.moderator.z } : null;
  if (zone === "L" || zone === "R") {
    if (col > 3 || row > 4) return null;
    return { x: (zone === "L" ? 0 : R_X) + (col - 1) * PITCH + SEAT / 2, z };
  }
  if (zone === "C") {
    if (col > 2 || row > 6) return null;
    return { x: C_X + (col === 1 ? SEAT / 2 : SEAT + 2 * TABLE_PAD + TABLE_W + SEAT / 2), z };
  }
  return null;
}

const COLOR_TOKENS = { free: "--success", taken: "--text-muted", mine: "--accent", myhold: "--accent", held: "--warning" };

// State is carried by the symbol and the label as well as the colour (same rule as the 2D map).
export function seatVisual(seat, map) {
  const cell = seatCell(seat, map);
  return { ...cell, colorToken: COLOR_TOKENS[cell.state] };
}

export function seatSummary(map) {
  const summary = { free: 0, taken: 0, held: 0, total: 0 };
  for (const seat of map?.seats || []) {
    const { state } = seatCell(seat, map);
    summary.total += 1;
    if (state === "free") summary.free += 1;
    else if (state === "held" || state === "myhold") summary.held += 1;
    else summary.taken += 1;
  }
  return summary;
}

export const summaryText = ({ free, taken, held, total }) => `ว่าง ${free} · มีผู้นั่ง ${taken}${held ? ` · กำลังยืนยัน ${held}` : ""} จากทั้งหมด ${total} ที่`;

const CX = WIDTH / 2;
export const CAMERA_PRESETS = [
  { id: "oblique", label: "มุมเฉียง", position: [CX + 5, 8, 11], target: [CX, 0.3, 2] },
  { id: "top", label: "มุมบน", position: [CX, 16, 2.7], target: [CX, 0, 2.2] },
  { id: "back", label: "มองจากหลังห้อง", position: [CX, 3.4, 11.5], target: [CX, 0.6, 0] },
];
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test tests/seat-map-3d.test.mjs`
Expected: PASS (7 tests). Then `npm test` — Expected: all existing tests still pass.

- [ ] **Step 6: Commit**

```bash
git add src/seatMap3d.js tests/seat-map-3d.test.mjs
git commit -m "feat: seat map 3D geometry, colours and summary (pure, tested)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>" -m "Claude-Session: https://claude.ai/code/session_012nLZNNp4Thf1pxbRq9Vzmh"
```

---

### Task 2: three.js scene component, lazy gate and styles

**Files:**
- Modify: `package.json`, `package-lock.json`, `src/seatMap.css`
- Create: `src/features/SeatMap3D.jsx`, `src/features/SeatMap3DGate.jsx`
- Test: `tests/seat-map-3d.test.mjs` (append)

**Interfaces:**
- Consumes: `ROOM_3D, CAMERA_PRESETS, seatPosition, seatVisual, seatSummary, summaryText` (Task 1); `seatAriaLabel, seatCell` from `src/seatMap.js`.
- Produces (used by Task 3): default export `SeatMap3DGate({ map, paused, onFallback })` — `map` is the `get_resident_seat_map` object, `paused` a boolean (a dialog is open), `onFallback()` is called when 3D cannot be shown. `SeatMap3D` (default export of `SeatMap3D.jsx`) takes `{ map, paused, onUnavailable }`.

- [ ] **Step 1: Record the baseline bundle size**

Run: `npm run build 2>&1 | tail -15`
Write down the size of the main `index-*.js` chunk (the "before" number for Task 3).

- [ ] **Step 2: Add three (exact version)**

Run: `npm install --save-exact three`
Check: `grep '"three"' package.json` shows a version with no `^` or `~`, and `git diff --stat package-lock.json` shows only `three` additions (no unrelated upgrades; if React/Vite versions moved, run `git checkout package-lock.json package.json` and redo with `npm install --save-exact three --no-audit --fund=false`, then compare).

- [ ] **Step 3: Write the failing wiring tests (append to `tests/seat-map-3d.test.mjs`)**

```js
const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("three is pinned exactly and only reached through the lazy gate", async () => {
  const pkg = JSON.parse(await read("package.json"));
  assert.match(pkg.dependencies.three, /^\d+\.\d+\.\d+$/, "exact version, no ^ or ~");
  const gate = await read("src/features/SeatMap3DGate.jsx");
  assert.match(gate, /lazy\(\(\) => import\("\.\/SeatMap3D"\)\)/);
  assert.doesNotMatch(gate, /from "three/);
  for (const file of ["src/features/SeatMap.jsx", "src/features/SeatMap3DGate.jsx", "src/seatMap3d.js", "src/seatMap.js"]) {
    const source = await read(file);
    assert.doesNotMatch(source, /from "three|from "\.\/SeatMap3D"/, `${file} must not import the scene statically`);
  }
});

test("the gate falls back to 2D when the chunk fails or WebGL is missing", async () => {
  const gate = await read("src/features/SeatMap3DGate.jsx");
  assert.match(gate, /getDerivedStateFromError/);
  assert.match(gate, /componentDidCatch/);
  assert.match(gate, /<Suspense/);
  const scene = await read("src/features/SeatMap3D.jsx");
  assert.match(scene, /try \{[\s\S]*new THREE\.WebGLRenderer[\s\S]*\} catch[\s\S]*onUnavailable\(\)/);
});

test("the scene is built once, draws on demand, and cleans up after itself", async () => {
  const scene = await read("src/features/SeatMap3D.jsx");
  assert.equal(scene.match(/new THREE\.WebGLRenderer/g).length, 1, "renderer created once, not per data refresh");
  assert.match(scene, /requestAnimationFrame/);
  assert.doesNotMatch(scene, /setAnimationLoop/, "no continuous loop");
  assert.match(scene, /renderer\.dispose\(\)/);
  assert.match(scene, /cancelAnimationFrame/);
  assert.match(scene, /ResizeObserver/);
  assert.match(scene, /disconnect\(\)/);
  assert.match(scene, /controls\.dispose\(\)/);
  assert.doesNotMatch(scene, /forceContextLoss/, "a lost context cannot be re-acquired on the same canvas (StrictMode)");
  assert.match(scene, /Math\.min\(window\.devicePixelRatio \|\| 1, 2\)/);
  assert.match(scene, /prefers-reduced-motion/);
  assert.match(scene, /aria-hidden="true"/);
});

test("the 3D code reads nothing a Resident does not already get from the 2D map", async () => {
  const scene = await read("src/features/SeatMap3D.jsx");
  assert.doesNotMatch(scene, /\.people|checked_in_at|on_time|\.counts|seatMapApi|supabase/);
  assert.match(scene, /seatAriaLabel\(/);
});
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `node --test tests/seat-map-3d.test.mjs`
Expected: the 4 new tests FAIL (files do not exist); the 7 earlier tests pass.

- [ ] **Step 5: Create `src/features/SeatMap3D.jsx`**

```jsx
import React, { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { CAMERA_PRESETS, ROOM_3D, seatPosition, seatSummary, seatVisual, summaryText } from "../seatMap3d";
import { seatAriaLabel, seatCell } from "../seatMap";

const cssColor = (token, fallback = "#888888") => getComputedStyle(document.documentElement).getPropertyValue(token).trim() || fallback;
const SEAT_H = 0.45;
const TAP_PX = 6;

function drawLabel(entry, code, symbol) {
  const key = `${code}|${symbol}`;
  if (entry.labelKey === key) return;
  entry.labelKey = key;
  const ctx = entry.canvas.getContext("2d");
  ctx.clearRect(0, 0, 256, 128);
  ctx.fillStyle = "rgba(255,255,255,.92)";
  ctx.beginPath();
  ctx.roundRect(8, 8, 240, 112, 24);
  ctx.fill();
  ctx.fillStyle = "#15231a";
  ctx.font = "700 56px 'Noto Sans Thai', system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(`${symbol ? `${symbol} ` : ""}${code}`, 128, 66);
  entry.texture.needsUpdate = true;
}

function disposeObject(object) {
  object.traverse((child) => {
    child.geometry?.dispose();
    const materials = Array.isArray(child.material) ? child.material : child.material ? [child.material] : [];
    for (const material of materials) { material.map?.dispose(); material.dispose(); }
  });
}

// View-only 3D room. The scene is built once; each new `map` only recolours and relabels the seats. Drawing is on demand (no animation loop).
export default function SeatMap3D({ map, paused = false, onUnavailable }) {
  const canvasRef = useRef(null);
  const stageRef = useRef(null);
  const view = useRef(null);
  const mapRef = useRef(map);
  const pausedRef = useRef(paused);
  const [tip, setTip] = useState(null);
  const [preset, setPreset] = useState("oblique");
  mapRef.current = map;
  pausedRef.current = paused;

  useEffect(() => {
    const canvas = canvasRef.current;
    const stage = stageRef.current;
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    } catch {
      onUnavailable();
      return undefined;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(cssColor("--canvas", "#f4f7f5"));
    const camera = new THREE.PerspectiveCamera(45, 4 / 3, 0.1, 100);
    const controls = new OrbitControls(camera, canvas);
    controls.maxPolarAngle = Math.PI / 2.05;
    controls.minDistance = 3;
    controls.maxDistance = 24;
    scene.add(new THREE.AmbientLight(0xffffff, 1.1));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(ROOM_3D.width / 2 - 4, 10, 6);
    scene.add(sun);

    const box = (w, h, d, color, x, y, z) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshLambertMaterial({ color }));
      mesh.position.set(x, y, z);
      scene.add(mesh);
      return mesh;
    };
    box(ROOM_3D.width + 3, 0.1, ROOM_3D.depth + 6, cssColor("--surface", "#ffffff"), ROOM_3D.width / 2, -0.05, (ROOM_3D.depth - 3) / 2 + 0.2);
    box(ROOM_3D.screen.w, ROOM_3D.screen.h, 0.12, "#2b2f2d", ROOM_3D.screen.x, 0.2 + ROOM_3D.screen.h / 2, ROOM_3D.screen.z);
    const { table } = ROOM_3D;
    box(table.w, 0.7, table.d, "#8a6a48", table.x + table.w / 2, 0.35, table.z + table.d / 2);

    const seatGroup = new THREE.Group();
    scene.add(seatGroup);
    const entries = new Map();
    const ray = new THREE.Raycaster();
    const pointer = new THREE.Vector2();

    let frame = 0;
    let glide = null;
    const draw = () => {
      frame = 0;
      if (glide) {
        const k = Math.min((performance.now() - glide.start) / glide.ms, 1);
        const e = k < 0.5 ? 4 * k * k * k : 1 - ((-2 * k + 2) ** 3) / 2;
        camera.position.lerpVectors(glide.fromPos, glide.toPos, e);
        controls.target.lerpVectors(glide.fromTarget, glide.toTarget, e);
        if (k >= 1) glide = null;
      }
      controls.update();
      renderer.render(scene, camera);
      if (glide) requestRender();
    };
    function requestRender() {
      if (frame || document.hidden || pausedRef.current) return;
      frame = requestAnimationFrame(draw);
    }

    const goTo = (id) => {
      const target = CAMERA_PRESETS.find((p) => p.id === id);
      if (!target) return;
      const toPos = new THREE.Vector3(...target.position);
      const toTarget = new THREE.Vector3(...target.target);
      if (reduceMotion) {
        camera.position.copy(toPos);
        controls.target.copy(toTarget);
        controls.update();
      } else {
        glide = { start: performance.now(), ms: 700, fromPos: camera.position.clone(), fromTarget: controls.target.clone(), toPos, toTarget };
      }
      requestRender();
    };

    const syncSeats = (current) => {
      const colors = {};
      const live = new Set();
      for (const seat of current?.seats || []) {
        const p = seatPosition(seat);
        if (!p) continue;
        live.add(seat.seat_code);
        let entry = entries.get(seat.seat_code);
        if (!entry) {
          const mesh = new THREE.Mesh(new THREE.BoxGeometry(ROOM_3D.seat, SEAT_H, ROOM_3D.seat), new THREE.MeshLambertMaterial({ color: "#888888" }));
          mesh.position.set(p.x, SEAT_H / 2, p.z);
          mesh.userData.seatCode = seat.seat_code;
          const labelCanvas = document.createElement("canvas");
          labelCanvas.width = 256;
          labelCanvas.height = 128;
          const texture = new THREE.CanvasTexture(labelCanvas);
          const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false }));
          sprite.scale.set(1.1, 0.55, 1);
          sprite.position.set(p.x, SEAT_H + 0.55, p.z);
          sprite.renderOrder = 2;
          seatGroup.add(mesh, sprite);
          entry = { mesh, sprite, canvas: labelCanvas, texture, labelKey: "" };
          entries.set(seat.seat_code, entry);
        }
        const visual = seatVisual(seat, current);
        colors[visual.colorToken] ||= cssColor(visual.colorToken);
        entry.mesh.material.color.set(colors[visual.colorToken]);
        drawLabel(entry, seat.seat_code, visual.symbol);
      }
      for (const [code, entry] of entries) {
        if (live.has(code)) continue;
        seatGroup.remove(entry.mesh, entry.sprite);
        disposeObject(entry.mesh);
        disposeObject(entry.sprite);
        entries.delete(code);
      }
      requestRender();
    };

    const resize = () => {
      const { clientWidth: w, clientHeight: h } = stage;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      requestRender();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(stage);

    const pick = (event) => {
      const rect = canvas.getBoundingClientRect();
      pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
      ray.setFromCamera(pointer, camera);
      const hit = ray.intersectObjects([...entries.values()].map((entry) => entry.mesh), false)[0];
      const code = hit?.object.userData.seatCode;
      const current = mapRef.current;
      const seat = code && current?.seats.find((item) => item.seat_code === code);
      return seat ? { x: event.clientX - rect.left, y: event.clientY - rect.top, text: seatAriaLabel(seat, seatCell(seat, current)) } : null;
    };
    let down = null;
    const onDown = (event) => { down = [event.clientX, event.clientY]; setTip(null); };
    const onUp = (event) => {
      if (!down || Math.hypot(event.clientX - down[0], event.clientY - down[1]) > TAP_PX) return;
      setTip(pick(event));
    };
    const onMove = (event) => {
      if (event.buttons || event.pointerType !== "mouse") return;
      const found = pick(event);
      canvas.style.cursor = found ? "pointer" : "grab";
      setTip(found);
    };
    const onLeave = () => setTip(null);
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerleave", onLeave);
    controls.addEventListener("change", requestRender);
    const onVisible = () => { if (!document.hidden) requestRender(); };
    document.addEventListener("visibilitychange", onVisible);

    const first = CAMERA_PRESETS[0];
    camera.position.set(...first.position);
    controls.target.set(...first.target);
    view.current = { goTo, syncSeats, requestRender };
    resize();
    syncSeats(mapRef.current);

    return () => {
      view.current = null;
      cancelAnimationFrame(frame);
      observer.disconnect();
      document.removeEventListener("visibilitychange", onVisible);
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerleave", onLeave);
      controls.removeEventListener("change", requestRender);
      controls.dispose();
      disposeObject(scene);
      renderer.dispose();
    };
  }, []);

  useEffect(() => { view.current?.syncSeats(map); }, [map]);
  useEffect(() => { if (!paused) view.current?.requestRender(); }, [paused]);

  const choose = (id) => { setPreset(id); view.current?.goTo(id); };
  return <div className="seatmap3d">
    <div className="seatmap3d-presets" role="group" aria-label="มุมมองผัง 3D">
      {CAMERA_PRESETS.map((p) => <button key={p.id} type="button" aria-pressed={preset === p.id} onClick={() => choose(p.id)}>{p.label}</button>)}
    </div>
    <div className="seatmap3d-stage" ref={stageRef}>
      <canvas ref={canvasRef} aria-hidden="true" />
      {tip && <div className="seatmap3d-tip" style={{ left: Math.min(tip.x + 12, 9999), top: tip.y + 12 }}>{tip.text}</div>}
    </div>
    <p className="seatmap-hint" role="status">{summaryText(seatSummary(map))}</p>
    <p className="seatmap-hint">ลากเพื่อหมุน · ซูมด้วยล้อเมาส์หรือสองนิ้ว · แตะที่นั่งเพื่อดูสถานะ · เลือกที่นั่งในผัง 2D</p>
  </div>;
}
```

- [ ] **Step 6: Create `src/features/SeatMap3DGate.jsx`**

```jsx
import React, { Suspense, lazy } from "react";

// three.js and the scene are a separate chunk: nothing is downloaded until someone switches to 3D.
const SeatMap3D = lazy(() => import("./SeatMap3D"));

class Boundary extends React.Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { this.props.onFail(); }
  render() { return this.state.failed ? null : this.props.children; }
}

export default function SeatMap3DGate({ map, paused = false, onFallback }) {
  return <Boundary onFail={onFallback}>
    <Suspense fallback={<p role="status">กำลังโหลดผัง 3D…</p>}>
      <SeatMap3D map={map} paused={paused} onUnavailable={onFallback} />
    </Suspense>
  </Boundary>;
}
```

- [ ] **Step 7: Append styles to `src/seatMap.css`**

```css

/* 3D view (phase 1, view only) */
.seatmap-viewswitch, .seatmap3d-presets { display: flex; flex-wrap: wrap; gap: 6px; }
.seatmap-viewswitch button, .seatmap3d-presets button { min-height: var(--touch-min, 44px); padding: 0 14px; border: 1px solid var(--line-strong); border-radius: var(--radius-md); background: var(--surface); font: inherit; }
.seatmap-viewswitch button[aria-pressed="true"], .seatmap3d-presets button[aria-pressed="true"] { background: var(--brand); border-color: var(--brand); color: #fff; font-weight: 700; }
.seatmap-viewswitch button:focus-visible, .seatmap3d-presets button:focus-visible { outline: 3px solid var(--focus); outline-offset: 2px; }
.seatmap3d { display: grid; gap: 8px; }
.seatmap3d-stage { position: relative; aspect-ratio: 4 / 3; min-height: 320px; max-height: 70vh; border: 1px solid var(--line-strong); border-radius: var(--radius-md); overflow: hidden; background: var(--canvas); }
.seatmap3d-stage canvas { display: block; width: 100%; height: 100%; touch-action: none; }
.seatmap3d-tip { position: absolute; max-width: 240px; padding: 6px 10px; border-radius: var(--radius-sm); background: var(--text); color: #fff; font-size: 1rem; pointer-events: none; }
```

- [ ] **Step 8: Run the tests**

Run: `npm test`
Expected: PASS (all, including the 4 new wiring tests). Then `npm run build 2>&1 | tail -20` — Expected: build OK and an extra chunk containing three.js appears (e.g. `SeatMap3D-*.js`); main `index-*.js` size equals the Step 1 number (±1 kB).

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json src/features/SeatMap3D.jsx src/features/SeatMap3DGate.jsx src/seatMap.css tests/seat-map-3d.test.mjs
git commit -m "feat: seat map 3D scene (three.js, lazy chunk, view only)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>" -m "Claude-Session: https://claude.ai/code/session_012nLZNNp4Thf1pxbRq9Vzmh"
```

---

### Task 3: The 2D | 3D switch in the seat-map tab

**Files:**
- Modify: `src/features/SeatMap.jsx` (import line 9 area; state near line 26; the `tab === "map"` block near lines 143-149)
- Test: `tests/seat-map-3d.test.mjs` (append)

**Interfaces:**
- Consumes: `SeatMap3DGate({ map, paused, onFallback })` (Task 2).
- Produces: nothing for later tasks.

- [ ] **Step 1: Write the failing tests (append)**

```js
test("the seat-map tab has a 2D | 3D switch, 2D by default, with the fixed fallback message", async () => {
  const panel = await read("src/features/SeatMap.jsx");
  assert.match(panel, /import SeatMap3DGate from "\.\/SeatMap3DGate"/);
  assert.match(panel, /useState\("2d"\)/);
  assert.match(panel, /ผัง 2D/);
  assert.match(panel, /ผัง 3D/);
  assert.match(panel, /แสดงผัง 3D ไม่ได้บนอุปกรณ์นี้ ใช้ผัง 2D แทน/);
  assert.match(panel, /<SeatMap3DGate map=\{map\} paused=\{Boolean\(dialog\)\}/);
  assert.match(panel, /<DesktopRoom map=\{map\} onSeat=\{onSeat\} \/>/, "2D is still rendered");
});

test("2D files are untouched by the 3D work", async () => {
  const views = await read("src/features/SeatMapViews.jsx");
  assert.doesNotMatch(views, /3D|three/i);
  const api = await read("src/seatMapApi.js");
  assert.doesNotMatch(api, /3D|three/i);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test tests/seat-map-3d.test.mjs`
Expected: the first new test FAILS (no switch yet); the second passes.

- [ ] **Step 3: Edit `src/features/SeatMap.jsx`**

a) After the `SeatMapViews` import line add:
```jsx
import SeatMap3DGate from "./SeatMap3DGate";
```
b) After `const [tab, setTab] = useState("map");` add:
```jsx
  const [view, setView] = useState("2d");
  const [note3d, setNote3d] = useState("");
```
c) Replace the whole `{tab === "map" && <> … </>}` block with:
```jsx
      {tab === "map" && <>
        <div className="seatmap-viewswitch" role="group" aria-label="รูปแบบผัง">
          <button type="button" aria-pressed={view === "2d"} onClick={() => setView("2d")}>ผัง 2D</button>
          <button type="button" aria-pressed={view === "3d"} onClick={() => { setNote3d(""); setView("3d"); }}>ผัง 3D</button>
        </div>
        {note3d && <p className="seatmap-hint" role="note">{note3d}</p>}
        {view === "3d"
          ? <SeatMap3DGate map={map} paused={Boolean(dialog)} onFallback={() => { setView("2d"); setNote3d("แสดงผัง 3D ไม่ได้บนอุปกรณ์นี้ ใช้ผัง 2D แทน"); }} />
          : <>
            <div className="seatmap-mobile-view">
              <MiniRoom map={map} activeZone={zone} onZone={setZone} />
              <div className="seatmap-zone-detail"><h3>{zoneName} <span className="muted">· {canManageSeats(map) ? "แตะที่นั่งเพื่อจัดที่" : "เลือกที่นั่ง"}</span></h3><ZoneGrid zone={zone} map={map} onSeat={onSeat} /></div>
            </div>
            <div className="seatmap-desktop-view"><DesktopRoom map={map} onSeat={onSeat} /></div>
          </>}
      </>}
```
(The inner 2D markup is byte-for-byte the previous block; only the wrapper changed.)

- [ ] **Step 4: Run tests, SSR check and build**

Run: `npm test` — Expected: PASS.
Run: `node scripts/check-seatmap-render.mjs` — Expected: its existing OK output (2D is the default, so the server render is unchanged).
Run: `npm run build 2>&1 | tail -20` — Expected: OK; `SeatMap3D-*.js` chunk present; main `index-*.js` within ±1 kB of the Task 2 Step 1 baseline.

- [ ] **Step 5: Commit**

```bash
git add src/features/SeatMap.jsx tests/seat-map-3d.test.mjs
git commit -m "feat: 2D | 3D switch in the seat-map tab (2D default, fallback to 2D)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>" -m "Claude-Session: https://claude.ai/code/session_012nLZNNp4Thf1pxbRq9Vzmh"
```

---

### Task 4: Real-browser check, notes and handoff

**Files:**
- Create (outside the repo, in the scratchpad directory): `seat3d-harness/index.html`, `seat3d-harness/main.jsx`, `seat3d-harness/vite.config.mjs`
- Modify: `docs/handoff.md`, `CLAUDE.md`

**Interfaces:** none.

- [ ] **Step 1: Create the throwaway harness (scratchpad only, never committed)**

`seat3d-harness/vite.config.mjs`:
```js
const REPO = "/Users/chagkrit/Downloads/Logbook-SurgeryCMU-git";
export default {
  root: new URL(".", import.meta.url).pathname,
  esbuild: { jsx: "automatic" },
  resolve: { alias: [
    { find: /^react-dom(\/.*)?$/, replacement: `${REPO}/node_modules/react-dom$1` },
    { find: /^react(\/.*)?$/, replacement: `${REPO}/node_modules/react$1` },
  ] },
  server: { host: "127.0.0.1", port: 5191, fs: { allow: [REPO, "/"] } },
};
```
`seat3d-harness/index.html`:
```html
<!doctype html><html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="/@fs/Users/chagkrit/Downloads/Logbook-SurgeryCMU-git/src/tokens.css">
<link rel="stylesheet" href="/@fs/Users/chagkrit/Downloads/Logbook-SurgeryCMU-git/src/seatMap.css">
<style>body{margin:0;padding:16px;font-family:var(--font-sans);background:var(--canvas)}</style></head>
<body><div id="root"></div><script type="module" src="/main.jsx"></script></body></html>
```
`seat3d-harness/main.jsx`:
```jsx
import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import SeatMap3DGate from "/@fs/Users/chagkrit/Downloads/Logbook-SurgeryCMU-git/src/features/SeatMap3DGate.jsx";

const seat = (seat_code, zone, row_no, col_no, extra = {}) => ({ seat_code, zone, row_no, col_no, held: false, occupant: null, ...extra });
const seats = [seat("M1", "M", 1, 1)];
for (let n = 1; n <= 12; n += 1) {
  seats.push(seat(`L${n}`, "L", Math.floor((n - 1) / 3) + 1, ((n - 1) % 3) + 1));
  seats.push(seat(`C${n}`, "C", Math.floor((n + 1) / 2), n % 2 === 1 ? 1 : 2));
  seats.push(seat(`R${n}`, "R", Math.floor((n - 1) / 3) + 1, ((n - 1) % 3) + 1));
}
const build = (tick) => ({
  session: { open: true, ended: false },
  me: { user_id: "me", role: "resident", in_room: true, hold: null },
  seats: seats.map((s, i) => i % 3 === tick % 3 && i % 2 === 0
    ? { ...s, occupant: { user_id: i === 4 ? "me" : `u${i}`, name: `ทดสอบ ${i}`, pgy: 2 } }
    : (i === 7 ? { ...s, held: true } : s)),
  people: [], counts: {},
});
function App() {
  const [tick, setTick] = useState(0);
  const [fell, setFell] = useState("");
  useEffect(() => { const t = setInterval(() => setTick((v) => v + 1), 8000); return () => clearInterval(t); }, []);
  return <main><h2>harness</h2>{fell && <p role="note">{fell}</p>}
    <SeatMap3DGate map={build(tick)} paused={false} onFallback={() => setFell("แสดงผัง 3D ไม่ได้บนอุปกรณ์นี้ ใช้ผัง 2D แทน")} /></main>;
}
createRoot(document.getElementById("root")).render(<App />);
```
Start it: `cd /Users/chagkrit/Downloads/Logbook-SurgeryCMU-git && npx vite --config <scratchpad>/seat3d-harness/vite.config.mjs` (run in background; stop it at the end).

- [ ] **Step 2: Check in a real browser (browser-use tool or Playwright)**

Open `http://127.0.0.1:5191/` and verify, taking a screenshot for each:
1. Desktop width (1280): the room appears, 37 seats coloured, labels with symbols, summary line, 3 preset buttons; the room matches `room_3d_preview.png` (L left, table with C seats on both sides, R right, M1 and the dark screen at the front).
2. Click each preset: view changes (oblique, top, back); with reduced motion emulated the view jumps.
3. Phone width (390, then 320): stage fills width, nothing overflows horizontally, preset buttons wrap, text readable.
4. Hover / tap a seat: tooltip shows e.g. `ที่นั่ง L2 มีผู้นั่งแล้ว · ทดสอบ 3`; drag rotates and does NOT show a tooltip.
5. Wait ≥ 9 s: seat colours change (mock data tick) and the camera does NOT reset.
6. Launch Chromium with WebGL disabled (`--disable-gpu --disable-3d-apis`, or override `HTMLCanvasElement.prototype.getContext` to return null before load): the fallback message appears and the page stays usable.
7. Console: no errors, no warnings about disposed/lost contexts after a reload.
Expected: all seven hold. Anything that does not is a bug to fix before Step 4 (write a failing test first where the bug is in `seatMap3d.js`).

- [ ] **Step 3: Stop the harness**

Stop the vite process; confirm `git status` shows no harness files inside the repo.

- [ ] **Step 4: Notes**

Append to `docs/handoff.md` a new section `## 3D view (phase 1, local branch feat/seat-map-3d)` stating: what was built (switch 2D|3D, all roles, view only, lazy `three`, fallback), the files, tests (`tests/seat-map-3d.test.mjs`), what Claude verified in a mock browser harness (list Step 2 results honestly), and what is NOT proven (real iPhone/Android, FB/LINE in-app browsers, real room dimensions in `ROOM_3D`, no production click-through), plus "not pushed / no PR". Append one line to the `CLAUDE.md` status log: `- 2026-10-14 (branch feat/seat-map-3d, not pushed): seat map 3D view phase 1 (view only, all roles, lazy three chunk, no migration); room size = constants in src/seatMap3d.js.`

- [ ] **Step 5: Final verification and commit**

Run: `npm test && npm run build 2>&1 | tail -8 && git status -sb`
Expected: tests pass, build OK, only the notes changed.
```bash
git add docs/handoff.md CLAUDE.md
git commit -m "docs: seat map 3D phase 1 handoff and status" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>" -m "Claude-Session: https://claude.ai/code/session_012nLZNNp4Thf1pxbRq9Vzmh"
```
Do not push or open a PR; report to the owner with the real-device checklist.

---

## Self-review (done while writing)
- **Spec coverage:** switch for all roles (Task 3); same data / no new field (Global Constraints + Task 2 test); lazy three (Task 2 test + build check); fallback (Tasks 2/3 + manual check 6); `seatPosition`/`seatVisual`/presets (Task 1); camera limits, reduced motion, on-demand drawing, pixel ratio, dispose (Task 2 test); tooltip with name only from `seat.occupant` (Task 2 + Task 4 check 4); text summary (Task 2); tests/build/browser check (Tasks 1-4); out-of-scope items not built. Spec detail "visible text list" is delivered as the summary line only; the per-seat text stays in the 2D map and the participants tab (the canvas is `aria-hidden`, 2D is the screen-reader path).
- **Placeholders:** none; every code step shows the code.
- **Type consistency:** `seatPosition`, `seatVisual`, `seatSummary`, `summaryText`, `CAMERA_PRESETS`, `ROOM_3D` names and shapes match across Tasks 1-2; `SeatMap3DGate({ map, paused, onFallback })` matches Task 3; `onUnavailable` is the scene's prop, wired to `onFallback` by the gate.
