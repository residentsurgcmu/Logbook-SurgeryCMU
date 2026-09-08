import React, { useEffect, useState } from "react";
import { onAuthChange, loadResidentWorkspace, requestPasswordReset, signIn, signOut, updatePassword } from "./residentApi";
import ResidentPlatform from "./features/ResidentPlatform";
import { isPasswordSetupRoute, residentRoleLabels, residentRoles } from "./residentAuth";

function Login({ onLogin, onRequestReset, error, initialMessage }) {
  const [role, setRole] = useState("resident"); const [email, setEmail] = useState(""); const [password, setPassword] = useState(""); const [mode, setMode] = useState("login"); const [busy, setBusy] = useState(false); const [localError, setLocalError] = useState(""); const [message, setMessage] = useState(initialMessage || "");
  async function submit(event) {
    event.preventDefault(); setBusy(true); setLocalError(""); setMessage("");
    try {
      if (mode === "reset") setMessage(await onRequestReset(email));
      else await onLogin({ email, password, role });
    } catch (nextError) { setLocalError(nextError.message === "Invalid login credentials" ? "อีเมลหรือรหัสผ่านไม่ถูกต้อง" : nextError.message); } finally { setBusy(false); }
  }
  return <main className="resident-login"><section><img src="/surgery-cmu-logo.png" alt="Surgery CMU" /><h1>Resident Surgery Assessment</h1><p>ระบบประเมินแพทย์ประจำบ้านศัลยศาสตร์ด้วย EPA และ PBA</p><small>ใช้เฉพาะบัญชีที่ Admin ของภาควิชาสร้างหรือเชิญให้</small></section><form onSubmit={submit}><h2>{mode === "reset" ? "ลืมรหัสผ่าน" : `เข้าสู่ระบบ ${residentRoleLabels[role]}`}</h2>{mode === "login" && <fieldset className="resident-role-selector"><legend>บทบาทผู้ใช้งาน</legend><div>{residentRoles.map((item) => <button key={item} type="button" className={role === item ? "active" : ""} onClick={() => { setRole(item); setLocalError(""); }}>{residentRoleLabels[item]}</button>)}</div></fieldset>}<label>อีเมล<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required autoComplete="username" /></label>{mode === "login" && <label>รหัสผ่าน<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required autoComplete="current-password" /></label>}{mode === "login" && <button className="forgot-password-button" type="button" onClick={() => { setMode("reset"); setLocalError(""); setMessage(""); }}>ลืมรหัสผ่าน?</button>}{localError && <p className="form-error">{localError || error}</p>}{!localError && error && <p className="form-error">{error}</p>}{message && <p className="form-success">{message}</p>}<button className="primary-button" disabled={busy}>{busy ? "กำลังดำเนินการ…" : mode === "reset" ? "ส่งลิงก์ตั้งรหัสผ่านใหม่" : "เข้าสู่ระบบ"}</button>{mode === "reset" && <button className="login-mode-button" type="button" onClick={() => { setMode("login"); setLocalError(""); setMessage(""); }}>กลับไปเข้าสู่ระบบ</button>}</form></main>;
}

function PasswordSetup({ onSave }) {
  const [password, setPassword] = useState(""); const [confirmPassword, setConfirmPassword] = useState(""); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  async function submit(event) {
    event.preventDefault(); setError("");
    if (password.length < 8) return setError("รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร");
    if (password !== confirmPassword) return setError("รหัสผ่านทั้งสองช่องไม่ตรงกัน");
    setBusy(true); try { await onSave(password); } catch (nextError) { setError(nextError.message || "ไม่สามารถตั้งรหัสผ่านได้"); } finally { setBusy(false); }
  }
  return <main className="resident-login"><section><img src="/surgery-cmu-logo.png" alt="Surgery CMU" /><h1>ตั้งรหัสผ่าน</h1><p>สร้างรหัสผ่านสำหรับบัญชี Resident Surgery Assessment</p><small>ลิงก์นี้ใช้สำหรับบัญชีที่ได้รับคำเชิญหรือขอรีเซ็ตรหัสผ่าน</small></section><form onSubmit={submit}><h2>ตั้งรหัสผ่านใหม่</h2><label>รหัสผ่านใหม่<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required minLength={8} autoComplete="new-password" /></label><label>ยืนยันรหัสผ่าน<input type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required minLength={8} autoComplete="new-password" /></label>{error && <p className="form-error">{error}</p>}<button className="primary-button" disabled={busy}>{busy ? "กำลังบันทึก…" : "บันทึกรหัสผ่าน"}</button></form></main>;
}

export default function App() {
  const [workspace, setWorkspace] = useState(undefined); const [error, setError] = useState(""); const [authMessage, setAuthMessage] = useState(""); const [needsPassword, setNeedsPassword] = useState(() => isPasswordSetupRoute(window.location));
  async function refresh() { setError(""); try { setWorkspace(await loadResidentWorkspace()); } catch (nextError) { setError(nextError.message || "ไม่สามารถเชื่อมต่อระบบได้"); setWorkspace(null); } }
  useEffect(() => { refresh(); const { data: listener } = onAuthChange((event, session) => { if (event === "PASSWORD_RECOVERY" || isPasswordSetupRoute(window.location)) setNeedsPassword(true); if (session) refresh(); else setWorkspace(null); }); return () => listener.subscription.unsubscribe(); }, []);
  if (workspace === undefined) return <div className="resident-loading">กำลังเชื่อมต่อ Resident Surgery Assessment…</div>;
  if (needsPassword && workspace && !workspace.unauthorized) return <PasswordSetup onSave={async (password) => { await updatePassword(password); await signOut(); window.history.replaceState({}, document.title, "/"); setNeedsPassword(false); setAuthMessage("ตั้งรหัสผ่านใหม่สำเร็จ กรุณาเข้าสู่ระบบอีกครั้ง"); setWorkspace(null); }} />;
  if (!workspace || workspace.unauthorized) return <Login initialMessage={authMessage} error={workspace?.unauthorized ? "บัญชีนี้ยังไม่ได้รับสิทธิ์ในระบบ Resident Surgery Assessment" : error} onLogin={async (credentials) => { setAuthMessage(""); await signIn(credentials); await refresh(); }} onRequestReset={requestPasswordReset} />;
  return <ResidentPlatform workspace={workspace} onRefresh={refresh} onLogout={async () => { await signOut(); setWorkspace(null); }} />;
}
