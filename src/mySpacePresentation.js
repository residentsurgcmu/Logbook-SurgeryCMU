import { residentTemplates } from "./generated/residentTemplates.js";

const titles = new Map(residentTemplates.map((template) => [template.code, template.title]));

// Display groups only: these do not grant access, assign a department, or affect scoring.
const groups = {
  trauma: { label: "อุบัติเหตุ", icon: "trauma" },
  general: { label: "ศัลยกรรมทั่วไป", icon: "general" },
  digestive: { label: "ทางเดินอาหาร", icon: "digestive" },
  colorectal: { label: "ลำไส้ใหญ่และทวารหนัก", icon: "colorectal" },
  hpb: { label: "ตับและทางเดินน้ำดี", icon: "hpb" },
  breast: { label: "เต้านม", icon: "breast" },
  vascular: { label: "หลอดเลือด", icon: "vascular" },
  laparoscopic: { label: "ทักษะส่องกล้อง", icon: "laparoscopic" },
  endocrine: { label: "ต่อมไร้ท่อ", icon: "endocrine" },
  airway: { label: "ทางเดินหายใจ", icon: "airway" },
};
const groupByCode = {
  "EPA-1": "trauma", "EPA-2": "general", "EPA-3": "digestive", "EPA-4": "hpb",
  "EPA-5": "breast", "EPA-6": "vascular", "EPA-7-L1-L2": "laparoscopic", "EPA-7-L3": "laparoscopic",
  "PBA-01": "vascular", "PBA-02": "general", "PBA-03": "vascular", "PBA-04": "breast",
  "PBA-05": "colorectal", "PBA-06": "colorectal", "PBA-07": "colorectal", "PBA-08": "digestive",
  "PBA-09": "colorectal", "PBA-10": "general", "PBA-11": "digestive", "PBA-12": "hpb",
  "PBA-13": "hpb", "PBA-14": "breast", "PBA-15": "hpb", "PBA-16": "digestive",
  "PBA-17": "general", "PBA-18": "endocrine", "PBA-19": "airway", "PBA-20": "vascular", "PBA-21": "general",
};

export function assessmentDisplayName(code, title = "") {
  const supplied = String(title || "").trim();
  const onlyCode = supplied.replace(/[\s-]/g, "").toUpperCase() === String(code).replace(/[\s-]/g, "").toUpperCase();
  const full = (supplied && !onlyCode ? supplied : titles.get(code)) || "";
  const name = full.replace(/^PBA(?:\s*[- ]?\d+)?\s*[:.–-]?\s*/i, "")
    .replace(/^EPA\s*[- ]?\d+(?:-L\d(?:-L\d)?)?\s*[:.–-]?\s*/i, "").trim();
  return name || "ยังไม่มีชื่อแบบประเมิน";
}

export function assessmentTopic(code) {
  return groups[groupByCode[code]] || groups.general;
}
