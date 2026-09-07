import React, { useState } from "react";
import { BookIcon, KeyIcon, LogoutIcon, QrIcon, ShieldIcon, UserIcon } from "./Icons";
import ChangePasswordDialog from "./ChangePasswordDialog";

const studentTabs = [["dashboard", "ภาพรวม", UserIcon], ["logbook", "Logbook", BookIcon], ["qr", "QR ของฉัน", QrIcon]];
const staffTabs = [["dashboard", "ภาพรวม", UserIcon], ["review", "ตรวจและอนุมัติ", ShieldIcon]];
const adminTabs = [["admin", "จัดการข้อมูล", ShieldIcon]];

const syncLabels = {
  connecting: "กำลังเชื่อม Supabase",
  saving: "กำลังบันทึกใน Supabase",
  synced: "เชื่อมต่อ Supabase แล้ว",
  offline: "ไม่สามารถเชื่อมฐานข้อมูล",
};

export default function AppShell({ user, activeTab, onTabChange, onLogout, onChangePassword, syncStatus, children }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [passwordDialogOpen, setPasswordDialogOpen] = useState(false);
  const classYear = user.classYear || user.activeEnrollment?.classYear || 4;
  const logbookLabel = user.role === "student" ? `Year ${classYear}` : "Student Logbook";
  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand-lockup">
          <img src="/surgery-cmu-logo.png" alt="Surgery CMU" />
          <div className="brand-copy">
            <strong>Surgery Logbook · {logbookLabel}</strong>
            <span>{user.role === "student" ? `ระบบบันทึกการฝึกปฏิบัติงาน นักศึกษาแพทย์ชั้นปีที่ ${classYear}` : "ระบบติดตามและรับรอง Logbook นักศึกษาแพทย์"}</span>
          </div>
        </div>
        <div className="header-actions">
          <div className={`sync-state ${syncStatus}`} role="status"><i /> <span>{syncLabels[syncStatus]}</span></div>
          <div className="profile-wrap">
            <button className="profile-button" onClick={() => setMenuOpen((open) => !open)} aria-expanded={menuOpen}>
              <span className="profile-avatar"><UserIcon size={18} /></span>
              <span><strong>{user.name}</strong><small>{user.role === "admin" ? "Admin" : user.role === "staff" ? "Staff" : "Student"}</small></span>
            </button>
            {menuOpen && (
              <div className="profile-menu">
                <div><strong>{user.name}</strong><span>{user.email}</span></div>
                <button onClick={() => { setMenuOpen(false); setPasswordDialogOpen(true); }}><KeyIcon size={18} />เปลี่ยนรหัสผ่าน</button>
                <button onClick={onLogout}><LogoutIcon size={18} />ออกจากระบบ</button>
              </div>
            )}
          </div>
        </div>
      </header>
      <nav className="tab-nav" aria-label="เมนูหลัก">
        {(user.role === "admin" ? adminTabs : user.role === "staff" ? staffTabs : studentTabs).map(([id, label, TabIcon]) => (
          <button key={id} className={activeTab === id ? "active" : ""} onClick={() => onTabChange(id)}><TabIcon size={17} />{label}</button>
        ))}
      </nav>
      <main className="main-content">{children}</main>
      <footer>ภาควิชาศัลยศาสตร์ คณะแพทยศาสตร์ มหาวิทยาลัยเชียงใหม่</footer>
      {passwordDialogOpen && <ChangePasswordDialog onChangePassword={onChangePassword} onClose={() => setPasswordDialogOpen(false)} />}
    </div>
  );
}
