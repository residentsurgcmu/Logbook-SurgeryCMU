// Sidebar sections. Tabs keep the role order built in ResidentPlatform; a tab
// missing from this list still shows (under the last section) instead of vanishing.
export const NAV_GROUPS = [
  ["การประเมิน", ["request", "pending", "scan", "dashboard", "qr", "history"]],
  ["เคสและประชุม", ["cases", "conference", "attendance", "round-admin"]],
  ["อื่นๆ", ["notifications", "exams", "export", "admin"]],
];

export function groupNav(nav) {
  const known = new Set(NAV_GROUPS.flatMap(([, ids]) => ids));
  const groups = NAV_GROUPS.map(([title, ids]) => [title, nav.filter(([id]) => ids.includes(id))]);
  groups[groups.length - 1][1].push(...nav.filter(([id]) => !known.has(id)));
  return groups.filter(([, items]) => items.length);
}

// Phone bottom bar: the few things each role does on the ward, with short labels.
// The fifth slot is always "เพิ่มเติม", which opens the full menu drawer.
export const BOTTOM_NAV = {
  resident: [["request", "ส่งประเมิน"], ["history", "ผลประเมิน"], ["qr", "QR ของฉัน"], ["cases", "เคส"]],
  staff: [["pending", "รอประเมิน"], ["scan", "สแกน"], ["dashboard", "ภาพรวม"], ["history", "ประวัติ"]],
  admin: [["dashboard", "ภาพรวม"], ["history", "ผลประเมิน"], ["cases", "เคส"], ["admin", "จัดการ"]],
};

// Only tabs the signed-in role can actually open are returned.
export function bottomNav(role, nav) {
  const allowed = new Set(nav.map(([id]) => id));
  return (BOTTOM_NAV[role] || []).filter(([id]) => allowed.has(id));
}
