import React, { useLayoutEffect, useRef } from "react";
import { MY_SPACE_LAYOUTS, MY_SPACE_CARD_LABELS, MY_SPACE_CARD_ORDER, MY_SPACE_CARD_SIZES, withMySpaceCardSize } from "../mySpaceLayouts";

export default function MySpaceLayoutSettings({ draft, setDraft, radarAvailable, onClose, onSave }) {
  const dialog = useRef(null);
  useLayoutEffect(() => {
    const element = dialog.current;
    const trigger = document.activeElement;
    element.showModal();
    return () => {
      if (element.open) element.close();
      trigger?.focus({ preventScroll: true });
    };
  }, []);
  const configurable = MY_SPACE_CARD_ORDER[draft.layout].filter((key) =>
    (key !== "radar" || radarAvailable) && (key !== "awards" || !draft.hideAwards));
  return <dialog ref={dialog} className="ms-layout-dialog" aria-label="จัดหน้า My Space"
    onCancel={(event) => { event.preventDefault(); onClose(); }}>
    <div className="ms-layout-dialog-head"><h2>จัดหน้า My Space</h2></div>
    <div className="ms-layout-dialog-body">
      <fieldset className="ms-layout-options">
        <legend>เลือกแม่แบบ</legend>
        <div className="ms-layout-choices">
          {MY_SPACE_LAYOUTS.map(([key, title, description]) => <label key={key} className="ms-layout-choice">
            <input type="radio" name="my-space-layout" checked={draft.layout === key}
              onChange={() => setDraft((current) => ({ ...current, layout: key }))} />
            <span className={`ms-layout-mini ms-layout-mini-${key}`} aria-hidden="true"><i /><i /><i /></span>
            <strong>{title}</strong><span>{description}</span>
          </label>)}
        </div>
      </fieldset>
      <label className="ms-layout-awards"><input type="checkbox" checked={draft.hideAwards}
        onChange={(e) => setDraft((current) => ({ ...current, hideAwards: e.target.checked }))} /> ซ่อนถ้วยและเหรียญทุกแม่แบบ</label>
      {configurable.length > 0 && <fieldset className="ms-layout-options ms-layout-sizes">
        <legend>ขนาดการ์ดในแม่แบบนี้</legend>
        {configurable.map((key) => <label key={key}>{MY_SPACE_CARD_LABELS[key]}
          <select value={draft.cards[draft.layout]?.[key] ?? "default"}
            onChange={(e) => setDraft((current) => withMySpaceCardSize(current, current.layout, key, e.target.value))}>
            {MY_SPACE_CARD_SIZES.map(([size, label]) => <option key={size} value={size}>{label}</option>)}
          </select>
        </label>)}
      </fieldset>}
      <p>การตั้งค่าจำไว้สำหรับบัญชีนี้ในเบราว์เซอร์เครื่องนี้</p>
    </div>
    <div className="ms-layout-dialog-actions">
      <button type="button" className="secondary-button" onClick={onClose}>ยกเลิก</button>
      <button type="button" className="primary-button" onClick={onSave}>ใช้แม่แบบ</button>
    </div>
  </dialog>;
}
