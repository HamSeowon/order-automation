import { describe, expect, it } from "vitest";
import { applyAddressPick, draftsFromText, missingFields, parsePaste, toOrderInsert } from "./orders";
import { parseOption } from "./product";

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

const drafts = (text: string) => draftsFromText(text, DICT, seqIds());
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

describe("missingFields", () => {
  it("only name/phone/address are required — an empty source chat no longer blocks saving", () => {
    expect(missingFields({ name: "홍길동", phone: "010-1234-5678", addr1: "서울 강서구 화곡로 55", source_room: "", created_by: "" })).toEqual([]);
    expect(missingFields({ name: " ", phone: "", addr1: "x" })).toEqual(["name", "phone"]);
  });

  it("new drafts leave the legacy source_room/created_by columns empty", () => {
    const [d] = draftsFromText("홍길동 01012345678\n서울 강서구 화곡로 55", DICT, seqIds());
    expect([d.fields.source_room, d.fields.created_by]).toEqual(["", ""]);
  });
});

describe("parsePaste — exported chat: message boundaries as order hints", () => {
  const h = (time: string) => `Sep 23, 2026 at ${time} AM, 직원A : `;
  const EXPORT = [
    "Wednesday, September 23, 2026",
    `${h("9:58")}2 photos`,
    // contact first, product after (real pattern) — the product stays with this order
    `${h("9:59")}동네언니`,
    "01088909237",
    "",
    "전남 순천시해룡면 매안5길74-4",
    "",
    "PO52857",
    "마스터바니[MASTER BUNNY] 정로스급 여성 방울 모자",
    "",
    "1개",
    `${h("10:01")}Photo`,
    // a product-only message merges into the contact message that follows
    `${h("10:02")}1828`,
    `${h("10:02")}브라운55`,
    "",
    "김민서",
    "010-2194-8913",
    "인천 미추홀구 낙섬동로7(금호타운)24동3175호",
    `${h("10:05")}한지호`,
    "",
    "55 66 품절",
  ].join("\n");

  it("one order per message, product-only messages merge forward, notices are excluded", () => {
    const { drafts, excluded } = parsePaste(EXPORT, DICT, seqIds());
    expect(drafts.map((d) => [d.groupId, d.fields.name, d.fields.phone, d.fields.addr1])).toEqual([
      ["group-1", "동네언니", "010-8890-9237", "전남 순천시해룡면 매안5길74-4"],
      ["group-2", "김민서", "010-2194-8913", "인천 미추홀구 낙섬동로7"],
    ]);
    expect(drafts[0].raw).toContain("마스터바니");
    expect(drafts[1].raw).toContain("1828");
    expect(drafts[1].fields).toMatchObject({ color: "브라운", size: "55" });
    expect(excluded.map((m) => m.reason)).toEqual(["사진·이모티콘·파일", "사진·이모티콘·파일", "안내(교환·품절·취소 등)"]);
  });
});

describe("source tag → vendor on the cards", () => {
  it("known tag fills the vendor of every card in the group; an unlisted short last line is flagged", () => {
    const known = draftsFromText("PXG\n골프 바지\n블랙 32\n\nPXG\n골프 바지\n블랙 34\n\n김민서 01021948913\n부산 연제구 반송로 88 미래맨션 A동 210호\n\n골마", DICT, seqIds());
    expect(known.map((d) => [d.fields.vendor, d.newTag])).toEqual([["골마", false], ["골마", false]]);
    const [unknown] = draftsFromText("그레이 100\n\n정예린\n010-3963-0701\n경기도 구리시 인창동43 인창해모로 614동9067호\n\n당", DICT, seqIds());
    expect([unknown.fields.vendor, unknown.newTag]).toEqual(["당", true]);
  });
});

describe("applyAddressPick", () => {
  it("road address → addr1; details kept; building name added in front when missing", () => {
    const pick = { roadAddress: "부산 수영구 광안해변로 100", buildingName: "쌍용예가", zonecode: "48300" };
    expect(applyAddressPick({ addr1: "부산수영구 광안동", addr2: "513동 455호" }, pick)).toEqual({
      addr1: "부산 수영구 광안해변로 100", addr2: "쌍용예가 513동 455호",
    });
    expect(applyAddressPick({ addr1: "부산수영구 광안동", addr2: "쌍용예가아파트513동 455호" }, pick)).toEqual({
      addr1: "부산 수영구 광안해변로 100", addr2: "쌍용예가아파트513동 455호",
    });
    expect(applyAddressPick({ addr1: "x", addr2: "3층" }, { ...pick, buildingName: "" })).toEqual({
      addr1: "부산 수영구 광안해변로 100", addr2: "3층",
    });
  });
});

// Item numbers (4 digits, for matching the photo) are shown on the card only — never in the product name/color/size/note
describe("item numbers", () => {
  const card = (text: string) => draftsFromText(text, DICT, seqIds())[0];

  it.each([
    ["1857\n\n그레이 66\n\n김민서 010-2194-8913\n서울 강서구 화곡로 55 1402호\n\n디", ["1857"]],
    ["1845. 그린77\n\n김민서 010-2194-8913\n서울 강서구 화곡로 55\n\n디", ["1845"]],
    ["1814) 로고 장식 소가죽 자동벨트 (MAN) 화이트\n\n김민서 010-2194-8913\n서울 강서구 화곡로 55\n\n디", ["1814"]],
    ["지포어 [ G / F ] 자동 마크벨트(MAN)*\n제품 / 품번  1604\n\n블랙\n\n김민서 010-2194-8913\n서울 강서구 화곡로 55\n\n디", ["1604"]],
    ["▫️ 제품 / 품번  1372\n\n블랙  265\n\n김민서 010-2194-8913\n서울 강서구 화곡로 55\n\n악", ["1372"]],
    ["Pxg골프화1583\n265\n\n김민서 010-2194-8913\n서울 강서구 화곡로 55\n\n열", ["1583"]],
    ["1759.1760\n\n블랙 66\n\n김민서 010-2194-8913\n서울 강서구 화곡로 55\n\n디", ["1759", "1760"]],
    ["1746스탠드백\n화이트\n\n김민서 010-2194-8913\n서울 강서구 화곡로 55\n\n디", ["1746"]],
    ["PO52384\n말본 [ MALBON ] 여성 립밴드 세미 와이드 팬츠**\n브라운 77\n\n김민서 010-2194-8913\n서울 강서구 화곡로 55\n\n장", ["PO52384"]],
  ])("%#", (text, numbers) => {
    const d = card(text);
    expect(d.itemNumbers).toEqual(numbers);
    const { product_name, color, size, note, brand_raw } = d.fields;
    for (const n of numbers) expect([product_name, color, size, note, brand_raw].join(" ")).not.toContain(n);
    // the 1402 of the address is left alone
    expect(d.fields.addr1 + d.fields.addr2).not.toBe("");
  });

  it("dates and ★ time lines don't end up in the product name", () => {
    const d = card("9월23일\n\nPxg베이스레이\n블랙55\n\n김민서 010-2194-8913\n서울 강서구 화곡로 55\n\n수정");
    expect(d.fields).toMatchObject({ product_name: "베이스레이", color: "블랙", size: "55" });
    expect(card("★ 9월  21일 13시 40분\n\n➡️ 옷제목 ; 어메이징 알렉스 볼마커 벨트\n\n➡️ 성함 ; 김민서\n➡️ 전번 ; 010 2194 8913\n➡️ 주소 ; 서울 강서구 화곡로 55\n\n티").fields.product_name)
      .toBe("어메이징 알렉스 볼마커 벨트"); // (no 어메이징 in this test dictionary — the point is: no date/time)
  });

  it("the address keeps its numbers", () => {
    expect(card("1857\n\n그레이 66\n\n김민서 010-2194-8913\n서울 강서구 화곡로 55 1402호\n\n디").fields.addr2).toBe("1402호");
  });
});

describe("labeled option lines (real shapes)", () => {
  it("'컬러ㅡ그레이 / 사이즈ㅡ110' under a product name", () => {
    const [d] = draftsFromText("스웨터\n컬러ㅡ그레이\n사이즈ㅡ110\n\n정지우 010 5517 3585\n전남여수시 여문문화5길37\n\n마", DICT, seqIds());
    expect(d.fields).toMatchObject({ product_name: "스웨터", color: "그레이", size: "110" });
  });

  it("'색상(사진참조)크림' + '사이즈/66' are one product, not two", () => {
    const d = draftsFromText("주문상품/사우스케이프 사우스크로스\n라운드넥 니트 가디건\n색상(사진참조)크림\n사이즈/66\n\n신지우\n01043539251\n경기도 의왕시 오전동 해모로아파트\n600동1496호\n\n디", DICT, seqIds());
    expect(d).toHaveLength(1);
    expect(d[0].fields).toMatchObject({ product_name: "라운드넥 니트 가디건", color: "크림", size: "66" });
  });
});

describe("item numbers (more real shapes)", () => {
  it("item numbers after a slash or hyphen, with a variant suffix", () => {
    const card = (line: string) => draftsFromText(`${line}\n\n김민서 010-2194-8913\n서울 강서구 화곡로 55\n\n디`, DICT, seqIds())[0];
    expect(card("스커트 롱스커트/1557").itemNumbers).toEqual(["1557"]);
    expect(card("OASI ALBA 니트베스트-1353").fields.product_name).toBe("OASI ALBA 니트베스트");
    expect(card("1878-1").itemNumbers).toEqual(["1878"]);
  });
});

// Several products in one message (real shapes) → one card each, same group (= n합배)
describe("several products in one message", () => {
  const CONTACT_LINES = "\n\n김민서\n010-2194-8913\n서울 강서구 화곡로 55\n\n디";
  const items = (products: string) =>
    draftsFromText(products + CONTACT_LINES, DICT, seqIds()).map((d) => ({
      group: d.groupId, brand: d.fields.brand_short, color: d.fields.color, size: d.fields.size, note: d.fields.note,
    }));

  it("bullet lines (✅️) each start a product; a line under a bullet belongs to it", () => {
    expect(items("✅️사우스 라운드넥 니트가디건\n     스카이 77사이즈\n✅️지포어 레이어드 랩스커트 블랙 77\n✅️지포어 직조베스트 77블랙")).toEqual([
      { group: "group-1", brand: "", color: "스카이", size: "77", note: "" },
      { group: "group-1", brand: "GF", color: "블랙", size: "77", note: "" },
      { group: "group-1", brand: "GF", color: "블랙", size: "77", note: "" },
    ]);
  });

  it("lines starting with an item number each are a product", () => {
    const d = draftsFromText("1871- 그레이\n\n1858- 그레이/66\n\n1855-  크림/66" + CONTACT_LINES, DICT, seqIds());
    expect(d.map((x) => [x.fields.color, x.fields.size])).toEqual([["그레이", ""], ["그레이", "66"], ["크림", "66"]]);
    expect(d[0].itemNumbers).toEqual(["1871", "1858", "1855"]);
  });

  it("two option lines under one product; a total line ('총 2장') is not a product", () => {
    expect(items("1759.1760\n\n블랙 66\n화이트  66\n총 2장")).toEqual([
      { group: "group-1", brand: "", color: "블랙", size: "66", note: "" },
      { group: "group-1", brand: "", color: "화이트", size: "66", note: "" },
    ]);
  });

  it("an option-only block takes the product line from the block above", () => {
    expect(items("지포어 [ G / F ] 자동 마크벨트(MAN)*\n제품 / 품번  1604\n\n블랙\n화이트")).toEqual([
      { group: "group-1", brand: "GF", color: "블랙", size: "", note: "" },
      { group: "group-1", brand: "GF", color: "화이트", size: "", note: "" },
    ]);
  });

  it("a single product with a number line stays one product", () => {
    expect(items("1435. 55사이즈")).toHaveLength(1);
    expect(items("💖미우미우-MIU MIU\n\n남성 스트레이트 레그 청바지2034\n\n사진색상 / 32")).toHaveLength(1);
  });
});

describe("labeled option lines (English)", () => {
  it("English option labels (Color / Size) describe one product", () => {
    const d = draftsFromText("여성 하이브리드 다운 자켓\nColor : 그레이\nSize : 66\n\n김민서\n010-2194-8913\n서울 강서구 화곡로 55\n\n디", DICT, seqIds());
    expect(d).toHaveLength(1);
    expect(d[0].fields).toMatchObject({ color: "그레이", size: "66" });
  });
});

describe("merge suggestions (n합배 across messages)", () => {
  const h = (time: string) => `Sep 23, 2026 at ${time} AM, 직원A : `;
  const order = (time: string, product: string, name: string, phone: string, addr: string, tag = "디", extra = "") =>
    `${h(time)}${product}\n\n${name}\n${phone}\n${addr}\n${extra ? `\n${extra}\n` : ""}\n${tag}`;
  const paste = (...messages: string[]) => parsePaste(messages.join("\n"), DICT, seqIds());

  it("same name + phone + address + tag in one paste → suggest one group", () => {
    const { drafts, merges } = paste(
      order("9:00", "블랙 66", "김민서", "010-2194-8913", "서울 강서구 화곡로 55 3층"),
      order("9:05", "화이트 55", "김민서", "010 2194 8913", "서울 강서구  화곡로 55, 3층"),
    );
    expect(drafts.map((d) => d.groupId)).toEqual(["group-1", "group-2"]);
    expect(merges).toEqual([{ groupId: "group-2", intoGroupId: "group-1", reason: "same-contact", message: "" }]);
  });

  it("the same phone alone (a vendor's shared number) is never merged", () => {
    const { merges } = paste(
      order("9:00", "블랙 66", "김민서", "010-5715-8415", "서울 강서구 화곡로 55", "티"),
      order("9:05", "화이트 55", "이서준", "010-5715-8415", "부산 연제구 반송로 88", "티"),
    );
    expect(merges).toEqual([]);
  });

  it("same contact on different days is not suggested (a repeat customer, not one parcel)", () => {
    const { merges } = paste(
      order("9:00", "블랙 66", "김민서", "010-2194-8913", "서울 강서구 화곡로 55"),
      `Sep 25, 2026 at 9:00 AM, 직원A : 화이트 55\n\n김민서\n010-2194-8913\n서울 강서구 화곡로 55\n\n디`,
    );
    expect(merges).toEqual([]);
  });

  it("an order that says 합배 → suggest the nearest earlier order with the same name (the address may differ)", () => {
    const { merges } = paste(
      order("9:00", "블랙 66", "김민서", "010-2194-8913", "서울 강서구 화곡로 55"),
      order("9:02", "화이트 55", "이서준", "010-5715-8415", "부산 연제구 반송로 88"),
      order("9:05", "77 그레이", "김민서", "010-2194-8913", "서울 강서구 화곡로 61", "마", "합배부탁드려용"),
    );
    expect(merges).toEqual([{ groupId: "group-3", intoGroupId: "group-1", reason: "hapbae", message: "합배부탁드려용" }]);
  });

  it("합배 with no earlier order of that name → no guess; the person picks the order on the card", () => {
    const { merges } = paste(
      order("9:00", "블랙 66", "김민서", "010-2194-8913", "서울 강서구 화곡로 55"),
      order("9:05", "77 그레이", "이서준", "010-5715-8415", "부산 연제구 반송로 88", "마", "합배부탁드려용"),
    );
    expect(merges).toEqual([{ groupId: "group-2", intoGroupId: null, reason: "hapbae", message: "합배부탁드려용" }]);
  });

  it("a message that is only a 합배 request is not a card: the same-name orders above it are suggested as one group", () => {
    const { drafts, merges, excluded } = paste(
      order("9:00", "블랙 66", "박도윤", "010-3333-4444", "부산 연제구 반송로 88", "장"),
      order("9:02", "블랙 66", "김민서", "010-2194-8913", "서울 강서구 화곡로 55"),
      order("9:05", "화이트 55", "박도윤", "010-3333-4444", "부산 연제구 반송로 90", "장"),
      `${h("9:06")}박도윤\n\n합배!!!`,
    );
    expect(drafts.map((d) => d.fields.name)).toEqual(["박도윤", "김민서", "박도윤"]);
    expect(merges).toEqual([{ groupId: "group-3", intoGroupId: "group-1", reason: "hapbae", message: "박도윤 합배!!!" }]);
    expect(excluded.map((m) => m.reason)).toEqual(["합배 요청 (카드에 합치기 제안으로 표시)"]);
  });

  it("a 합배 request naming one order only → that card asks which order to merge with", () => {
    const { merges } = paste(order("9:00", "블랙 66", "박도윤", "010-3333-4444", "부산 연제구 반송로 88", "장"), `${h("9:06")}박도윤\n\n합배!!!`);
    expect(merges).toEqual([{ groupId: "group-1", intoGroupId: null, reason: "hapbae", message: "박도윤 합배!!!" }]);
  });
});
