import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ENDED_NOTE, MODERATOR_ZONE, SEAT_POLL_MS, ZONE_INFO, bangkokHm, canManageSeats, canPickSeat, canReviewRequests, pickDefaultSession, seatCell, seatErrorMessage, serverOffsetMs, shouldPoll,
} from "../seatMap";
import {
  certifySeatMap, confirmSeat, holdSeat, listSeatSessions, loadMySeatEvents, loadSeatMap, moveToReserveArea, releaseSeat,
  listSeatRequests, reportUrgentDuty, requestSeatCorrection, reviewSeatRequest, staffReleaseSeat, staffSetSeat,
} from "../seatMapApi";
import { CorrectionDialog, DesktopRoom, HistoryTab, HoldDialog, ManageDialog, MiniRoom, PeopleTab, PersonalCard, RequestList, UrgentDialog, ZoneGrid } from "./SeatMapViews";

const thaiDate = (iso) => new Intl.DateTimeFormat("th-TH", { dateStyle: "full", timeZone: "Asia/Bangkok" }).format(new Date(iso));
const TABS = [["map", "ผังที่นั่ง"], ["people", "ผู้เข้าร่วม"], ["history", "ประวัติของฉัน"]];

// Shown on the "เช็คชื่อประชุม" page for every session that has a seat map; renders nothing when there is none.
export function SeatMapPanel({ user, refreshKey = "" }) {
  const [sessions, setSessions] = useState(null);
  const [sessionId, setSessionId] = useState("");
  const [map, setMap] = useState(null);
  const [offsetMs, setOffsetMs] = useState(0);
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [notice, setNotice] = useState("");
  const [dialogError, setDialogError] = useState("");
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState("map");
  const [zone, setZone] = useState("L");
  const [dialog, setDialog] = useState(null);
  const [history, setHistory] = useState(null);
  const [requests, setRequests] = useState([]);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const mounted = useRef(true);
  const ticket = useRef(0);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const loadSessions = useCallback(async () => {
    try {
      const list = await listSeatSessions();
      if (!mounted.current) return;
      setSessions(list);
      setSessionId((previous) => (previous && list.some((item) => item.session_id === previous) ? previous : pickDefaultSession(list, Date.now())));
    } catch (nextError) {
      if (mounted.current) { setSessions([]); setLoadError(seatErrorMessage(nextError)); }
    }
  }, []);

  const refresh = useCallback(async (id) => {
    if (!id) return;
    const mine = ++ticket.current;
    try {
      const requestedAt = Date.now();
      const next = await loadSeatMap(id);
      if (!mounted.current || mine !== ticket.current) return;
      setMap(next);
      setOffsetMs(serverOffsetMs(next, requestedAt));
      if (next.me.role === "staff") {
        try { const rows = await listSeatRequests(id); if (mounted.current && mine === ticket.current) setRequests(rows); } catch { /* the queue is secondary: keep the map */ }
      }
      setLoadError("");
    } catch (nextError) {
      if (mounted.current && mine === ticket.current) setLoadError(seatErrorMessage(nextError));
    }
  }, []);

  useEffect(() => { loadSessions(); }, [refreshKey, loadSessions]);
  useEffect(() => { setMap(null); setHistory(null); refresh(sessionId); }, [sessionId, refresh]);
  useEffect(() => { if (sessionId) refresh(sessionId); }, [refreshKey]);

  const dialogOpen = Boolean(dialog);
  const ended = Boolean(map?.session?.ended);
  useEffect(() => {
    if (!sessionId) return undefined;
    const tick = () => { if (shouldPoll({ hidden: document.hidden, dialogOpen, ended })) refresh(sessionId); };
    const timer = window.setInterval(tick, SEAT_POLL_MS);
    const onVisible = () => { if (!document.hidden) tick(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, [sessionId, dialogOpen, ended, refresh]);

  useEffect(() => {
    if (tab !== "history" || !sessionId) return;
    loadMySeatEvents(sessionId).then((rows) => { if (mounted.current) setHistory(rows); }).catch((nextError) => { if (mounted.current) setError(seatErrorMessage(nextError)); });
  }, [tab, sessionId, map?.me?.seat, map?.me?.status]);

  // Every action: call, reload the map, close the dialog on success, keep it open and explain on failure.
  async function act(run, success) {
    setBusy(true); setNotice(""); setError(""); setDialogError("");
    try {
      await run();
      if (!mounted.current) return;
      setDialog(null); setNotice(success);
      await refresh(sessionId);
    } catch (nextError) {
      if (!mounted.current) return;
      const message = seatErrorMessage(nextError);
      if (dialog) setDialogError(message); else setError(message);
      await refresh(sessionId);
    } finally { if (mounted.current) setBusy(false); }
  }

  async function onSeat(seat) {
    if (!map) return;
    if (canManageSeats(map)) { setDialogError(""); setDialog({ type: "manage", seat }); return; }
    const cell = seatCell(seat, map);
    if (!canPickSeat(map) || !(cell.state === "free" || cell.state === "myhold")) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const expiresAt = await holdSeat(sessionId, seat.seat_code);
      if (mounted.current) { setDialogError(""); setDialog({ type: "hold", seat, expiresAt }); }
    } catch (nextError) {
      if (mounted.current) setError(seatErrorMessage(nextError));
      await refresh(sessionId);
    } finally { if (mounted.current) setBusy(false); }
  }

  if (sessions === null || !sessions.length) return loadError && sessions ? <p className="form-error" role="alert">{loadError}</p> : null;
  const session = sessions.find((item) => item.session_id === sessionId) || sessions[0];
  const pendingRequests = requests.filter((request) => request.state === "pending" && request.user_id !== map?.me?.user_id).length;
  const tabs = map && canReviewRequests(map) ? [...TABS, ["requests", pendingRequests ? `คำขอรอตรวจ (${pendingRequests})` : "คำขอ"]] : TABS;
  const zoneName = zone === "M" ? MODERATOR_ZONE.name : ZONE_INFO.find((item) => item.zone === zone)?.name;
  return <section className="resident-panel seatmap" aria-labelledby="seatmap-title">
    <div className="seatmap-head">
      <h2 id="seatmap-title">ผังที่นั่งประชุม</h2>
      {sessions.length > 1
        ? <label>รอบ<select value={sessionId} onChange={(event) => setSessionId(event.target.value)}>{sessions.map((item) => <option key={item.session_id} value={item.session_id}>{thaiDate(item.meeting_date)} · {bangkokHm(item.starts_at)}–{bangkokHm(item.ends_at)} น.</option>)}</select></label>
        : <span>{thaiDate(session.meeting_date)} · {bangkokHm(session.starts_at)}–{bangkokHm(session.ends_at)} น.</span>}
    </div>
    {error && <p className="form-error" role="alert">{error}</p>}
    {loadError && <p className="form-error" role="alert">{loadError}</p>}
    {notice && <p className="form-success" role="status">{notice}</p>}
    {!map ? <p role="status">กำลังโหลดผังที่นั่ง…</p> : <>
      {map.session.ended && <p className="seatmap-ended" role="note">การประชุมนี้จบแล้ว · {ENDED_NOTE}</p>}
      <PersonalCard map={map} busy={busy}
        onRelease={() => act(() => releaseSeat(sessionId), "คืนที่นั่งแล้ว")}
        onReserve={() => act(() => moveToReserveArea(sessionId), "ย้ายไปที่นั่งเสริมแล้ว")}
        onUrgent={() => { setDialogError(""); setDialog({ type: "urgent" }); }}
        onCorrection={() => { setDialogError(""); setDialog({ type: "correction" }); }}
        onCertify={() => act(() => certifySeatMap(sessionId), "บันทึกการรับรองผังแล้ว")} />
      <div className="seatmap-tabs" role="tablist" aria-label="หัวข้อผังที่นั่ง">
        {tabs.map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>{label}</button>)}
      </div>
      {tab === "map" && <>
        <div className="seatmap-mobile-view">
          <MiniRoom map={map} activeZone={zone} onZone={setZone} />
          <div className="seatmap-zone-detail"><h3>{zoneName} <span className="muted">· {canManageSeats(map) ? "แตะที่นั่งเพื่อจัดที่" : "เลือกที่นั่ง"}</span></h3><ZoneGrid zone={zone} map={map} onSeat={onSeat} /></div>
        </div>
        <div className="seatmap-desktop-view"><DesktopRoom map={map} onSeat={onSeat} /></div>
      </>}
      {tab === "people" && <PeopleTab map={map} query={query} onQuery={setQuery} status={status} onStatus={setStatus} />}
      {tab === "history" && <HistoryTab events={history} />}
      {tab === "requests" && canReviewRequests(map) && <section className="seatmap-people">
        <p className="seatmap-hint">อาจารย์เป็นผู้อนุมัติหรือไม่อนุมัติ · ตรวจกับตารางปฏิบัติงานก่อน · คำขอของตัวเองให้อาจารย์ท่านอื่นตรวจ</p>
        <RequestList requests={requests} busy={busy} ownerId={map.me.user_id}
          onReview={(requestId, decision) => act(() => reviewSeatRequest(requestId, decision), decision === "approved" ? "อนุมัติคำขอแล้ว" : "บันทึกว่าไม่อนุมัติแล้ว")} />
      </section>}
    </>}
    {dialog?.type === "hold" && <HoldDialog seat={dialog.seat} from={map?.me?.seat || ""} expiresAt={dialog.expiresAt} offsetMs={offsetMs} busy={busy} error={dialogError}
      onConfirm={() => act(() => confirmSeat(sessionId, dialog.seat.seat_code), "บันทึกที่นั่งแล้ว")} onCancel={() => { setDialog(null); refresh(sessionId); }} />}
    {dialog?.type === "manage" && <ManageDialog seat={dialog.seat} map={map} busy={busy} error={dialogError}
      onSet={(residentId) => act(() => staffSetSeat(sessionId, residentId, dialog.seat.seat_code), "จัดที่นั่งแล้ว")}
      onRelease={(residentId) => act(() => staffReleaseSeat(sessionId, residentId), "คืนที่นั่งแล้ว")} onClose={() => setDialog(null)} />}
    {dialog?.type === "urgent" && <UrgentDialog busy={busy} error={dialogError}
      onSubmit={({ reason, note }) => act(() => reportUrgentDuty(sessionId, reason, note), "บันทึกภารกิจจำเป็นแล้ว · รอผู้ดูแลตรวจสอบ")} onCancel={() => setDialog(null)} />}
    {dialog?.type === "correction" && <CorrectionDialog busy={busy} error={dialogError}
      onSubmit={({ note }) => act(() => requestSeatCorrection(sessionId, note), "ส่งคำขอแก้ไขแล้ว")} onCancel={() => setDialog(null)} />}
  </section>;
}
