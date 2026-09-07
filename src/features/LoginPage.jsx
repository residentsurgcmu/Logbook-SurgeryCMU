import React, { useState } from "react";
import { LockIcon, MailIcon, UserIcon } from "../components/Icons";

export default function LoginPage({ onLogin, onActivate, onRequestReset, initialMessage = "" }) {
  const registerRole = new URLSearchParams(window.location.search).get("register");
  const invitedRole = ["staff", "student", "admin"].includes(registerRole) ? registerRole : null;
  const [role, setRole] = useState(invitedRole || "student");
  const [mode, setMode] = useState(invitedRole ? "activate" : "login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [studentCode, setStudentCode] = useState("");
  const [studentGroup, setStudentGroup] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState(initialMessage);
  const [loading, setLoading] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setLoading(true); setError(""); setMessage("");
    try {
      if (mode === "reset") {
        setMessage(await onRequestReset(email));
      } else if (mode === "activate") {
        if (password.length < 8) throw new Error("รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร");
        const nextMessage = await onActivate({ role, email, password, fullName, studentCode, studentGroup });
        setMessage(nextMessage);
      } else {
        await onLogin({ role, email, password });
      }
    } catch (nextError) {
      setError(nextError.message === "Invalid login credentials" ? "อีเมลหรือรหัสผ่านไม่ถูกต้อง" : nextError.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="login-page">
      <section className="login-brand">
        <img src="/surgery-cmu-logo.png" alt="Surgery CMU" />
        <h1>Surgery Logbook</h1>
        <h2>ระบบบันทึกการฝึกปฏิบัติงานนักศึกษาแพทย์</h2>
        <div className="brand-rule" />
        <p>บันทึกกิจกรรมตามสมุด Logbook ส่งให้อาจารย์ประเมินผ่าน QR และติดตามความครบถ้วนได้จากทุกอุปกรณ์</p>
      </section>
      <section className="login-panel" aria-labelledby="login-title">
        <div className="mobile-logo"><img src="/surgery-cmu-logo.png" alt="" /><span>Surgery Logbook</span></div>
        <h2 id="login-title">{mode === "login" ? "เข้าสู่ระบบ" : mode === "activate" ? "เปิดใช้งานครั้งแรก" : "ลืมรหัสผ่าน"}</h2>
        <form onSubmit={submit}>
          {mode !== "reset" && <fieldset>
            <legend>บทบาทผู้ใช้งาน</legend>
            <div className="role-selector">
              {["student", "staff", "admin"].map((item) => (
                <button type="button" key={item} className={role === item ? "active" : ""} onClick={() => { setRole(item); setError(""); }}>
                  <UserIcon size={22} /> {item === "admin" ? "Admin" : item === "staff" ? "Staff" : "Student"}
                </button>
              ))}
            </div>
          </fieldset>}
          {mode === "activate" && role === "student" && <>
            <label>ชื่อ–นามสกุล<div className="input-wrap"><UserIcon size={20} /><input type="text" value={fullName} onChange={(event) => setFullName(event.target.value)} autoComplete="name" required /></div></label>
            <label>รหัสนักศึกษา<div className="input-wrap"><UserIcon size={20} /><input type="text" inputMode="numeric" pattern="[0-9]{6,20}" value={studentCode} onChange={(event) => setStudentCode(event.target.value.replace(/\D/g, ""))} placeholder="ตัวเลข 6–20 หลัก" required /></div></label>
            <label>กลุ่มที่<div className="input-wrap"><UserIcon size={20} /><input type="text" inputMode="numeric" pattern="[0-9]{1,3}" value={studentGroup} onChange={(event) => setStudentGroup(event.target.value.replace(/\D/g, ""))} placeholder="เช่น 1" required /></div></label>
          </>}
          <label>อีเมล<div className="input-wrap"><MailIcon size={20} /><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="username" required /></div></label>
          {mode !== "reset" && <label>รหัสผ่าน<div className="input-wrap"><LockIcon size={20} /><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder={mode === "login" ? "รหัสผ่านของคุณ" : "ตั้งรหัสผ่านอย่างน้อย 8 ตัว"} autoComplete={mode === "login" ? "current-password" : "new-password"} required /></div></label>}
          {mode === "login" && <button className="forgot-password-button" type="button" onClick={() => { setMode("reset"); setError(""); setMessage(""); }}>ลืมรหัสผ่าน?</button>}
          {error && <div className="form-error" role="alert">{error}</div>}
          {message && <div className="form-success" role="status">{message}</div>}
          <button className="primary-button login-submit" type="submit" disabled={loading}>{loading ? "กำลังดำเนินการ…" : mode === "login" ? "เข้าสู่ระบบ" : mode === "activate" ? "สร้างบัญชี" : "ส่งลิงก์เปลี่ยนรหัสผ่าน"}</button>
          <button className="login-mode-button" type="button" onClick={() => { setMode(mode === "login" ? "activate" : "login"); setError(""); setMessage(""); }}>
            {mode === "login" ? "เข้าใช้งานครั้งแรก? เปิดใช้งานบัญชี" : "กลับไปเข้าสู่ระบบ"}
          </button>
          <p className="login-help">Student ลงทะเบียนด้วยอีเมลของตนเองได้และต้องยืนยันอีเมลก่อนใช้งาน ส่วนบัญชี Staff และ Admin ต้องอยู่ในรายชื่อที่ภาควิชาอนุมัติ</p>
        </form>
      </section>
    </main>
  );
}
