import React, { useEffect, useRef, useState } from "react";
import { ScanIcon } from "../components/Icons";
import { isInAppBrowser, parseRoundTokenInput } from "../roundSchedule";

// stop() on a camera that is still starting leaves the stream running; always wait for `ready` first.
function stopScanner(scanner) {
  if (!scanner) return Promise.resolve();
  return scanner.ready.then(() => scanner.html5.stop()).catch(() => {}).finally(() => {
    try { scanner.html5.clear(); } catch { /* element already gone */ }
  });
}

export function RoundQrScanner({ onToken, disabled = false }) {
  const [camera, setCamera] = useState(false);
  const [manual, setManual] = useState("");
  const [error, setError] = useState("");
  const scannerRef = useRef(null);
  const stopping = useRef(Promise.resolve());
  const locked = useRef(false);
  const inApp = isInAppBrowser();

  function accept(value) {
    const token = parseRoundTokenInput(value);
    if (!token) { setError("QR นี้ไม่ใช่ QR เช็คชื่อประชุม กรุณาสแกน QR ที่แสดงในห้องประชุมหรือวางลิงก์เต็ม"); return false; }
    setError("");
    setCamera(false);
    setManual("");
    onToken(token);
    return true;
  }

  useEffect(() => {
    if (!camera) return undefined;
    let cancelled = false;
    stopping.current.then(() => import("html5-qrcode")).then(({ Html5Qrcode }) => {
      if (cancelled) return;
      const html5 = new Html5Qrcode("round-qr-reader", { verbose: false });
      const ready = html5.start({ facingMode: "environment" }, { fps: 10, qrbox: { width: 240, height: 240 } }, (decoded) => {
        if (locked.current) return;
        locked.current = true;
        const ok = accept(decoded);
        if (!ok) window.setTimeout(() => { locked.current = false; }, 1500);
      }, () => {});
      scannerRef.current = { html5, ready };
      ready.catch(() => {
        if (cancelled) return;
        setError("เปิดกล้องไม่สำเร็จ กรุณาอนุญาตการใช้กล้องของเว็บนี้ในการตั้งค่า (iPhone: การตั้งค่า > Safari > กล้อง) หรือวางลิงก์จาก QR ในช่องด้านล่าง");
        setCamera(false);
      });
    }).catch(() => { setError("เปิดตัวสแกน QR ไม่สำเร็จ กรุณาวางลิงก์จาก QR ในช่องด้านล่าง"); setCamera(false); });
    return () => { cancelled = true; stopping.current = stopScanner(scannerRef.current); scannerRef.current = null; locked.current = false; };
  }, [camera]);

  return <section className="round-scanner" aria-label="สแกน QR เช็คชื่อ">
    <button className={camera ? "secondary-button icon-button" : "primary-button icon-button"} type="button" disabled={disabled} onClick={() => { setError(""); setCamera((value) => !value); }}>
      <ScanIcon />{camera ? "ปิดกล้อง" : "สแกน QR เช็คชื่อ"}
    </button>
    {inApp && <p className="form-error" role="note">คุณเปิดเว็บนี้จากแอปแชต กล้องอาจถูกบล็อก กรุณาเปิดด้วย Safari หรือเปิดด้วย Chrome ของเครื่อง หรือวางลิงก์จาก QR ในช่องด้านล่าง</p>}
    {camera && <div id="round-qr-reader" className="qr-reader" />}
    <div className="manual-qr">
      <label>วางลิงก์จาก QR<input value={manual} onChange={(event) => setManual(event.target.value)} placeholder="วางลิงก์ /attendance/..." /></label>
      <button className="secondary-button" type="button" disabled={disabled || !manual.trim()} onClick={() => accept(manual)}>ใช้ลิงก์นี้</button>
    </div>
    {error && <p className="form-error" role="alert">{error}</p>}
  </section>;
}
