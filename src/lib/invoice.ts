// 로젠 송장 파일접수 양식 (기획서 4.3) — 순수 함수만. 엑셀 파일 생성은 invoice-xlsx.ts
//
// 양식: Sheet1 하나, 헤더 없음, 주문(상품) 1건 = 1행, 5열 모두 텍스트
//   A 이름 (코드) | B 010 1234 5678 | C 도로명주소, 나머지주소 | D 약칭-상품명-색상 사이즈  (메모) | E 코드

import type { Order } from "@/lib/database.types";
import { excelProductName } from "@/lib/orders";

export type InvoiceSource = Pick<
  Order,
  "name" | "phone" | "addr1" | "addr2" | "brand_short" | "brand_raw" | "product_name" | "color" | "size" | "note" | "vendor" | "source_room"
>;

/** 기존 양식의 열 너비 (A~E) */
export const INVOICE_COL_WIDTHS = [15, 16.88, 67.38, 57.5, 9.63];
export const INVOICE_SHEET_NAME = "Sheet1";

/** E열·A열 괄호 안 코드: 거래처, 없으면 출처 방 (2026-09-26 결정) */
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

/** 기본 파일 이름: 2026-09-26.xlsx, 같은 날 두 번째부터 2026-09-26_2.xlsx */
export function defaultExportFileName(kstDate: string, seq: number): string {
  return `${kstDate}${seq > 1 ? `_${seq}` : ""}.xlsx`;
}

/**
 * 사용자가 입력한 파일 이름 정리: 경로·금지 문자 제거, 100자 제한, .xlsx 확장자 보장.
 * 비어 있으면 null (→ DB 함수가 기본 이름을 붙인다)
 */
export function sanitizeExportFileName(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const name = input
    .trim()
    .replace(/\.xlsx$/i, "")
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ")
    .split(/\s+/)
    .filter((part) => part && !/^\.+$/.test(part)) // "..", "." 같은 경로 조각 제거
    .join(" ")
    .replace(/^\.+/, "")
    .trim();
  if (!name) return null;
  return `${name.slice(0, 100)}.xlsx`;
}

/** Content-Disposition 헤더 (한글 파일 이름: RFC 5987 filename* + ASCII 대체 이름) */
export function contentDisposition(fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}
