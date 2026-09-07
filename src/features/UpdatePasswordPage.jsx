import React, { useState } from "react";
import { KeyIcon, LockIcon } from "../components/Icons";

export default function UpdatePasswordPage({ onUpdate }) {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function submit(event) {
    event.preventDefault();
    setError("");
    if (password.length < 8) return setError("รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร");
    if (password !== confirmPassword) return setError("รหัสผ่านทั้งสองช่องไม่ตรงกัน");
    setLoading(true);
    try {
      await onUpdate(password);
    } catch (nextError) {
      setError(nextError.message || "ไม่สามารถเปลี่ยนรหัสผ่านได้ ลิงก์อาจหมดอายุ");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="password-page">
      <section className="password-card">
        <img src="/surgery-cmu-logo.png" alt="Surgery CMU" />
        <span className="password-icon"><KeyIcon size={28} /></span>
        <h1>ตั้งรหัสผ่านใหม่</h1>
        <p>กำหนดรหัสผ่านอย่างน้อย 8 ตัวอักษรสำหรับบัญชีของคุณ</p>
        <form onSubmit={submit}>
          <label>รหัสผ่านใหม่<div className="input-wrap"><LockIcon size={20} /><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" required /></div></label>
          <label>ยืนยันรหัสผ่านใหม่<div className="input-wrap"><LockIcon size={20} /><input type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} autoComplete="new-password" required /></div></label>
          {error && <div className="form-error" role="alert">{error}</div>}
          <button className="primary-button login-submit" type="submit" disabled={loading}>{loading ? "กำลังบันทึก…" : "เปลี่ยนรหัสผ่าน"}</button>
        </form>
      </section>
    </main>
  );
}
