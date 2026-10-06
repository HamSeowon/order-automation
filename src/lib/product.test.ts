import { describe, expect, it } from "vitest";
import { findBrand, parseOption, suggestProductFields } from "./product";
import { parseBrandLines } from "./brands";

// Brand dictionary as it would be bulk-entered on the brand screen (variants from the order-chat analysis)
const DICT = parseBrandLines(`지포어=지포
지포=지포
지포*=지포
G / F=지포
GFORE=지포
말본=말본
MALBON=말본
말=말본
타이틀리스트=타이틀
타이틀=타이틀
Titleist=타이틀
PXG=PXG
PX*=PXG
사우스케이프=사우스
사우스=사우스
[SC]=사우스
어메이징=AMZ
핑=핑
PING=핑`).entries;

const short = (text: string) => findBrand(text, DICT)?.short_form ?? null;

describe("findBrand", () => {
  it.each([
    ["핑크 66", null], // "핑" inside "핑크" is not the brand
    ["핑 드라이버 커버", "핑"],
    ["PING 드라이버 커버", "핑"],
    ["지포* [ G / F ] 매장판제품 HYBRID HOOD (WOMEN)", "지포"],
    ["지포어바이저", "지포"],
    ["PX* 골프화", "PXG"],
    ["Pxg베이스레이", "PXG"],
    ["사우스케이프  [SC]매장완제품 버킷햇", "사우스"],
    ["[SC] 벨트백", "사우스"],
    ["말 와이드", "말본"],
    ["말본 [ MALBON ] 여성 립밴드 세미 와이드 팬츠", "말본"],
    ["타이틀벨트", "타이틀"],
    ["말씀하신 상품", null], // 1-letter Korean brand only as a word of its own
    ["코오롱하늘채 101동", null],
  ])("%s → %s", (text, expected) => {
    expect(short(text)).toBe(expected);
  });
});

describe("colors, sizes and quantities (real order lines)", () => {
  it.each([
    ["세피아77", { color: "세피아", size: "77" }],
    ["검66", { color: "블랙", size: "66" }],
    ["0402. 검2개", { color: "블랙", quantityNote: "수량 2개" }],
    ["흰색 55", { color: "화이트", size: "55" }],
    ["BLACK 100", { color: "블랙", size: "100" }],
    ["BK L", { color: "블랙", size: "L" }],
    ["색상(사진참조)크림", { color: "크림" }],
    ["라이트그레이 66 1개", { color: "라이트그레이", size: "66" }],
    ["상의66사이즈1장", { size: "66" }],
    ["77 싸이즈", { size: "77" }],
    ["원사이즈", { size: "F" }],
    ["화이트 255-260MM", { color: "화이트", size: "255-260" }],
    ["네이비 77L", { color: "네이비", size: "77" }],
    ["컬러ㅡ그레이 사이즈ㅡ110", { color: "그레이", size: "110" }],
    ["블랙 2족", { color: "블랙", quantityNote: "수량 2족" }],
    ["1 SET 3 PCS 구성 블랙", { color: "블랙", quantityNote: "" }],
    ["블랙 66 화이트 66 총 2장", { quantityNote: "수량 2장" }],
    ["핑크 77", { brand_short: "", color: "핑크", size: "77" }],
  ])("%s", (text, expected) => {
    expect(suggestProductFields(text, DICT)).toMatchObject(expected);
  });

  it("brackets, marketing banners and 매장판 noise don't end up in the product name or the size", () => {
    expect(suggestProductFields("<남은수량 빅 세일> 지포* [ G / F ] 매장판 PLEATED SKIRT (WOMEN)   사이즈 : 66", DICT)).toMatchObject({
      brand_short: "지포", product_name: "PLEATED SKIRT (WOMEN)", size: "66", color: "",
    });
  });

  it("option lines", () => {
    expect(parseOption("검정 L")).toEqual({ color: "블랙", size: "L", quantityNote: "" });
    expect(parseOption("블랙 - 1개")).toEqual({ color: "블랙", size: "", quantityNote: "" });
    expect(parseOption("55아이보리")).toEqual({ color: "아이보리", size: "55", quantityNote: "" });
  });
});
