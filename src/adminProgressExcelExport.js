import { buildAdminProgressWorkbook } from "./adminProgressExcel.js";
import { progressFileName } from "./adminProgress.js";

export async function exportAdminProgressExcel(rows, generatedAt) {
  const { default: ExcelJS } = await import("exceljs");
  const data = await buildAdminProgressWorkbook(ExcelJS, { rows, generatedAt }).xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([data], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  const link = document.createElement("a");
  try {
    link.href = url;
    link.download = progressFileName(generatedAt);
    document.body.append(link);
    link.click();
  } finally {
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
