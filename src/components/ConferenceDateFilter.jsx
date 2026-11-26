import React, { useId, useLayoutEffect, useRef, useState } from "react";
import { includesConferenceDay, pickConferenceDay } from "../conferenceDisplayDates";
import { shiftIsoDate } from "../roundSchedule";
import "./conferenceDisplay.css";

const monthLabel = new Intl.DateTimeFormat("th-TH", { month: "long", year: "numeric", timeZone: "UTC" });
const dayLabel = new Intl.DateTimeFormat("th-TH", { dateStyle: "full", timeZone: "UTC" });
const shortDate = new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeZone: "UTC" });
const toDate = (iso) => new Date(iso + "T12:00:00Z");
const startOfMonth = (iso) => iso.slice(0, 7) + "-01";
function shiftMonth(iso, step) {
  const date = toDate(startOfMonth(iso));
  date.setUTCMonth(date.getUTCMonth() + step);
  return date.toISOString().slice(0, 10);
}

export default function ConferenceDateFilter({ value, initialDate, onChange }) {
  const id = useId();
  const trigger = useRef(null);
  const grid = useRef(null);
  const focusDay = useRef(false);
  const replaceOnPick = useRef(true);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const [cursor, setCursor] = useState(value.start || initialDate);
  const month = startOfMonth(cursor);
  const firstWeekday = (toDate(month).getUTCDay() + 6) % 7;
  const days = Number(shiftIsoDate(shiftMonth(month, 1), -1).slice(-2));
  const summary = value.start
    ? shortDate.format(toDate(value.start)) + (value.end && value.end !== value.start ? " – " + shortDate.format(toDate(value.end)) : "")
    : "ทุกวันที่รับไว้";

  useLayoutEffect(() => {
    if (open && focusDay.current) {
      focusDay.current = false;
      grid.current?.querySelector('[tabindex="0"]')?.focus();
    }
  }, [open, cursor]);

  function close(nextRange) {
    if (nextRange) onChange(nextRange);
    setOpen(false);
    trigger.current?.focus();
  }

  function moveDay(event, day) {
    const offsets = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    if (!(event.key in offsets)) return;
    event.preventDefault();
    focusDay.current = true;
    setCursor(shiftIsoDate(day, offsets[event.key]));
  }

  return (
    <div className="conf-date-filter" onKeyDown={(event) => {
      if (event.key === "Escape" && open) { event.stopPropagation(); close(); }
    }}>
      <span className="conf-date-label">วันที่รับไว้</span>
      <button ref={trigger} type="button" className="secondary-button conf-date-trigger" aria-expanded={open} aria-controls={id}
        onClick={() => {
          if (open) { close(); return; }
          setDraft(value);
          replaceOnPick.current = true;
          setCursor(value.start || initialDate);
          focusDay.current = true;
          setOpen(true);
        }}>{summary} <span aria-hidden="true">▾</span></button>
      {open && (
        <div id={id} className="conf-date-picker" role="group" aria-label="เลือกวันที่รับไว้">
          <div className="conf-date-month">
            <button type="button" aria-label="เดือนก่อน" onClick={() => setCursor(shiftMonth(month, -1))}>‹</button>
            <strong aria-live="polite">{monthLabel.format(toDate(month))}</strong>
            <button type="button" aria-label="เดือนถัดไป" onClick={() => setCursor(shiftMonth(month, 1))}>›</button>
          </div>
          <div className="conf-date-grid" ref={grid}>
            {["จ.", "อ.", "พ.", "พฤ.", "ศ.", "ส.", "อา."].map((day) => <span key={day} aria-hidden="true">{day}</span>)}
            {Array.from({ length: firstWeekday }, (_, i) => <span key={`pad-${i}`} aria-hidden="true" />)}
            {Array.from({ length: days }, (_, i) => {
              const day = shiftIsoDate(month, i);
              return <button key={day} type="button" tabIndex={day === cursor ? 0 : -1} aria-label={dayLabel.format(toDate(day))}
                aria-pressed={Boolean(draft.start && includesConferenceDay(draft, day))}
                onKeyDown={(event) => moveDay(event, day)}
                onClick={() => {
                  const replace = replaceOnPick.current;
                  replaceOnPick.current = false;
                  setCursor(day);
                  setDraft((current) => pickConferenceDay(replace ? { start: "", end: "" } : current, day));
                }}>{i + 1}</button>;
            })}
          </div>
          <p className="case-muted" aria-live="polite">
            {draft.start ? shortDate.format(toDate(draft.start)) + (draft.end && draft.end !== draft.start ? " – " + shortDate.format(toDate(draft.end)) : "") : "ยังไม่ได้เลือกวัน"}
            <br />เลือก 1 วัน หรือเลือกวันแรกและวันสุดท้ายของช่วง
          </p>
          <div className="conf-date-actions">
            <button type="button" className="secondary-button" onClick={() => close({ start: "", end: "" })}>ล้างวันที่</button>
            <button type="button" className="primary-button" disabled={!draft.start} onClick={() => close(draft)}>ใช้ตัวกรองวันที่</button>
          </div>
        </div>
      )}
    </div>
  );
}
