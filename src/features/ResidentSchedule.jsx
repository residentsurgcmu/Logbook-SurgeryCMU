import { SCHEDULE_TITLE } from "../embedLinkRules";
import React, { useCallback, useEffect, useState } from "react";
import { EMBED_LINKS, clearEmbedLink, embedAddressProblem, embedErrorMessage, embedHost, loadEmbedLinks, setEmbedLink } from "../residentEmbedLinks";

// Outside web pages shown inside this page. Everyone signed in can look; only an Admin sets
// the addresses. Nothing here talks to those sites except the browser frame itself.
const DUTY_TODAY = EMBED_LINKS.find((item) => item.key === "duty_today");

export default function ResidentSchedule({ user, onNavigate }) {
  const [links, setLinks] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [active, setActive] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [editing, setEditing] = useState(false);
  const isAdmin = user.role === "admin";

  const load = useCallback(async () => {
    try {
      const rows = await loadEmbedLinks();
      setLinks(rows);
      setActive((current) => current === DUTY_TODAY.key || rows.some((row) => row.link_key === current)
        ? current : EMBED_LINKS.find(({ key }) => rows.some((row) => row.link_key === key))?.key || DUTY_TODAY.key);
    } catch (nextError) {
      setError(embedErrorMessage(nextError));
      setLinks(null);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const current = (links || []).find((row) => row.link_key === active) || null;
  const tabs = EMBED_LINKS.filter(({ key }) => key === DUTY_TODAY.key || links?.some((row) => row.link_key === key));
  return (
    <section className="resident-panel sched">
      <div className="panel-title-row">
        <div><h2>{SCHEDULE_TITLE}</h2><p>ดูตารางจากเว็บภายนอกในหน้านี้ · ข้อมูลแสดงสดจากเว็บต้นทาง</p></div>
        {isAdmin && <button type="button" className="secondary-button" onClick={() => { setEditing((value) => !value); setNotice(""); }}>{editing ? "ปิดการตั้งค่า" : "ตั้งค่าที่อยู่"}</button>}
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      {notice && <p className="form-success" role="status">{notice}</p>}
      {links === null && !error && <p className="case-muted">กำลังโหลด…</p>}

      {isAdmin && editing && links && (
        <EmbedSettings links={links} onSaved={async (message) => { setNotice(message); setError(""); await load(); setReloadKey((n) => n + 1); }} onError={setError} />
      )}

      {links && (
        <>
          <div className="lib-chips" role="tablist" aria-label="เลือกตาราง">
            {tabs.map(({ key, label }) => (
              <button key={key} type="button" role="tab" aria-selected={active === key} className={active === key ? "active" : ""} onClick={() => setActive(key)}>{label}</button>
            ))}
          </div>
          {active === DUTY_TODAY.key && !current && (
            <div className="sched-empty" role="status">
              <strong>เวรวันนี้ · ยังไม่เปิดใช้งาน</strong>
              <p>{isAdmin ? 'ยังไม่ได้ตั้งค่าที่อยู่ กด "ตั้งค่าที่อยู่" แล้วกรอกช่อง "เวรวันนี้"' : "Admin ยังไม่ได้ตั้งค่าที่อยู่ของเวรวันนี้"}</p>
              <button type="button" className="secondary-button" onClick={() => onNavigate?.("home")}>กลับหน้าแรก</button>
            </div>
          )}
          {current && (
            <>
              <div className="sched-bar">
                <span className="case-muted">{embedHost(current.url)}</span>
                <div className="button-row">
                  <button type="button" className="secondary-button" onClick={() => setReloadKey((n) => n + 1)}>โหลดใหม่</button>
                  <a className="secondary-button" href={current.url} target="_blank" rel="noopener noreferrer">เปิดในแท็บใหม่</a>
                </div>
              </div>
              <div className="sched-frame">
                <iframe
                  key={`${current.link_key}-${reloadKey}-${current.url}`}
                  title={active === DUTY_TODAY.key ? DUTY_TODAY.defaultTitle : current.title}
                  src={current.url}
                  sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads allow-presentation"
                  allow="fullscreen"
                  referrerPolicy="strict-origin-when-cross-origin"
                />
              </div>
              <p className="case-muted">ถ้ากรอบว่างหรือขอให้ล็อกอิน กด "เปิดในแท็บใหม่" · ข้อมูลในกรอบมาจากเว็บภายนอก ไม่ได้ถูกเก็บในระบบนี้</p>
            </>
          )}
        </>
      )}
    </section>
  );
}

function EmbedSettings({ links, onSaved, onError }) {
  const [drafts, setDrafts] = useState(() => Object.fromEntries(EMBED_LINKS.map((item) => {
    const saved = links.find((row) => row.link_key === item.key);
    return [item.key, { title: saved?.title || item.defaultTitle, url: saved?.url || "" }];
  })));
  const [busy, setBusy] = useState("");
  const [problems, setProblems] = useState({});

  async function save(key) {
    if (busy) return;
    const problem = embedAddressProblem(drafts[key].url);
    setProblems((all) => ({ ...all, [key]: problem }));
    if (problem) return;
    setBusy(key);
    onError("");
    try {
      await setEmbedLink(key, key === DUTY_TODAY.key ? DUTY_TODAY.defaultTitle : drafts[key].title.trim(), drafts[key].url.trim());
      await onSaved("บันทึกที่อยู่แล้ว");
    } catch (nextError) { onError(embedErrorMessage(nextError)); } finally { setBusy(""); }
  }
  async function clear(key) {
    if (busy || !window.confirm("ลบที่อยู่นี้? (ลบเฉพาะที่อยู่ที่ตั้งไว้ ไม่กระทบเว็บต้นทาง)")) return;
    setBusy(key);
    onError("");
    try {
      await clearEmbedLink(key);
      setDrafts((all) => ({ ...all, [key]: { ...all[key], url: "" } }));
      await onSaved("ลบที่อยู่แล้ว");
    } catch (nextError) { onError(embedErrorMessage(nextError)); } finally { setBusy(""); }
  }

  return (
    <div className="sched-edit">
      <p className="lib-warn">ที่อยู่เก็บในฐานข้อมูล ไม่อยู่ในโค้ด · ใช้เฉพาะเว็บที่ไม่มีข้อมูลระบุตัวผู้ป่วย หรือที่ได้รับอนุญาตให้แสดงแล้ว · ผู้ที่ได้ลิงก์มีสิทธิ์เปิดเว็บต้นทางเองได้</p>
      {EMBED_LINKS.map((item) => {
        const saved = links.find((row) => row.link_key === item.key);
        return (
          <div className="sched-edit-row" key={item.key}>
            <strong>{item.label}</strong>
            {item.key !== DUTY_TODAY.key && <label>ชื่อแท็บ<input value={drafts[item.key].title} maxLength={80} onChange={(event) => setDrafts((all) => ({ ...all, [item.key]: { ...all[item.key], title: event.target.value } }))} /></label>}
            <label>ที่อยู่ (https://…)<input value={drafts[item.key].url} placeholder="https://" onChange={(event) => setDrafts((all) => ({ ...all, [item.key]: { ...all[item.key], url: event.target.value } }))} /></label>
            {problems[item.key] && <p className="form-error" role="alert">{problems[item.key]}</p>}
            <div className="button-row">
              <button type="button" className="primary-button" disabled={Boolean(busy)} onClick={() => save(item.key)}>{busy === item.key ? "กำลังบันทึก…" : "บันทึก"}</button>
              {saved && <button type="button" className="link-button" disabled={Boolean(busy)} onClick={() => clear(item.key)}>ลบที่อยู่นี้</button>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
