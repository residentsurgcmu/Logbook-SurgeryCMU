import React, { useEffect, useState } from "react";
import { onAuthChange, loadResidentWorkspace, signIn, signOut } from "./residentApi";
import ResidentPlatform from "./features/ResidentPlatform";

function Login({ onLogin, error }) {
  const [email, setEmail] = useState(""); const [password, setPassword] = useState(""); const [busy, setBusy] = useState(false); const [localError, setLocalError] = useState("");
  async function submit(event) { event.preventDefault(); setBusy(true); setLocalError(""); try { await onLogin({ email, password }); } catch (nextError) { setLocalError(nextError.message === "Invalid login credentials" ? "อีเมลหรือรหัสผ่านไม่ถูกต้อง" : nextError.message); } finally { setBusy(false); } }
  return <main className="resident-login"><section><img src="/surgery-cmu-logo.png" alt="Surgery CMU" /><h1>Resident Surgery Assessment</h1><p>ระบบประเมินแพทย์ประจำบ้านศัลยศาสตร์ด้วย EPA และ PBA</p><small>ใช้เฉพาะบัญชีที่ Admin ของภาควิชาสร้างให้</small></section><form onSubmit={submit}><h2>เข้าสู่ระบบ</h2><label>อีเมล<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required autoComplete="username" /></label><label>รหัสผ่าน<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required autoComplete="current-password" /></label>{(localError || error) && <p className="form-error">{localError || error}</p>}<button className="primary-button" disabled={busy}>{busy ? "กำลังเข้าสู่ระบบ…" : "เข้าสู่ระบบ"}</button></form></main>;
}

export default function App() {
  const [workspace, setWorkspace] = useState(undefined); const [error, setError] = useState("");
  async function refresh() { setError(""); try { setWorkspace(await loadResidentWorkspace()); } catch (nextError) { setError(nextError.message || "ไม่สามารถเชื่อมต่อระบบได้"); setWorkspace(null); } }
  useEffect(() => { refresh(); const { data: listener } = onAuthChange((_event, session) => { if (!session) setWorkspace(null); }); return () => listener.subscription.unsubscribe(); }, []);
  if (workspace === undefined) return <div className="resident-loading">กำลังเชื่อมต่อ Resident Surgery Assessment…</div>;
  if (!workspace || workspace.unauthorized) return <Login error={workspace?.unauthorized ? "บัญชีนี้ยังไม่ได้รับสิทธิ์ในระบบ Resident Surgery Assessment" : error} onLogin={async (credentials) => { await signIn(credentials); await refresh(); }} />;
  return <ResidentPlatform workspace={workspace} onRefresh={refresh} onLogout={async () => { await signOut(); setWorkspace(null); }} />;
}
