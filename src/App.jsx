import React, { useEffect, useState } from "react";
import { onAuthChange, loadResidentWorkspace, signIn, signOut, updatePassword } from "./residentApi";
import ResidentPlatform from "./features/ResidentPlatform";

const hasPasswordSetupLink = () => {
  const queryType = new URLSearchParams(window.location.search).get("type");
  const hashType = new URLSearchParams(window.location.hash.replace(/^#/, "")).get("type");
  return [queryType, hashType].some((type) => type === "invite" || type === "recovery");
};

function Login({ onLogin, error }) {
  const [email, setEmail] = useState(""); const [password, setPassword] = useState(""); const [busy, setBusy] = useState(false); const [localError, setLocalError] = useState("");
  async function submit(event) { event.preventDefault(); setBusy(true); setLocalError(""); try { await onLogin({ email, password }); } catch (nextError) { setLocalError(nextError.message === "Invalid login credentials" ? "อีเมลหรือรหัสผ่านไม่ถูกต้อง" : nextError.message); } finally { setBusy(false); } }
  return <main className="resident-login"><section><img src="/surgery-cmu-logo.png" alt="Surgery CMU" /><h1>Resident Surgery Assessment</h1><p>ระบบประเมินแพทย์ประจำบ้านศัลยศาสตร์ด้วย EPA และ PBA</p><small>ใช้เฉพาะบัญชีที่ Admin ของภาควิชาสร้างให้</small></section><form onSubmit={submit}><h2>เข้าสู่ระบบ</h2><label>อีเมล<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required autoComplete="username" /></label><label>รหัสผ่าน<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required autoComplete="current-password" /></label>{(localError || error) && <p className="form-error">{localError || error}</p>}<button className="primary-button" disabled={busy}>{busy ? "กำลังเข้าสู่ระบบ…" : "เข้าสู่ระบบ"}</button></form></main>;
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
  const [workspace, setWorkspace] = useState(undefined); const [error, setError] = useState(""); const [needsPassword, setNeedsPassword] = useState(hasPasswordSetupLink);
  async function refresh() { setError(""); try { setWorkspace(await loadResidentWorkspace()); } catch (nextError) { setError(nextError.message || "ไม่สามารถเชื่อมต่อระบบได้"); setWorkspace(null); } }
  useEffect(() => { refresh(); const { data: listener } = onAuthChange((event, session) => { if (event === "PASSWORD_RECOVERY" || hasPasswordSetupLink()) setNeedsPassword(true); if (session) refresh(); else setWorkspace(null); }); return () => listener.subscription.unsubscribe(); }, []);
  if (workspace === undefined) return <div className="resident-loading">กำลังเชื่อมต่อ Resident Surgery Assessment…</div>;
  if (needsPassword && workspace && !workspace.unauthorized) return <PasswordSetup onSave={async (password) => { await updatePassword(password); window.history.replaceState({}, document.title, window.location.pathname); setNeedsPassword(false); await refresh(); }} />;
  if (!workspace || workspace.unauthorized) return <Login error={workspace?.unauthorized ? "บัญชีนี้ยังไม่ได้รับสิทธิ์ในระบบ Resident Surgery Assessment" : error} onLogin={async (credentials) => { await signIn(credentials); await refresh(); }} />;
  return <ResidentPlatform workspace={workspace} onRefresh={refresh} onLogout={async () => { await signOut(); setWorkspace(null); }} />;
}
