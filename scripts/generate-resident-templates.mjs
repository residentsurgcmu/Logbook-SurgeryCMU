import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sources = [
  ["EPA-1", "EPA", "EPA 1 Multiple trauma assessment and management", "EPA/EPA1-trauma.docx", ["L1", "L2", "L3", "L4", "L5"]],
  ["EPA-2", "EPA", "EPA 2 Management of acute surgical abdomen", "EPA/EPA2-acute abdomen.docx", ["L1", "L2", "L3", "L4", "L5"]],
  ["EPA-3", "EPA", "EPA 3 Management of gastrointestinal bleeding", "EPA/EPA3-Gastrointestinal Bleeding.docx", ["L1", "L2", "L3", "L4", "L5"]],
  ["EPA-4", "EPA", "EPA 4 Management of common hepato-biliary and pancreatic diseases", "EPA/EPA4-hepato-biliary.docx", ["L1", "L2", "L3", "L4", "L5"]],
  ["EPA-5", "EPA", "EPA 5 Management of breast mass in women", "EPA/EPA5-breast mass.docx", ["L1", "L2", "L3", "L4", "L5"]],
  ["EPA-6", "EPA", "EPA 6 Common problem in vascular disease", "EPA/EPA6-vascular.docx", ["L1", "L2", "L3", "L4", "L5"]],
  ["EPA-7", "EPA", "EPA 7 Basic laparoscopic surgical skill", "EPA/EPA7 Basic Laparoscopic.docx", ["F", "M", "E"]],
  ["EPA-8", "EPA", "EPA 8 Management of out-patient departments", "EPA/EPA_OPD.pdf", ["L1", "L2", "L3", "L4", "L5"]],
  ["PBA-01", "PBA", "PBA Amputation", "PBA/1.การประเมินหัตถการ amputation.pdf", ["F", "M", "E"]],
  ["PBA-02", "PBA", "PBA Appendectomy", "PBA/2.การประเมินหัตถการ appendectomy.pdf", ["F", "M", "E"]],
  ["PBA-03", "PBA", "PBA AVF", "PBA/3.การประเมินหัตถการ avf.pdf", ["F", "M", "E"]],
  ["PBA-04", "PBA", "PBA Breast conservative surgery", "PBA/4.การประเมินหัตถการ bcs.pdf", ["F", "M", "E"]],
  ["PBA-05", "PBA", "PBA Colectomy", "PBA/5.การประเมินหัตถการ colectomy.pdf", ["F", "M", "E"]],
  ["PBA-06", "PBA", "PBA Colonoscopy", "PBA/6.การประเมินหัตถการ colonoscope.pdf", ["F", "M", "E"]],
  ["PBA-07", "PBA", "PBA Colostomy", "PBA/7.การประเมินหัตถการ colostomy.pdf", ["F", "M", "E"]],
  ["PBA-08", "PBA", "PBA EGD", "PBA/8.การประเมินหัตถการ egd.pdf", ["F", "M", "E"]],
  ["PBA-09", "PBA", "PBA Hemorrhoidectomy", "PBA/9.การประเมินหัตถการ hemorrhoidectomy .pdf", ["F", "M", "E"]],
  ["PBA-10", "PBA", "PBA Hernia", "PBA/10.การประเมินหัตถการ hernia.pdf", ["F", "M", "E"]],
  ["PBA-11", "PBA", "PBA Intestinal anastomosis", "PBA/11.การประเมินหัตถการ intestinal anastomosis.pdf", ["F", "M", "E"]],
  ["PBA-12", "PBA", "PBA Laparoscopic cholecystectomy", "PBA/12.การประเมินหัตถการ lc.pdf", ["F", "M", "E"]],
  ["PBA-13", "PBA", "PBA Liver resection", "PBA/13.การประเมินหัตถการ liver resection.pdf", ["F", "M", "E"]],
  ["PBA-14", "PBA", "PBA Modified radical mastectomy", "PBA/14.การประเมินหัตถการ mrm.pdf", ["F", "M", "E"]],
  ["PBA-15", "PBA", "PBA Open cholecystectomy", "PBA/15.การประเมินหัตถการ oc.pdf", ["F", "M", "E"]],
  ["PBA-16", "PBA", "PBA Percutaneous endoscopic gastrostomy", "PBA/16.การประเมินหัตถการ peg.pdf", ["F", "M", "E"]],
  ["PBA-17", "PBA", "PBA Splenectomy", "PBA/17.การประเมินหัตถการ splenectomy.pdf", ["F", "M", "E"]],
  ["PBA-18", "PBA", "PBA Thyroid surgery", "PBA/18.การประเมินหัตถการ thyroid surgery.pdf", ["F", "M", "E"]],
  ["PBA-19", "PBA", "PBA Tracheostomy", "PBA/19.การประเมินหัตถการ tracheostomy.pdf", ["F", "M", "E"]],
  ["PBA-20", "PBA", "PBA Varicose vein", "PBA/20.การประเมินหัตถการ vv.pdf", ["F", "M", "E"]],
  ["PBA-21", "PBA", "PBA Other procedure", "PBA/21.การประเมินหัตถการอื่นๆ .pdf", ["F", "M", "E"]],
];

const ignored = /^(resident|staff|date|operation|procedure assessment|pba procedure|epa |level of epa|competency and epa|milestone|staff comment|staff comments|comments?|f\s*[–-]\s*fails|m\s*[–-]\s*meets|e\s*[–-]\s*exceeds|fail|meet expectation|exceed|ชื่อ|วัน|ผู้ประเมิน|ผู้สอบ|คะแนน|เกณฑ์การประเมิน)/i;
const section = /^(preparation|content|pre-operative|intra-operative|post-operative|planning|exposure|technique|patient care|assessment|หัวข้อ|การวัด|ระดับความสามารถ)/i;

function extract(relativePath) {
  const fullPath = path.join(root, relativePath);
  if (relativePath.endsWith(".docx")) return execFileSync("textutil", ["-convert", "txt", "-stdout", fullPath], { encoding: "utf8" });
  return execFileSync("pdftotext", [fullPath, "-"], { encoding: "utf8" });
}

function criteriaFrom(text) {
  const lines = text.replace(/\r/g, "\n").split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length > 3 && line.length < 420 && !ignored.test(line));
  const unique = [];
  for (const line of lines) if (!unique.some((item) => item.toLocaleLowerCase() === line.toLocaleLowerCase())) unique.push(line);
  return unique.map((label, index) => ({ code: `C${index + 1}`, label, section: section.test(label) ? label : "Assessment criteria", sortOrder: index + 1 }));
}

const residentTemplates = sources.map(([code, type, title, sourceFile, scoreOptions]) => {
  const sourceBytes = readFileSync(path.join(root, sourceFile));
  return { code, type, title, sourceFile, sourceHash: createHash("sha256").update(sourceBytes).digest("hex"), scoreOptions, criteria: criteriaFrom(extract(sourceFile)) };
});

if (residentTemplates.some((template) => template.criteria.length === 0)) throw new Error("A source form produced no assessment criteria");
mkdirSync(path.join(root, "src/generated"), { recursive: true });
writeFileSync(path.join(root, "src/generated/residentTemplates.js"), `// Generated from EPA/ and PBA/ source files. Do not edit manually.\nexport const residentTemplates = ${JSON.stringify(residentTemplates, null, 2)};\n`);
console.log(`Generated ${residentTemplates.length} templates from EPA/PBA source files.`);
