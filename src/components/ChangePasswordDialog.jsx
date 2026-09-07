import React, { useEffect, useState } from "react";
import { KeyIcon, LockIcon, XIcon } from "./Icons";

export default function ChangePasswordDialog({ onChangePassword, onClose }) {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    function closeOnEscape(event) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  async function submit(event) {
    event.preventDefault();
    setError("");
    setMessage("");
    if (password.length < 8) return setError("รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร");
    if (password !== confirmation) return setError("รหัสผ่านทั้งสองช่องไม่ตรงกัน");
    setLoading(true);
    try {
      setMessage(await onChangePassword(password));
      setPassword("");
      setConfirmation("");
    } catch (nextError) {
      setError(nextError.message || "ไม่สามารถเปลี่ยนรหัสผ่านได้");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="modal-card password-modal" role="dialog" aria-modal="true" aria-labelledby="change-password-title">
        <button className="modal-close" type="button" onClick={onClose} aria-label="ปิดหน้าต่างเปลี่ยนรหัสผ่าน"><XIcon size={20} /></button>
        <span className="modal-icon"><KeyIcon size={26} /></span>
        <h2 id="change-password-title">เปลี่ยนรหัสผ่าน</h2>
        <p>บัญชีที่เข้าสู่ระบบอยู่สามารถตั้งรหัสผ่านใหม่ได้ทันที โดยไม่ต้องรออีเมล</p>
        <form onSubmit={submit}>
          <label>รหัสผ่านใหม่<div className="input-wrap"><LockIcon size={20} /><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" required /></div></label>
          <label>ยืนยันรหัสผ่านใหม่<div className="input-wrap"><LockIcon size={20} /><input type="password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="new-password" required /></div></label>
          {error && <div className="form-error" role="alert">{error}</div>}
          {message && <div className="form-success" role="status">{message}</div>}
          <div className="modal-actions"><button className="secondary-button" type="button" onClick={onClose}>ยกเลิก</button><button className="primary-button" type="submit" disabled={loading}>{loading ? "กำลังบันทึก…" : "เปลี่ยนรหัสผ่าน"}</button></div>
        </form>
      </section>
    </div>
  );
}
