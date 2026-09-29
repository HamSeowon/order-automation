import { describe, expect, it } from "vitest";
import { parseBrandLines, validateBrand } from "./brands";

describe("parseBrandLines", () => {
  it("reads all of tab (pasting two Excel columns) / = / → / -> / comma as separators", () => {
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

  it("a comma separator is matched on its last occurrence (so the name itself can contain commas)", () => {
    expect(parseBrandLines("Abercrombie, Fitch, ANF").entries).toEqual([
      { full_name: "Abercrombie, Fitch", short_form: "ANF" },
    ]);
  });

  it("unparsable lines go into errors with their line number, blank lines are ignored", () => {
    expect(parseBrandLines("AMAZING=AMZ\n\n구분자없음\n=빈이름\n빈약칭=").errors).toEqual([
      { line: 3, text: "구분자없음" },
      { line: 4, text: "=빈이름" },
      { line: 5, text: "빈약칭=" },
    ]);
  });

  it("a duplicate within the same list (case-insensitive) is resolved by the later line", () => {
    expect(parseBrandLines("Amazing=AM\nAMAZING = AMZ").entries).toEqual([
      { full_name: "AMAZING", short_form: "AMZ" },
    ]);
  });
});

describe("validateBrand", () => {
  it("trims whitespace and rejects empty or overly long values", () => {
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
