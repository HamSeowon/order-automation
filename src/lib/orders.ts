import type { OrderInsert } from "@/lib/database.types";
import { normalizePhone, segmentOrders, splitProducts } from "@/lib/parser";
import { suggestItemFields, type DictEntry } from "@/lib/product";

/** 카드/저장 단계에서 사람이 편집하는 주문 필드 */
export const ORDER_FIELDS = [
  "source_room", "name", "phone", "addr1", "addr2", "brand_raw", "brand_short",
  "product_name", "color", "size", "vendor", "note", "created_by",
] as const;

export type OrderField = (typeof ORDER_FIELDS)[number];
export type OrderDraft = Record<OrderField, string>;

export const REQUIRED_FIELDS = ["name", "phone", "addr1"] as const satisfies readonly OrderField[];

/** 같은 메시지(order_group_id)에서 나온 카드들이 공유하는 고객 정보. 한 카드에서 고치면 묶음 전체에 반영 */
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
 * 송장 "상품명" 조합 (기획서 4.3, 로젠 양식 기준): 약칭-상품명-색상 사이즈.
 * 브랜드·상품명·색상 사이는 "-", 사이즈 앞은 공백. 빈 값은 건너뛴다.
 */
export function excelProductName(o: Pick<OrderDraft, "brand_short" | "brand_raw" | "product_name" | "color" | "size">): string {
  const main = [o.brand_short || o.brand_raw, o.product_name, o.color].map((s) => s?.trim()).filter(Boolean).join("-");
  return [main, o.size?.trim()].filter(Boolean).join(" ");
}

export type ParsedDraft = {
  /** 같은 메시지에서 나온 카드는 같은 값 (orders.order_group_id) */
  groupId: string;
  /** 이 메시지의 원문 (대조용, 묶음 안 카드들이 공유) */
  raw: string;
  fields: OrderDraft;
};

/**
 * 붙여넣은 원문 → 카드 초안들.
 * 메시지(주문) 하나에 상품이 여러 개면 상품 수만큼 카드를 만들고, 이름/전화/주소 등은 모든 카드에 복사한다.
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

/** 클라이언트에서 온 값을 저장 가능한 형태로 정리 (허용된 필드만, 공백 제거, 전화번호 정규화) */
export function toOrderInsert(input: unknown): OrderInsert {
  const src = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const out: OrderInsert = {};
  for (const f of ORDER_FIELDS) {
    const v = src[f];
    out[f] = typeof v === "string" ? v.trim().slice(0, 500) : "";
  }
  out.phone = out.phone ? normalizePhone(out.phone) : "";
  // 기획서 4.1: 매칭 안 되면 brand_short 는 brand_raw 와 동일하게 저장
  if (!out.brand_short) out.brand_short = out.brand_raw;
  // 그룹 ID가 없거나 형식이 틀리면 DB 기본값(새 그룹)을 쓴다
  if (typeof src.order_group_id === "string" && UUID_RE.test(src.order_group_id)) {
    out.order_group_id = src.order_group_id;
  }
  return out;
}
