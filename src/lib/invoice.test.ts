import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import {
  contentDisposition, defaultExportFileName, invoiceRow, sanitizeExportFileName, type InvoiceSource,
} from "./invoice";
import { buildInvoiceWorkbook } from "./invoice-xlsx";
import { excelProductName } from "./orders";

const base: InvoiceSource = {
  name: "홍길동",
  phone: "010-1234-5678",
  addr1: "경기 양주시 옥정동로3길 38",
  addr2: "301호",
  brand_short: "피",
  brand_raw: "피피",
  product_name: "신 아워글래스핏 카라",
  color: "블랙",
  size: "M",
  note: "",
  vendor: "굿1",
  source_room: "양주방",
};

describe("excelProductName (Logen template: short-productname-color size)", () => {
  it.each([
    [{}, "피-신 아워글래스핏 카라-블랙 M"],
    [{ size: "" }, "피-신 아워글래스핏 카라-블랙"],
    [{ brand_short: "" }, "피피-신 아워글래스핏 카라-블랙 M"], // falls back to the raw text if there's no short form
    [{ color: "" }, "피-신 아워글래스핏 카라 M"],
    [{ brand_short: "", brand_raw: "", color: "", size: "" }, "신 아워글래스핏 카라"],
  ])("%j → %s", (patch, expected) => {
    expect(excelProductName({ ...base, ...patch })).toBe(expected);
  });
});

describe("invoiceRow", () => {
  it("the same 5 columns as the existing template", () => {
    expect(invoiceRow(base)).toEqual([
      "홍길동 (굿1)",
      "010 1234 5678",
      "경기 양주시 옥정동로3길 38, 301호",
      "피-신 아워글래스핏 카라-블랙 M",
      "굿1",
    ]);
  });

  it("the note goes at the end of column D as (memo), including any quantity notation", () => {
    expect(invoiceRow({ ...base, note: "교환선발송 / 수량 2개" })[3]).toBe("피-신 아워글래스핏 카라-블랙 M  (교환선발송 / 수량 2개)");
  });

  it("falls back to the source chat as the code when there's no vendor, or to just the name when neither exists", () => {
    expect(invoiceRow({ ...base, vendor: " " })).toMatchObject(["홍길동 (양주방)", expect.any(String), expect.any(String), expect.any(String), "양주방"]);
    const r = invoiceRow({ ...base, vendor: "", source_room: "" });
    expect([r[0], r[4]]).toEqual(["홍길동", ""]);
  });

  it("omits the comma when there's no rest-of-address", () => {
    expect(invoiceRow({ ...base, addr2: "" })[2]).toBe("경기 양주시 옥정동로3길 38");
  });
});

describe("file name", () => {
  it("default name: date only for the first, _N from the second onward", () => {
    expect(defaultExportFileName("2026-09-26", 1)).toBe("2026-09-26.xlsx");
    expect(defaultExportFileName("2026-09-26", 2)).toBe("2026-09-26_2.xlsx");
  });

  it.each([
    ["2026-09-26", "2026-09-26.xlsx"],
    ["로젠 접수.XLSX", "로젠 접수.xlsx"],
    ["../../etc/passwd", "etc passwd.xlsx"],
    ['a<b>:c"d|e?f*', "a b c d e f.xlsx"],
    ["   ", null],
    [".xlsx", null],
    [123, null],
  ])("%j → %j", (input, expected) => {
    expect(sanitizeExportFileName(input)).toBe(expected);
  });

  it("download header for a non-ASCII file name", () => {
    expect(contentDisposition("로젠_2026-09-26.xlsx")).toBe(
      `attachment; filename="___2026-09-26.xlsx"; filename*=UTF-8''%EB%A1%9C%EC%A0%A0_2026-09-26.xlsx`,
    );
  });
});

describe("buildInvoiceWorkbook", () => {
  it("a single Sheet1, data starting at row 1 with no header, every cell as text, column widths preserved", () => {
    const bytes = buildInvoiceWorkbook([base, { ...base, name: "김영희", phone: "01011112222", note: "부재시 경비실" }]);
    const wb = XLSX.read(bytes, { type: "array", cellStyles: true });
    expect(wb.SheetNames).toEqual(["Sheet1"]);
    const ws = wb.Sheets.Sheet1;
    expect(ws["!ref"]).toBe("A1:E2");
    expect(XLSX.utils.sheet_to_json(ws, { header: 1 })).toEqual([
      invoiceRow(base),
      ["김영희 (굿1)", "01011112222", "경기 양주시 옥정동로3길 38, 301호", "피-신 아워글래스핏 카라-블랙 M  (부재시 경비실)", "굿1"],
    ]);
    // Check the phone number wasn't coerced into a number (leading zero preserved)
    for (const addr of ["A1", "B1", "C1", "D1", "E1", "B2"]) expect(ws[addr].t).toBe("s");
    // Excel's internal unit (pixel) conversion introduces about 0.05-character rounding differences
    const widths = (ws["!cols"] ?? []).map((c) => c.wch ?? 0);
    [15, 16.88, 67.38, 57.5, 9.63].forEach((w, i) => expect(Math.abs(widths[i] - w)).toBeLessThan(0.1));
  });

  it("an empty sheet when there are no orders", () => {
    const wb = XLSX.read(buildInvoiceWorkbook([]), { type: "array" });
    expect(XLSX.utils.sheet_to_json(wb.Sheets.Sheet1, { header: 1 })).toEqual([]);
  });
});
