import React from "react";
import { QRCodeSVG } from "qrcode.react";
import { QrIcon, ShieldIcon } from "../components/Icons";
import { appUrl } from "../appConfig";
import { formatYear4Timestamp } from "../year4Time";

export default function StudentQr({ user, entries }) {
  const qrValue = `${appUrl}/evaluate/${user.qrToken}`;
  const pendingEntries = entries.filter((entry) => entry.studentId === user.id && entry.status === "submitted" && entry.selectedApproverId);
  const pending = pendingEntries.length;
  const latestSubmittedAt = pendingEntries.reduce((latest, entry) => entry.submittedAt > latest ? entry.submittedAt : latest, "");

  if (!pending) {
    return (
      <>
        <div className="page-heading"><div><h1>QR ประจำตัวนักศึกษา</h1><p>QR จะแสดงหลังบันทึกกิจกรรมครบถ้วนและเลือก Staff ผู้อนุมัติ</p></div></div>
        <section className="content-panel empty-state qr-locked"><QrIcon size={36} /><h2>ยังไม่มีรายการพร้อมอนุมัติ</h2><p>ไปที่หน้า Logbook กรอกข้อมูล เลือก Staff และกด “บันทึกและแสดง QR”</p></section>
      </>
    );
  }

  return (
    <>
      <div className="page-heading"><div><h1>QR ประจำตัวนักศึกษา</h1><p>แสดง QR นี้ให้ Staff หลังจากส่งกิจกรรมเพื่อรออนุมัติ</p></div></div>
      <div className="qr-layout">
        <section className="content-panel qr-card">
          <div className="qr-brand"><img src="/surgery-cmu-logo.png" alt="Surgery CMU" /><div><strong>Surgery Logbook · Year {user.classYear || 4}</strong><span>ปีการศึกษา {user.academicYear || user.cohortYear} · คณะแพทยศาสตร์ มหาวิทยาลัยเชียงใหม่</span></div></div>
          <div className="qr-code-wrap"><QRCodeSVG value={qrValue} size={248} level="H" marginSize={2} bgColor="#ffffff" fgColor="#111827" /></div>
          <h2>{user.name}</h2>
          <p>{user.studentCode} · Year {user.classYear || 4} · ปีการศึกษา {user.academicYear || user.cohortYear || 2568}</p>
          <code>{String(user.qrToken).slice(0, 8).toUpperCase()}</code>
          <div className="qr-pending"><QrIcon size={18} /> มี {pending} รายการรอ Staff อนุมัติ</div>
          <div className="qr-submitted-at">บันทึกล่าสุด: {formatYear4Timestamp(latestSubmittedAt)}</div>
          <div className="qr-assignees">ส่งให้ {Array.from(new Set(pendingEntries.map((entry) => entry.selectedApproverName).filter(Boolean))).join(", ")}</div>
          <button className="secondary-button" onClick={() => window.print()}>พิมพ์บัตร QR</button>
        </section>
        <aside className="content-panel qr-guidance">
          <ShieldIcon size={34} />
          <h2>QR นี้ใช้ระบุตัวนักศึกษาเท่านั้น</h2>
          <p>การสแกน QR จะไม่อนุมัติรายการโดยอัตโนมัติ Staff ต้องเข้าสู่ระบบ ตรวจชื่อและเลือกรายการที่ต้องการประเมินทุกครั้ง</p>
          <ol><li>กรอกกิจกรรมให้ครบและเลือก Staff</li><li>กดบันทึกเพื่อแสดง QR</li><li>ให้ Staff ที่เลือกสแกนและตรวจข้อมูล</li><li>ติดตามผลที่หน้า Logbook</li></ol>
          <div className="privacy-note">QR ไม่มีชื่อผู้ป่วย HN หรือข้อมูลทางการแพทย์ฝังอยู่ภายใน</div>
        </aside>
      </div>
    </>
  );
}
