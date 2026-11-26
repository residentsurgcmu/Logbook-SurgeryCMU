import React, { useEffect, useId, useLayoutEffect, useRef, useState } from "react";

export default function CasePhoto({ src, label, onRefresh }) {
  const viewer = useRef(null);
  const viewport = useRef(null);
  const center = useRef(null);
  const title = useId();
  const [open, setOpen] = useState(false);
  const [scale, setScale] = useState(1);
  const [failedSrc, setFailedSrc] = useState(null);
  const failed = failedSrc === src;

  useEffect(() => {
    if (!open) return;
    const dialog = viewer.current;
    dialog.showModal();
    return () => { if (dialog.open) dialog.close(); };
  }, [open]);

  useLayoutEffect(() => {
    const frame = viewport.current;
    if (!frame || !center.current) return;
    const { x, y } = center.current;
    frame.scrollLeft = x * frame.scrollWidth - frame.clientWidth / 2;
    frame.scrollTop = y * frame.scrollHeight - frame.clientHeight / 2;
    center.current = null;
  }, [scale]);

  function close() {
    viewer.current?.close();
    setOpen(false);
  }

  function zoom(next) {
    const frame = viewport.current;
    if (next === scale || !frame) return;
    center.current = {
      x: (frame.scrollLeft + frame.clientWidth / 2) / frame.scrollWidth,
      y: (frame.scrollTop + frame.clientHeight / 2) / frame.scrollHeight,
    };
    setScale(next);
  }

  return <>
    <button type="button" className="case-photo-trigger" aria-label={`ดูรูปใหญ่: ${label}`}
      onClick={() => { setScale(1); setFailedSrc(null); setOpen(true); }}>
      {src ? <img src={src} alt={label} /> : <span className="case-media-empty">โหลดภาพไม่สำเร็จ · เปิดเพื่อลองใหม่</span>}
    </button>
    {open && <dialog ref={viewer} className="case-photo-dialog" aria-labelledby={title}
      onKeyDown={(event) => { if (event.key === "Escape") event.stopPropagation(); }}
      onCancel={(event) => { event.preventDefault(); close(); }}>
      <div className="case-photo-layout">
        <div className="case-photo-title">
          <h3 id={title}>{label}</h3>
          <button type="button" className="secondary-button" onClick={close}>ปิดรูป</button>
        </div>
        <div className="case-photo-tools" role="group" aria-label="ขนาดภาพ">
          <button type="button" className="secondary-button" aria-label="ย่อรูป" disabled={scale === 1} onClick={() => zoom(scale - 0.5)}>−</button>
          <button type="button" className="secondary-button" onClick={() => zoom(1)}>พอดีจอ</button>
          <button type="button" className="secondary-button" aria-label="ขยายรูป" disabled={scale === 4} onClick={() => zoom(scale + 0.5)}>+</button>
          <output aria-live="polite">{scale === 1 ? "พอดีจอ" : `${scale * 100}%`}</output>
        </div>
        <div ref={viewport} className="case-photo-viewport" tabIndex={0} aria-label="พื้นที่ภาพ เลื่อนเพื่อดูส่วนที่ขยาย">
          {src && !failed ? <div className="case-photo-canvas" style={{ "--case-photo-scale": scale }}>
            <img src={src} alt={label} onError={() => setFailedSrc(src)} />
          </div> : <div className="case-photo-unavailable">
            <p role="status">ไม่สามารถเปิดรูปได้</p>
            {onRefresh && <button type="button" className="secondary-button" onClick={() => { setFailedSrc(null); onRefresh(); }}>โหลดรูปล่าสุด</button>}
          </div>}
        </div>
      </div>
    </dialog>}
  </>;
}
