import React, { useEffect } from "react";
import { QRCodeSVG } from "qrcode.react";
import { QrIcon, XIcon } from "../components/Icons";
import { appUrl } from "../appConfig";

export default function StudentQrModal({ user, entry, onClose, onOpenQr }) {
  useEffect(() => {
    function closeOnEscape(event) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  const qrValue = `${appUrl}/evaluate/${user.qrToken}`;

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="modal-card qr-success-modal" role="dialog" aria-modal="true" aria-labelledby="qr-success-title">
        <button className="modal-close" type="button" onClick={onClose} aria-label="ปิดหน้าต่าง QR"><XIcon size={20} /></button>
        <span className="modal-icon"><QrIcon size={28} /></span>
        <h2 id="qr-success-title">บันทึก Logbook สำเร็จ</h2>
        <p>แสดง QR นี้ให้ Staff ที่เลือกสแกนเพื่อตรวจและอนุมัติ</p>
        <div className="qr-code-wrap"><QRCodeSVG value={qrValue} size={230} level="H" marginSize={2} bgColor="#ffffff" fgColor="#111827" /></div>
        <strong>{user.name}</strong>
        <span>{user.studentCode} · ส่งให้ {entry.selectedApproverName}</span>
        <div className="modal-actions">
          <button className="secondary-button" type="button" onClick={onClose}>ปิด</button>
          <button className="primary-button" type="button" onClick={onOpenQr}>ไปหน้า QR ของฉัน</button>
        </div>
      </section>
    </div>
  );
}
