import { buildCaseWorkbook, caseExportFileName } from "./caseExcel";
import { loadCaseNotesForCases } from "./residentCasesApi";

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

// `rows` are already filtered (filterCasesForExport) so the file matches the count shown.
export async function exportCasesExcel(rows, people, range) {
  const { default: ExcelJS } = await import("exceljs");
  const notes = await loadCaseNotesForCases(rows.map((row) => row.id));
  const data = await buildCaseWorkbook(ExcelJS, { rows, notes, people }).xlsx.writeBuffer();
  download(new Blob([data], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), caseExportFileName(range));
}
