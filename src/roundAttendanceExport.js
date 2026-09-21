const BANGKOK_TIME_ZONE = "Asia/Bangkok";
const A4_LANDSCAPE = [841.89, 595.28];
const PAGE_LEFT = 36;
const PAGE_RIGHT = A4_LANDSCAPE[0] - 36;
const PAGE_BOTTOM = 42;

const thaiDate = (value) =>
  new Intl.DateTimeFormat("th-TH", {
    dateStyle: "full",
    timeZone: BANGKOK_TIME_ZONE,
  }).format(new Date(`${value}T00:00:00+07:00`));

const thaiTime = (value) =>
  new Intl.DateTimeFormat("th-TH", {
    dateStyle: "medium",
    timeStyle: "medium",
    timeZone: BANGKOK_TIME_ZONE,
  }).format(new Date(value));

const safeFilename = (value) =>
  String(value || "MM-Grand-Round")
    .replace(/[^a-zA-Z0-9ก-๙_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function wrapText(value, font, size, maxWidth) {
  const source = String(value ?? "—").trim() || "—";
  const lines = [];
  let line = "";
  const append = (part) => {
    const candidate = line ? `${line} ${part}` : part;
    if (line && font.widthOfTextAtSize(candidate, size) > maxWidth) {
      lines.push(line);
      line = part;
    } else {
      line = candidate;
    }
  };
  for (const word of source.split(/\s+/)) {
    if (font.widthOfTextAtSize(word, size) <= maxWidth) {
      append(word);
      continue;
    }
    let fragment = "";
    for (const character of Array.from(word)) {
      if (fragment && font.widthOfTextAtSize(fragment + character, size) > maxWidth) {
        append(fragment);
        fragment = character;
      } else {
        fragment += character;
      }
    }
    if (fragment) append(fragment);
  }
  if (line) lines.push(line);
  return lines.length ? lines : ["—"];
}

export function roundSessionsInDateRange(sessions, dateFrom, dateTo) {
  return [...sessions]
    .filter((session) => (!dateFrom || session.meeting_date >= dateFrom) && (!dateTo || session.meeting_date <= dateTo))
    .sort((left, right) => left.meeting_date.localeCompare(right.meeting_date));
}

export function filterRoundAttendance(attendance, filters = {}) {
  return attendance.filter((row) => {
    if (filters.residentId && row.user_id !== filters.residentId) return false;
    if (filters.pgy && (row.role_at_check_in !== "resident" || Number(row.resident_profiles?.pgy) !== Number(filters.pgy))) return false;
    return true;
  });
}

function rowsForSession(attendance, sessionId) {
  return attendance
    .filter((row) => row.session_id === sessionId)
    .sort((left, right) => new Date(left.checked_in_at) - new Date(right.checked_in_at));
}

export async function createRoundAttendancePdf(sessions, attendance, label) {
  const [{ PDFDocument, rgb }, fontkitModule] = await Promise.all([
    import("pdf-lib"),
    import("@pdf-lib/fontkit"),
  ]);
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkitModule.default);
  const fontBytes = await fetch("/fonts/NotoSansThai.ttf").then((response) => {
    if (!response.ok) throw new Error("โหลดฟอนต์ภาษาไทยสำหรับ PDF ไม่สำเร็จ");
    return response.arrayBuffer();
  });
  const font = await pdf.embedFont(fontBytes, { subset: true });
  const green = rgb(0.082, 0.329, 0.149);
  const ink = rgb(0.09, 0.14, 0.11);
  const muted = rgb(0.35, 0.42, 0.37);
  const line = rgb(0.82, 0.87, 0.83);
  const soft = rgb(0.95, 0.98, 0.96);
  const columns = [30, 170, 70, 220, 90, 160];
  const headers = ["ลำดับ", "ชื่อ", "PGY", "อีเมล", "บทบาท", "Timestamp scan QR (Asia/Bangkok)"];
  let page;
  let y;

  const addPage = () => {
    page = pdf.addPage(A4_LANDSCAPE);
    y = 555;
    page.drawText("MM & Grand Round Conference · รายงานการเข้าประชุม", {
      x: PAGE_LEFT,
      y,
      size: 16,
      font,
      color: green,
    });
    y -= 20;
    page.drawText(label, { x: PAGE_LEFT, y, size: 9, font, color: muted });
    y -= 20;
  };

  const drawTableHeader = () => {
    const headerHeight = 21;
    page.drawRectangle({
      x: PAGE_LEFT,
      y: y - headerHeight + 4,
      width: PAGE_RIGHT - PAGE_LEFT,
      height: headerHeight,
      color: soft,
    });
    let x = PAGE_LEFT + 5;
    headers.forEach((header, index) => {
      page.drawText(header, { x, y: y - 10, size: 8, font, color: green });
      x += columns[index];
    });
    y -= headerHeight;
  };

  const drawSessionHeading = (session, count, continued = false) => {
    const text = `${continued ? "ต่อเนื่อง · " : ""}${thaiDate(session.meeting_date)} · ผู้เช็กชื่อ ${count} คน`;
    page.drawText(text, { x: PAGE_LEFT, y, size: 11, font, color: ink });
    y -= 17;
    drawTableHeader();
  };

  const startSessionPage = (session, count, continued) => {
    addPage();
    drawSessionHeading(session, count, continued);
  };

  addPage();
  sessions.forEach((session, sessionIndex) => {
    const rows = rowsForSession(attendance, session.id);
    if (sessionIndex > 0 && y < PAGE_BOTTOM + 55) addPage();
    drawSessionHeading(session, rows.length);
    if (!rows.length) {
      page.drawText("ยังไม่มีผู้เช็กชื่อ", { x: PAGE_LEFT, y, size: 9, font, color: muted });
      y -= 22;
      return;
    }
    rows.forEach((row, index) => {
      const cells = [
        String(index + 1),
        row.resident_profiles?.full_name || "—",
        row.resident_profiles?.pgy ? `PGY ${row.resident_profiles.pgy}` : "—",
        row.resident_profiles?.email || "—",
        row.role_at_check_in === "staff" ? "Staff" : "Resident",
        thaiTime(row.checked_in_at),
      ];
      const lineGroups = cells.map((cell, cellIndex) =>
        wrapText(cell, font, 8, columns[cellIndex] - 8),
      );
      const rowHeight = Math.max(...lineGroups.map((lines) => lines.length)) * 12 + 9;
      if (y - rowHeight < PAGE_BOTTOM) {
        startSessionPage(session, rows.length, true);
      }
      let x = PAGE_LEFT + 5;
      lineGroups.forEach((lines, cellIndex) => {
        lines.forEach((text, lineIndex) => {
          page.drawText(text, { x, y: y - 10 - lineIndex * 12, size: 8, font, color: ink });
        });
        x += columns[cellIndex];
      });
      y -= rowHeight;
      page.drawLine({
        start: { x: PAGE_LEFT, y },
        end: { x: PAGE_RIGHT, y },
        thickness: 0.45,
        color: line,
      });
      y -= 1;
    });
    y -= 12;
  });
  const pages = pdf.getPages();
  pages.forEach((item, index) => {
    item.drawText(`หน้า ${index + 1}/${pages.length} · สำหรับการบริหารการศึกษา`, {
      x: PAGE_LEFT,
      y: 22,
      size: 8,
      font,
      color: muted,
    });
  });
  return pdf.save();
}

export async function exportRoundAttendancePdf({ sessions, attendance, splitByDate }) {
  if (!sessions.length) throw new Error("ไม่พบวันประชุมตามช่วงวันที่ที่เลือก");
  if (splitByDate) {
    for (const session of sessions) {
      const bytes = await createRoundAttendancePdf([session], attendance, `วันที่ประชุม: ${thaiDate(session.meeting_date)}`);
      download(new Blob([bytes], { type: "application/pdf" }), `${safeFilename(`MM-Grand-Round-${session.meeting_date}`)}.pdf`);
    }
    return sessions.length;
  }
  const firstDate = sessions[0].meeting_date;
  const lastDate = sessions[sessions.length - 1].meeting_date;
  const label = firstDate === lastDate
    ? `วันที่ประชุม: ${thaiDate(firstDate)}`
    : `ช่วงวันที่: ${thaiDate(firstDate)} – ${thaiDate(lastDate)}`;
  const bytes = await createRoundAttendancePdf(sessions, attendance, label);
  download(new Blob([bytes], { type: "application/pdf" }), `${safeFilename(`MM-Grand-Round-${firstDate}-to-${lastDate}`)}.pdf`);
  return 1;
}
