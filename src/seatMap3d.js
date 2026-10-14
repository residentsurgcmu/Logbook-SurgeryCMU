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
