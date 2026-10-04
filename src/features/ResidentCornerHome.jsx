import React from "react";
import { BedIcon, BookIcon, CalendarIcon, ChevronIcon, ClipboardIcon, MicIcon, BellIcon, KeyIcon } from "../components/Icons";
import { cornerSummary, CORNER_SERVICES } from "../residentCorner";

function Shortcut({ title, description, icon: Icon, onClick }) {
  return <button type="button" className="corner-shortcut" onClick={onClick}>
    <span className="corner-shortcut-icon"><Icon size={22} /></span>
    <span><strong>{title}</strong><small>{description}</small></span><ChevronIcon size={18} />
  </button>;
}

export default function ResidentCornerHome({ workspace, onNavigate, onOpenRequest }) {
  const { user } = workspace;
  const staff = user.role === "staff";
  const admin = user.role === "admin";
  const summary = cornerSummary(workspace);
  const names = new Map((workspace.allProfiles || workspace.profiles).map((person) => [person.id, person.name]));
  const date = new Intl.DateTimeFormat("th-TH", { dateStyle: "full", timeZone: "Asia/Bangkok" }).format(new Date());
  return <div className="corner-home">
    <section className="corner-welcome" aria-label="พื้นที่ทำงานของคุณ">
      <div><p className="corner-eyebrow">SURGERY WORKSPACE · {date}</p>
        <h2>{staff ? "งานสอนและการประเมิน" : admin ? "ดูแลพื้นที่ทำงานของภาควิชา" : "เริ่มวันทำงานของคุณ"}</h2>
        <p>{staff ? "ติดตามคำขอประเมิน ให้ feedback และเตรียมเคสสำหรับการสอน" : admin ? "จัดการสมาชิก กิจกรรม และติดตามภาพรวมการฝึกอบรม" : "รวบรวมเคส เตรียมประชุม และติดตามการฝึกอบรมในพื้นที่เดียว"}</p>
      </div>
      <button type="button" className="primary-button" onClick={() => onNavigate(staff ? "pending" : admin ? "admin" : "cases")}>{staff ? "เปิดคิวประเมิน" : admin ? "จัดการระบบ" : "เปิด New admissions"}<ChevronIcon size={18} /></button>
    </section>
    <div className="corner-columns">
      <div className="corner-stack">
        {staff ? <section className="resident-panel corner-queue">
          <div className="corner-panel-heading"><h2>คิวประเมินของคุณ</h2><span className="corner-count">{summary.pending.length} รายการ</span></div>
          {summary.pending.length ? summary.pending.slice(0, 4).map((request) => <div className="corner-queue-item" key={request.id}>
            <div><small>{names.get(request.resident_id) || "Resident"} · {request.resident_template_definitions?.template_code || "EPA/PBA"}</small><strong>{request.procedure_or_activity || request.resident_template_definitions?.title || "คำขอประเมิน"}</strong></div>
            <button type="button" className="secondary-button" onClick={() => onOpenRequest(request)}>ประเมิน</button>
          </div>) : <p className="corner-empty">ไม่มีคำขอรอประเมินที่ส่งถึงคุณ</p>}
          <button type="button" className="text-button" onClick={() => onNavigate("pending")}>ดูคิวประเมินทั้งหมด →</button>
        </section> : null}
        <section className="resident-panel corner-tasks">
          <div className="corner-panel-heading"><h2>{staff ? "งานสอนและทบทวนเคส" : "งานของฉัน"}</h2><span className="corner-eyebrow">DAILY WORK</span></div>
          <Shortcut title="New admissions" description="เปิดเคส อัปเดตรายละเอียด และเพิ่มภาพประกอบ" icon={BedIcon} onClick={() => onNavigate("cases")} />
          <Shortcut title="Friday conference" description="ทบทวนเคสตามช่วงวันและเตรียมการนำเสนอ" icon={MicIcon} onClick={() => onNavigate("conference")} />
          <Shortcut title={admin ? "จัดกิจกรรมและเช็คชื่อ" : "เช็คชื่อประชุม"} description="MM / Grand Round · เปิดระบบกิจกรรมและประวัติเดิม" icon={CalendarIcon} onClick={() => onNavigate(admin ? "round-admin" : "attendance")} />
        </section>
        <section className="resident-panel">
          <div className="corner-panel-heading"><h2>การฝึกอบรม EPA / PBA</h2><BookIcon /></div>
          <div className="corner-metrics">
            <button type="button" onClick={() => onNavigate(staff ? "pending" : admin ? "dashboard" : "request")}><strong>{summary.pending.length}</strong><span>{admin ? "คำขอรอประเมินในระบบ" : staff ? "คำขอที่รอฉันประเมิน" : "คำขอของฉันที่รอประเมิน"}</span></button>
            <button type="button" onClick={() => onNavigate("history")}><strong>{summary.completed}</strong><span>{staff ? "ฉันประเมินแล้ว" : admin ? "ผลประเมินในระบบ" : "ผลประเมินของฉัน"}</span></button>
          </div>
          <button type="button" className="text-button" onClick={() => onNavigate("dashboard")}>เปิดภาพรวม EPA / PBA →</button>
        </section>
      </div>
      <div className="corner-stack">
        <section className="corner-conference">
          <p className="corner-eyebrow">FRIDAY CONFERENCE</p><h2>จากงาน service<br />สู่การเรียนรู้ร่วมกัน</h2>
          <p>เปิดรายการเคสและภาพประกอบ เพื่อเตรียมอภิปรายในการประชุมวันศุกร์</p>
          <button type="button" className="secondary-button" onClick={() => onNavigate("conference")}>เตรียมประชุม <ChevronIcon size={18} /></button>
        </section>
        <section className="resident-panel corner-tasks">
          <div className="corner-panel-heading"><h2>แหล่งเรียนรู้และตารางงาน</h2></div>
          <Shortcut title="คลังวิดีโอ" description="ยังไม่เชื่อมแหล่งวิดีโอ" icon={BookIcon} onClick={() => onNavigate("videos")} />
          <Shortcut title="ตารางเวร / ตาราง OR" description="ยังไม่เชื่อมตารางจริง" icon={CalendarIcon} onClick={() => onNavigate("schedule")} />
          <Shortcut title="Microsoft 365 / Google" description="ดูสถานะการเชื่อมบัญชี" icon={KeyIcon} onClick={() => onNavigate("accounts")} />
        </section>
        <button type="button" className="corner-inbox" onClick={() => onNavigate("notifications")}><BellIcon /><span>การแจ้งเตือนที่ยังไม่อ่าน</span><strong>{summary.unread}</strong><ChevronIcon size={18} /></button>
      </div>
    </div>
  </div>;
}

export function CornerService({ service, onNavigate }) {
  const info = CORNER_SERVICES[service];
  if (!info) return null;
  return <section className="resident-panel corner-service">
    <p className="corner-eyebrow">RESIDENT CORNER</p><h2>{info.subtitle}</h2>
    <p>{info.note}</p><div className="corner-service-grid">{info.items.map((item) => <div key={item}><ClipboardIcon size={24} /><h3>{item}</h3><span className="corner-count">ยังไม่เปิดใช้งาน</span></div>)}</div>
    <button type="button" className="secondary-button" onClick={() => onNavigate("home")}>กลับหน้าแรก</button>
  </section>;
}
