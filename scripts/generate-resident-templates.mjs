import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const epa7 = "EPA/EPA7 ประเมิน 2 ครั้ง-Basic Laparoscopic.docx";
const epaTitles = [
  "Multiple trauma assessment and management",
  "Management of acute abdomen",
  "Management of Gastrointestinal Bleeding",
  "Management of common hepato-biliary and pancreatic diseases",
  "Management of breast mass in women",
  "Common problem in vascular disease",
];
const pbaTitles = [
  "Amputation",
  "Appendectomy",
  "AVF",
  "Breast Conservative Surgery (BCS)",
  "Colectomy",
  "Colonoscope",
  "Colostomy",
  "EGD",
  "Hemorrhoidectomy",
  "Hernia",
  "Intestinal anastomosis",
  "Laparoscopic cholecystectomy (LC)",
  "Liver resection",
  "Modified radical mastectomy (MRM)",
  "Open cholecystectomy (OC)",
  "PEG",
  "Splenectomy",
  "Thyroid surgery",
  "Tracheostomy",
  "Varicose vein (VV)",
  "Other operation",
];
const pgyRecommendations = {
  1: [2, 19, 16, 10],
  2: [8, 1, 15, 11],
  3: [6, 7, 17, 12, 3, 20],
  4: [5, 9, 4, 14, 13],
};
const epaLegend = [
  ["L1", "ไม่มีความรู้ความเข้าใจ หรือยังไม่สามารถปฏิบัติได้เอง"],
  [
    "L2",
    "ความรู้ความเข้าใจบ้าง หรือสามารถปฏิบัติได้บ้าง ต้องได้รับการควบคุมดูแลใกล้ชิด",
  ],
  [
    "L3",
    "มีความรู้ความเข้าใจพอควร หรือปฏิบัติได้เองเป็นส่วนใหญ่โดยต้องการคำแนะนำเพียงเล็กน้อย",
  ],
  [
    "L4",
    "มีความรู้ความเข้าใจเป็นอย่างดี หรือปฏิบัติได้เองเป็นส่วนใหญ่โดยต้องการคำแนะนำเพียงเล็กน้อย",
  ],
  [
    "L5",
    "มีความรู้ความเข้าใจเป็นอย่างดี สามารถสอนผู้อื่น หรือควบคุมผู้มีประสบการณ์น้อยกว่าปฏิบัติงานได้",
  ],
];
const fmeLegend = [
  ["F", "Fails"],
  ["M", "Meets expectation"],
  ["E", "Exceeds"],
];
const epaOutcomes = ["Excellence", "Pass", "Boarderline", "Fail"];
const pbaOutcomes = ["F", "M", "E"];

function tables(relativePath) {
  return JSON.parse(
    execFileSync(
      "python3",
      [
        path.join(root, "scripts/extract-resident-docx.py"),
        path.join(root, relativePath),
      ],
      { encoding: "utf8" },
    ),
  );
}
function sourceHash(relativePath) {
  return createHash("sha256")
    .update(readFileSync(path.join(root, relativePath)))
    .digest("hex");
}
function template(
  code,
  type,
  title,
  sourceFile,
  labels,
  options,
  legend,
  outcomes,
  maxAttempts,
  recommendedPgy = [],
) {
  const present = labels.map((label) => label?.trim()).filter(Boolean);
  if (!present.length || present.length !== labels.length)
    throw new Error(`Missing criteria in ${sourceFile}`);
  return {
    code,
    type,
    title,
    sourceFile,
    sourceHash: sourceHash(sourceFile),
    scoreOptions: options,
    scoreLegend: legend,
    outcomeOptions: outcomes,
    maxAttempts,
    requiresSelfAssessment: type === "PBA",
    recommendedPgy,
    criteria: present.map((label, index) => ({
      code: `C${index + 1}`,
      label,
      section: "Assessment criteria",
      sortOrder: index + 1,
    })),
  };
}

const catalog = [];
const epaFiles = readdirSync(path.join(root, "EPA")).filter((name) =>
  name.endsWith(".docx"),
);
for (let number = 1; number <= 6; number++) {
  const name = epaFiles.find((entry) => entry.startsWith(`EPA${number}-`));
  if (!name) throw new Error(`EPA ${number} source is missing`);
  const relative = `EPA/${name}`;
  const labels = tables(relative)
    .filter((table) => table[0]?.[0]?.trim() === "หัวข้อ")
    .flatMap((table) =>
      table
        .slice(1)
        .map((row) => row[0]?.trim())
        .filter(Boolean),
    );
  catalog.push(
    template(
      `EPA-${number}`,
      "EPA",
      `EPA ${number} ${epaTitles[number - 1]}`,
      relative,
      labels,
      ["L1", "L2", "L3", "L4", "L5"],
      epaLegend,
      epaOutcomes,
      2,
    ),
  );
}
const epa7Tables = tables(epa7);
catalog.push(
  template(
    "EPA-7-L1-L2",
    "EPA",
    "EPA 7 Basic Laparoscopic surgical skill Level 1–2",
    epa7,
    [...epa7Tables[1].slice(1), ...epa7Tables[2].slice(1)].map((row) =>
      row[0]?.trim(),
    ),
    ["F", "M", "E"],
    fmeLegend,
    epaOutcomes,
    1,
  ),
);
catalog.push(
  template(
    "EPA-7-L3",
    "EPA",
    "EPA 7 Basic Laparoscopic surgical skill Level 3",
    epa7,
    epa7Tables[4].slice(1).map((row) => row[0]?.trim()),
    ["F", "M", "E"],
    fmeLegend,
    epaOutcomes,
    1,
  ),
);

const opd = "EPA/EPA_OPD.docx";
const opdItems = tables(opd)[0][2][0]
  .split("\n")
  .filter((line) => /^[๑-๙][.．][๑-๙]/u.test(line));
if (opdItems.length !== 8)
  throw new Error(`Expected 8 EPA OPD criteria, found ${opdItems.length}`);
catalog.push(
  template(
    "EPA-8",
    "EPA",
    "EPA 8 Management of out-patient departments",
    opd,
    opdItems,
    ["L1", "L2", "L3", "L4", "L5"],
    epaLegend,
    ["ผ่านการประเมิน", "ไม่ผ่านการประเมิน"],
    null,
  ),
);

const pbaFiles = readdirSync(path.join(root, "PBA")).filter((name) =>
  name.endsWith(".docx"),
);
for (let number = 1; number <= 21; number++) {
  const name = pbaFiles.find((entry) => entry.startsWith(`${number}.`));
  if (!name) throw new Error(`PBA ${number} source is missing`);
  const relative = `PBA/${name}`;
  const rows = tables(relative).flatMap((table) => table);
  const scoredRows = rows.filter(
    (row) =>
      row.length >= 3 &&
      /^F\s*M\s*E$/i.test(row[1]?.replace(/\s+/g, " ").trim()) &&
      /^F\s*M\s*E$/i.test(row[2]?.replace(/\s+/g, " ").trim()),
  );
  catalog.push(
    template(
      `PBA-${String(number).padStart(2, "0")}`,
      "PBA",
      `PBA ${pbaTitles[number - 1]}`,
      relative,
      scoredRows.map((row) => row[0]?.trim()),
      ["F", "M", "E"],
      fmeLegend,
      pbaOutcomes,
      null,
      Object.entries(pgyRecommendations)
        .filter(([, items]) => items.includes(number))
        .map(([pgy]) => Number(pgy)),
    ),
  );
}
if (catalog.length !== 30)
  throw new Error(`Expected 30 templates, found ${catalog.length}`);
writeFileSync(
  path.join(root, "src/generated/residentTemplates.js"),
  `// Generated from the DOCX sources in EPA/ and PBA/. Do not edit manually.\nexport const residentTemplates = ${JSON.stringify(catalog, null, 2)};\n`,
);
console.log(`Generated ${catalog.length} source-backed templates.`);
