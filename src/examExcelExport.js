import { buildExamWorkbook, examExportFileName } from "./examExcel";

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

// `event` is one grouped exam (groupExamRecords): the file matches what is on screen.
export async function exportExamExcel(event) {
  const { default: ExcelJS } = await import("exceljs");
  const data = await buildExamWorkbook(ExcelJS, event).xlsx.writeBuffer();
  download(new Blob([data], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), examExportFileName(event));
}
