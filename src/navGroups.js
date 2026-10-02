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
