import { describe, expect, it } from "vitest";
import { draftsFromText, toOrderInsert } from "./orders";
import { parseOption } from "./product";

const BASE = { source_room: "송파방", created_by: "아버지" };
const DICT = [
  { full_name: "A.P.C GOLF", short_form: "APC" },
  { full_name: "지포어", short_form: "GF" },
  { full_name: "PXG", short_form: "PXG" },
];

// Issue sequential IDs so the group ID is predictable in tests
const seqIds = () => {
  let n = 0;
  return () => `group-${++n}`;
};

const drafts = (text: string) => draftsFromText(text, DICT, BASE, seqIds());
const pick = (d: ReturnType<typeof drafts>[number]) => {
  const { name, phone, addr1, addr2, brand_raw, brand_short, product_name, color, size, note } = d.fields;
  return { group: d.groupId, name, phone, addr1, addr2, brand_raw, brand_short, product_name, color, size, note };
};

const CONTACT = {
  name: "이서연",
  phone: "010-2456-7890",
  addr1: "서울시 송파구 위례성대로 27번지",
  addr2: "1105동 402호 위례파크뷰",
};

describe("one message, multiple products → one card per product", () => {
  it("spec example: 2 products → 2 cards, contact info copied, same group", () => {
    const text = `A.P.C GOLF [아페쎄 골프]
세일러 티셔츠
화이트77

지포어 [ G / F ] 매장판
에센셜 캐시미어 스웨터(WOMEN)
민트77

서울시 송파구 위례성대로 27번지 1105동 402호 위례파크뷰
01024567890

이서연`;
    expect(drafts(text).map(pick)).toEqual([
      {
        group: "group-1", ...CONTACT,
        brand_raw: "A.P.C GOLF [아페쎄 골프]", brand_short: "APC",
        product_name: "세일러 티셔츠", color: "화이트", size: "77", note: "",
      },
      {
        group: "group-1", ...CONTACT,
        brand_raw: "지포어 [ G / F ] 매장판", brand_short: "GF",
        product_name: "에센셜 캐시미어 스웨터(WOMEN)", color: "민트", size: "77", note: "",
      },
    ]);
  });

  it("3 products + contact info in a different order (name → phone → address)", () => {
    const text = `PXG
골프 바지
블랙 32

지포어
니트
네이비 L

미등록브랜드
바람막이
라벤더 M

홍길동
010-1234-5678
경기 성남시 분당구 판교역로 235 에이치스퀘어 N동 7층`;
    const result = drafts(text).map(pick);
    expect(result).toHaveLength(3);
    expect(new Set(result.map((r) => r.group))).toEqual(new Set(["group-1"]));
    for (const r of result) {
      expect(r).toMatchObject({
        name: "홍길동",
        phone: "010-1234-5678",
        addr1: "경기 성남시 분당구 판교역로 235",
        addr2: "에이치스퀘어 N동 7층",
      });
    }
    expect(result.map(({ brand_raw, brand_short, product_name, color, size }) => ({ brand_raw, brand_short, product_name, color, size }))).toEqual([
      { brand_raw: "PXG", brand_short: "PXG", product_name: "골프 바지", color: "블랙", size: "32" },
      // "니트" is 2 Hangul characters and overlaps the name pattern, but must be treated as a product name since it's inside a product block
      { brand_raw: "지포어", brand_short: "GF", product_name: "니트", color: "네이비", size: "L" },
      // A brand/color not in the dictionary still has the size stripped from the option line, with the rest treated as color
      { brand_raw: "미등록브랜드", brand_short: "", product_name: "바람막이", color: "라벤더", size: "M" },
    ]);
  });

  it("same product, only the options differ (multiple option lines in one block) → one card per option", () => {
    const text = `PXG
골프 바지
블랙 32
화이트 34

김영희 01011112222
부산 연제구 반송로 88 미래맨션 A동 210호`;
    const result = drafts(text).map(pick);
    expect(result.map(({ group, product_name, color, size }) => ({ group, product_name, color, size }))).toEqual([
      { group: "group-1", product_name: "골프 바지", color: "블랙", size: "32" },
      { group: "group-1", product_name: "골프 바지", color: "화이트", size: "34" },
    ]);
    expect(result.every((r) => r.name === "김영희" && r.phone === "010-1111-2222")).toBe(true);
  });

  it("same product, only the options differ (the block is repeated) → one card per block", () => {
    const text = `PXG
골프 바지
블랙 32

PXG
골프 바지
블랙 34

김영희 01011112222
부산 연제구 반송로 88 미래맨션 A동 210호`;
    expect(drafts(text).map((d) => [d.groupId, d.fields.color, d.fields.size])).toEqual([
      ["group-1", "블랙", "32"],
      ["group-1", "블랙", "34"],
    ]);
  });

  it("a quantity notation doesn't add more cards, it goes into the note instead", () => {
    const text = `PXG
골프 바지
블랙 32 2개

지포어
니트
네이비 L x3

지포어
모자
화이트 FREE 1개

김영희 01011112222
부산 연제구 반송로 88 미래맨션 A동 210호`;
    expect(drafts(text).map(({ fields: { product_name, color, size, note } }) => ({ product_name, color, size, note }))).toEqual([
      { product_name: "골프 바지", color: "블랙", size: "32", note: "수량 2개" },
      { product_name: "니트", color: "네이비", size: "L", note: "수량 3개" },
      { product_name: "모자", color: "화이트", size: "FREE", note: "" },
    ]);
  });

  it("2 messages pasted at once → a different group per message", () => {
    const text = `PXG
골프 바지
블랙 32

지포어
니트
네이비 L

김영희 01011112222
부산 연제구 반송로 88 미래맨션 A동 210호

지포어
모자
화이트 FREE

박철수
01033334444
서울 강서구 화곡로 55 행복엠밸리3단지 512-903호`;
    const result = drafts(text).map(pick);
    expect(result.map((r) => [r.group, r.name, r.product_name])).toEqual([
      ["group-1", "김영희", "골프 바지"],
      ["group-1", "김영희", "니트"],
      ["group-2", "박철수", "모자"],
    ]);
  });

  it("the legacy label format / one-line product format still produces one card per message (spec appendix)", () => {
    const text = `➡️ 옷제목 ; 어메이징 알렉스 볼마커 벨트

컬러/사이즈/수량 ;

블랙  1개

➡️ 성함 ; 최유리

➡️ 전번 ; 010 4521. 6390

➡️ 주소 ; 서울시 송파구

백제고분로 212 한빛상가 지하1층 8-3

티, 블루

부산 연제구 반송로 88 미래맨션 A동 210호

오하늘 01056372041`;
    expect(drafts(text).map((d) => [d.groupId, d.fields.name])).toEqual([
      ["group-1", "최유리"],
      ["group-2", "오하늘"],
    ]);
  });
});

describe("parseOption", () => {
  it.each([
    ["화이트77", { color: "화이트", size: "77", quantityNote: "" }],
    ["블랙L", { color: "블랙", size: "L", quantityNote: "" }],
    ["네이비 FREE", { color: "네이비", size: "FREE", quantityNote: "" }],
    ["95 블랙", { color: "블랙", size: "95", quantityNote: "" }],
    ["블랙 32 2개", { color: "블랙", size: "32", quantityNote: "수량 2개" }],
    ["민트", { color: "민트", size: "", quantityNote: "" }],
  ])("%s", (input, expected) => {
    expect(parseOption(input)).toEqual(expected);
  });
});

describe("toOrderInsert", () => {
  it("keeps a valid order_group_id, drops a malformed one (falls back to a new group via the DB default)", () => {
    const id = "3f2c1a9e-8b7d-4c6e-9a1b-2c3d4e5f6a7b";
    expect(toOrderInsert({ name: "a", order_group_id: id }).order_group_id).toBe(id);
    expect(toOrderInsert({ name: "a", order_group_id: "'; drop table" }).order_group_id).toBeUndefined();
    expect(toOrderInsert({ name: "a", order_group_id: null }).order_group_id).toBeUndefined();
  });
});
