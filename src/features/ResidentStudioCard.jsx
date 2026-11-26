import React, { useState } from "react";
import chip from "../assets/resident-card/chip-waves.svg";
import waves from "../assets/resident-card/waves.svg";
import { RESIDENT_CARD_EDITIONS } from "../mySpaceLayouts";

export default function ResidentStudioCard({ card, name, pgy, hideAwards }) {
  const [showBack, setShowBack] = useState(false);
  const back = showBack && !hideAwards;
  const edition = RESIDENT_CARD_EDITIONS.find(([id]) => id === card.edition)[1];
  return <>
    <div className={`ms-studio-card ms-studio-card-${card.edition}`}>
    <div className="ms-studio-brand"><strong>Resident Corner</strong><span>{edition}</span></div>
    {!back && card.motif !== "off" && <div className={`ms-studio-motif ms-studio-motif-${card.motif}`}>
      <img src={card.motif === "chip" ? chip : waves} alt="" />
      <span>ลาย NFC · ยังแตะไม่ได้</span>
    </div>}
    {back ? <div className="ms-studio-identity"><h3>ผลงานที่เลือกแสดง</h3><p>ยังไม่มีทะเบียนผลงานที่ยืนยันแล้ว</p></div> : <div className="ms-studio-identity">
      {pgy && <span className="ms-studio-pgy">PGY {pgy}</span>}
      <h3>{name || "Resident"}</h3>
      <p>ภาควิชาศัลยศาสตร์ · คณะแพทยศาสตร์ มช.</p>
    </div>}
    </div>
    {!hideAwards && <button type="button" className="ms-link" onClick={() => setShowBack((prev) => !prev)}>
      {back ? "ดูด้านหน้า" : "ดูด้านผลงาน"}
    </button>}
  </>;
}
