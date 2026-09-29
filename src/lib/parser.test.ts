import { describe, expect, it } from "vitest";
import { normalizePhone, segmentOrders, splitAddress } from "./parser";
import { suggestProductFields } from "./product";

// Fictionalized raw order text in the format of the spec appendix's real-world example
const SPEC_EXAMPLE = `➡️ 옷제목 ; 어메이징 알렉스 볼마커 벨트

컬러/사이즈/수량 ;

블랙  1개

➡️ 성함 ; 최유리

➡️ 전번 ; 010 4521. 6390

➡️ 주소 ; 서울시 송파구

백제고분로 212 한빛상가 지하1층 8-3

티, 블루

부산 연제구 반송로 88 미래맨션 A동 210호

오하늘 01056372041

리더,Pxg  화이트 30 사이즈

정민준

01067482059

서울 강서구 화곡로 55

행복엠밸리3단지

512-903호`;

describe("segmentOrders", () => {
  it("splits the spec-appendix example into the expected result", () => {
    const orders = segmentOrders(SPEC_EXAMPLE);
    expect(orders.map(({ name, phone, addr1, addr2 }) => ({ name, phone, addr1, addr2 }))).toEqual([
      { name: "최유리", phone: "010-4521-6390", addr1: "서울시 송파구 백제고분로 212", addr2: "한빛상가 지하1층 8-3" },
      { name: "오하늘", phone: "010-5637-2041", addr1: "부산 연제구 반송로 88", addr2: "미래맨션 A동 210호" },
      { name: "정민준", phone: "010-6748-2059", addr1: "서울 강서구 화곡로 55", addr2: "행복엠밸리3단지 512-903호" },
    ]);
  });

  it("attaches product lines to each order", () => {
    const orders = segmentOrders(SPEC_EXAMPLE);
    expect(orders.map((o) => o.productText)).toEqual([
      "어메이징 알렉스 볼마커 벨트 / 블랙  1개",
      "티, 블루",
      "리더,Pxg  화이트 30 사이즈",
    ]);
  });

  it("empty input yields an empty array", () => {
    expect(segmentOrders("  \n\n ")).toEqual([]);
  });

  it("handles an address label whose value is on the next line, and a note label", () => {
    const [o] = segmentOrders(`➡️ 성함 ; 김철수
➡️ 전번 ; 010-1111-2222
➡️ 주소 ;
경기 성남시 분당구 판교역로 235 에이치스퀘어 N동 7층
➡️ 참고 ; 부재시 경비실`);
    expect(o).toMatchObject({
      name: "김철수",
      phone: "010-1111-2222",
      addr1: "경기 성남시 분당구 판교역로 235",
      addr2: "에이치스퀘어 N동 7층",
      note: "부재시 경비실",
    });
  });
});

describe("splitAddress", () => {
  it("includes a 번길-style address in addr1", () => {
    expect(splitAddress("경기 수원시 팔달구 중앙로123번길 45 2층")).toEqual({
      addr1: "경기 수원시 팔달구 중앙로123번길 45",
      addr2: "2층",
    });
  });
  it("goes entirely into addr1 when there's no road name", () => {
    expect(splitAddress("서울 강남구 역삼동 123-4")).toEqual({ addr1: "서울 강남구 역삼동 123-4", addr2: "" });
  });
});

describe("normalizePhone", () => {
  it.each([
    ["010 4521. 6390", "010-4521-6390"],
    ["01056372041", "010-5637-2041"],
    ["011-123-4567", "011-123-4567"],
    ["없음", "없음"],
  ])("%s → %s", (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
  });
});

describe("suggestProductFields", () => {
  const dict = [
    { full_name: "어메이징", short_form: "AMZ" },
    { full_name: "AMAZING", short_form: "AMZ" },
    { full_name: "PXG", short_form: "PXG" },
  ];

  it("separates the dictionary brand, color, and quantity", () => {
    expect(suggestProductFields("어메이징 알렉스 볼마커 벨트 / 블랙  1개", dict)).toEqual({
      brand_raw: "어메이징",
      brand_short: "AMZ",
      brandMatched: true,
      product_name: "알렉스 볼마커 벨트",
      color: "블랙",
      size: "",
      quantityNote: "",
    });
  });

  it("case-insensitive brand + numeric size", () => {
    expect(suggestProductFields("리더,Pxg  화이트 30 사이즈", dict)).toMatchObject({
      brand_raw: "Pxg",
      brand_short: "PXG",
      product_name: "리더",
      color: "화이트",
      size: "30",
    });
  });

  it("leaves the brand empty and flags it unmatched when there's no match", () => {
    expect(suggestProductFields("티, 블루 2개", dict)).toMatchObject({
      brand_raw: "",
      brandMatched: false,
      product_name: "티",
      color: "블루",
      quantityNote: "수량 2개",
    });
  });
});
