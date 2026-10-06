// Logen shipping-label file-upload template (spec 4.3) — pure functions only. The .xlsx file itself is built in invoice-xlsx.ts
//
// Template: one sheet (Sheet1), no header row, 1 parcel (order group; n합배 = n products) = 1 row, all 5 columns are text
//   A name (code) | B 010 1234 5678 | C road-name address, rest of address | D short-productname-color size  (memo) | E code

import type { Order } from "@/lib/database.types";
import { excelProductName } from "@/lib/orders";

export type InvoiceSource = Pick<
  Order,
  "name" | "phone" | "addr1" | "addr2" | "brand_short" | "brand_raw" | "product_name" | "color" | "size" | "note" | "vendor" | "source_room"
> & {
  /** Products of the same group (n합배) go on one label row. Missing → the row stands alone */
  order_group_id?: string;
};

/** Column widths of the existing template (A–E) */
export const INVOICE_COL_WIDTHS = [15, 16.88, 67.38, 57.5, 9.63];
export const INVOICE_SHEET_NAME = "Sheet1";

/** Code in parentheses for columns E/A: vendor, or the source chat if empty (decided 2026-09-26) */
export const invoiceCode = (o: Pick<InvoiceSource, "vendor" | "source_room">) => o.vendor.trim() || o.source_room.trim();

export function invoiceRow(o: InvoiceSource): [string, string, string, string, string] {
  const code = invoiceCode(o);
  const name = o.name.trim();
  const addr1 = o.addr1.trim();
  const addr2 = o.addr2.trim();
  const note = o.note.trim();
  const product = excelProductName(o);
  return [
    code ? `${name} (${code})` : name,
    o.phone.trim().replace(/-/g, " "),
    addr2 ? `${addr1}, ${addr2}` : addr1,
    note ? `${product}  (${note})` : product,
    code,
  ];
}

/**
 * Label rows for a list of orders: the products of one group (order_group_id) share one parcel → one row.
 * Columns A/B/C/E come from the group (its first row); D = "n합배-" + each product's name joined by ", ", plus the
 * group's notes once at the end ("  (note)"). A group with one product keeps the single-row format.
 * Groups keep the order in which they first appear.
 */
export function invoiceRows(orders: InvoiceSource[]): [string, string, string, string, string][] {
  const groups = new Map<string | symbol, InvoiceSource[]>();
  for (const o of orders) {
    const key = o.order_group_id ?? Symbol();
    groups.set(key, [...(groups.get(key) ?? []), o]);
  }
  return [...groups.values()].map((items) => {
    if (items.length === 1) return invoiceRow(items[0]);
    const row = invoiceRow({ ...items[0], note: "" });
    // The shared note is copied onto every row of the group — keep each note part once
    const notes = [...new Set(items.flatMap((o) => o.note.split(" / ").map((s) => s.trim()).filter(Boolean)))].join(" / ");
    const products = `${items.length}합배-${items.map(excelProductName).join(", ")}`;
    row[3] = notes ? `${products}  (${notes})` : products;
    return row;
  });
}

/** Default file name: 2026-09-26.xlsx, 2026-09-26_2.xlsx from the second export of the same day */
export function defaultExportFileName(kstDate: string, seq: number): string {
  return `${kstDate}${seq > 1 ? `_${seq}` : ""}.xlsx`;
}

/**
 * Clean up a user-provided file name: strip path/forbidden characters, cap at 100 chars, ensure a .xlsx extension.
 * Returns null if empty (→ the DB function attaches the default name)
 */
export function sanitizeExportFileName(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const name = input
    .trim()
    .replace(/\.xlsx$/i, "")
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ")
    .split(/\s+/)
    .filter((part) => part && !/^\.+$/.test(part)) // drop path fragments like ".." or "."
    .join(" ")
    .replace(/^\.+/, "")
    .trim();
  if (!name) return null;
  return `${name.slice(0, 100)}.xlsx`;
}

/** Content-Disposition header (for non-ASCII file names: RFC 5987 filename* + an ASCII fallback name) */
export function contentDisposition(fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}
