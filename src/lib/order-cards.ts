// Order-entry cards: one card = one parcel = one order group (orders.order_group_id) holding n products (n합배).
// Pure functions for the entry screen; in the DB each product stays one orders row sharing order_group_id.

import { invoiceRows } from "@/lib/invoice";
import type { MergeSuggestion, OrderDraft, ParsedPaste } from "@/lib/orders";

/** Fields shared by every product of the parcel */
export const SHARED_FIELDS = ["name", "phone", "addr1", "addr2", "vendor", "note"] as const;
export type SharedField = (typeof SHARED_FIELDS)[number];
export type CardShared = Record<SharedField, string>;

/** Fields of one product line */
export const ITEM_FIELDS = ["brand_raw", "brand_short", "product_name", "color", "size", "note"] as const;
export type ItemField = (typeof ITEM_FIELDS)[number];
export type CardItem = Record<ItemField, string> & {
  key: string;
  /** A person edited the short form directly → don't overwrite it when the raw brand text changes */
  brandShortEdited: boolean;
};

export type OrderCard = {
  key: string;
  /** orders.order_group_id — always set (also for hand-made cards), so all products of the card are saved as one group */
  groupId: string;
  /** Raw text the card came from (for cross-checking) */
  raw: string;
  /** The tag isn't in the known tag list (cleared once the vendor is edited) */
  newTag: boolean;
  /** Postal code of the address picked in the address search — shown for checking only, not saved */
  zonecode: string;
  /** Item numbers / product codes taken out of the product text — shown for matching the photo, not saved */
  itemNumbers: string[];
  shared: CardShared;
  items: CardItem[];
  /** A pending n합배 suggestion for this card (merge it into another card) */
  merge: MergeSuggestion | null;
  saving: boolean;
  error: string | null;
};

const emptyShared = (): CardShared => ({ name: "", phone: "", addr1: "", addr2: "", vendor: "", note: "" });

export const emptyItem = (newKey: () => string): CardItem => ({
  key: newKey(),
  brand_raw: "",
  brand_short: "",
  product_name: "",
  color: "",
  size: "",
  note: "",
  brandShortEdited: false,
});

export function emptyCard(newKey: () => string, newGroupId: () => string = () => crypto.randomUUID()): OrderCard {
  return {
    key: newKey(),
    groupId: newGroupId(),
    raw: "",
    newTag: false,
    zonecode: "",
    itemNumbers: [],
    shared: emptyShared(),
    items: [emptyItem(newKey)],
    merge: null,
    saving: false,
    error: null,
  };
}

/** parsePaste result → cards (one per group, in paste order), with each merge suggestion on the card it would move */
export function cardsFromPaste(paste: ParsedPaste, newKey: () => string = () => crypto.randomUUID()): OrderCard[] {
  const cards = new Map<string, OrderCard>();
  for (const d of paste.drafts) {
    let card = cards.get(d.groupId);
    const f = d.fields;
    if (!card) {
      card = {
        key: newKey(),
        groupId: d.groupId,
        raw: d.raw,
        newTag: d.newTag,
        zonecode: "",
        itemNumbers: d.itemNumbers,
        shared: { name: f.name, phone: f.phone, addr1: f.addr1, addr2: f.addr2, vendor: f.vendor, note: d.orderNote },
        items: [],
        merge: paste.merges.find((m) => m.groupId === d.groupId) ?? null,
        saving: false,
        error: null,
      };
      cards.set(d.groupId, card);
    }
    card.items.push({
      key: newKey(),
      brand_raw: f.brand_raw,
      brand_short: f.brand_short,
      product_name: f.product_name,
      color: f.color,
      size: f.size,
      note: d.itemNote,
      brandShortEdited: false,
    });
  }
  return [...cards.values()];
}

/** Join notes, keeping each " / "-separated part once (the order note is copied onto every product) */
const joinNotes = (...notes: string[]) => {
  const parts = notes.flatMap((n) => n.split(" / ")).map((n) => n.trim()).filter(Boolean);
  return [...new Set(parts)].join(" / ");
};

/** Rows to save: one orders row per product, all with the card's group id */
export function cardRows(card: OrderCard): (OrderDraft & { order_group_id: string })[] {
  return card.items.map((item) => ({
    ...card.shared,
    brand_raw: item.brand_raw,
    brand_short: item.brand_short,
    product_name: item.product_name,
    color: item.color,
    size: item.size,
    note: joinNotes(card.shared.note, item.note),
    // legacy columns (source is the tag → vendor)
    source_room: "",
    created_by: "",
    order_group_id: card.groupId,
  }));
}

/** Column D of the label for this card, as it will be exported ("n합배-…" for 2+ products) */
export function invoicePreview(card: OrderCard): string {
  return invoiceRows(cardRows(card))[0]?.[3] ?? "";
}

/** Put the source card's products into the target card (the target's contact and group id are kept) */
export function mergeCards(target: OrderCard, source: OrderCard): OrderCard {
  return {
    ...target,
    raw: [target.raw, source.raw].filter(Boolean).join("\n\n— 합배 —\n\n"),
    itemNumbers: [...new Set([...target.itemNumbers, ...source.itemNumbers])],
    shared: { ...target.shared, note: joinNotes(target.shared.note, source.shared.note) },
    items: [...target.items, ...source.items],
    merge: null,
    error: null,
  };
}

/** One card (and group) per product; the first product keeps the card's group id */
export function splitCard(card: OrderCard, newKey: () => string, newGroupId: () => string = () => crypto.randomUUID()): OrderCard[] {
  return card.items.map((item, i) => ({
    ...card,
    key: i === 0 ? card.key : newKey(),
    groupId: i === 0 ? card.groupId : newGroupId(),
    items: [item],
    merge: null,
    saving: false,
    error: null,
  }));
}
