import React, { useEffect, useMemo, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { QrIcon, ScanIcon, ShieldIcon, UserIcon } from "../components/Icons";
import { resolveResidentQr } from "../residentApi";

export function parseResidentQrToken(value) {
  const text = String(value || "").trim();
  const match = text.match(/(?:^|\/evaluate\/)([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})(?:$|[?#/])/i);
  return match?.[1]?.toLowerCase() || "";
}

export function ResidentQrCard({ user }) {
  const value = user.qrToken ? `${window.location.origin}/evaluate/${user.qrToken}` : "";
  return <section className="resident-panel resident-qr-card"><div className="qr-card-copy"><span className="eyebrow"><QrIcon size={18} /> QR สำหรับการประเมิน</span><h2>ให้ Staff สแกนเพื่อเปิดรายการประเมินของคุณ</h2><p>QR นี้ระบุเฉพาะบัญชี Resident ไม่มีชื่อผู้ป่วย HN หรือรายละเอียดการรักษา</p><ol><li>ส่งแบบประเมินและเลือก Staff ให้ตรงกับผู้ประเมิน</li><li>แสดง QR นี้ให้ Staff สแกนจากโทรศัพท์หรือคอมพิวเตอร์</li><li>Staff ตรวจชื่อและเลือกคำขอก่อนเริ่มประเมิน</li></ol></div><div className="qr-code-panel">{value ? <QRCodeSVG value={value} size={230} level="H" marginSize={2} aria-label={`QR code ของ ${user.name}`} /> : <div className="qr-unavailable">กำลังเตรียม QR code<br />กรุณารีเฟรชหลัง Admin อัปเดตฐานข้อมูล</div>}<strong>{user.name}</strong><span>Resident{user.pgy ? ` · PGY ${user.pgy}` : ""}</span></div><div className="privacy-note wide-note"><ShieldIcon /><p><strong>QR มีไว้ยืนยันตัวตนเท่านั้น</strong><br />การสแกนไม่ใช่การอนุมัติผล และ Staff ต้องลงชื่อเข้าใช้ก่อนเสมอ</p></div></section>;
}

// The handle is { html5, ready }: `ready` settles when the camera has started
// (or failed). stop() on a camera that is still starting leaves the stream
// running with no owner, so always wait for `ready` before stopping.
// Returns a promise that settles once the element is released, so the next
// scanner on the same element can wait for it (clear() empties the element).
function stopScanner(scanner) {
  if (!scanner) return Promise.resolve();
  return scanner.ready.then(() => scanner.html5.stop()).catch(() => {}).finally(() => {
    try { scanner.html5.clear(); } catch { /* element already gone */ }
  });
}

export function StaffQrScanner({ workspace, initialToken = "", onOpenRequest }) {
  const scannerRef = useRef(null); const stopping = useRef(Promise.resolve()); const userOpenedCamera = useRef(false); const scanLock = useRef(false); const lookupSeq = useRef(0); const [camera, setCamera] = useState(!initialToken); const [facing, setFacing] = useState("environment"); const [manual, setManual] = useState(initialToken); const [resident, setResident] = useState(null); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const pending = useMemo(() => resident ? workspace.requests.filter((request) => request.status === "pending" && request.resident_id === resident.user_id && request.staff_id === workspace.user.id) : [], [resident, workspace]);
  async function resolve(value) { const token = parseResidentQrToken(value); if (!token) return setError("QR code ไม่ถูกต้อง กรุณาสแกนใหม่หรือวางลิงก์เต็ม"); const seq = ++lookupSeq.current; setBusy(true); setError(""); try { const result = await resolveResidentQr(token); if (seq !== lookupSeq.current) return; setResident(result); setManual(token); setCamera(false); window.history.replaceState({}, "", `/evaluate/${token}`); } catch (nextError) { if (seq !== lookupSeq.current) return; setResident(null); setError(nextError.message || "ตรวจสอบ QR ไม่สำเร็จ"); } finally { if (seq === lookupSeq.current) setBusy(false); } }
  useEffect(() => { if (initialToken) resolve(initialToken); }, []);
  useEffect(() => {
    if (!camera) return undefined;
    let cancelled = false;
    stopping.current.then(() => import("html5-qrcode")).then(({ Html5Qrcode }) => {
      if (cancelled) return;
      // Headless scanner: no library camera picker or Start button. A
      // facingMode constraint is a preference, so a laptop still falls back
      // to its only camera.
      const html5 = new Html5Qrcode("resident-qr-reader", { verbose: false });
      const ready = html5.start({ facingMode: facing }, { fps: 10, qrbox: { width: 240, height: 240 } }, (decoded) => {
        // The camera decodes ~10 frames/s; handle one QR at a time instead of
        // firing a lookup for every frame until the camera closes.
        if (scanLock.current) return;
        scanLock.current = true;
        Promise.resolve(resolve(decoded)).finally(() => { window.setTimeout(() => { scanLock.current = false; }, 1500); });
      }, () => {});
      scannerRef.current = { html5, ready };
      ready.catch(() => {
        if (cancelled) return;
        // The camera opens by itself on this page; only complain when the
        // Staff user asked for it (a desktop without a camera stays quiet).
        if (userOpenedCamera.current) setError("เปิดกล้องไม่สำเร็จ กรุณาอนุญาตการใช้กล้อง หรือวางลิงก์จาก QR ในช่องด้านล่าง");
        setCamera(false);
      });
    }).catch(() => setError("เปิดตัวสแกน QR ไม่สำเร็จ"));
    return () => { cancelled = true; stopping.current = stopScanner(scannerRef.current); scannerRef.current = null; };
  }, [camera, facing]);
  return <div className="scanner-layout"><section className="resident-panel scanner-panel"><div className="section-heading"><h2><ScanIcon /> สแกน QR ของ Resident</h2><p>ต้องอนุญาตการใช้กล้อง หรือวางลิงก์จาก QR ในช่องด้านล่าง</p></div><button className={camera ? "secondary-button icon-button" : "primary-button icon-button"} type="button" onClick={() => { userOpenedCamera.current = true; setCamera((value) => !value); }}><ScanIcon />{camera ? "ปิดกล้อง" : "เปิดกล้องสแกน QR"}</button>{camera && <button className="secondary-button" type="button" onClick={() => { userOpenedCamera.current = true; setFacing((value) => value === "environment" ? "user" : "environment"); }}>{facing === "environment" ? "สลับเป็นกล้องหน้า" : "สลับเป็นกล้องหลัง"}</button>}{camera && <div id="resident-qr-reader" className="qr-reader" />}<div className="manual-qr"><label>ลิงก์หรือรหัส QR<input value={manual} onChange={(event) => setManual(event.target.value)} placeholder="วางลิงก์ /evaluate/..." /></label><button className="secondary-button" type="button" disabled={busy} onClick={() => resolve(manual)}>{busy ? "กำลังตรวจสอบ…" : "ตรวจสอบ QR"}</button></div>{error && <p className="form-error">{error}</p>}</section>
    <section className="resident-panel scanned-result"><div className="section-heading"><h2>ผลการสแกน</h2><p>Staff จะเห็นเฉพาะคำขอที่ Resident ส่งถึงตนเอง</p></div>{resident ? <><div className="resident-identity"><span><UserIcon size={24} /></span><div><small>Resident ที่ยืนยันแล้ว</small><strong>{resident.full_name}</strong><p>PGY {resident.pgy || "—"}</p></div></div>{pending.length ? <div className="scan-request-list">{pending.map((request) => <button type="button" key={request.id} onClick={() => onOpenRequest(request)}><span><strong>{request.resident_template_definitions?.template_code} · {request.resident_template_definitions?.title}</strong><small>{request.procedure_or_activity}</small></span><b>เปิดประเมิน →</b></button>)}</div> : <div className="qr-mismatch"><strong>ไม่พบคำขอที่ส่งถึงคุณ</strong><p>ชื่อ Staff ในคำขออาจไม่ตรงกับบัญชีที่กำลังใช้งาน กรุณาให้ Resident ตรวจสอบและส่งใหม่ ไม่สามารถเปิดคำขอของ Staff คนอื่นได้</p></div>}</> : <div className="scan-placeholder"><QrIcon size={52} /><strong>รอการสแกน QR</strong><p>ตรวจสอบชื่อ Resident ทุกครั้งก่อนเริ่มประเมิน</p></div>}</section></div>;
}
