import type { OrderInsert } from "@/lib/database.types";
import { normalizePhone, segmentOrders, splitProducts } from "@/lib/parser";
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
export const GROUP_SHARED_FIELDS: readonly OrderField[] = ["source_room", "name", "phone", "addr1", "addr2", "vendor", "created_by"];

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

export const emptyOrderDraft = (source_room = "", created_by = ""): OrderDraft => ({
  source_room, name: "", phone: "", addr1: "", addr2: "", brand_raw: "", brand_short: "",
  product_name: "", color: "", size: "", vendor: "", note: "", created_by,
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
  fields: OrderDraft;
};

/**
 * Pasted raw text → card drafts.
 * If one message (order) has multiple products, one card is created per product, and the name/phone/address etc. are copied onto every card.
 */
export function draftsFromText(
  text: string,
  dict: DictEntry[],
  base: { source_room: string; created_by: string },
  newId: () => string = () => crypto.randomUUID(),
): ParsedDraft[] {
  return segmentOrders(text).flatMap((order) => {
    const groupId = newId();
    return splitProducts(order).map((item) => {
      const s = suggestItemFields(item, dict);
      return {
        groupId,
        raw: order.raw,
        fields: {
          ...emptyOrderDraft(base.source_room, base.created_by),
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
  });
}

export function missingFields(o: Partial<OrderDraft>): OrderField[] {
  const missing: OrderField[] = REQUIRED_FIELDS.filter((f) => !o[f]?.trim());
  if (!o.source_room?.trim()) missing.push("source_room");
  return missing;
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
