import type { OrderInsert } from "@/lib/database.types";
import { splitKakaoPaste, type ExcludedMessage } from "@/lib/kakao";
import { normalizePhone, segmentOrders, splitProducts, type ParsedOrder } from "@/lib/parser";
import { suggestItemFields, type DictEntry } from "@/lib/product";

/** Order fields a person edits at the card/save stage */
export const ORDER_FIELDS = [
  "source_room", "name", "phone", "addr1", "addr2", "brand_raw", "brand_short",
  "product_name", "color", "size", "vendor", "note", "created_by",
] as const;

export type OrderField = (typeof ORDER_FIELDS)[number];
export type OrderDraft = Record<OrderField, string>;

export const REQUIRED_FIELDS = ["name", "phone", "addr1"] as const satisfies readonly OrderField[];

/** Customer fields shared by all cards from the same message (order_group_id). Editing one card updates the whole group */
export const GROUP_SHARED_FIELDS: readonly OrderField[] = ["name", "phone", "addr1", "addr2", "vendor"];

export const FIELD_LABELS: Record<OrderField, string> = {
  source_room: "출처 방",
  name: "이름",
  phone: "전화번호",
  addr1: "주소 (시/구/번지)",
  addr2: "나머지 주소",
  brand_raw: "브랜드 원문",
  brand_short: "브랜드 약칭",
  product_name: "상품명",
  color: "색상",
  size: "사이즈",
  vendor: "거래처",
  note: "참고사항",
  created_by: "입력자",
};

// source_room / created_by are legacy columns: orders are now pasted from one combined chat and the source is the
// trailing tag line (→ vendor), so new orders store them as empty strings. They stay in ORDER_FIELDS so editing an
// old order in the list keeps its existing values.
export const emptyOrderDraft = (): OrderDraft => ({
  source_room: "", name: "", phone: "", addr1: "", addr2: "", brand_raw: "", brand_short: "",
  product_name: "", color: "", size: "", vendor: "", note: "", created_by: "",
});

/**
 * Build the invoice "product name" (spec 4.3, based on the Logen template): short-form-productname-color size.
 * Brand/product name/color are joined with "-", size is preceded by a space. Empty values are skipped.
 */
export function excelProductName(o: Pick<OrderDraft, "brand_short" | "brand_raw" | "product_name" | "color" | "size">): string {
  const main = [o.brand_short || o.brand_raw, o.product_name, o.color].map((s) => s?.trim()).filter(Boolean).join("-");
  return [main, o.size?.trim()].filter(Boolean).join(" ");
}

export type ParsedDraft = {
  /** Cards from the same message share this value (orders.order_group_id) */
  groupId: string;
  /** Raw text of this message (for cross-checking; shared by the cards in the group) */
  raw: string;
  /** The vendor came from an unlisted short last line — show "새 태그?" on the card */
  newTag: boolean;
  /** Item numbers / product codes from the product lines — shown on the card only */
  itemNumbers: string[];
  /** The order-wide note (remarks, extra phone numbers…) and this product's own note (quantity) — fields.note joins both */
  orderNote: string;
  itemNote: string;
  fields: OrderDraft;
};

/** Suggestion to put one order's products into another order's parcel (n합배) — a person confirms it on screen */
export type MergeSuggestion = {
  /** The order to move… */
  groupId: string;
  /** …into this (earlier) order's group. null: a 합배 request with no matching order — the person picks one on the card */
  intoGroupId: string | null;
  /** same-contact: same name + phone + address + tag / hapbae: a message asked for combined shipping */
  reason: "same-contact" | "hapbae";
  /** The 합배 request text (for reason "hapbae") */
  message: string;
};

export type ParsedPaste = {
  drafts: ParsedDraft[];
  /** Messages set aside as non-orders (photos, waybill/exchange/sold-out notices, …) — shown folded on screen */
  excluded: ExcludedMessage[];
  merges: MergeSuggestion[];
};

const HAPBAE_RE = /합배|같이\s*보내/;
const flat = (s: string) => s.replace(/[\s,]/g, "");
// Never just the phone: one vendor's number is used for many different customers
const contactKey = (o: ParsedOrder) => {
  if (!o.name || !o.phone || !o.addr1) return null;
  return [o.name.trim(), o.phone.replace(/\D/g, ""), flat(o.addr1 + o.addr2), o.vendor.trim()].join("|");
};
// The 합배 request as written: the lines that say it (a short request message is shown whole: "박도윤 합배!!!")
const hapbaeText = (o: ParsedOrder) => {
  const lines = o.raw.split("\n").map((l) => l.trim()).filter(Boolean);
  return (lines.length <= 2 ? lines : lines.filter((l) => HAPBAE_RE.test(l))).join(" ");
};
// A 합배 request points at the same person's order(s) a few messages up
const HAPBAE_LOOKBACK = 10;

/** The date part of a message time ("Sep 21, 2026 at 1:32 AM" → "Sep 21, 2026"); "" when unknown (plain copy, PC copy) */
function messageDay(time: string): string {
  return /^(.*?\d{4}\.?)(?: at |\s+(?:오전|오후))/.exec(time)?.[1] ?? "";
}

/**
 * Pasted raw text (app copy or exported chat .txt) → card drafts + the messages that were set aside + n합배 suggestions.
 * If one message (order) has multiple products, one card is created per product, and the name/phone/address etc. are copied onto every card.
 */
export function parsePaste(
  text: string,
  dict: DictEntry[],
  newId: () => string = () => crypto.randomUUID(),
): ParsedPaste {
  const paste = splitKakaoPaste(text);
  const parsed = paste.structured
    ? segmentOrders(paste.messages.map((m) => m.text))
    : segmentOrders(paste.messages[0]?.text ?? "");

  const kept: { order: ParsedOrder; groupId: string }[] = [];
  const excluded = [...paste.excluded];
  const merges: MergeSuggestion[] = [];
  const suggest = (s: MergeSuggestion) => {
    if (!merges.some((m) => m.groupId === s.groupId)) merges.push(s);
  };
  const day = (o: ParsedOrder) =>
    o.messageIndex === undefined ? "" : messageDay(paste.messages[o.messageIndex]?.time ?? "");
  const sameDay = (a: ParsedOrder, b: ParsedOrder) => !day(a) || !day(b) || day(a) === day(b);
  // Recent orders of the same person (by name), most recent last
  const sameName = (name: string) =>
    name ? kept.slice(-HAPBAE_LOOKBACK).filter((k) => k.order.name === name && k.order.phone) : [];

  for (const order of parsed) {
    const hapbae = HAPBAE_RE.test(order.raw);
    const message = hapbae ? hapbaeText(order) : "";
    // A message that only asks for combined shipping ("박도윤 / 합배!!!", "위에랑 합배") isn't an order. The same person's
    // orders just above it are suggested as one parcel; with only one, that card asks which order to merge with.
    if (hapbae && !order.phone && !order.addr1) {
      const targets = sameName(order.name);
      const [first, ...rest] = targets;
      for (const t of rest) suggest({ groupId: t.groupId, intoGroupId: first.groupId, reason: "hapbae", message });
      if (targets.length === 1) suggest({ groupId: first.groupId, intoGroupId: null, reason: "hapbae", message });
      excluded.push({ sender: "", time: "", text: order.raw, reason: "합배 요청 (카드에 합치기 제안으로 표시)" });
      continue;
    }
    const groupId = newId();
    // Same name + phone + address + tag (never the phone alone), on the same day when the dates are known
    const key = contactKey(order);
    const same = key && kept.find((k) => contactKey(k.order) === key && sameDay(k.order, order));
    if (same) {
      suggest({ groupId, intoGroupId: same.groupId, reason: "same-contact", message: "" });
    } else if (hapbae) {
      // "합배부탁드려용" in an order: the nearest earlier order of the same person, or let the person pick
      const target = sameName(order.name).pop();
      suggest({ groupId, intoGroupId: target?.groupId ?? null, reason: "hapbae", message });
    }
    kept.push({ order, groupId });
  }
  return { drafts: kept.flatMap(({ order, groupId }) => orderDrafts(order, dict, groupId)), excluded, merges };
}

export function draftsFromText(text: string, dict: DictEntry[], newId?: () => string): ParsedDraft[] {
  return parsePaste(text, dict, newId).drafts;
}

function orderDrafts(order: ParsedOrder, dict: DictEntry[], groupId: string): ParsedDraft[] {
  return splitProducts(order).map((item) => {
    const s = suggestItemFields(item, dict);
    return {
      groupId,
      raw: order.raw,
      newTag: order.newTag,
      itemNumbers: order.itemNumbers,
      orderNote: order.note,
      itemNote: s.quantityNote,
      fields: {
        ...emptyOrderDraft(),
        name: order.name,
        phone: order.phone,
        addr1: order.addr1,
        addr2: order.addr2,
        vendor: order.vendor,
        brand_raw: s.brand_raw,
        brand_short: s.brand_short,
        product_name: s.product_name,
        color: s.color,
        size: s.size,
        note: [order.note, s.quantityNote].filter(Boolean).join(" / "),
      },
    };
  });
}

export function missingFields(o: Partial<OrderDraft>): OrderField[] {
  return REQUIRED_FIELDS.filter((f) => !o[f]?.trim());
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Clean up client-provided values into a savable shape (only allowed fields, trimmed, phone normalized) */
export function toOrderInsert(input: unknown): OrderInsert {
  const src = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const out: OrderInsert = {};
  for (const f of ORDER_FIELDS) {
    const v = src[f];
    out[f] = typeof v === "string" ? v.trim().slice(0, 500) : "";
  }
  out.phone = out.phone ? normalizePhone(out.phone) : "";
  // Spec 4.1: if there's no dictionary match, store brand_short the same as brand_raw
  if (!out.brand_short) out.brand_short = out.brand_raw;
  // If the group ID is missing or malformed, fall back to the DB default (a new group)
  if (typeof src.order_group_id === "string" && UUID_RE.test(src.order_group_id)) {
    out.order_group_id = src.order_group_id;
  }
  return out;
}

/** A result picked in the address search (Kakao postcode service) */
export type AddressPick = { roadAddress: string; buildingName: string; zonecode: string };

/**
 * Apply an address-search result: the road address replaces addr1, the parsed details (동/호/층) stay in addr2, and the
 * building name is put in front of addr2 unless it's already there. The postal code is not stored (Logen template has no column).
 */
export function applyAddressPick(fields: Pick<OrderDraft, "addr1" | "addr2">, pick: AddressPick): { addr1: string; addr2: string } {
  const addr2 = fields.addr2.trim();
  const building = pick.buildingName.trim();
  const flat = (s: string) => s.replace(/\s/g, "");
  const hasBuilding = !building || flat(addr2).includes(flat(building));
  return {
    addr1: pick.roadAddress.trim() || fields.addr1,
    addr2: hasBuilding ? addr2 : [building, addr2].filter(Boolean).join(" "),
  };
}
