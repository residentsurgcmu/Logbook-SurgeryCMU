import React, { useId, useLayoutEffect, useRef, useState } from "react";
import "./assessmentSearchSelect.css";

export const matchesAssessmentSearch = (query, ...fields) => {
  const normalize = (text) => String(text ?? "").normalize("NFC").toLowerCase();
  const haystack = fields.map(normalize).join(" ");
  return normalize(query).trim().split(/\s+/).every((word) => haystack.includes(word));
};

// The text is a filter, never the submitted value. Only activating an option changes the ID.
export default function AssessmentSearchSelect({ label, options, value, onChange, placeholder, disabled }) {
  const id = useId();
  const input = useRef(null);
  const list = useRef(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlighted, setHighlighted] = useState(-1);
  const selected = options.find((option) => option.value === value);
  const visible = options.filter((option) => matchesAssessmentSearch(query, option.label));
  const activeId = open && visible[highlighted] ? `${id}-option-${highlighted}` : undefined;

  useLayoutEffect(() => {
    const active = list.current?.children[highlighted];
    if (!active) return;
    const item = active.getBoundingClientRect();
    const viewport = list.current.getBoundingClientRect();
    if (item.top < viewport.top) list.current.scrollTop -= viewport.top - item.top;
    if (item.bottom > viewport.bottom) list.current.scrollTop += item.bottom - viewport.bottom;
  }, [open, highlighted]);

  function close() {
    setOpen(false);
    setQuery("");
    setHighlighted(-1);
  }

  function choose(option) {
    if (option.disabled) return;
    onChange(option.value);
    close();
  }

  function keyDown(event) {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Escape" && open) {
      event.preventDefault();
      event.stopPropagation();
      close();
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      const index = open && highlighted >= 0 ? highlighted + step : step > 0 ? 0 : visible.length - 1;
      for (let next = index; next >= 0 && next < visible.length; next += step) {
        if (!visible[next].disabled) { setHighlighted(next); break; }
      }
      setOpen(true);
    } else if (open && event.key === "Enter") {
      event.preventDefault();
      const option = visible[highlighted] || (visible.length === 1 ? visible[0] : null);
      if (option) choose(option);
    }
  }

  return (
    <div className="assessment-search-select" onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget)) close();
    }}>
      <label htmlFor={id}>{label}</label>
      <div className="assessment-search-select-field">
        <input
          ref={input}
          id={id}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={open ? id + "-list" : undefined}
          aria-activedescendant={activeId}
          aria-required="true"
          disabled={disabled}
          autoComplete="off"
          placeholder={placeholder}
          value={open ? query : selected?.label || ""}
          onFocus={() => { setOpen(true); setHighlighted(-1); }}
          onClick={() => setOpen(true)}
          onChange={(event) => {
            setQuery(event.target.value);
            setHighlighted(-1);
            setOpen(true);
            if (list.current) list.current.scrollTop = 0;
          }}
          onKeyDown={keyDown}
        />
        <button type="button" tabIndex={-1} disabled={disabled} aria-label={`${open ? "ปิด" : "เปิด"}รายการ${label}`}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => { if (open) close(); else { input.current.focus(); setOpen(true); } }}>▾</button>
      </div>
      {open && (
        <div className="assessment-search-select-popup">
          <ul ref={list} id={id + "-list"} role="listbox" aria-label={label}>
            {visible.map((option, index) => (
              <li key={option.value} id={`${id}-option-${index}`} role="option" aria-selected={option.value === value}
                aria-disabled={option.disabled || undefined} data-highlighted={index === highlighted}
                onMouseDown={(event) => event.preventDefault()} onClick={() => choose(option)}>
                {option.label}
              </li>
            ))}
          </ul>
          {visible.length === 0 && <p role="status">ไม่พบรายการที่ตรงกับคำค้น</p>}
        </div>
      )}
    </div>
  );
}
