import { describe, expect, it } from "vitest";
import { normalizePhone, segmentOrders, splitAddress } from "./parser";
import { suggestProductFields } from "./product";

// 기획서 부록의 실제 주문 원문
const SPEC_EXAMPLE = `➡️ 옷제목 ; 어메이징 알렉스 볼마커 벨트

컬러/사이즈/수량 ;

블랙  1개

➡️ 성함 ; 박시연

➡️ 전번 ; 010 8674. 8568

➡️ 주소 ; 서울시 송파구

올림픽로 145 리센츠상가 지하1층 15-2

티, 블루

부산 연제구 쌍미천로 190 동원맨션 A동 502호

심춘선 01087698178

리더,Pxg  화이트 30 사이즈

이유석

01053525668

서울 강서구 마곡서1로 100

마곡엠밸리6단지

616-1103호`;

describe("segmentOrders", () => {
  it("기획서 부록 예시를 기대 결과대로 분리한다", () => {
    const orders = segmentOrders(SPEC_EXAMPLE);
    expect(orders.map(({ name, phone, addr1, addr2 }) => ({ name, phone, addr1, addr2 }))).toEqual([
      { name: "박시연", phone: "010-8674-8568", addr1: "서울시 송파구 올림픽로 145", addr2: "리센츠상가 지하1층 15-2" },
      { name: "심춘선", phone: "010-8769-8178", addr1: "부산 연제구 쌍미천로 190", addr2: "동원맨션 A동 502호" },
      { name: "이유석", phone: "010-5352-5668", addr1: "서울 강서구 마곡서1로 100", addr2: "마곡엠밸리6단지 616-1103호" },
    ]);
  });

  it("상품 줄을 각 주문에 붙인다", () => {
    const orders = segmentOrders(SPEC_EXAMPLE);
    expect(orders.map((o) => o.productText)).toEqual([
      "어메이징 알렉스 볼마커 벨트 / 블랙  1개",
      "티, 블루",
      "리더,Pxg  화이트 30 사이즈",
    ]);
  });

  it("빈 입력은 빈 배열", () => {
    expect(segmentOrders("  \n\n ")).toEqual([]);
  });

  it("값이 다음 줄에 오는 주소 라벨과 참고사항 라벨을 처리한다", () => {
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
  it("번길 주소를 addr1에 포함한다", () => {
    expect(splitAddress("경기 수원시 팔달구 중앙로123번길 45 2층")).toEqual({
      addr1: "경기 수원시 팔달구 중앙로123번길 45",
      addr2: "2층",
    });
  });
  it("도로명이 없으면 전부 addr1", () => {
    expect(splitAddress("서울 강남구 역삼동 123-4")).toEqual({ addr1: "서울 강남구 역삼동 123-4", addr2: "" });
  });
});

describe("normalizePhone", () => {
  it.each([
    ["010 8674. 8568", "010-8674-8568"],
    ["01087698178", "010-8769-8178"],
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

  it("딕셔너리 브랜드·색상·수량을 분리한다", () => {
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

  it("대소문자 무시 브랜드 + 숫자 사이즈", () => {
    expect(suggestProductFields("리더,Pxg  화이트 30 사이즈", dict)).toMatchObject({
      brand_raw: "Pxg",
      brand_short: "PXG",
      product_name: "리더",
      color: "화이트",
      size: "30",
    });
  });

  it("매칭 안 되면 브랜드를 비워두고 미매칭 표시", () => {
    expect(suggestProductFields("티, 블루 2개", dict)).toMatchObject({
      brand_raw: "",
      brandMatched: false,
      product_name: "티",
      color: "블루",
      quantityNote: "수량 2개",
    });
  });
});
