import React, { useEffect, useRef, useState } from "react";
import { getMyNotificationPreferences, saveMyNotificationPreferences } from "../residentApi";

// RC-NOTIF-V1 — own notification settings. Values shown are always the ones the server confirmed.
// Every account change (logout, A→B, even A→B→A) starts a new generation; a response or save started in an
// older generation is dropped, so no value or success message crosses accounts. A failed save keeps the
// values being edited.
const GROUPS = {
  staff: [
    { title: "คำขอประเมินใหม่", keys: [["request_web", "ในเว็บ"], ["request_email", "อีเมล"]] },
    { title: "แจ้งเตือนคำขอที่รอเกิน 24 ชั่วโมง", keys: [["reminder_web", "ในเว็บ"], ["reminder_email", "อีเมล"]] },
  ],
  resident: [{ title: "Staff ประเมินเสร็จแล้ว", keys: [["completed_web", "ในเว็บ"]] }],
};

export default function NotificationPreferences({ user }) {
  const userId = user?.id || "";
  const groups = GROUPS[user?.role] || [];
  const [server, setServer] = useState(null);
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const generation = useRef(0);
  const live = (gen, forUser, data) => generation.current === gen && (!data || data.user_id === forUser);

  async function load(gen, forUser, keepDraft = null) {
    try {
      const data = await getMyNotificationPreferences();
      if (!live(gen, forUser, data)) return;                       // stale generation or another account
      setServer(data);
      setDraft(keepDraft ? { ...data, ...keepDraft } : data);       // keep what the user was editing
    } catch (nextError) {
      if (live(gen, forUser)) setError(nextError.message);
    }
  }
  useEffect(() => {
    generation.current += 1;
    setServer(null); setDraft(null); setNotice(""); setError(""); setBusy(false);
    if (userId && groups.length) load(generation.current, userId);
  }, [userId]);

  if (!groups.length) return null;
  const changes = draft && server ? Object.fromEntries(groups.flatMap((g) => g.keys.map(([k]) => k)).filter((k) => draft[k] !== server[k]).map((k) => [k, draft[k]])) : {};
  const dirty = Object.keys(changes).length > 0;

  async function save(event) {
    event.preventDefault();
    if (!dirty || busy) return;
    const forUser = userId; const gen = generation.current; const editing = changes;
    setBusy(true); setError(""); setNotice("");
    try {
      const data = await saveMyNotificationPreferences(server.version, editing);
      if (!live(gen, forUser, data)) return;
      setServer(data); setDraft(data); setNotice("บันทึกแล้ว");
    } catch (nextError) {
      if (!live(gen, forUser)) return;
      setError(nextError.message);                                  // draft is left as the user edited it
      if (nextError.code === "RC_NOTIF_VERSION_CONFLICT") await load(gen, forUser, editing);
    } finally {
      if (live(gen, forUser)) setBusy(false);
    }
  }

  return (
    <section className="resident-panel notification-preferences" aria-labelledby="notification-preferences-title">
      <h2 id="notification-preferences-title">ตั้งค่าการแจ้งเตือน</h2>
      <p className="muted">
        การปิดมีผลกับรายการที่ยังรอส่งด้วย · เปิดกลับแล้วจะไม่ส่งย้อนหลัง · อีเมลที่ระบบเริ่มส่งไปแล้วอาจยังมาถึง
      </p>
      {!draft && !error && <p aria-live="polite">กำลังโหลดการตั้งค่า…</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
      {draft && (
        <form onSubmit={save}>
          {groups.map((group) => (
            <fieldset key={group.title} disabled={busy}>
              <legend>{group.title}</legend>
              {group.keys.map(([key, label]) => (
                <label key={key} className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={Boolean(draft[key])}
                    onChange={(event) => { setNotice(""); setDraft({ ...draft, [key]: event.target.checked }); }}
                  />
                  <span>{label}</span>
                </label>
              ))}
            </fieldset>
          ))}
          <button type="submit" className="primary-button" disabled={!dirty || busy}>
            {busy ? "กำลังบันทึก…" : "บันทึกการตั้งค่า"}
          </button>
          {notice && <span role="status" className="muted"> {notice}</span>}
        </form>
      )}
    </section>
  );
}
