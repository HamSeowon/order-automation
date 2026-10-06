import { describe, expect, it } from "vitest";
import { parsePaste } from "./orders";
import { cardRows, cardsFromPaste, emptyCard, invoicePreview, mergeCards, splitCard } from "./order-cards";

const DICT = [
  { full_name: "지포어", short_form: "G/F" },
  { full_name: "말본", short_form: "말" },
];

const seq = (prefix: string) => {
  let n = 0;
  return () => `${prefix}-${++n}`;
};

// Fake contact, real shapes: one message with 2 products, then a second order of the same person
const PASTE = [
  "Sep 23, 2026 at 9:00 AM, 직원A : 지포어 팬츠",
  "블랙 66",
  "",
  "말본 스커트",
  "화이트 55",
  "",
  "김민서",
  "010-2194-8913",
  "서울 강서구 화곡로 55 3층",
  "",
  "오늘 꼭 보내주세요",
  "",
  "디",
  "Sep 23, 2026 at 9:05 AM, 직원A : 지포어 모자 네이비 2개",
  "",
  "김민서",
  "010-2194-8913",
  "서울 강서구 화곡로 55 3층",
  "",
  "디",
].join("\n");

const cards = () => cardsFromPaste(parsePaste(PASTE, DICT, seq("g")), seq("k"));

describe("order cards (one card = one parcel = one order group)", () => {
  it("products of one message are one card with a product list; the same-contact order comes with a merge suggestion", () => {
    const [a, b] = cards();
    expect(a.groupId).toBe("g-1");
    expect(a.shared).toMatchObject({
      name: "김민서",
      phone: "010-2194-8913",
      addr1: "서울 강서구 화곡로 55",
      vendor: "디",
      note: "오늘 꼭 보내주세요",
    });
    expect(a.items.map((i) => [i.brand_short, i.product_name, i.color, i.size])).toEqual([
      ["G/F", "팬츠", "블랙", "66"],
      ["말", "스커트", "화이트", "55"],
    ]);
    expect(a.merge).toBeNull();
    expect(b.items.map((i) => [i.product_name, i.note])).toEqual([["모자", "수량 2개"]]);
    expect(b.merge).toEqual({ groupId: "g-2", intoGroupId: "g-1", reason: "same-contact", message: "" });
  });

  it("rows to save: one per product, same group id, the order note + the product's own note", () => {
    const [a, b] = cards();
    expect(cardRows(a).map((r) => [r.order_group_id, r.product_name, r.note])).toEqual([
      ["g-1", "팬츠", "오늘 꼭 보내주세요"],
      ["g-1", "스커트", "오늘 꼭 보내주세요"],
    ]);
    expect(cardRows(b)[0]).toMatchObject({ name: "김민서", note: "수량 2개", source_room: "", created_by: "" });
  });

  it("merging moves the products into the target card (its contact and group are kept)", () => {
    const [a, b] = cards();
    const merged = mergeCards(a, b);
    expect(merged.groupId).toBe("g-1");
    expect(merged.items.map((i) => i.product_name)).toEqual(["팬츠", "스커트", "모자"]);
    expect(merged.raw).toContain("모자");
    expect(invoicePreview(merged)).toBe(
      "3합배-G/F-팬츠-블랙 66, 말-스커트-화이트 55, G/F-모자-네이비  (오늘 꼭 보내주세요 / 수량 2개)",
    );
  });

  it("splitting makes one card (and group) per product", () => {
    const [a] = cards();
    const parts = splitCard(a, seq("k2"), seq("new"));
    expect(parts.map((c) => [c.groupId, c.items.length, c.shared.name])).toEqual([
      ["g-1", 1, "김민서"],
      ["new-1", 1, "김민서"],
    ]);
    expect(invoicePreview(parts[1])).toBe("말-스커트-화이트 55  (오늘 꼭 보내주세요)");
  });

  it("an empty card still gets its own group id, so its products stay together when saved", () => {
    const c = emptyCard(seq("k"), seq("g"));
    expect(c.groupId).toBe("g-1");
    expect(c.items).toHaveLength(1);
  });
});
