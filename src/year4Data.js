export const year4Activities = [
  { id: "advisor-meeting", title: "พบอาจารย์ที่ปรึกษา", group: "การกำกับติดตาม", target: 2, unit: "ครั้ง", fields: ["week", "supervisor", "detail"] },
  { id: "patient-care", title: "ผู้ป่วยที่รับไว้ในความดูแล", group: "การดูแลผู้ป่วย", target: 12, unit: "ราย", fields: ["patient", "diagnosis", "unit"] },
  { id: "major-operation-observe", title: "สังเกตการผ่าตัดใหญ่", group: "ห้องผ่าตัด", target: 8, unit: "ราย", fields: ["week", "patient", "diagnosis", "procedure", "supervisor"] },
  { id: "opd-attendance", title: "เข้าเรียนที่ OPD", group: "กิจกรรมรายสัปดาห์", target: 8, unit: "สัปดาห์", fields: ["week", "unit", "supervisor"] },
  { id: "conference", title: "เข้าร่วม Conference ของหน่วย", group: "กิจกรรมรายสัปดาห์", target: 8, unit: "สัปดาห์", fields: ["week", "title", "unit", "supervisor"] },
  { id: "after-hours-duty", title: "อยู่เวรนอกเวลาราชการ", group: "เวร", target: 8, unit: "ครั้ง", fields: ["unit", "diagnosis", "supervisor", "detail"] },
  { id: "emergency-duty", title: "อยู่เวรห้องฉุกเฉิน", group: "เวร", target: 4, unit: "ครั้ง", fields: ["diagnosis", "supervisor", "detail"] },
  { id: "major-operation-assist", title: "ช่วยการผ่าตัดใหญ่", group: "หัตถการ", target: 3, unit: "ราย", fields: ["patient", "diagnosis", "procedure", "supervisor"] },
  { id: "minor-operation", title: "สังเกตหรือช่วยการผ่าตัดเล็ก", group: "หัตถการ", target: 2, unit: "ราย", fields: ["patient", "diagnosis", "procedure", "participation", "supervisor"] },
  { id: "wound-suture", title: "เย็บแผล", group: "หัตถการพื้นฐาน", target: 2, unit: "ราย", fields: ["patient", "diagnosis", "procedure", "supervisor"] },
  { id: "foley-catheter", title: "ใส่ Foley catheter", group: "หัตถการพื้นฐาน", target: 3, unit: "ราย", fields: ["patient", "diagnosis", "unit", "supervisor"] },
  { id: "venipuncture", title: "เจาะเลือด", group: "หัตถการพื้นฐาน", target: 4, unit: "ราย", fields: ["patient", "diagnosis", "unit", "supervisor"] },
  { id: "stomal-care", title: "ทำ Stomal care", group: "หัตถการพื้นฐาน", target: 1, unit: "ราย", fields: ["patient", "diagnosis", "unit", "supervisor"] },
  { id: "nasogastric-tube", title: "ใส่ Nasogastric tube", group: "หัตถการพื้นฐาน", target: 2, unit: "ราย", fields: ["patient", "diagnosis", "unit", "supervisor"] },
  { id: "major-trauma-first-aid", title: "เห็น First aid management in major trauma", group: "หัตถการพื้นฐาน", target: 2, unit: "ราย", fields: ["patient", "diagnosis", "unit", "supervisor", "detail"] },
  { id: "proctoscopy", title: "ทำ Proctoscopy", group: "หัตถการพื้นฐาน", target: 1, unit: "ราย", fields: ["patient", "diagnosis", "unit", "supervisor"] },
  { id: "resident-teaching", title: "การสอนของ Resident", group: "กิจกรรมรายสัปดาห์", target: 8, unit: "สัปดาห์", fields: ["week", "title", "supervisor"] },
];

export const activityById = new Map(year4Activities.map((activity) => [activity.id, activity]));
export const year4ActivityGroups = [...new Set(year4Activities.map((activity) => activity.group))];

export const statusLabels = {
  draft: "ฉบับร่าง",
  submitted: "รออนุมัติ",
  approved: "อนุมัติแล้ว",
  rejected: "ส่งกลับแก้ไข",
};

export const demoStudents = [
  { id: "demo-student-1", name: "นศพ. พิมพ์ชนก ใจดี", email: "student01@example.ac.th", role: "student", studentCode: "650710001", studentGroup: "1", cohortYear: 2569, qrToken: "a391dc7b-48ca-4f7a-bb53-2569c0de0001" },
  { id: "demo-student-2", name: "นศพ. ธนภัทร วิริยะ", email: "student02@example.ac.th", role: "student", studentCode: "650710002", studentGroup: "2", cohortYear: 2569, qrToken: "a391dc7b-48ca-4f7a-bb53-2569c0de0002" },
];

export const demoStaff = { id: "demo-staff-1", name: "อ. นพ. สมชาย ศัลยแพทย์", email: "staff@example.ac.th", role: "staff" };
export const demoAdmin = { id: "demo-admin-1", name: "Surgery CMU Year 4 Admin", email: "surgerycmuyear4@hotmail.com", role: "admin" };
export const demoStaffDirectory = [
  demoStaff,
  { id: "demo-staff-2", name: "อ. พญ. กานดา ศัลยแพทย์", email: "staff02@example.ac.th", role: "staff" },
];

export const demoRotations = [
  { id: "demo-rotation-1", academicYear: 2568, groupCode: "1", name: "ศัลยศาสตร์ กลุ่ม 1", startDate: "2025-08-01", endDate: "2025-09-30", status: "open" },
  { id: "demo-rotation-2", academicYear: 2568, groupCode: "2", name: "ศัลยศาสตร์ กลุ่ม 2", startDate: "2025-08-01", endDate: "2025-09-30", status: "open" },
];

export const demoCertifications = [];

export const demoEntries = [
  { id: "demo-entry-1", studentId: "demo-student-1", activityType: "major-operation-observe", date: "2025-08-04", weekNumber: 1, patientReference: "เคส ••1042", diagnosis: "Acute appendicitis", procedureName: "Laparoscopic appendectomy", supervisorName: "อ. นพ. สมชาย ศัลยแพทย์", selectedApproverId: "demo-staff-1", selectedApproverName: "อ. นพ. สมชาย ศัลยแพทย์", detail: "สังเกตขั้นตอนและอภิปรายข้อบ่งชี้", status: "approved", submittedAt: "2025-08-04T09:45:00Z", approvedAt: "2025-08-04T10:30:00Z", approverName: "อ. นพ. สมชาย", approverComment: "", revision: 1, oneDriveSyncStatus: "synced" },
  { id: "demo-entry-2", studentId: "demo-student-1", activityType: "opd-attendance", date: "2025-08-06", weekNumber: 1, unitName: "ศัลยกรรมทั่วไป 1", supervisorName: "อ. พญ. กานดา", detail: "", status: "approved", submittedAt: "2025-08-06T08:50:00Z", approvedAt: "2025-08-06T09:30:00Z", approverName: "อ. พญ. กานดา", approverComment: "", revision: 1, oneDriveSyncStatus: "synced" },
  { id: "demo-entry-3", studentId: "demo-student-1", activityType: "conference", date: "2025-08-08", weekNumber: 1, activityTitle: "Morbidity and Mortality Conference", unitName: "ศัลยกรรมทั่วไป", supervisorName: "อ. นพ. สมชาย ศัลยแพทย์", selectedApproverId: "demo-staff-1", selectedApproverName: "อ. นพ. สมชาย ศัลยแพทย์", detail: "สรุปประเด็นภาวะแทรกซ้อนหลังผ่าตัด", status: "submitted", submittedAt: "2025-08-08T03:10:00Z", revision: 1, oneDriveSyncStatus: "not_required" },
  { id: "demo-entry-4", studentId: "demo-student-1", activityType: "venipuncture", date: "2025-08-09", patientReference: "เคส ••2238", diagnosis: "Bowel obstruction", unitName: "ศัลยกรรมชาย", supervisorName: "พว. ผู้ควบคุม", detail: "", status: "rejected", submittedAt: "2025-08-09T06:15:00Z", approverComment: "กรุณาระบุชื่อผู้ควบคุมให้ครบ", revision: 1, oneDriveSyncStatus: "not_required" },
  { id: "demo-entry-5", studentId: "demo-student-2", activityType: "emergency-duty", date: "2025-08-10", diagnosis: "Blunt abdominal trauma", supervisorName: "พจบ. เวรศัลยกรรม", detail: "ประเมิน primary survey", status: "submitted", submittedAt: "2025-08-10T14:20:00Z", revision: 1, oneDriveSyncStatus: "not_required" },
];

export function calculateProgress(entries, activities = year4Activities) {
  const approved = entries.filter((entry) => entry.status === "approved");
  return activities.map((activity) => {
    const completed = approved.filter((entry) => entry.activityType === activity.id).length;
    const percent = activity.target ? Math.min(100, Math.round((completed / activity.target) * 100)) : null;
    return { ...activity, completed, percent, remaining: activity.target === null ? null : Math.max(0, activity.target - completed) };
  });
}
