import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { hnPilotWebExport } from "../residentCasesApi";

export default function CaseHnExport({ keyId, onClose }) {
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
    hnPilotWebExport("list", { p_prefix: search.prefix }).then((value) => {
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
    setSearch({ prefix: normalized });
  }

  async function download() {
    if (!selected.length || busy) return;
    const ids = selected.map(({ id }) => id);
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
      link.download = "grand-rounds-hn-encrypted.json";
      try { link.click(); } finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
    } catch {
      if (mounted.current) setError("ส่งออกไม่ได้ ตรวจสิทธิ์หรือสถานะเคส แล้วลองใหม่");
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  return <div className="case-form">
    <p>เลือกเฉพาะเคสที่จะใช้ใน Grand Rounds ได้ไม่เกิน 50 เคส ไฟล์ที่ดาวน์โหลดต้องเปิดด้วยกุญแจบนเครื่องของคุณ</p>
    <form className="button-row" onSubmit={find}>
      <label>ค้นหารหัสเคส <input value={prefix} maxLength={9} disabled={busy}
        onChange={(e) => setPrefix(e.target.value)} placeholder="ADM-00012" /></label>
      <button className="secondary-button" disabled={busy}>ค้นหา</button>
    </form>
    {error && <p role="alert" className="form-error">{error}</p>}
    {rows === null && <p role="status">กำลังโหลดเคส…</p>}
    {rows?.length === 0 && <p>ไม่พบเคสที่ส่งออกได้</p>}
    {rows?.length === 50 && <p>แสดง 50 รายการล่าสุด ค้นหาด้วยรหัสเคสเพื่อดูรายการอื่น</p>}
    {!!rows?.length && <fieldset>
      <legend>รหัสเคสที่ส่งออกได้</legend>
      {rows.map((row) => {
        const checked = selected.some(({ id }) => id === row.id);
        return <label key={row.id} className="case-check">
          <input type="checkbox" checked={checked} disabled={busy || (!checked && selected.length >= 50)}
            onChange={(e) => {
              const add = e.target.checked;
              setSelected((all) => add
                ? (all.length >= 50 || all.some(({ id }) => id === row.id) ? all : [...all, row])
                : all.filter(({ id }) => id !== row.id));
            }} /> {row.code}
        </label>;
      })}
    </fieldset>}
    {selected.length > 0 && <div>เลือก {selected.length} เคส: {selected.map(({ code }) => code).join(", ")}{" "}
      <button type="button" className="link-button" disabled={busy} onClick={() => setSelected([])}>ล้างรายการ</button></div>}
    <div className="button-row">
      <button type="button" className="secondary-button" onClick={onClose}>ปิด</button>
      <button type="button" className="primary-button" disabled={busy || !selected.length} onClick={download}>
        {busy ? "กำลังเตรียมไฟล์…" : "ดาวน์โหลดไฟล์เข้ารหัส"}
      </button>
    </div>
  </div>;
}
