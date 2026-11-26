import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { thaiDate } from "./CaseParts";
import { hnPilotWebExport } from "../residentCasesApi";

const MAX_EXPORT_CASES = 50;

export default function CaseHnExport({ keyId }) {
  const [grouped, setGrouped] = useState(false);
  const [day, setDay] = useState("");
  const [wholeDay, setWholeDay] = useState(false);
  const [prefix, setPrefix] = useState("");
  const [search, setSearch] = useState({ prefix: "" });
  const [rows, setRows] = useState(null);
  const [selected, setSelected] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const mounted = useRef(false);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => {
    let current = true;
    hnPilotWebExport(search.day ? "list-day" : "list", { p_prefix: search.day || search.prefix }).then((value) => {
      if (current) setRows(value);
    }).catch(() => {
      if (current) {
        setRows([]);
        setError("โหลดรายการไม่ได้ โปรดตรวจสิทธิ์หรือค้นหาอีกครั้ง");
      }
    });
    return () => { current = false; };
  }, [search]);

  function find(event) {
    event.preventDefault();
    const normalized = prefix.trim().toUpperCase();
    if (!/^(ADM-)?[0-9]{0,5}$/.test(normalized)) {
      setError("ค้นหาด้วยรหัสเคส เช่น ADM-00012");
      return;
    }
    setError("");
    setRows(null);
    setWholeDay(false);
    setSearch({ prefix: normalized });
  }

  function loadDay(date) {
    if (busy) return;
    if (!date) {
      setDay("");
      setWholeDay(false);
      setRows(null);
      setSearch({ prefix: "" });
      return;
    }
    setError("");
    setDay(date);
    setRows(null);
    setWholeDay(true);
    setSearch({ day: date });
  }

  async function download(batch = selected, suffix = "") {
    if (!batch.length || batch.length > MAX_EXPORT_CASES || busy) return;
    const ids = batch.map(({ id }) => id);
    setBusy(true);
    setError("");
    try {
      const bundle = await hnPilotWebExport("download", { p_case_ids: ids });
      if (!mounted.current) return;
      if (bundle?.format !== "rc-hn-prod-v1" || bundle.type !== "bundle" || bundle.keyId !== keyId
          || bundle.records?.length !== ids.length
          || !bundle.records.every((row, i) => row.caseUuid === ids[i] && row.keyId === keyId)) {
        throw new Error("Unexpected export bundle");
      }
      const url = URL.createObjectURL(new Blob([JSON.stringify(bundle)], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `grand-rounds-hn-encrypted${suffix}.json`;
      try { link.click(); } finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
    } catch {
      if (mounted.current) setError("ส่งออกไม่ได้ ตรวจสิทธิ์หรือสถานะเคส แล้วลองใหม่");
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  const dayTooLarge = wholeDay && rows?.length > 500;
  const visibleRows = dayTooLarge ? [] : rows ?? [];
  const byDay = new Map();
  for (const row of visibleRows) {
    const date = row.admitDate ?? "";
    if (!byDay.has(date)) byDay.set(date, []);
    byDay.get(date).push(row);
  }
  const groups = grouped || wholeDay ? [...byDay.entries()].sort(([a], [b]) => b.localeCompare(a)) : [["", visibleRows]];
  const selectedIds = new Set(selected.map(({ id }) => id));
  const unselectedVisible = visibleRows.filter(({ id }) => !selectedIds.has(id));
  const allVisibleSelected = visibleRows.length > 0 && unselectedVisible.length === 0;
  const wouldExceedLimit = selected.length + unselectedVisible.length > MAX_EXPORT_CASES;

  function selectAllVisible() {
    setSelected((current) => {
      const ids = new Set(current.map(({ id }) => id));
      const next = [...current, ...visibleRows.filter(({ id }) => !ids.has(id))];
      return next.length <= MAX_EXPORT_CASES ? next : current;
    });
  }

  return <div className="case-form hn-export">
    <div className="hn-export-content">
      <div className="hn-export-controls">
        <p className="case-muted">ส่งออกได้สูงสุด {MAX_EXPORT_CASES} เคสต่อไฟล์ เปิดไฟล์ด้วยกุญแจบนเครื่องของคุณ</p>
        <div className="hn-export-filters">
          <form className="hn-export-search" onSubmit={find}>
            <label>ค้นหารหัสเคส<input value={prefix} maxLength={9} disabled={busy}
              onChange={(e) => setPrefix(e.target.value)} placeholder="ADM-00012" /></label>
            <button className="secondary-button" disabled={busy}>ค้นหา</button>
          </form>
          <label>วันที่รับ<input type="date" value={day} disabled={busy} onChange={(event) => loadDay(event.target.value)} /></label>
        </div>
        <div className="hn-export-options">
          <button type="button" className="secondary-button" disabled={busy} aria-pressed={grouped || wholeDay}
            onClick={() => { setGrouped(!grouped && !wholeDay); if (wholeDay) { setWholeDay(false); setRows(null); setSearch({ prefix: "" }); } }}>จัดกลุ่มตามวันที่รับ</button>
          {!!visibleRows.length && <button type="button" className="secondary-button"
            disabled={busy || allVisibleSelected || wouldExceedLimit} onClick={selectAllVisible}>เลือกทั้งหมดที่แสดง ({visibleRows.length})</button>}
        </div>
      </div>
      <div className="hn-export-results" role="region" aria-label="รายการเคสที่ส่งออกได้" tabIndex={0}>
        {dayTooLarge && <p role="alert">วันนี้มีมากกว่า 500 เคส กรุณาแบ่งตามรหัสเคสเพื่อส่งออก</p>}
        {wholeDay && !dayTooLarge && visibleRows.length > 0 && <div className="hn-export-options hn-export-batches">
          {Array.from({ length: Math.ceil(visibleRows.length / MAX_EXPORT_CASES) }, (_, i) => <button key={i} type="button"
            className="secondary-button" disabled={busy} onClick={() => download(visibleRows.slice(i * MAX_EXPORT_CASES, (i + 1) * MAX_EXPORT_CASES), `-${day}${visibleRows.length > MAX_EXPORT_CASES ? `-part-${i + 1}` : ""}`)}>
            {visibleRows.length <= MAX_EXPORT_CASES ? `ดาวน์โหลดทั้งวัน (${visibleRows.length} เคส)` : `ดาวน์โหลดชุดที่ ${i + 1} (${Math.min(MAX_EXPORT_CASES, visibleRows.length - i * MAX_EXPORT_CASES)} เคส)`}
          </button>)}
        </div>}
        {rows === null && <p role="status">กำลังโหลดเคส…</p>}
        {rows?.length === 0 && <p>ไม่พบเคสที่ส่งออกได้</p>}
        {!wholeDay && rows?.length === MAX_EXPORT_CASES && <p>แสดงได้สูงสุด {MAX_EXPORT_CASES} รายการล่าสุดที่ตรงกับคำค้น ค้นหาด้วยรหัสเคสเพื่อดูรายการอื่น</p>}
        {wouldExceedLimit && <p className="case-muted">เลือกทั้งหมดไม่ได้ เพราะรวมกับเคสที่เลือกไว้แล้วจะเกิน {MAX_EXPORT_CASES} เคส กรุณาล้างรายการหรือเลือกเฉพาะเคสที่ต้องการ</p>}
        {!!visibleRows.length && <fieldset>
          <legend>รหัสเคสที่ส่งออกได้ ({visibleRows.length})</legend>
          {groups.map(([date, dailyRows]) => <div key={date} className="hn-export-day">
            {date && <div className="hn-export-day-head">
              <strong>{thaiDate(date)} <span className="case-muted">· {dailyRows.length} เคส</span></strong>
              {!wholeDay && <button type="button" className="secondary-button" disabled={busy} onClick={() => loadDay(date)}>ดูทุกเคสของวันนี้</button>}
            </div>}
            <div className="hn-export-cases">
              {dailyRows.map((row) => {
                const checked = selectedIds.has(row.id);
                return <label key={row.id} className="case-check">
                  <input type="checkbox" checked={checked} disabled={busy || (!checked && selected.length >= MAX_EXPORT_CASES)}
                    onChange={(e) => {
                      const add = e.target.checked;
                      setSelected((all) => add
                        ? (all.length >= MAX_EXPORT_CASES || all.some(({ id }) => id === row.id) ? all : [...all, row])
                        : all.filter(({ id }) => id !== row.id));
                    }} />{row.code}
                </label>;
              })}
            </div>
          </div>)}
        </fieldset>}
      </div>
    </div>
    <div className="hn-export-footer">
      {error && <p role="alert" className="form-error">{error}</p>}
      <div className="hn-export-footer-row">
        <div className="hn-export-selection">
          <strong role="status">เลือก {selected.length}/{MAX_EXPORT_CASES} เคส</strong>
          {selected.length > 0 && <button type="button" className="link-button" disabled={busy} onClick={() => setSelected([])}>ล้างรายการ</button>}
        </div>
        <button type="button" className="primary-button" disabled={busy || !selected.length} onClick={() => download()}>
          {busy ? "กำลังเตรียมไฟล์…" : "ดาวน์โหลดไฟล์เข้ารหัส"}
        </button>
      </div>
    </div>
  </div>;
}
