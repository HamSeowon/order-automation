import { describe, expect, it } from "vitest";
import { draftsFromText, toOrderInsert } from "./orders";
import { parseOption } from "./product";

const BASE = { source_room: "송파방", created_by: "아버지" };
const DICT = [
  { full_name: "A.P.C GOLF", short_form: "APC" },
  { full_name: "지포어", short_form: "GF" },
  { full_name: "PXG", short_form: "PXG" },
];

// 테스트에서 그룹 ID를 예측할 수 있게 순번으로 발급
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
  name: "권선희",
  phone: "010-3056-9333",
  addr1: "서울시 송파구 위례광장로 163번지",
  addr2: "2203동 203호 송파더센트레",
};

describe("한 메시지 여러 상품 → 상품 수만큼 카드", () => {
  it("요구사항 예시: 상품 2개 → 카드 2장, 연락처 복사, 같은 그룹", () => {
    const text = `A.P.C GOLF [아페쎄 골프]
세일러 티셔츠
화이트77

지포어 [ G / F ] 매장판
에센셜 캐시미어 스웨터(WOMEN)
민트77

서울시 송파구 위례광장로 163번지 2203동 203호 송파더센트레
01030569333

권선희`;
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

  it("상품 3개 + 연락처 순서가 다른 경우 (이름 → 전화 → 주소)", () => {
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
      // "니트"는 한글 2자라 이름 패턴과 겹치지만, 상품 블록 안이라 상품명으로 처리돼야 함
      { brand_raw: "지포어", brand_short: "GF", product_name: "니트", color: "네이비", size: "L" },
      // 딕셔너리에 없는 브랜드/색상도 옵션 줄에서 사이즈를 뺀 나머지를 색상으로
      { brand_raw: "미등록브랜드", brand_short: "", product_name: "바람막이", color: "라벤더", size: "M" },
    ]);
  });

  it("같은 상품, 옵션만 다른 경우 (한 블록에 옵션 줄 여러 개) → 옵션마다 카드", () => {
    const text = `PXG
골프 바지
블랙 32
화이트 34

김영희 01011112222
부산 연제구 쌍미천로 190 동원맨션 A동 502호`;
    const result = drafts(text).map(pick);
    expect(result.map(({ group, product_name, color, size }) => ({ group, product_name, color, size }))).toEqual([
      { group: "group-1", product_name: "골프 바지", color: "블랙", size: "32" },
      { group: "group-1", product_name: "골프 바지", color: "화이트", size: "34" },
    ]);
    expect(result.every((r) => r.name === "김영희" && r.phone === "010-1111-2222")).toBe(true);
  });

  it("같은 상품, 옵션만 다른 경우 (블록을 반복해서 쓴 경우) → 블록마다 카드", () => {
    const text = `PXG
골프 바지
블랙 32

PXG
골프 바지
블랙 34

김영희 01011112222
부산 연제구 쌍미천로 190 동원맨션 A동 502호`;
    expect(drafts(text).map((d) => [d.groupId, d.fields.color, d.fields.size])).toEqual([
      ["group-1", "블랙", "32"],
      ["group-1", "블랙", "34"],
    ]);
  });

  it("수량 표기는 카드를 늘리지 않고 참고사항으로", () => {
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
부산 연제구 쌍미천로 190 동원맨션 A동 502호`;
    expect(drafts(text).map(({ fields: { product_name, color, size, note } }) => ({ product_name, color, size, note }))).toEqual([
      { product_name: "골프 바지", color: "블랙", size: "32", note: "수량 2개" },
      { product_name: "니트", color: "네이비", size: "L", note: "수량 3개" },
      { product_name: "모자", color: "화이트", size: "FREE", note: "" },
    ]);
  });

  it("한 번에 붙여넣은 메시지 2개 → 메시지마다 다른 그룹", () => {
    const text = `PXG
골프 바지
블랙 32

지포어
니트
네이비 L

김영희 01011112222
부산 연제구 쌍미천로 190 동원맨션 A동 502호

지포어
모자
화이트 FREE

박철수
01033334444
서울 강서구 마곡서1로 100 마곡엠밸리6단지 616-1103호`;
    const result = drafts(text).map(pick);
    expect(result.map((r) => [r.group, r.name, r.product_name])).toEqual([
      ["group-1", "김영희", "골프 바지"],
      ["group-1", "김영희", "니트"],
      ["group-2", "박철수", "모자"],
    ]);
  });

  it("기존 라벨 형식/한 줄 상품 형식은 메시지당 카드 1장 유지 (기획서 부록)", () => {
    const text = `➡️ 옷제목 ; 어메이징 알렉스 볼마커 벨트

컬러/사이즈/수량 ;

블랙  1개

➡️ 성함 ; 박시연

➡️ 전번 ; 010 8674. 8568

➡️ 주소 ; 서울시 송파구

올림픽로 145 리센츠상가 지하1층 15-2

티, 블루

부산 연제구 쌍미천로 190 동원맨션 A동 502호

심춘선 01087698178`;
    expect(drafts(text).map((d) => [d.groupId, d.fields.name])).toEqual([
      ["group-1", "박시연"],
      ["group-2", "심춘선"],
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
  it("유효한 order_group_id 는 유지하고, 형식이 틀리면 버린다 (DB 기본값으로 새 그룹)", () => {
    const id = "3f2c1a9e-8b7d-4c6e-9a1b-2c3d4e5f6a7b";
    expect(toOrderInsert({ name: "a", order_group_id: id }).order_group_id).toBe(id);
    expect(toOrderInsert({ name: "a", order_group_id: "'; drop table" }).order_group_id).toBeUndefined();
    expect(toOrderInsert({ name: "a", order_group_id: null }).order_group_id).toBeUndefined();
  });
});
