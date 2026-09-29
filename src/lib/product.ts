// Product raw text → extract "suggested" brand/product name/color/size.
// Spec Section 5: the dictionary never auto-confirms, it only pre-fills the card. A person makes the final call.

import type { ProductItem } from "./parser";

export type DictEntry = { full_name: string; short_form: string };

export type ProductSuggestion = {
  brand_raw: string;
  brand_short: string;
  /** Whether the brand was found in the dictionary (false shows "unmatched" on the card) */
  brandMatched: boolean;
  product_name: string;
  color: string;
  size: string;
  /** Only filled in when quantity is 2 or more. Product decision: record it as a note instead of duplicating cards per quantity */
  quantityNote: string;
};

const COLORS = [
  "아이보리", "라이트그레이", "다크그레이", "차콜", "블랙", "화이트", "네이비", "그레이", "베이지",
  "블루", "스카이블루", "레드", "핑크", "그린", "카키", "브라운", "옐로우", "퍼플", "민트", "와인",
  "오렌지", "실버", "골드", "검정", "흰색", "남색", "회색", "빨강", "파랑", "노랑", "초록", "소라",
  "연청", "진청", "중청",
];
// Match longer names first (skyblue before blue)
const COLORS_BY_LENGTH = [...COLORS].sort((a, b) => b.length - a.length);

const SEP = "[\\s,/·()]";
const SIZE_RE = new RegExp(`(?:^|${SEP})(XXXL|XXL|XL|L|M|S|XS|FREE|F|프리|\\d{2,3})(?=$|${SEP}|\\s*사이즈)`, "i");
// "2개", "2장", "2벌", "2ea", "x2", "×2", "*2"
const QTY_RE = /(\d+)\s*(?:개|장|벌|ea)|(?:^|\s)[x×*]\s*(\d+)(?=$|\s)/i;
// Trailing size at the end of an option line (may be glued to the color: "화이트77", "블랙L", "네이비 FREE")
const TRAILING_SIZE_RE = /(?<![A-Za-z0-9])(XXXL|XXL|XL|XS|S|M|L|FREE|F|프리|\d{2,3})\s*(?:사이즈)?\s*$/i;

function takeQuantity(text: string): { rest: string; quantityNote: string } {
  const m = QTY_RE.exec(text);
  if (!m) return { rest: text, quantityNote: "" };
  const n = Number(m[1] ?? m[2]);
  return { rest: removeFirst(text, m[0]), quantityNote: n > 1 ? `수량 ${n}개` : "" };
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function removeFirst(text: string, piece: string): string {
  const i = text.toLowerCase().indexOf(piece.toLowerCase());
  return i < 0 ? text : text.slice(0, i) + " " + text.slice(i + piece.length);
}

export function findBrand(text: string, dict: DictEntry[]): DictEntry | null {
  const lower = text.toLowerCase();
  let best: DictEntry | null = null;
  for (const entry of dict) {
    const name = entry.full_name.trim().toLowerCase();
    if (!name) continue;
    // Match Latin brand names on word boundaries (so "PXG" doesn't match inside "APXGO")
    const re = /^[a-z0-9]+$/.test(name)
      ? new RegExp(`(^|[^a-z0-9])${escapeRe(name)}($|[^a-z0-9])`)
      : null;
    const hit = re ? re.test(lower) : lower.includes(name);
    if (hit && (!best || name.length > best.full_name.trim().length)) best = entry;
  }
  return best;
}

/** Look up the brand's short form in the dictionary (exact full_name match, or the input is already a short form) */
export function lookupShortForm(brandRaw: string, dict: DictEntry[]): string | null {
  const key = brandRaw.trim().toLowerCase();
  if (!key) return null;
  const hit = dict.find((e) => e.full_name.trim().toLowerCase() === key)
    ?? dict.find((e) => e.short_form.trim().toLowerCase() === key);
  return hit ? hit.short_form : null;
}

/** Suggest a short form for the raw brand text: prefer an exact name/short-form match, otherwise a brand contained within the raw text */
export function suggestShortForm(brandRaw: string, dict: DictEntry[]): string | null {
  return lookupShortForm(brandRaw, dict) ?? findBrand(brandRaw, dict)?.short_form ?? null;
}

export function suggestProductFields(productText: string, dict: DictEntry[]): ProductSuggestion {
  let rest = productText;

  const brand = findBrand(rest, dict);
  let brand_raw = "";
  if (brand) {
    const m = new RegExp(escapeRe(brand.full_name.trim()), "i").exec(rest);
    brand_raw = m ? m[0] : brand.full_name;
    rest = removeFirst(rest, brand_raw);
  }

  const qty = takeQuantity(rest);
  rest = qty.rest;
  const quantityNote = qty.quantityNote;

  let color = "";
  for (const c of COLORS_BY_LENGTH) {
    if (rest.includes(c)) {
      color = c;
      rest = removeFirst(rest, c);
      break;
    }
  }

  let size = "";
  const sz = SIZE_RE.exec(rest);
  if (sz) {
    size = sz[1].toUpperCase();
    rest = removeFirst(rest, sz[0]);
  }
  rest = rest.replace(/사이즈/g, " ");

  const product_name = rest
    .split(/[\s,/]+/)
    .filter(Boolean)
    .join(" ")
    .trim();

  return {
    brand_raw,
    brand_short: brand ? brand.short_form : "",
    brandMatched: !!brand,
    product_name,
    color,
    size,
    quantityNote,
  };
}

/** Parse an option line (color+size[+quantity]). Whatever is left after removing size/quantity is treated as color (e.g. "화이트77" → 화이트 / 77) */
export function parseOption(option: string): { color: string; size: string; quantityNote: string } {
  const { rest: withoutQty, quantityNote } = takeQuantity(option);
  let rest = withoutQty.trim();
  let size = "";
  const trailing = TRAILING_SIZE_RE.exec(rest);
  const sz = trailing ?? SIZE_RE.exec(rest);
  if (sz) {
    size = sz[1].toUpperCase();
    rest = removeFirst(rest, sz[0]);
  }
  const color = rest.replace(/사이즈/g, " ").split(/[\s,/]+/).filter(Boolean).join(" ");
  return { color, size, quantityNote };
}

/** splitProducts result (one product) → suggested card values */
export function suggestItemFields(item: ProductItem, dict: DictEntry[]): ProductSuggestion {
  if (item.kind === "free") return suggestProductFields(item.text, dict);
  const brandLine = item.brand.trim();
  // The whole brand line may be the dictionary key, or only part of it may be the brand (e.g. "지포어 [ G / F ] 매장판")
  const hit = suggestShortForm(brandLine, dict);
  return {
    brand_raw: brandLine,
    brand_short: hit ?? "",
    brandMatched: hit !== null,
    product_name: item.product.trim(),
    ...parseOption(item.option),
  };
}
