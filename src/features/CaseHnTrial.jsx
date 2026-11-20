import React, { useEffect, useRef, useState } from "react";
import { supabase } from "../supabase";
import { isCaseHnTrialEnabled, isSyntheticCaseHn, sealTrialHn } from "../caseHnTrialCrypto";

export const caseHnTrialEnabled = isCaseHnTrialEnabled(
  import.meta.env.VITE_CASE_HN_TRIAL, import.meta.env.VITE_SUPABASE_URL,
);
export default function CaseHnTrial({ actorId, caseUuid, caseCode }) {
  const [status, setStatus] = useState(undefined);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const epoch = useRef(0);
  const hnRef = useRef(null);
  const call = async (operation, args = {}) => {
    const { data, error } = await supabase.rpc("rc_hn_case_trial", {p_case_id: caseUuid, p_operation: operation, ...args});
    if (error) throw error;
    return data;
  };
  useEffect(() => {
    const current = ++epoch.current;
    call("status").then((data) => {
      if (current === epoch.current) setStatus(data);
    }).catch(() => {
      if (current === epoch.current) setMessage("ตรวจสถานะ HN ไม่สำเร็จ ลองปิดแล้วเปิดรายละเอียดใหม่");
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT" || session?.user?.id !== actorId) {
        ++epoch.current;
        setStatus(null);
        setMessage("");
      }
    });
    return () => { ++epoch.current; subscription.unsubscribe(); };
  }, [actorId, caseUuid]);

  async function stillCurrent(current) {
    if (current !== epoch.current) return false;
    const { data } = await supabase.auth.getSession();
    return current === epoch.current && data.session?.user?.id === actorId;
  }
  async function save() {
    if (busy || !status) return;
    const current = epoch.current;
    setBusy(true);
    setMessage("");
    try {
      const hn = hnRef.current.value.trim();
      hnRef.current.value = "";
      if (!isSyntheticCaseHn(hn)) {
        setMessage("ใช้ HN สมมติรูปแบบ DEMO-123456");
        return;
      }
      const publicKey = status.publicKey;
      const sealed = await sealTrialHn({publicKey, configuredKey:publicKey?.keyId, caseUuid, caseCode, hn});
      if (!await stillCurrent(current)) return;
      const result = await call("save", {p_key_id:sealed.keyId, p_ciphertext:sealed.ciphertext, p_revision:status.revision});
      if (current !== epoch.current) return;
      setStatus((previous) => ({...previous, ...result}));
      setMessage("บันทึก HN แล้ว");
    } catch (error) {
      if (current !== epoch.current) return;
      if (error?.code === "40001") {
        const refreshed = await call("status").catch(() => null);
        if (current !== epoch.current) return;
        setStatus(refreshed);
        setMessage("มีการแก้ไขจากที่อื่น กรุณาตรวจสถานะก่อนกรอกใหม่");
      } else {
        setMessage("ยืนยันการบันทึกไม่ได้ ตรวจสถานะและกุญแจก่อนส่งซ้ำ");
      }
    } finally {
      if (current === epoch.current) setBusy(false);
    }
  }
  if (!status && !message) return null;
  return <section className="case-field" aria-label="HN ระบบซ้อม">
    <strong>HN · ระบบซ้อม</strong>
    {status && <p>{status.saved ? "บันทึก HN แล้ว" : "ยังไม่ได้บันทึก HN"}</p>}
    {status?.canWrite && <>
      <label>HN สมมติ<input ref={hnRef} placeholder="DEMO-123456" autoComplete="off" spellCheck={false} maxLength={11} disabled={busy} /></label>
      <button type="button" className="secondary-button" disabled={busy} onClick={save}>{status.saved ? "แทนที่ HN สมมติ" : "บันทึก HN สมมติ"}</button>
    </>}
    {message && <p role="status">{message}</p>}
  </section>;
}
