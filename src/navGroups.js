// Preserve every role-authorized tab, including future modules.
export const NAV_GROUPS = [
  ["พื้นที่ทำงาน", ["home", "cases", "conference", "schedule"]],
  ["การเรียนรู้และกิจกรรม", ["videos", "attendance", "round-admin"]],
  ["การประเมิน", ["request", "pending", "scan", "dashboard", "qr", "history", "exams"]],
  ["อื่นๆ", ["accounts", "notifications", "export", "admin"]],
];

export function groupNav(nav, role = "resident") {
  const known = new Set(NAV_GROUPS.flatMap(([, ids]) => ids));
  const groups = NAV_GROUPS.map(([title, ids]) => [title, nav.filter(([id]) => ids.includes(id))]);
  groups[groups.length - 1][1].push(...nav.filter(([id]) => !known.has(id)));
  // Staff reach their assessment queue before service and teaching links.
  if (role === "staff") groups.splice(1, 0, ...groups.splice(2, 1));
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
