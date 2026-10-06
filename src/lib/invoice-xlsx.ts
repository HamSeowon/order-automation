import * as XLSX from "xlsx";
import { INVOICE_COL_WIDTHS, INVOICE_SHEET_NAME, invoiceRows, type InvoiceSource } from "@/lib/invoice";

/** Build the Logen-template .xlsx file bytes (no header row, every cell is text; one row per order group — n합배) */
export function buildInvoiceWorkbook(orders: InvoiceSource[]): Uint8Array<ArrayBuffer> {
  const rows = invoiceRows(orders);
  const ws = XLSX.utils.aoa_to_sheet(rows);
  // Force even number-looking values (phone numbers, etc.) into text cells — matches the original template
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
