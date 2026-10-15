import React, { useState } from "react";
import { DownloadIcon } from "../components/Icons";
import { exportExamExcel } from "../examExcelExport";

export default function ExamExportButton({ event, disabled = false, hint = "" }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function run() {
    setBusy(true);
    setError("");
    try {
      await exportExamExcel(event);
    } catch (nextError) {
      setError(nextError.message || "สร้างไฟล์ Excel ไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <button type="button" className="secondary-button icon-button" disabled={busy || disabled} onClick={run}><DownloadIcon />{busy ? "กำลังสร้าง Excel…" : "ส่งออก Excel"}</button>
      {hint && <p className="muted-empty">{hint}</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
    </>
  );
}
