// Summaries use only the workspace already authorized by the server.
// Filtering here is presentation, never a replacement for RLS.
export function cornerSummary(workspace) {
  const { user, requests = [], assessments = [], notifications = [] } = workspace;
  const mine = (row, staffField) => user.role === "admin" ||
    (user.role === "staff" ? row[staffField] === user.id : row.resident_id === user.id);
  return {
    pending: requests.filter((row) => row.status === "pending" && mine(row, "staff_id")),
    completed: assessments.filter((row) => mine(row, "evaluator_id")).length,
    unread: notifications.filter((row) => !row.read_at && row.recipient_id === user.id).length,
  };
}

export const CORNER_SERVICES = {
  videos: { title: "คลังวิดีโอ", subtitle: "ทบทวนการผ่าตัดและบทเรียนของภาควิชา", items: ["วิดีโอการผ่าตัด", "บทเรียนและ conference ย้อนหลัง"], note: "ยังไม่เปิดคลังวิดีโอในระบบนี้ รอเชื่อมแหล่งวิดีโอและกำหนดสิทธิ์การรับชม" },
  schedule: { title: "ตารางเวร / ตาราง OR", subtitle: "ดูงาน service และวางแผนวันทำงาน", items: ["ตารางเวรและทีมรับผิดชอบ", "ตารางห้องผ่าตัด"], note: "ยังไม่เชื่อมตารางจริง จึงยังไม่มีข้อมูลเวรหรือคิวผ่าตัดให้แสดง" },
  accounts: { title: "บัญชีที่เชื่อมต่อ", subtitle: "Microsoft 365 และ Google", items: ["Microsoft 365", "Google"], note: "ยังไม่เปิดเชื่อมบัญชีภายนอก การเข้าสู่ระบบยังใช้บัญชีที่ภาควิชาจัดให้" },
};
