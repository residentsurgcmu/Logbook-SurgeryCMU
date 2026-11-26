// Fixture only: these records are invented and never enter the exam API.
const previewHost = "resident-surgery-logbook-git-feat-my-space-x-f624cd-surgery-cmu.vercel.app";
export const isXrayRadarDemoHost = (hostname) => hostname === previewHost;
export const demoResidentId = "xray-preview-fixture";
export const demoXrayRows = [
  ["UGI1", 14, 20, "scored"],
  ["Colorectal", 8, 10, "scored"],
  ["HPB", 6, 10, "scored"],
  ["Breast & Endocrine", 15, 20, "scored"],
  ["Vascular", null, 10, "absent"],
  ["Trauma", 12, 20, "scored"],
].map(([part_name, score, max_score, value_state]) => ({
  part_name, score, max_score, value_state, resident_id: demoResidentId, exam_type: "xray_anatomy",
  exam_id: "xray-preview-exam", revision_id: "xray-preview-revision",
  title: "X-ray Anatomy — ข้อมูลสมมติ", exam_date: "2026-11-01",
}));
