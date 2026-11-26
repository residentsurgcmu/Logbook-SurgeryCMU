export const MY_SPACE_LAYOUTS = [
  ["daily", "Daily Rounds", "งานที่ต้องติดตามและนัดถัดไป"],
  ["board", "Board Checklist", "รายการเตรียมสอบแบบข้อความ"],
  ["rings", "Training Rings", "วงความก้าวหน้า EPA, PBA และบอร์ด"],
  ["achiever", "Achiever", "การ์ดประจำตัวและความก้าวหน้า"],
];

const CARD_LABELS = {
  waiting: "รอการประเมิน", calendar: "ปฏิทินและนัดถัดไป", progress: "ความก้าวหน้าของฉัน",
  exams: "ผลการสอบของฉัน", radar: "X-ray Anatomy", recent: "กิจกรรมล่าสุด",
  attendance: "การเข้าร่วมประชุมของฉัน", profile: "การ์ด Resident", awards: "ผลงานและเหรียญ",
};

export const MY_SPACE_CARD_ORDER = {
  daily: ["waiting", "calendar", "progress", "exams", "radar", "recent", "attendance"],
  board: [],
  rings: ["progress", "radar", "exams", "waiting", "calendar", "recent", "attendance"],
  achiever: ["profile", "progress", "awards", "radar", "exams", "recent", "waiting", "calendar", "attendance"],
};
export const MY_SPACE_CARD_LABELS = CARD_LABELS;
export const MY_SPACE_CARD_SIZES = [
  ["default", "ตามแม่แบบ"], ["compact", "กะทัดรัด"], ["large", "ขนาดใหญ่"], ["collapsed", "ย่อเหลือหัวข้อ"],
];

function preferenceKey(userId) {
  return userId ? `resident-corner:my-space-layout:v1:${userId}` : null;
}

export function normalizeMySpacePreferences(raw) {
  const layout = MY_SPACE_LAYOUTS.some(([id]) => raw?.layout === id) ? raw.layout : "daily";
  const cards = {};
  const expandedSizes = {};
  for (const [template, keys] of Object.entries(MY_SPACE_CARD_ORDER)) {
    for (const key of keys) {
      const size = raw?.cards?.[template]?.[key];
      if (size !== "default" && MY_SPACE_CARD_SIZES.some(([id]) => size === id)) {
        (cards[template] ??= {})[key] = size;
        const expanded = raw?.expandedSizes?.[template]?.[key];
        if (size === "collapsed" && (expanded === "compact" || expanded === "large")) {
          (expandedSizes[template] ??= {})[key] = expanded;
        }
      }
    }
  }
  return { layout, hideAwards: raw?.hideAwards === true, cards, expandedSizes };
}

export function loadMySpacePreferences(userId) {
  try {
    const key = preferenceKey(userId);
    if (key) return normalizeMySpacePreferences(JSON.parse(globalThis.localStorage.getItem(key)));
  } catch { /* Use defaults when browser storage is unavailable. */ }
  return normalizeMySpacePreferences(null);
}

export function saveMySpacePreferences(userId, value) {
  try {
    const key = preferenceKey(userId);
    if (!key) return false;
    globalThis.localStorage.setItem(key, JSON.stringify(normalizeMySpacePreferences(value)));
    return true;
  } catch { return false; }
}

export function withMySpaceCardSize(preferences, layout, card, size) {
  const previousSize = preferences.cards[layout]?.[card];
  const previousExpanded = preferences.expandedSizes[layout]?.[card];
  return normalizeMySpacePreferences({
    ...preferences,
    cards: { ...preferences.cards, [layout]: { ...preferences.cards[layout], [card]: size } },
    expandedSizes: { ...preferences.expandedSizes, [layout]: {
      ...preferences.expandedSizes[layout], [card]: size === "collapsed" && (previousSize === "collapsed" ? previousExpanded : previousSize),
    } },
  });
}
