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

describe("excelProductName (로젠 양식: 약칭-상품명-색상 사이즈)", () => {
  it.each([
    [{}, "피-신 아워글래스핏 카라-블랙 M"],
    [{ size: "" }, "피-신 아워글래스핏 카라-블랙"],
    [{ brand_short: "" }, "피피-신 아워글래스핏 카라-블랙 M"], // 약칭 없으면 원문
    [{ color: "" }, "피-신 아워글래스핏 카라 M"],
    [{ brand_short: "", brand_raw: "", color: "", size: "" }, "신 아워글래스핏 카라"],
  ])("%j → %s", (patch, expected) => {
    expect(excelProductName({ ...base, ...patch })).toBe(expected);
  });
});

describe("invoiceRow", () => {
  it("기존 양식과 같은 5열", () => {
    expect(invoiceRow(base)).toEqual([
      "홍길동 (굿1)",
      "010 1234 5678",
      "경기 양주시 옥정동로3길 38, 301호",
      "피-신 아워글래스핏 카라-블랙 M",
      "굿1",
    ]);
  });

  it("참고사항은 D열 끝에 (메모), 수량 표기도 포함", () => {
    expect(invoiceRow({ ...base, note: "교환선발송 / 수량 2개" })[3]).toBe("피-신 아워글래스핏 카라-블랙 M  (교환선발송 / 수량 2개)");
  });

  it("거래처가 없으면 출처 방을 코드로, 둘 다 없으면 이름만", () => {
    expect(invoiceRow({ ...base, vendor: " " })).toMatchObject(["홍길동 (양주방)", expect.any(String), expect.any(String), expect.any(String), "양주방"]);
    const r = invoiceRow({ ...base, vendor: "", source_room: "" });
    expect([r[0], r[4]]).toEqual(["홍길동", ""]);
  });

  it("나머지 주소가 없으면 쉼표 없이", () => {
    expect(invoiceRow({ ...base, addr2: "" })[2]).toBe("경기 양주시 옥정동로3길 38");
  });
});

describe("파일 이름", () => {
  it("기본 이름: 첫 번째는 날짜만, 두 번째부터 _N", () => {
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

  it("한글 파일 이름 다운로드 헤더", () => {
    expect(contentDisposition("로젠_2026-09-26.xlsx")).toBe(
      `attachment; filename="___2026-09-26.xlsx"; filename*=UTF-8''%EB%A1%9C%EC%A0%A0_2026-09-26.xlsx`,
    );
  });
});

describe("buildInvoiceWorkbook", () => {
  it("Sheet1 하나, 헤더 없이 1행부터 데이터, 모든 셀 텍스트, 열 너비 유지", () => {
    const bytes = buildInvoiceWorkbook([base, { ...base, name: "김영희", phone: "01011112222", note: "부재시 경비실" }]);
    const wb = XLSX.read(bytes, { type: "array", cellStyles: true });
    expect(wb.SheetNames).toEqual(["Sheet1"]);
    const ws = wb.Sheets.Sheet1;
    expect(ws["!ref"]).toBe("A1:E2");
    expect(XLSX.utils.sheet_to_json(ws, { header: 1 })).toEqual([
      invoiceRow(base),
      ["김영희 (굿1)", "01011112222", "경기 양주시 옥정동로3길 38, 301호", "피-신 아워글래스핏 카라-블랙 M  (부재시 경비실)", "굿1"],
    ]);
    // 전화번호가 숫자로 바뀌지 않았는지 (앞자리 0 보존)
    for (const addr of ["A1", "B1", "C1", "D1", "E1", "B2"]) expect(ws[addr].t).toBe("s");
    // 엑셀 내부 단위(픽셀) 변환 때문에 0.05자 정도 반올림 차이가 난다
    const widths = (ws["!cols"] ?? []).map((c) => c.wch ?? 0);
    [15, 16.88, 67.38, 57.5, 9.63].forEach((w, i) => expect(Math.abs(widths[i] - w)).toBeLessThan(0.1));
  });

  it("주문이 없으면 빈 시트", () => {
    const wb = XLSX.read(buildInvoiceWorkbook([]), { type: "array" });
    expect(XLSX.utils.sheet_to_json(wb.Sheets.Sheet1, { header: 1 })).toEqual([]);
  });
});
