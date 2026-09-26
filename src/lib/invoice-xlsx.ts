import * as XLSX from "xlsx";
import { INVOICE_COL_WIDTHS, INVOICE_SHEET_NAME, invoiceRow, type InvoiceSource } from "@/lib/invoice";

/** 로젠 양식 .xlsx 파일 바이트 생성 (헤더 없음, 모든 셀 텍스트) */
export function buildInvoiceWorkbook(orders: InvoiceSource[]): Uint8Array<ArrayBuffer> {
  const rows = orders.map(invoiceRow);
  const ws = XLSX.utils.aoa_to_sheet(rows);
  // 숫자처럼 보이는 값(전화번호 등)도 전부 텍스트 셀로 — 원본 양식과 동일
  for (const addr of Object.keys(ws)) {
    if (addr.startsWith("!")) continue;
    const cell = ws[addr] as XLSX.CellObject;
    cell.t = "s";
    cell.v = String(cell.v ?? "");
  }
  ws["!cols"] = INVOICE_COL_WIDTHS.map((wch) => ({ wch }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, INVOICE_SHEET_NAME);
  return new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer);
}
