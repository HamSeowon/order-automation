// 상품 원문 → 브랜드/상품명/색상/사이즈 "제안값" 추출.
// 기획서 5장: 딕셔너리는 자동 확정하지 않고 카드에 pre-fill만 한다. 최종 확정은 사람이 한다.

import type { ProductItem } from "./parser";

export type DictEntry = { full_name: string; short_form: string };

export type ProductSuggestion = {
  brand_raw: string;
  brand_short: string;
  /** 딕셔너리에서 브랜드를 찾았는지 (false면 카드에 "미매칭" 표시) */
  brandMatched: boolean;
  product_name: string;
  color: string;
  size: string;
  /** 수량이 2개 이상일 때만 채움. 운영 결정: 수량만큼 카드를 복제하지 않고 참고사항에만 기록 */
  quantityNote: string;
};

const COLORS = [
  "아이보리", "라이트그레이", "다크그레이", "차콜", "블랙", "화이트", "네이비", "그레이", "베이지",
  "블루", "스카이블루", "레드", "핑크", "그린", "카키", "브라운", "옐로우", "퍼플", "민트", "와인",
  "오렌지", "실버", "골드", "검정", "흰색", "남색", "회색", "빨강", "파랑", "노랑", "초록", "소라",
  "연청", "진청", "중청",
];
// 긴 이름부터 매칭 (스카이블루가 블루보다 먼저)
const COLORS_BY_LENGTH = [...COLORS].sort((a, b) => b.length - a.length);

const SEP = "[\\s,/·()]";
const SIZE_RE = new RegExp(`(?:^|${SEP})(XXXL|XXL|XL|L|M|S|XS|FREE|F|프리|\\d{2,3})(?=$|${SEP}|\\s*사이즈)`, "i");
// "2개", "2장", "2벌", "2ea", "x2", "×2", "*2"
const QTY_RE = /(\d+)\s*(?:개|장|벌|ea)|(?:^|\s)[x×*]\s*(\d+)(?=$|\s)/i;
// 옵션 줄 끝의 사이즈 (색상에 붙어 있어도 됨: "화이트77", "블랙L", "네이비 FREE")
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
    // 영문 브랜드는 단어 경계로 매칭 (PXG가 "APXGO" 안에서 잡히지 않게)
    const re = /^[a-z0-9]+$/.test(name)
      ? new RegExp(`(^|[^a-z0-9])${escapeRe(name)}($|[^a-z0-9])`)
      : null;
    const hit = re ? re.test(lower) : lower.includes(name);
    if (hit && (!best || name.length > best.full_name.trim().length)) best = entry;
  }
  return best;
}

/** 딕셔너리로 브랜드 약칭을 찾는다 (정확히 일치하는 full_name 또는 이미 약칭인 경우) */
export function lookupShortForm(brandRaw: string, dict: DictEntry[]): string | null {
  const key = brandRaw.trim().toLowerCase();
  if (!key) return null;
  const hit = dict.find((e) => e.full_name.trim().toLowerCase() === key)
    ?? dict.find((e) => e.short_form.trim().toLowerCase() === key);
  return hit ? hit.short_form : null;
}

/** 브랜드 원문에 대한 약칭 제안: 정확히 일치하는 이름/약칭 우선, 없으면 원문 안에 포함된 브랜드 */
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

/** 옵션 줄(색상+사이즈[+수량]) 해석. 사이즈·수량을 뺀 나머지는 모두 색상으로 본다 (예: "화이트77" → 화이트 / 77) */
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

/** splitProducts 결과(상품 1개) → 카드 제안값 */
export function suggestItemFields(item: ProductItem, dict: DictEntry[]): ProductSuggestion {
  if (item.kind === "free") return suggestProductFields(item.text, dict);
  const brandLine = item.brand.trim();
  // 브랜드 줄 전체가 딕셔너리 키일 수도, 일부만 브랜드일 수도 있음 (예: "지포어 [ G / F ] 매장판")
  const hit = suggestShortForm(brandLine, dict);
  return {
    brand_raw: brandLine,
    brand_short: hit ?? "",
    brandMatched: hit !== null,
    product_name: item.product.trim(),
    ...parseOption(item.option),
  };
}
