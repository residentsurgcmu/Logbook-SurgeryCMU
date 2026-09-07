export const essentialProcedures = [
  { id: "breast-ultrasound", category: "Essential — Common", operation: "Breast ultrasound", targets: [{ role: "Surgeon", count: 30 }] },
  { id: "percutaneous", category: "Essential — Common", operation: "Percutaneous procedures", targets: [{ role: "Supervisor", count: 10 }, { role: "Surgeon", count: 15 }] },
  { id: "duct-excision", category: "Essential — Common", operation: "Major ductal exploration / excision", targets: [{ role: "Surgeon", count: 1 }] },
  { id: "partial-mastectomy", category: "Essential — Common", operation: "Partial mastectomy / diagnostic excision", targets: [{ role: "Supervisor", count: 5 }, { role: "Surgeon", count: 10 }] },
  { id: "oncoplastic", category: "Essential — Common", operation: "Oncoplastic partial mastectomy", targets: [{ role: "Supervisor", count: 5 }, { role: "Surgeon", count: 10 }] },
  { id: "total-mastectomy", category: "Essential — Common", operation: "Total mastectomy", targets: [{ role: "Supervisor", count: 5 }, { role: "Surgeon", count: 10 }] },
  { id: "skin-sparing", category: "Essential — Common", operation: "Skin-sparing mastectomy", targets: [{ role: "Surgeon", count: 1 }, { role: "Assist", count: 5 }] },
  { id: "nipple-sparing", category: "Essential — Common", operation: "Nipple / areolar-sparing mastectomy", targets: [{ role: "Surgeon", count: 1 }, { role: "Assist", count: 5 }] },
  { id: "pedicle-flap", category: "Essential — Common", operation: "Pedicle flap reconstruction", targets: [{ role: "Assist", count: 2 }, { role: "Observe", count: 5 }] },
  { id: "breast-implant", category: "Essential — Common", operation: "Breast implant reconstruction", targets: [{ role: "Assist", count: 2 }, { role: "Observe", count: 5 }] },
  { id: "sentinel-node", category: "Essential — Common", operation: "Sentinel node biopsy", targets: [{ role: "Supervisor", count: 5 }, { role: "Surgeon", count: 10 }] },
  { id: "axillary-dissection", category: "Essential — Common", operation: "Level 1–2 axillary node dissection", targets: [{ role: "Supervisor", count: 2 }, { role: "Surgeon", count: 5 }] },
  { id: "level-3-node", category: "Essential — Uncommon", operation: "Level 3 node dissection", targets: [] },
  { id: "palliative-mastectomy", category: "Essential — Uncommon", operation: "Palliative mastectomy for stage 4 disease", targets: [] },
  { id: "chest-wall", category: "Essential — Uncommon", operation: "Chest wall recurrence / radical resection", targets: [] },
  { id: "local-flap", category: "Essential — Uncommon", operation: "Local tissue flap closure", targets: [] },
  { id: "free-flap", category: "Essential — Uncommon", operation: "Free flap reconstruction (TRAM / DIEP)", targets: [] },
  { id: "vacuum-biopsy", category: "Complex — As available", operation: "Vacuum-assisted core biopsy", targets: [] },
  { id: "wire-localization", category: "Complex — As available", operation: "Wire / seed / clip localization", targets: [] },
  { id: "tumor-ablation", category: "Complex — As available", operation: "Tumor ablation", targets: [] },
  { id: "gynecomastia", category: "Complex — As available", operation: "Subcutaneous mastectomy for gynecomastia", targets: [] },
  { id: "radical-mastectomy", category: "Complex — As available", operation: "Radical mastectomy", targets: [] },
];

export const epaTemplates = [
  {
    id: "EPA 1",
    title: "Basic breast cancer surgery",
    items: [
      "รวบรวมข้อมูลจากประวัติก้อนที่เต้านม",
      "ประเมินปัจจัยเสี่ยงของมะเร็งเต้านม",
      "ตรวจร่างกายผู้ป่วยอย่างเหมาะสม",
      "วางแผนการรักษามะเร็งเต้านม",
      "สื่อสารแผนการรักษากับผู้ป่วยและญาติ",
      "ผ่าตัด mastectomy",
      "ผ่าตัด breast-conserving surgery",
      "ผ่าตัด sentinel node biopsy",
    ],
  },
  { id: "EPA 2", title: "Advanced breast cancer surgery", items: ["ประเมินผู้ป่วยและระยะโรค", "เลือกแผนการรักษาและวิธีผ่าตัด", "Nipple / skin-sparing mastectomy", "Axillary management และ targeted axillary dissection", "สื่อสารและดูแลภาวะแทรกซ้อน"] },
  { id: "EPA 3", title: "Breast intervention", items: ["Breast ultrasound", "FNA / cyst aspiration", "Core needle biopsy", "Drainage procedure", "Image-guided localization"] },
  { id: "EPA 4", title: "Research progression and development", items: ["กำหนดคำถามวิจัย", "ออกแบบโครงการและจริยธรรมวิจัย", "รวบรวมและวิเคราะห์ข้อมูล", "นำเสนอหรือเผยแพร่ผลงาน"] },
  { id: "EPA 5", title: "Neoadjuvant and adjuvant therapy", items: ["ประเมินข้อบ่งชี้", "เลือก systemic therapy", "ติดตามผลและความเป็นพิษ", "ประสานการดูแลแบบสหสาขา"] },
  { id: "EPA 6", title: "Breast imaging interpretation", items: ["Mammography", "Breast / nodal ultrasound", "Breast MRI", "สรุปผลเพื่อวางแผนการรักษา"] },
  { id: "EPA 7", title: "Genetic counseling and interpretation", items: ["ซักประวัติความเสี่ยงทางพันธุกรรม", "เลือกการตรวจที่เหมาะสม", "อ่านและแปลผลตรวจ", "วางแผนรักษาและติดตาม", "สื่อสารกับผู้ป่วยและญาติ"] },
];

export const pbaTemplates = [
  {
    id: "PBA 1",
    title: "Total mastectomy and axillary lymph node biopsy",
    sections: {
      "I. Content": [
        "C1 Knowledge of indications and contraindications: staging, choice of breast surgery, axillary management and patient preference",
        "C2 Awareness of sequelae: hematoma, seroma, infection, nerve injury and lymphedema",
        "C3 Knowledge of operative complications",
        "C4 Explains the perioperative process to the patient or relatives",
        "C5 Explains likely outcome and recovery time",
      ],
      "II. Pre-operative planning": [
        "PL1 Understands breast and axillary anatomy, lymphatic drainage, nerves and vessels",
        "PL2 Selects appropriate equipment, material and devices",
        "PL3 Checks equipment and device requirements with operating room staff",
        "PL4 Reviews patient records and preoperative investigations personally",
      ],
      "III. Pre-operative preparation": [
        "PR1 Confirms that consent has been obtained", "PR2 Gives an effective briefing to the operating team",
        "PR3 Ensures safe positioning on the operating table", "PR4 Performs careful skin preparation",
        "PR5 Performs careful draping of the operative field", "PR6 Ensures equipment and materials are deployed safely",
        "PR7 Ensures appropriate drug administration",
      ],
      "IV. Exposure and closure": [
        "E1 Plans an elliptical incision incorporating the biopsy scar", "E2 Achieves adequate exposure",
        "E3 Completes wound closure properly", "E4 Uses the surgical drain properly",
      ],
      "V. Intraoperative technique": [
        "IT1 Handles tissue consistently with minimal damage", "IT2 Uses instruments appropriately and safely",
        "IT3 Anticipates and responds to anatomical variation", "IT4 Deals calmly and effectively with untoward events",
        "IT5 Uses the assistant effectively", "IT6 Communicates clearly with scrub team and anesthetist",
        "IT7 Identifies mastectomy boundaries, axillary vein and relevant nerves", "IT8 Achieves adequate hemostasis",
      ],
      "VI. Post-operative management": [
        "PM1 Ensures safe transfer from table to bed", "PM2 Constructs a clear operative note",
        "PM3 Records clear postoperative instructions",
      ],
    },
  },
  {
    id: "PBA 2",
    title: "Breast conserving surgery",
    sections: {
      "I. Content": [
        "C1 Knowledge of indications and contraindications: staging, BCS contraindications and patient preference",
        "C2 Awareness of sequelae: hematoma, seroma, infection, asymmetry, inadequate margin and re-excision",
        "C3 Knowledge of operative complications", "C4 Explains the perioperative process to the patient or relatives",
        "C5 Explains likely outcome and recovery time", "C6 Explains adjuvant radiation",
      ],
      "II. Pre-operative planning": [
        "PL1 Understands breast anatomy and parenchymal volume",
        "PL2 Selects appropriate equipment including intraoperative ultrasound and metallic clips",
        "PL3 Checks equipment and device requirements with operating room staff",
        "PL4 Reviews patient records and preoperative investigations personally",
      ],
      "III. Pre-operative preparation": [
        "PR1 Confirms that consent has been obtained", "PR2 Gives an effective briefing to the operating team",
        "PR3 Ensures safe positioning on the operating table", "PR4 Performs careful skin preparation",
        "PR5 Performs careful draping of the operative field", "PR6 Ensures equipment and materials are deployed safely",
        "PR7 Ensures appropriate drug administration",
      ],
      "IV. Exposure and closure": [
        "E1 Plans an incision incorporating the biopsy scar", "E2 Achieves adequate exposure",
        "E3 Completes wound closure properly",
      ],
      "V. Intraoperative technique": [
        "IT1 Handles tissue consistently with minimal damage", "IT2 Uses instruments appropriately and safely",
        "IT3 Anticipates and responds to anatomical variation", "IT4 Deals calmly and effectively with untoward events",
        "IT5 Uses the assistant effectively", "IT6 Communicates clearly with scrub team and anesthetist",
        "IT7 Achieves wide excision with an adequate margin", "IT8 Achieves adequate hemostasis",
        "IT9 Places metallic clips to identify the tumor bed", "IT10 Orients the wide excision specimen",
      ],
      "VI. Post-operative management": [
        "PM1 Ensures safe transfer from table to bed", "PM2 Constructs a clear operative note",
        "PM3 Records clear postoperative instructions",
      ],
    },
  },
  {
    id: "PBA 3",
    title: "Sentinel lymph node biopsy",
    sections: {
      "I. Content": [
        "C1 Knowledge of indications and contraindications for DCIS and early breast cancer",
        "C2 Awareness of sequelae and need for further axillary surgery when indicated",
        "C3 Knowledge of complications: hematoma, seroma, infection and nerve injury",
        "C4 Explains the perioperative process to the patient or relatives", "C5 Explains likely outcome and recovery time",
      ],
      "II. Pre-operative planning": [
        "PL1 Understands lymphatic drainage of the breast", "PL2 Selects blue dye or radioisotope appropriately",
        "PL3 Checks equipment and device requirements with operating room staff",
        "PL4 Reviews patient records and preoperative investigations personally",
        "PL5 Contacts pathology for intraoperative sentinel-node assessment",
      ],
      "III. Pre-operative preparation": [
        "PR1 Confirms that consent has been obtained", "PR2 Gives an effective briefing to the operating team",
        "PR3 Ensures safe positioning on the operating table", "PR4 Performs careful skin preparation",
        "PR5 Performs careful draping of the operative field", "PR6 Ensures equipment and materials are deployed safely",
        "PR7 Ensures appropriate drug administration",
      ],
      "IV. Exposure and closure": [
        "E1 Plans an axillary incision at the lower hair line", "E2 Achieves adequate exposure",
        "E3 Completes wound closure properly", "E4 Uses a drain if further axillary dissection is performed",
      ],
      "V. Intraoperative technique": [
        "IT1 Handles tissue consistently with minimal damage", "IT2 Uses instruments appropriately and safely",
        "IT3 Anticipates and responds to anatomical variation", "IT4 Deals calmly and effectively with untoward events",
        "IT5 Uses the assistant effectively", "IT6 Communicates clearly with scrub team and anesthetist",
        "IT7 Performs blue-dye injection, breast massage and sentinel-node identification correctly",
        "IT8 Achieves adequate hemostasis",
      ],
      "VI. Post-operative management": [
        "PM1 Ensures safe transfer from table to bed", "PM2 Constructs a clear operative note",
        "PM3 Records clear postoperative instructions",
      ],
    },
  },
];

export const participationOptions = ["Surgeon", "Supervisor", "Assist", "Observe"];
export const essentialRoles = participationOptions;
