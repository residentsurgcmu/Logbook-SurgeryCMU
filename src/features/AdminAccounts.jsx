import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  listAdminAccounts, listAdminAccountEvents, previewAdminAccountAction,
  updateAdminAccount, setAdminAccountActive, listAdminInviteStates, resendAccountInvite,
} from "../residentApi";
import {
  ACCOUNT_ROLE_LABELS, accountDraft, accountEditPlan, accountErrorCode,
  accountErrorMessage, accountEventSummary, accountStatusReason, prepareAccountAttempt,
} from "../adminAccounts.js";
import { inviteState } from "../adminInviteState.js";
import "./AdminAccounts.css";

const liveApi = { listAdminAccounts, listAdminAccountEvents, previewAdminAccountAction, updateAdminAccount, setAdminAccountActive, listAdminInviteStates, resendAccountInvite };
const detail = (account) => account.role === "resident" ? `PGY ${account.pgy ?? "—"}` : account.role === "staff" ? account.unit_name || "ไม่ระบุหน่วย" : account.admin_tag || "ไม่ระบุป้าย";
const sortColumns = [
  { key: "name", label: "บัญชี", value: (account) => account.full_name || account.email },
  { key: "detail", label: "ชั้นปี / หน่วย / ป้าย", value: (account) => account.role === "resident" ? (account.pgy == null ? null : `PGY ${account.pgy}`) : account.role === "staff" ? account.unit_name : account.admin_tag },
  { key: "status", label: "สิทธิ์บัญชี / คำเชิญ", value: (account, state) => `${account.active ? 1 : 2} ${inviteState(state).label}` },
];
const accountCollator = new Intl.Collator(["th", "en"], { numeric: true, sensitivity: "base" });
const sortDirectionLabel = { ascending: "จากน้อยไปมาก", descending: "จากมากไปน้อย" };

const displayValue = (value) => value === true ? "ใช้งาน" : value === false ? "ปิดใช้งาน" : value == null || value === "" ? "ไม่ระบุ" : String(value);
const dateTime = (value) => new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Bangkok" }).format(new Date(value));
const fieldLabels = { full_name: "ชื่อ", pgy: "PGY", unit_name: "หน่วย", admin_tag: "ป้าย Admin", active: "สถานะ" };

function AccountState({ account }) {
  return <span className={`account-state${account.active ? "" : " inactive"}`}>{account.active ? "มีสิทธิ์ใช้งาน" : "ปิดสิทธิ์ใช้งาน"}</span>;
}
function AccountIdentity({ account, self }) {
  return <div className="account-identity"><span className="account-initials" aria-hidden="true">{Array.from(account.full_name || "?").slice(0,2).join("")}</span><div><strong>{account.full_name}</strong><small>{ACCOUNT_ROLE_LABELS[account.role] || "—"}{account.role === "resident" ? ` · ${detail(account)}` : ""}{self ? " · บัญชีของคุณ" : ""}</small></div></div>;
}
function AccountHistory({ userId, api }) {
  const [open, setOpen] = useState(false);
  const [events, setEvents] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!open) return;
    let current = true;
    setLoading(true); setError("");
    api.listAdminAccountEvents(userId).then((rows) => { if (current) setEvents(rows); })
      .catch((nextError) => { if (current) setError(accountErrorMessage(nextError)); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [open, userId, api, retry]);
  return <section className="account-history" aria-label="ประวัติการเปลี่ยนแปลงบัญชี">
    <button type="button" className="text-button" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? "ซ่อนประวัติ" : "ดูประวัติการเปลี่ยนแปลง"}</button>
    {open && <div aria-live="polite">
      {loading ? <p>กำลังโหลดประวัติ…</p> : error ? <><p className="form-error" role="alert">{error}</p><button type="button" className="secondary-button" onClick={() => setRetry(retry + 1)}>ลองโหลดประวัติใหม่</button></> : !events.length ? <p>ยังไม่มีประวัติการเปลี่ยนแปลง</p> : <ol>{events.map((event) => <li key={event.id}>
        <strong>{accountEventSummary(event)}</strong><p>{dateTime(event.created_at)} · {event.actor_name || "Admin"}</p>
        {Object.entries(event.changes || {}).filter(([key]) => fieldLabels[key]).map(([key, values]) => <p key={key}>{fieldLabels[key]}: {displayValue(values?.before)} → {displayValue(values?.after)}</p>)}
        {event.reason && <p className="account-reason-text">เหตุผล: {event.reason}</p>}
        {Array.isArray(event.side_effects?.cancelled_request_ids) && <p>ยกเลิกคำขอ {event.side_effects.cancelled_request_ids.length} รายการ</p>}
      </li>)}</ol>}
    </div>}
  </section>;
}

export default function AdminAccounts({ userId, onRefresh, refreshKey, api = liveApi }) {
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState("");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState(null);
  const [role, setRole] = useState("");
  const [status, setStatus] = useState("");
  const [onboarding, setOnboarding] = useState("");
  const [invites, setInvites] = useState({});
  const [inviteError, setInviteError] = useState("");
  const [resendTarget, setResendTarget] = useState(null);
  const [resending, setResending] = useState(false);
  const [resendFeedback, setResendFeedback] = useState(null);
  const sending = useRef(false);
  const resendConfirmation = useRef(null);
  const [selected, setSelected] = useState(null);
  const [view, setView] = useState("list");
  const [draft, setDraft] = useState(null);
  const [reason, setReason] = useState("");
  const [preview, setPreview] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [error, setError] = useState(null);
  const [validation, setValidation] = useState({});
  const [success, setSuccess] = useState("");
  const [refreshWarning, setRefreshWarning] = useState("");
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const mounted = useRef(false);
  const listSequence = useRef(0);
  const previewSequence = useRef(0);
  const writing = useRef(false);
  const attempt = useRef(null);
  const fields = useRef({});
  const section = useRef(null);

  async function reloadAccounts() {
    const sequence = ++listSequence.current;
    setLoading(true); setListError(""); setInviteError("");
    try {
      const rows = await api.listAdminAccounts();
      if (mounted.current && sequence === listSequence.current) setAccounts(rows);
      if (api.listAdminInviteStates) {
        try {
          const states = await api.listAdminInviteStates(rows.map((row) => row.user_id));
          if (mounted.current && sequence === listSequence.current)
            setInvites(Object.fromEntries(states.map((state) => [state.user_id, state])));
        } catch {
          if (mounted.current && sequence === listSequence.current) {
            setInvites({});
            setInviteError("โหลดสถานะคำเชิญไม่ได้ กรุณาโหลดรายชื่อใหม่");
          }
        }
      }
      return rows;
    } catch (nextError) {
      if (mounted.current && sequence === listSequence.current) setListError(accountErrorMessage(nextError));
      throw nextError;
    } finally {
      if (mounted.current && sequence === listSequence.current) setLoading(false);
    }
  }
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; listSequence.current++; previewSequence.current++; }; }, []);
  useEffect(() => { reloadAccounts().catch(() => {}); }, [api, refreshKey]);
  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("th");
    const rows = accounts.filter((account) => (!role || account.role === role) &&
      (!status || String(account.active) === status) &&
      (!onboarding || inviteState(invites[account.user_id]).key === onboarding) &&
      `${account.full_name} ${account.email}`.toLocaleLowerCase("th").includes(query));
    if (!sort) return rows;
    const { value } = sortColumns.find(({ key }) => key === sort.key);
    return rows.sort((left, right) => {
      const a = value(left, invites[left.user_id]);
      const b = value(right, invites[right.user_id]);
      if (Boolean(a) !== Boolean(b)) return a ? -1 : 1;
      const order = accountCollator.compare(a ?? "", b ?? "");
      return (sort.direction === "descending" ? -order : order) ||
        accountCollator.compare(left.full_name, right.full_name) ||
        accountCollator.compare(left.email, right.email);
    });
  }, [accounts, role, status, search, onboarding, invites, sort]);

  function toggleSort(key) {
    setSort((current) => ({
      key,
      direction: current?.key === key && current.direction === "ascending" ? "descending" : "ascending",
    }));
  }
  const editPlan = selected && draft ? accountEditPlan(selected, draft) : null;
  const mustReload = ["ACCOUNT_CONFLICT", "PREVIEW_CHANGED", "ROLE_RULE"].includes(error?.code);
  const blocked = busy || uncertain || mustReload;
  const isSelf = (account) => account.is_self || account.user_id === userId;
  function focusSection() { section.current?.scrollIntoView({ block: "start", behavior: "auto" }); }
  function back() {
    if (writing.current) return;
    previewSequence.current++; setView("list"); setSelected(null); setDraft(null); setPreview(null);
    setError(null); setValidation({}); setUncertain(false); attempt.current = null; focusSection();
  }
  function beginEdit(account) {
    previewSequence.current++; setSelected({ ...account }); setDraft(accountDraft(account)); setView("edit");
    setPreview(null); setError(null); setValidation({}); setSuccess(""); setUncertain(false); attempt.current = null; focusSection();
  }
  async function fetchPreview(account, action) {
    const sequence = ++previewSequence.current;
    setPreviewLoading(true); setPreview(null);
    try {
      const next = await api.previewAdminAccountAction(account.user_id, action);
      if (mounted.current && sequence === previewSequence.current) setPreview(next);
    } catch (nextError) {
      if (mounted.current && sequence === previewSequence.current) setError({ code: accountErrorCode(nextError), message: accountErrorMessage(nextError) });
    } finally {
      if (mounted.current && sequence === previewSequence.current) setPreviewLoading(false);
    }
  }
  function beginStatus(account) {
    if (isSelf(account)) return;
    setSelected({ ...account }); setView("status"); setReason(""); setError(null); setValidation({});
    setSuccess(""); setUncertain(false); attempt.current = null; focusSection();
    fetchPreview(account, account.active ? "deactivate" : "reactivate");
  }
  async function inspectLatest() {
    if (writing.current) return;
    try {
      const rows = await reloadAccounts();
      if (!mounted.current) return;
      if (uncertain) { back(); setSuccess("โหลดข้อมูลล่าสุดแล้ว กรุณาตรวจสถานะและประวัติของบัญชีก่อนทำรายการใหม่"); return; }
      const latest = rows.find((account) => account.user_id === selected?.user_id);
      if (!latest) { back(); return; }
      if (view === "edit") { beginEdit(latest); return; }
      if (latest.active !== selected.active) { back(); setSuccess("สถานะบัญชีเปลี่ยนแล้ว กรุณาตรวจรายชื่อและประวัติล่าสุด"); return; }
      setSelected(latest); setError(null); attempt.current = null;
      await fetchPreview(latest, latest.active ? "deactivate" : "reactivate");
    } catch { setError({ code: "", message: "โหลดข้อมูลล่าสุดไม่สำเร็จ ยังไม่ได้ยืนยันรายการใหม่ กรุณาลองอีกครั้ง" }); }
  }
  async function runWrite(kind, payload) {
    if (writing.current) return;
    writing.current = true; setBusy(true); setError(null);
    try {
      attempt.current = prepareAccountAttempt(attempt.current, kind, payload);
      const args = { ...attempt.current.payload, requestId: attempt.current.requestId };
      const result = await (kind === "edit" ? api.updateAdminAccount(args) : api.setAdminAccountActive(args));
      if (!mounted.current) return;
      const name = kind === "edit" ? payload.changes.full_name || selected.full_name : selected.full_name;
      attempt.current = null; setUncertain(false); setView("list"); setSelected(null); setDraft(null); setPreview(null);
      setSuccess(kind === "edit" ? `บันทึกข้อมูล ${name} แล้ว` : `${payload.active ? "เปิด" : "ปิด"}ใช้งาน ${name} แล้ว${!payload.active ? ` · ยกเลิกคำขอ ${result.cancelled_requests ?? 0} รายการ` : ""}`);
      setRefreshWarning(""); focusSection();
      // A committed write stays successful even if reloading another workspace panel fails.
      await reloadAccounts().catch(() => {});
      try { await onRefresh?.(); } catch { if (mounted.current) setRefreshWarning("บันทึกสำเร็จแล้ว แต่บางส่วนยังโหลดไม่ครบ กรุณาโหลดหน้าใหม่ก่อนทำรายการต่อ"); }
    } catch (nextError) {
      if (!mounted.current) return;
      const code = accountErrorCode(nextError);
      const definitive = Boolean(code) || /Active Admin|Admin role required|Account was not found|INVALID_INPUT|JWT|session expired|permission denied/i.test(nextError?.message || "");
      setUncertain(!definitive);
      if (definitive) attempt.current = null;
      setError({ code, message: definitive ? accountErrorMessage(nextError) : "ยังยืนยันผลการบันทึกไม่ได้ อาจบันทึกสำเร็จแล้ว ลองคำขอเดิมอีกครั้งหรือตรวจข้อมูลล่าสุดก่อนทำรายการใหม่" });
    } finally { writing.current = false; if (mounted.current) setBusy(false); }
  }
  function saveEdit(event) {
    event.preventDefault(); if (writing.current || mustReload) return;
    if (uncertain && attempt.current) { runWrite(attempt.current.kind, attempt.current.payload); return; }
    if (!editPlan.valid) { setValidation(editPlan.errors); fields.current[Object.keys(editPlan.errors)[0]]?.focus(); return; }
    if (!editPlan.changed) { setValidation({ general: "ยังไม่มีข้อมูลที่เปลี่ยนแปลง กรุณาแก้ข้อมูลก่อนบันทึก" }); return; }
    setValidation({}); runWrite("edit", { userId: selected.user_id, updatedAt: selected.updated_at, changes: editPlan.changes, reason: editPlan.reason });
  }
  function saveStatus(event) {
    event.preventDefault(); if (writing.current || mustReload) return;
    if (uncertain && attempt.current) { runWrite(attempt.current.kind, attempt.current.payload); return; }
    if (!preview || previewLoading || preview.blockers.length) return;
    const reasonError = accountStatusReason(reason);
    if (reasonError) { setValidation({ reason: reasonError }); fields.current.reason?.focus(); return; }
    setValidation({}); runWrite("status", { userId: selected.user_id, active: preview.action === "reactivate", updatedAt: preview.updated_at, reason: reason.trim(), previewCounts: preview.preview_counts || null });
  }
  function updateDraft(key, value) { setDraft((current) => ({ ...current, [key]: value })); setValidation({}); }
  const errorBox = error && <div className="account-error" role="alert"><p>{error.message}</p>{(mustReload || uncertain || !preview && view === "status") && <button type="button" className="secondary-button" disabled={busy || loading || previewLoading} onClick={inspectLatest}>{view === "status" && !uncertain ? "ตรวจผลกระทบล่าสุด" : "โหลดข้อมูลล่าสุด"}</button>}</div>;
  async function confirmResend() {
    if (!resendTarget || sending.current) return;
    sending.current = true;
    setResending(true); setResendFeedback(null);
    try {
      await api.resendAccountInvite(resendTarget.user_id);
      if (mounted.current) setResendFeedback({ message: `ส่งลิงก์ตั้งรหัสผ่านให้ ${resendTarget.email} แล้ว กรุณาให้ผู้รับตรวจ Inbox และ Junk` });
    } catch (nextError) {
      if (mounted.current) setResendFeedback({ error: true, message: nextError.message });
    } finally {
      if (mounted.current) {
        setResendTarget(null);
        await reloadAccounts().catch(() => {});
      }
      sending.current = false;
      if (mounted.current) setResending(false);
    }
  }
  useEffect(() => { if (resendTarget) resendConfirmation.current?.focus(); }, [resendTarget]);
  const showInviteStatus = (account) => {
    const row = invites[account.user_id];
    const state = inviteState(row);
    return <div className="account-invite-state"><span>{state.label}</span>{(row?.activated_at || row?.sent_at) && <small>{row.activated_at ? "เข้าใช้ครั้งแรกที่บันทึก" : "ส่งคำเชิญล่าสุด"} · {dateTime(row.activated_at || row.sent_at)}</small>}</div>;
  };
  const accountActions = (account) => <div className="account-actions"><button type="button" className="text-button" disabled={loading || Boolean(listError)} onClick={() => beginEdit(account)} aria-label={`แก้ไข ${account.full_name}`}>แก้ไข</button>{isSelf(account) ? <button type="button" className="secondary-button" disabled>บัญชีของคุณ</button> : <button type="button" className="secondary-button" disabled={loading || Boolean(listError)} onClick={() => beginStatus(account)} aria-label={`${account.active ? "ปิด" : "เปิด"}ใช้งาน ${account.full_name}`}>{account.active ? "ปิดใช้งาน" : "เปิดกลับ"}</button>}
    {account.active && !isSelf(account) && inviteState(invites[account.user_id]).resend && <button type="button" className="text-button" disabled={loading || resending || Boolean(listError)} onClick={() => { setResendTarget(account); setResendFeedback(null); focusSection(); }} aria-label={`ส่งอีเมลซ้ำให้ ${account.full_name}`}>ส่งอีเมลซ้ำ</button>}</div>;
  const validationText = (key) => validation[key] && <span className="form-error" role="alert" id={`account-error-${key}`}>{validation[key]}</span>;
  const fieldProps = (key) => ({ ref: (node) => { fields.current[key] = node; }, "aria-invalid": Boolean(validation[key]), "aria-describedby": validation[key] ? `account-error-${key}` : undefined });

  return <section ref={section} className="admin-accounts" aria-label="จัดการบัญชีผู้ใช้">
    {success && <p className="account-success" role="status">{success}</p>}
    {refreshWarning && <p className="account-notice warning" role="alert">{refreshWarning}</p>}
    {view === "list" ? <section className="resident-panel account-list-panel">
      <div className="account-heading"><div><h2>จัดการบัญชี</h2><p>แก้ไขข้อมูล และดูแลสถานะการใช้งานของบัญชี</p></div><button type="button" className="secondary-button" disabled={loading} onClick={() => reloadAccounts().catch(() => {})}>{loading ? "กำลังโหลด…" : "โหลดรายชื่อใหม่"}</button></div>
      <p className="account-counts">{accounts.length} บัญชีทั้งหมด · ใช้งาน {accounts.filter((account) => account.active).length} · ปิดใช้งาน {accounts.filter((account) => !account.active).length}</p>
      <div className="account-filters"><label>ค้นหาบัญชี<input type="search" placeholder="ชื่อหรืออีเมล" value={search} onChange={(event) => setSearch(event.target.value)} /></label><label>บทบาท<select value={role} onChange={(event) => setRole(event.target.value)}><option value="">ทุกบทบาท</option>{Object.entries(ACCOUNT_ROLE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>สิทธิ์บัญชี<select value={status} onChange={(event) => setStatus(event.target.value)}><option value="">ทุกสถานะ</option><option value="true">ใช้งาน</option><option value="false">ปิดสิทธิ์</option></select></label>
      <label>คำเชิญและการเข้าใช้งาน<select value={onboarding} onChange={(event) => setOnboarding(event.target.value)}><option value="">ทุกสถานะคำเชิญ</option><option value="activated">เปิดใช้งานแล้ว</option><option value="sent">ส่งคำเชิญแล้ว</option><option value="failed">ส่งไม่สำเร็จ</option><option value="pending">ไม่มีประวัติการส่ง</option><option value="unknown">ยังไม่ยืนยัน</option></select></label></div>
      <p className="account-hint">“เปิดใช้งานแล้ว” ขึ้นเมื่อผู้ใช้เข้า Resident Corner ด้วยรหัสผ่าน “ส่งคำเชิญแล้ว” ยังยืนยันการเข้า Inbox ไม่ได้</p>
      {inviteError && <p className="form-error" role="alert">{inviteError}</p>}
      {resendTarget && <div className="account-notice" ref={resendConfirmation} tabIndex={-1}><strong>ส่งลิงก์ตั้งรหัสผ่านใหม่ไปที่ {resendTarget.email}?</strong><div className="account-actions"><button type="button" className="secondary-button" disabled={resending} onClick={() => setResendTarget(null)}>ยกเลิก</button><button type="button" className="primary-button" disabled={resending} onClick={confirmResend}>{resending ? "กำลังส่ง…" : "ยืนยันส่งอีเมลซ้ำ"}</button></div></div>}
      {resendFeedback && <p className={resendFeedback.error ? "form-error" : "form-success"} role={resendFeedback.error ? "alert" : "status"}>{resendFeedback.message}</p>}
      {listError && <p className="form-error" role="alert">{listError} กรุณาโหลดรายชื่อใหม่ก่อนทำรายการ</p>}
      {loading && <p role="status">กำลังโหลดบัญชี…</p>}
      {!loading && !listError && !filtered.length && <p className="account-empty">ไม่พบบัญชีที่ตรงกับการค้นหา</p>}
      <div className="account-mobile-sort">
        <label>เรียงตาม<select value={sort ? `${sort.key}:${sort.direction}` : ""} onChange={(event) => {
          const [key, direction] = event.target.value.split(":");
          setSort(key ? { key, direction } : null);
        }}>
          <option value="">ลำดับเดิม</option>
          {sortColumns.flatMap(({ key, label }) => Object.entries(sortDirectionLabel).map(([direction, text]) =>
            <option key={`${key}:${direction}`} value={`${key}:${direction}`}>{label} · {text}</option>
          ))}
        </select></label>
      </div>
      <div className="account-table"><table><thead><tr>
        {sortColumns.map(({ key, label }) => {
          const direction = sort?.key === key ? sort.direction : undefined;
          const next = direction === "ascending" ? "descending" : "ascending";
          return <th key={key} scope="col" aria-sort={direction}>
            <button type="button" className="account-sort-button" onClick={() => toggleSort(key)}
              aria-label={`เรียง ${label} ${sortDirectionLabel[next]}`}>
              <span>{label}</span><span aria-hidden="true">{direction === "ascending" ? "↑" : direction === "descending" ? "↓" : "↕"}</span>
            </button>
          </th>;
        })}
        <th scope="col">จัดการ</th>
      </tr></thead><tbody>{filtered.map((account) => <tr key={account.user_id}><td><AccountIdentity account={account} self={isSelf(account)} /><span className="account-email">{account.email}</span></td><td>{detail(account)}</td><td><AccountState account={account} />{showInviteStatus(account)}</td><td>{accountActions(account)}</td></tr>)}</tbody></table></div>
      <div className="account-cards">{filtered.map((account) => <article key={account.user_id}><div className="account-card-heading"><AccountIdentity account={account} self={isSelf(account)} /><AccountState account={account} /></div><p className="account-email">{account.email}</p>{account.role !== "resident" && <p>{detail(account)}</p>}{showInviteStatus(account)}{accountActions(account)}</article>)}</div>
      <p className="account-foot" aria-live="polite">แสดง {filtered.length} จาก {accounts.length} บัญชี</p>
    </section> : <>
      <button type="button" className="text-button account-back" disabled={busy || uncertain} onClick={back}>← รายชื่อบัญชี</button>
      {view === "edit" ? <section className="resident-panel account-edit-panel"><h2>แก้ไขข้อมูลบัญชี</h2><div className="account-card-heading"><AccountIdentity account={selected} self={isSelf(selected)} /><AccountState account={selected} /></div><p className="account-email">อีเมล: {selected.email}</p>
        <form onSubmit={saveEdit} noValidate>
          <fieldset disabled={blocked}><legend className="visually-hidden">ข้อมูลบัญชี</legend><div className="account-form-grid">
            <label className="wide">ชื่อ *<input {...fieldProps("full_name")} value={draft.full_name} maxLength={160} required onChange={(event) => updateDraft("full_name", event.target.value)} />{validationText("full_name")}</label>
            {selected.role === "resident" && <label>ชั้นปี (PGY)<select {...fieldProps("pgy")} value={draft.pgy} onChange={(event) => updateDraft("pgy", event.target.value)}><option value="">เลือก PGY</option>{[1,2,3,4].map((year) => <option key={year} value={year}>PGY {year}</option>)}</select>{validationText("pgy")}</label>}
            {selected.role === "staff" && <label className="wide">หน่วย<input {...fieldProps("unit_name")} value={draft.unit_name} maxLength={80} onChange={(event) => updateDraft("unit_name", event.target.value)} /><small>ชื่อและหน่วยจะเปลี่ยนในรายชื่อ Staff ด้วย</small>{validationText("unit_name")}</label>}
            {selected.role === "admin" && <label className="wide">ป้าย Admin<input {...fieldProps("admin_tag")} value={draft.admin_tag} maxLength={40} list="account-admin-tags" onChange={(event) => updateDraft("admin_tag", event.target.value)} /><datalist id="account-admin-tags"><option value="F" /><option value="N" /></datalist><small>เป็นป้ายกำกับ ไม่เพิ่มสิทธิ์การใช้งาน</small>{validationText("admin_tag")}</label>}
          </div>
          {Object.hasOwn(editPlan.changes, "pgy") && <p className="account-notice warning">PGY {selected.pgy} → PGY {draft.pgy}<br />รายงานเช็คชื่อจะใช้ PGY ใหม่ รวมถึงกิจกรรมที่ผ่านมา ผลสอบและผลประเมินเดิมไม่เปลี่ยน</p>}
          <label>{Object.hasOwn(editPlan.changes, "pgy") ? "เหตุผลที่เปลี่ยน PGY *" : "เหตุผลในการแก้ไข (ถ้ามี)"}<textarea {...fieldProps("reason")} value={draft.reason} maxLength={300} onChange={(event) => updateDraft("reason", event.target.value)} /><small>ไม่ใส่ข้อมูลผู้ป่วยหรือข้อมูลส่วนตัวที่ไม่จำเป็น</small>{validationText("reason")}</label></fieldset>
          {validationText("general")}{errorBox}
          <p className="account-hint" aria-live="polite">{uncertain ? "การลองอีกครั้งจะใช้คำขอเดิม เพื่อไม่บันทึกซ้ำ" : !editPlan.changed ? "แก้ไขข้อมูลที่ต้องการ แล้วกดบันทึก" : Object.hasOwn(editPlan.changes, "pgy") && !draft.reason.trim() ? "กรุณากรอกเหตุผลที่เปลี่ยน PGY ก่อนบันทึก" : "ตรวจข้อมูลก่อนบันทึก"}</p>
          <div className="account-form-actions"><button type="button" className="secondary-button" disabled={busy || uncertain} onClick={back}>ยกเลิก</button><button type="submit" className="primary-button" disabled={busy || mustReload}>{busy ? "กำลังบันทึก…" : uncertain ? "ลองบันทึกคำขอเดิมอีกครั้ง" : "บันทึกการแก้ไข"}</button></div>
        </form><AccountHistory key={selected.user_id} userId={selected.user_id} api={api} />
      </section> : <section className="resident-panel account-status-panel"><div className="account-card-heading"><AccountIdentity account={selected} /><AccountState account={selected} /></div><h2>{selected.active ? "ปิดใช้งาน" : "เปิดใช้งาน"} {selected.full_name}{selected.active ? "?" : " กลับ?"}</h2>
        {previewLoading && <p role="status">กำลังตรวจผลกระทบล่าสุด…</p>}
        {preview && <>
          {preview.action === "deactivate" ? <><p>บัญชีนี้จะใช้สิทธิ์ใน Resident Corner ไม่ได้</p><div className="account-impact"><div><strong>คำขอรอประเมิน {preview.pending_requests} รายการ</strong><p>คำขอที่เกี่ยวข้องจะถูกยกเลิก เปิดบัญชีกลับแล้วคำขอจะไม่กลับมา</p></div><span>ยกเลิกคำขอ</span></div>{preview.active_assignments > 0 && <div className="account-impact keep"><div><strong>งานมอบหมาย {preview.active_assignments} รายการ</strong><p>เก็บไว้ และกลับมาใช้สิทธิ์ได้เมื่อเปิดบัญชี</p></div><span>เก็บไว้</span></div>}<p className="account-notice">เก็บผลประเมิน ผลสอบ และประวัติเช็คชื่อเดิมไว้</p></> : <><p className="account-notice">บัญชีจะกลับมาใช้สิทธิ์ได้ งานมอบหมายเดิมกลับมาใช้งาน คำขอที่ยกเลิกจะยังคงยกเลิก</p>{selected.role === "resident" && <div className={`account-notice${preview.academic_year_warning ? " warning" : ""}`}><strong>ชั้นปีปัจจุบัน PGY {preview.pgy}</strong><p>{preview.academic_year_warning ? "บัญชีปิดข้ามปีการศึกษา กรุณาตรวจ PGY ให้ถูกต้องก่อนเปิดกลับ" : "ตรวจชั้นปีให้ถูกต้องก่อนเปิดกลับ"}</p><button type="button" className="text-button" disabled={busy || uncertain} onClick={() => beginEdit(selected)}>ตรวจและแก้ไข PGY</button></div>}</>}
          {preview.blockers.map((code) => <p className="form-error" role="alert" key={code}>{accountErrorMessage(code)}</p>)}
        </>}
        <form onSubmit={saveStatus} noValidate><fieldset disabled={blocked || previewLoading || !preview || Boolean(preview?.blockers.length)}><legend className="visually-hidden">เหตุผลในการเปลี่ยนสถานะ</legend><label>เหตุผลที่{selected.active ? "ปิด" : "เปิด"}ใช้งาน *<textarea {...fieldProps("reason")} value={reason} maxLength={300} onChange={(event) => { setReason(event.target.value); setValidation({}); }} /><small>ไม่ใส่ข้อมูลผู้ป่วยหรือข้อมูลส่วนตัวที่ไม่จำเป็น</small>{validationText("reason")}</label></fieldset>{errorBox}
          <div className="account-form-actions"><button type="button" className="secondary-button" disabled={busy || uncertain} onClick={back}>กลับไปก่อน</button><button type="submit" className={selected.active ? "account-danger-button" : "primary-button"} disabled={busy || mustReload || previewLoading || !preview || Boolean(preview?.blockers.length)}>{busy ? "กำลังบันทึก…" : uncertain ? "ลองคำขอเดิมอีกครั้ง" : `ยืนยัน${selected.active ? "ปิด" : "เปิด"}ใช้งาน`}</button></div>
        </form>
      </section>}
    </>}
  </section>;
}
