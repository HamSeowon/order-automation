import { describe, expect, it } from "vitest";
import { parseBrandLines, validateBrand } from "./brands";

describe("parseBrandLines", () => {
  it("탭(엑셀 두 열 복사) / = / → / -> / 쉼표 구분자를 모두 읽는다", () => {
    const text = [
      "AMAZING\tAMZ",
      "어메이징 = AMZ",
      "지포어 → GF",
      "PXG->PXG",
      "A.P.C GOLF, APC",
    ].join("\n");
    expect(parseBrandLines(text)).toEqual({
      entries: [
        { full_name: "AMAZING", short_form: "AMZ" },
        { full_name: "어메이징", short_form: "AMZ" },
        { full_name: "지포어", short_form: "GF" },
        { full_name: "PXG", short_form: "PXG" },
        { full_name: "A.P.C GOLF", short_form: "APC" },
      ],
      errors: [],
    });
  });

  it("쉼표는 마지막 쉼표 기준 (이름에 쉼표가 있어도 됨)", () => {
    expect(parseBrandLines("Abercrombie, Fitch, ANF").entries).toEqual([
      { full_name: "Abercrombie, Fitch", short_form: "ANF" },
    ]);
  });

  it("해석 못 한 줄은 줄 번호와 함께 errors 로, 빈 줄은 무시", () => {
    expect(parseBrandLines("AMAZING=AMZ\n\n구분자없음\n=빈이름\n빈약칭=").errors).toEqual([
      { line: 3, text: "구분자없음" },
      { line: 4, text: "=빈이름" },
      { line: 5, text: "빈약칭=" },
    ]);
  });

  it("같은 목록 안 중복(대소문자 무시)은 뒤의 줄이 우선", () => {
    expect(parseBrandLines("Amazing=AM\nAMAZING = AMZ").entries).toEqual([
      { full_name: "AMAZING", short_form: "AMZ" },
    ]);
  });
});

describe("validateBrand", () => {
  it("공백을 정리하고 빈 값·너무 긴 값을 거부한다", () => {
    expect(validateBrand({ full_name: "  PXG ", short_form: " PXG" })).toEqual({
      ok: true,
      value: { full_name: "PXG", short_form: "PXG" },
    });
    expect(validateBrand({ full_name: " ", short_form: "X" }).ok).toBe(false);
    expect(validateBrand({ full_name: "X", short_form: "" }).ok).toBe(false);
    expect(validateBrand({ full_name: "X".repeat(101), short_form: "X" }).ok).toBe(false);
    expect(validateBrand(null).ok).toBe(false);
  });
});
