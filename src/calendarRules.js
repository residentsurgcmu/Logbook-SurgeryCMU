export const CALENDAR_KINDS = { exam: 'การสอบ', activity: 'กิจกรรม' };
export const CALENDAR_STATUSES = { draft: 'ฉบับร่าง', published: 'ประกาศแล้ว', cancelled: 'ยกเลิก' };
export const bangkokInput = (iso) => new Date(new Date(iso).getTime() + 7 * 3600000).toISOString().slice(0, 16);
export const bangkokIso = (input) => {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(input)) throw new Error('กรุณาระบุวันเวลาให้ครบ');
  const date = new Date(`${input}:00+07:00`);
  if (!Number.isFinite(date.getTime()) || bangkokInput(date) !== input) throw new Error('วันเวลาไม่ถูกต้อง');
  return date.toISOString();
};
export function calendarRange(month) {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error('เดือนที่เลือกไม่ถูกต้อง');
  const [year, m] = month.split('-').map(Number);
  if (m < 1 || m > 12) throw new Error('เดือนที่เลือกไม่ถูกต้อง');
  return { from: new Date(Date.UTC(year,m-1,1,-7)).toISOString(), to: new Date(Date.UTC(year,m,1,-7)).toISOString() };
}
export const calendarTime = (iso) => new Intl.DateTimeFormat('th-TH',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Bangkok'}).format(new Date(iso));
export function calendarError(error) {
  const text = error?.message || '';
  if (text.includes('CALENDAR_CONFLICT')) return 'ข้อมูลถูกเปลี่ยนแล้ว กรุณาโหลดล่าสุดก่อนแก้ไข';
  if (text.includes('CALENDAR_FORBIDDEN')) return 'ไม่มีสิทธิ์ใช้งานหรือบัญชีถูกปิด กรุณาเข้าสู่ระบบใหม่';
  if (text.includes('CALENDAR_LIMIT')) return 'มีรายการมากเกินไป กรุณาเลือกช่วงเวลาให้แคบลง';
  if (text.includes('CALENDAR_INVALID')) return 'ตรวจวันเวลา รายละเอียด และผู้เข้าร่วม (ต้องมี Resident ที่ใช้งาน 1–200 คน)';
  return 'ทำรายการไม่สำเร็จ หากขาดการเชื่อมต่อระหว่างบันทึก ให้โหลดตรวจรายการก่อนส่งใหม่';
}
