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

// Day keys and month arithmetic stay in Bangkok regardless of browser timezone.
export function calendarMonthDays(month) {
  calendarRange(month);
  const [y,m]=month.split('-').map(Number), first=new Date(Date.UTC(y,m-1,1));
  const count=new Date(Date.UTC(y,m,0)).getUTCDate();
  return Array.from({length:Math.ceil((first.getUTCDay()+count)/7)*7},(_,i)=>{
    const day=i-first.getUTCDay()+1;
    return day<1||day>count?null:`${month}-${String(day).padStart(2,'0')}`;
  });
}
export function calendarEventsForDay(events,day) {
  const start=new Date(`${day}T00:00:00+07:00`).getTime(),end=start+86400000;
  return events.filter(e=>new Date(e.starts_at).getTime()<end&&new Date(e.ends_at).getTime()>start);
}
export function shiftCalendarMonth(month,delta) {
  calendarRange(month);const [y,m]=month.split('-').map(Number);
  return new Date(Date.UTC(y,m-1+delta,1)).toISOString().slice(0,7);
}
export const calendarDayLabel = day=>new Intl.DateTimeFormat('th-TH',{dateStyle:'full',timeZone:'Asia/Bangkok'}).format(new Date(`${day}T12:00:00+07:00`));
export const calendarMonthLabel = month=>new Intl.DateTimeFormat('th-TH',{month:'long',year:'numeric',timeZone:'Asia/Bangkok'}).format(new Date(`${month}-01T12:00:00+07:00`));
