// Friday conference agenda rules. Pure functions (no network), shared by the screen and the tests.
//  - cases admitted in [from, to] join automatically
//  - the organiser's saved CHANGES: cases left out, older cases added, and the order
export function buildAgenda({ cases, from, to, excluded = [], added = [], order = [] }) {
  const live = cases.filter((row) => !row.deleted_at);
  const auto = live.filter((row) => row.admit_date >= from && row.admit_date <= to);
  const autoIds = new Set(auto.map((row) => row.id));
  const extra = live.filter((row) => added.includes(row.id) && !autoIds.has(row.id));
  const base = [...auto, ...extra].sort((a, b) => a.admit_date.localeCompare(b.admit_date) || a.case_code.localeCompare(b.case_code));
  const pos = new Map(order.map((id, i) => [id, i]));
  return base
    .map((row, i) => ({ row, i, source: autoIds.has(row.id) ? "auto" : "added", excluded: excluded.includes(row.id) }))
    .sort((x, y) => (pos.has(x.row.id) ? pos.get(x.row.id) : 1e6 + x.i) - (pos.has(y.row.id) ? pos.get(y.row.id) : 1e6 + y.i))
    .map(({ i, ...item }) => item);
}

export const includedRows = (agenda) => agenda.filter((item) => !item.excluded).map((item) => item.row);

export function moveId(ids, id, direction) {
  const from = ids.indexOf(id);
  const to = from + direction;
  if (from < 0 || to < 0 || to >= ids.length) return ids;
  const next = ids.slice();
  [next[from], next[to]] = [next[to], next[from]];
  return next;
}

// Drag and drop: put `id` at position `toIndex` (0-based). Out-of-range targets are clamped.
export function moveToIndex(ids, id, toIndex) {
  const from = ids.indexOf(id);
  if (from < 0) return ids;
  const to = Math.max(0, Math.min(ids.length - 1, toIndex));
  if (to === from) return ids;
  const next = ids.slice();
  next.splice(from, 1);
  next.splice(to, 0, id);
  return next;
}

// Shown in the arrange dialog: this range first (ticked unless excluded), then older/other cases (unticked unless added).
export function agendaCandidates({ cases, from, to }) {
  const live = cases.filter((row) => !row.deleted_at);
  const inRange = live.filter((row) => row.admit_date >= from && row.admit_date <= to)
    .sort((a, b) => a.admit_date.localeCompare(b.admit_date) || a.case_code.localeCompare(b.case_code))
    .map((row) => ({ row, outside: false }));
  const outside = live.filter((row) => !(row.admit_date >= from && row.admit_date <= to))
    .sort((a, b) => b.admit_date.localeCompare(a.admit_date) || b.case_code.localeCompare(a.case_code))
    .map((row) => ({ row, outside: true }));
  return [...inRange, ...outside];
}

// Today any active member may arrange the agenda (mirrors private.resident_can_manage_conference() in the database).
// If the rule is tightened there, change this function too; the database is what actually enforces it.
export const canManageConference = (user) => Boolean(user && ["resident", "staff", "admin"].includes(user.role));

export const MAX_RANGE_DAYS = 62;
export const conferenceRangeProblem = (from, to) => {
  if (!from || !to) return "กรุณาเลือกวันที่เริ่มต้นและสิ้นสุด";
  if (from > to) return "วันเริ่มต้องไม่เกินวันสิ้นสุด";
  const days = (new Date(`${to}T00:00:00Z`) - new Date(`${from}T00:00:00Z`)) / 86400000;
  if (days > MAX_RANGE_DAYS) return "ช่วงวันที่ยาวเกิน 63 วัน";
  return "";
};
