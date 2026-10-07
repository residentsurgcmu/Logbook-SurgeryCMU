import { EPA_CODES, PBA_CODES, PROGRESS_WARNING, bangkokProgressTime, progressResidents } from "./adminProgress.js";

function formatSheet(sheet) {
  sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF155426" } };
  sheet.eachRow((row) => { row.alignment = { vertical: "top", wrapText: true }; });
}

// Only explicitly permitted aggregate fields are copied; raw RPC rows never enter cells.
export function buildAdminProgressWorkbook(ExcelJS, { rows, generatedAt }) {
  const book = new ExcelJS.Workbook();
  book.creator = "Resident Corner";
  const read = book.addWorksheet("อ่านก่อน", { views: [{ state: "frozen", xSplit: 1, ySplit: 1 }] });
  read.columns = [{ header: "หัวข้อ", key: "topic", width: 28 }, { header: "คำอธิบาย", key: "description", width: 100 }];
  [
    ["ข้อมูล ณ", `${bangkokProgressTime(generatedAt)} (เวลาไทย)`],
    ["การใช้ไฟล์", PROGRESS_WARNING],
    ["ใช้แล้ว", "คำขอที่ไม่ถูกยกเลิก (รวมคำขอที่ยังรอประเมิน) + ผลประเมินที่ Admin บันทึกโดยตรง"],
    ["เพดาน", "จำนวนครั้งทั้งหมดที่ใช้ได้ รวมครั้งที่ Admin เพิ่มให้; ไม่จำกัด แปลว่าไม่มีเพดาน"],
    ["ปีนี้ (EPA)", "จำนวนครั้งที่ใช้ในปีการศึกษานี้ รวมคำขอที่ยังรอประเมิน"],
    ["ถึงเกณฑ์", "มีผลประเมินเสร็จครั้งใดครั้งหนึ่งที่ทุกเกณฑ์เป็น L4/L5 (M/E สำหรับ EPA 7)"],
    ["EPA ถึงเกณฑ์ x/8", "นับเฉพาะ EPA ที่นับในเกณฑ์สอบบอร์ด ไม่รวม EPA-8"],
    ["ทำแล้ว (PBA)", "จำนวนเรื่องที่มีผลประเมินเสร็จแล้วอย่างน้อยหนึ่งครั้ง เป้า 16 เรื่อง; คำขอที่รอไม่นับว่าทำแล้ว"],
    ["ปีนี้ (PBA)", "รวมจำนวนผลประเมินที่เสร็จในปีการศึกษานี้ (completed_this_year) เป้าปีละ 4 เรื่อง; อาจรวมการประเมินเรื่องเดิมหลายครั้ง"],
    ["รอประเมิน (PBA)", "จำนวนเรื่องที่มีคำขอรอประเมิน อาจเป็นเรื่องที่เคยประเมินเสร็จแล้วด้วย"],
    ["เครื่องหมาย PBA", "✓ = มีผลประเมินเสร็จแล้ว; … = มีแต่คำขอที่รอประเมิน; ช่องว่าง = ยังไม่ขอประเมิน"],
    ["รอประเมิน (EPA)", "ข้อความรอประเมินในช่องใช้แล้ว/เพดาน แสดงว่ามีคำขอรอ Staff"],
    ["ปีการศึกษา", "เริ่ม 1 กรกฎาคม; เพิ่มครั้งได้เฉพาะเพดานรวม ไม่ยกเลิกกฎหนึ่งคำขอต่อแบบประเมินต่อปีการศึกษา"],
    ["PGY", "ชั้นปีของ Resident"],
  ].forEach(([topic, description]) => read.addRow({ topic, description }));
  const epa = book.addWorksheet("EPA", { views: [{ state: "frozen", xSplit: 1, ySplit: 1 }] });
  const pba = book.addWorksheet("PBA", { views: [{ state: "frozen", xSplit: 1, ySplit: 1 }] });
  const identity = [{ header: "ชื่อ Resident", key: "name", width: 28 }, { header: "PGY", key: "pgy", width: 8 }];
  epa.columns = [...identity, ...EPA_CODES.flatMap((code) => {
    const label = code === "EPA-8" ? `${code} (ไม่นับในเกณฑ์สอบบอร์ด)` : code;
    return [
      { header: `${label} ใช้แล้ว/เพดาน`, key: `${code}_used`, width: code === "EPA-8" ? 34 : 24 },
      { header: `${label} ปีนี้`, key: `${code}_year`, width: 18 },
      { header: `${label} ถึงเกณฑ์`, key: `${code}_met`, width: 20 },
    ];
  }), { header: "EPA ถึงเกณฑ์ x/8", key: "summary", width: 24 }];
  pba.columns = [...identity,
    { header: "ทำแล้ว n เรื่อง (เป้า 16)", key: "done", width: 28 },
    { header: "ปีนี้ n เรื่อง (เป้าปีละ 4)", key: "year", width: 28 },
    { header: "รอประเมิน k", key: "pending", width: 18 },
    ...PBA_CODES.map((code) => ({ header: code, key: code, width: 12 })),
  ];
  const byResident = new Map();
  for (const row of rows) {
    if (!byResident.has(row.resident_id)) byResident.set(row.resident_id, new Map());
    byResident.get(row.resident_id).set(row.template_code, row);
  }
  for (const resident of progressResidents(rows)) {
    const forms = byResident.get(resident.id);
    const epaRow = { name: resident.name, pgy: resident.pgy };
    let met = 0;
    for (const code of EPA_CODES) {
      const form = forms.get(code);
      if (!form) continue; // Absent/inactive forms stay blank, never invent progress.
      epaRow[`${code}_used`] = `${form.attempts_used}/${form.attempts_cap ?? "ไม่จำกัด"}${form.has_pending ? " · รอประเมิน" : ""}`;
      epaRow[`${code}_year`] = form.attempts_this_year;
      epaRow[`${code}_met`] = form.met === true ? "ใช่" : "ไม่ใช่";
      if (code !== "EPA-8" && form.counts_for_board === true && form.met === true) met++;
    }
    epaRow.summary = `${met}/8`;
    epa.addRow(epaRow);
    const pbaRow = { name: resident.name, pgy: resident.pgy, done: 0, year: 0, pending: 0 };
    for (const code of PBA_CODES) {
      const form = forms.get(code);
      if (!form) continue;
      if (form.done === true) pbaRow.done++;
      pbaRow.year += form.completed_this_year || 0;
      if (form.has_pending === true) pbaRow.pending++;
      pbaRow[code] = form.done === true ? "✓" : form.has_pending === true ? "…" : "";
    }
    pba.addRow(pbaRow);
  }
  [read, epa, pba].forEach(formatSheet);
  return book;
}
