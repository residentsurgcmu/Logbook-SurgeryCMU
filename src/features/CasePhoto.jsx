import React, { useEffect, useId, useLayoutEffect, useRef, useState } from "react";

export default function CasePhoto({ src, label, onRefresh, photos, startIndex = 0 }) {
  const viewer = useRef(null);
  const viewport = useRef(null);
  const center = useRef(null);
  const title = useId();
  const [index, setIndex] = useState(startIndex);
  const [hand, setHand] = useState(true);
  const drag = useRef(null);
  const picture = photos?.[index];
  const photoSrc = photos ? picture?.url : src;
  const photoLabel = picture?.caption || (photos ? `ภาพที่ ${index + 1}` : label);
  const [open, setOpen] = useState(false);
  const [scale, setScale] = useState(1);
  const [failedSrc, setFailedSrc] = useState(null);


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

  function move(next) {
    if (next < 0 || next >= photos.length) return;
    center.current = null;
    viewport.current?.scrollTo(0, 0);
    drag.current = null;
    setScale(1);
    setIndex(next);
    setFailedSrc(null);
  }

  function startPan(event) {
    if (!hand || scale <= 1 || event.button !== 0) return;
    const frame = event.currentTarget;
    drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, left: frame.scrollLeft, top: frame.scrollTop };
    frame.setPointerCapture(event.pointerId);
  }
  function pan(event) {
    const start = drag.current;
    if (start?.id !== event.pointerId) return;
    event.currentTarget.scrollTo(start.left + start.x - event.clientX, start.top + start.y - event.clientY);
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
      onClick={() => { setIndex(startIndex); setScale(1); setHand(true); setFailedSrc(null); setOpen(true); }}>
      {src ? <img src={src} alt={label} /> : <span className="case-media-empty">โหลดภาพไม่สำเร็จ · เปิดเพื่อลองใหม่</span>}
    </button>
    {open && <dialog ref={viewer} className="case-photo-dialog" aria-labelledby={title}
      onKeyDown={(event) => {
        if (event.key === "Escape") event.stopPropagation();
        if (photos?.length > 1 && event.target !== viewport.current && ["ArrowLeft", "ArrowRight"].includes(event.key)) {
          event.preventDefault();
          move(index + (event.key === "ArrowRight" ? 1 : -1));
        }
      }}
      onCancel={(event) => { event.preventDefault(); close(); }}>
      <div className="case-photo-layout">
        <div className="case-photo-title">
          <h3 id={title}>{photoLabel}</h3>
          <button type="button" className="secondary-button" onClick={close}>ปิดรูป</button>
        </div>
        <div className="case-photo-tools" role="group" aria-label="ขนาดภาพ">
          <button type="button" className="secondary-button" aria-label="ย่อรูป" disabled={scale === 1} onClick={() => zoom(scale - 0.5)}>−</button>
          <button type="button" className="secondary-button" onClick={() => zoom(1)}>พอดีจอ</button>
          <button type="button" className="secondary-button" aria-label="ขยายรูป" disabled={scale === 4} onClick={() => zoom(scale + 0.5)}>+</button>
          <button type="button" className="secondary-button" aria-pressed={hand && scale > 1} disabled={scale === 1} onClick={() => setHand(!hand)}>✋ ลากรูป</button>
          {photos?.length > 1 && <>
            <button type="button" className="secondary-button" aria-label="รูปก่อนหน้า" disabled={index === 0} onClick={() => move(index - 1)}>←</button>
            <span aria-live="polite">{index + 1} / {photos.length}</span>
            <button type="button" className="secondary-button" aria-label="รูปถัดไป" disabled={index === photos.length - 1} onClick={() => move(index + 1)}>→</button>
          </>}
          <output aria-live="polite">{scale === 1 ? "พอดีจอ" : `${scale * 100}%`}</output>
        </div>
        <div ref={viewport} className={`case-photo-viewport${hand && scale > 1 ? " case-photo-pan" : ""}`} tabIndex={0}
          onPointerDown={startPan} onPointerMove={pan} onLostPointerCapture={() => { drag.current = null; }} aria-label="พื้นที่ภาพ เลื่อนเพื่อดูส่วนที่ขยาย">
          {photoSrc && failedSrc !== photoSrc ? <div className="case-photo-canvas" style={{ "--case-photo-scale": scale }}>
            <img src={photoSrc} alt={photoLabel} draggable={false} onError={() => setFailedSrc(photoSrc)} />
          </div> : <div className="case-photo-unavailable">
            <p role="status">ไม่สามารถเปิดรูปได้</p>
            {onRefresh && <button type="button" className="secondary-button" onClick={() => { setFailedSrc(null); onRefresh(); }}>โหลดรูปล่าสุด</button>}
          </div>}
        </div>
      </div>
    </dialog>}
  </>;
}
