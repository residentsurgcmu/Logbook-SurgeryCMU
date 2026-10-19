// Inspect and bounded-inflate the ZIP before ExcelJS loads it. No archive entry is trusted.
export const XLSX_LIMITS = Object.freeze({ file: 5 * 1024 ** 2, expanded: 24 * 1024 ** 2, entry: 6 * 1024 ** 2, entries: 256, ratio: 150 });
function bad() { throw new Error("ไฟล์ไม่ใช่ XLSX ที่รองรับ หรือมีขนาด/เนื้อหาที่ไม่อนุญาต กรุณาใช้แม่แบบจากระบบ"); }
const decoder = new TextDecoder("utf-8", { fatal: true });
function xmlAttribute(value) {
  const decoded = value.replace(/&(#x[0-9a-f]+|#[0-9]+|amp|lt|gt|quot|apos);/gi, (_, ref) => {
    if (ref[0] !== "#") return ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" })[ref.toLowerCase()];
    const n = ref[1].toLowerCase() === "x" ? parseInt(ref.slice(2), 16) : Number(ref.slice(1));
    if (!Number.isInteger(n) || n <= 0 || n > 0x10ffff || (n >= 0xd800 && n <= 0xdfff)) bad();
    return String.fromCodePoint(n);
  });
  if (/&[^\s]*;/.test(decoded)) bad();
  return decoded;
}
function validationRangeSize(ref) {
  const ends = ref.toUpperCase().split(":");
  if (!ends.length || ends.length > 2) bad();
  const coords = ends.map((end) => {
    const m = end.match(/^([A-Z]{1,3})([1-9][0-9]{0,2})$/); if (!m) bad();
    const col = [...m[1]].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0), row = Number(m[2]);
    if (col > 103 || row > 300) bad(); return [col, row];
  });
  const [left, top] = coords[0], [right, bottom] = coords[1] || coords[0];
  if (left > right || top > bottom) bad();
  return (right - left + 1) * (bottom - top + 1);
}
function inspectWorksheetRanges(xml) {
  // ExcelJS expands merges/validation sqrefs while loading; ZIP byte limits alone cannot bound that work.
  if (/<(?:[\w.-]+:)?mergeCells?(?:\s|\/?>)/i.test(xml)) bad();
  let expandedCells = 0, validations = 0;
  for (const tag of xml.matchAll(/<(?:[\w.-]+:)?dataValidation\b([^>]*)>/gi)) {
    if (++validations > 30900) bad();
    const attributes = new Map();
    for (const attr of tag[1].matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
      const key = attr[1].toLowerCase(); if (attributes.has(key)) bad();
      attributes.set(key, xmlAttribute(attr[2] ?? attr[3]));
    }
    const sqref = attributes.get("sqref"); if (!sqref?.trim()) bad();
    // Count overlapping/repeated refs too: each could cause another expansion in the upstream parser.
    for (const ref of sqref.matchAll(/\S+/g)) {
      expandedCells += validationRangeSize(ref[0]);
      if (expandedCells > 30900) bad();
    }
  }
}
function crc32(bytes) {
  let crc = -1;
  for (const byte of bytes) {
    crc ^= byte;
    for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ -1) >>> 0;
}
async function inflate(bytes, max) {
  let stream;
  try { stream = new DecompressionStream("deflate-raw"); }
  catch { throw new Error("เบราว์เซอร์นี้ยังอ่านไฟล์นำเข้าไม่ได้ กรุณาใช้ Chrome หรือ Edge รุ่นปัจจุบัน"); }
  const reader = new Blob([bytes]).stream().pipeThrough(stream).getReader();
  let size = 0; const chunks = [];
  try {
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > max) { await reader.cancel(); bad(); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const result = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
  return result;
}
export async function inspectManagedXlsx(input, filename = "template.xlsx") {
  if (!/\.xlsx$/i.test(filename)) bad();
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.byteLength < 22 || bytes.byteLength > XLSX_LIMITS.file) bad();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = bytes.length - 22;
  while (end >= Math.max(0, bytes.length - 65557) && view.getUint32(end, true) !== 0x06054b50) end--;
  if (end < 0 || end < bytes.length - 65557 || end + 22 + view.getUint16(end + 20, true) !== bytes.length) bad();
  const n = view.getUint16(end + 10, true), start = view.getUint32(end + 16, true), length = view.getUint32(end + 12, true);
  if (!n || n > XLSX_LIMITS.entries || view.getUint16(end + 4, true) || view.getUint16(end + 6, true) || view.getUint16(end + 8, true) !== n || start + length !== end) bad();
  let p = start, total = 0; const names = new Set(), files = new Map(), ranges = [];
  for (let i = 0; i < n; i++) {
    if (p + 46 > end || view.getUint32(p, true) !== 0x02014b50) bad();
    const flags = view.getUint16(p + 8, true), method = view.getUint16(p + 10, true);
    const crc = view.getUint32(p + 16, true), compressed = view.getUint32(p + 20, true), expanded = view.getUint32(p + 24, true);
    const nameSize = view.getUint16(p + 28, true), extra = view.getUint16(p + 30, true), comment = view.getUint16(p + 32, true), local = view.getUint32(p + 42, true);
    if (p + 46 + nameSize + extra + comment > end) bad();
    const nameBytes = bytes.subarray(p + 46, p + 46 + nameSize), name = decoder.decode(nameBytes);
    if (names.has(name.toLowerCase()) || /(^\/|\\|(^|\/)\.\.(\/|$)|\x00)/.test(name) || (flags & 1) || ![0, 8].includes(method)) bad();
    if (/vba|externalLinks|activeX|embeddings|\.bin$/i.test(name)) bad();
    names.add(name.toLowerCase()); total += expanded;
    if (expanded > XLSX_LIMITS.entry || total > XLSX_LIMITS.expanded || expanded > Math.max(1024, compressed * XLSX_LIMITS.ratio)) bad();
    if (local + 30 > start || view.getUint32(local, true) !== 0x04034b50 || view.getUint16(local + 8, true) !== method || view.getUint16(local + 6, true) !== flags) bad();
    const localNameSize = view.getUint16(local + 26, true), localExtra = view.getUint16(local + 28, true);
    const begin = local + 30 + localNameSize + localExtra, finish = begin + compressed;
    if (finish > start || decoder.decode(bytes.subarray(local + 30, local + 30 + localNameSize)) !== name) bad();
    if (ranges.some(([a, b]) => local < b && finish > a)) bad(); ranges.push([local, finish]);
    const content = method === 0 ? bytes.subarray(begin, finish) : await inflate(bytes.subarray(begin, finish), Math.min(expanded, XLSX_LIMITS.entry));
    if (content.length !== expanded || crc32(content) !== crc) bad();
    if (/\.(xml|rels)$/i.test(name)) {
      const xml = decoder.decode(content);
      if (/<!DOCTYPE|<!ENTITY|TargetMode\s*=\s*["']External|macroEnabled/i.test(xml)) bad();
      // Reject formulas anywhere, including cached results. Never evaluate formulas.
      if (/^xl\/worksheets\/.*\.xml$/i.test(name)) {
        inspectWorksheetRanges(xml);
        if (/<(?:\w+:)?f(?:\s|>|\/)/i.test(xml)) bad();
        let cellCount = 0, rowCount = 0;
        for (const row of xml.matchAll(/<(?:\w+:)?row\b([^>]*)>/gi)) {
          const index = row[1].match(/\br=["']([0-9]+)["']/)?.[1];
          if (!index || Number(index) < 1 || Number(index) > 300 || ++rowCount > 300) bad();
        }
        for (const cell of xml.matchAll(/<(?:\w+:)?c\b([^>]*)>/gi)) {
          const coord = cell[1].match(/\br=["']([A-Z]+)([0-9]+)["']/i);
          if (!coord || Number(coord[2]) < 1 || Number(coord[2]) > 300 || ++cellCount > 30900) bad();
          const column = [...coord[1].toUpperCase()].reduce((n, letter) => n * 26 + letter.charCodeAt(0) - 64, 0);
          if (column > 103) bad();
        }
        for (const col of xml.matchAll(/<(?:\w+:)?col\b([^>]*)>/gi)) {
          const max = col[1].match(/\bmax=["']([0-9]+)["']/)?.[1];
          if (!max || Number(max) > 103) bad();
        }
      }
      files.set(name, xml);
    }
    p += 46 + nameSize + extra + comment;
  }
  if (p !== end || !files.has("[Content_Types].xml") || !files.has("xl/workbook.xml")) bad();
  return bytes;
}
