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

/** Color words as written in orders (also used by the parser so a lone color word isn't taken as a name) */
export const COLOR_NAMES = [
  "블랙", "화이트", "네이비", "그레이", "회색", "베이지", "블루", "레드", "핑크", "그린",
  "카키", "브라운", "아이보리", "옐로우", "퍼플", "민트", "와인", "차콜", "오렌지", "실버", "골드",
  "검정", "흰색", "남색", "빨강", "파랑", "노랑", "초록", "소라", "연청", "진청", "중청",
  "스카이블루", "라이트그레이", "라이트베이지", "다크네이비", "다크그레이", "크림", "세피아", "스카이", "버건디",
  "오트밀", "옐로", "카멜", "라벤더", "올리브", "멜란지", "코랄", "모카",
];

// Synonyms → the representative color that goes on the label
const COLOR_SYNONYMS: Record<string, string> = {
  검정: "블랙", 검정색: "블랙", 검: "블랙", black: "블랙", bk: "블랙",
  흰색: "화이트", 흰: "화이트", white: "화이트", wh: "화이트",
  회색: "그레이", gray: "그레이", grey: "그레이",
  남색: "네이비", 곤색: "네이비", navy: "네이비",
  옐로: "옐로우", beige: "베이지", ivory: "아이보리", pink: "핑크", red: "레드", blue: "블루",
};

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Word-boundary pattern for a dictionary/color word: Latin words don't match inside other Latin words ("PXG" ≠ "APXGO"),
 * 1–2 letter Korean words don't match inside other Korean words ("핑" ≠ "핑크", "검" ≠ "검수"). Group 2 is the word itself.
 */
function wordRe(word: string, flags = "i"): RegExp {
  const w = escapeRe(word);
  if (/^[a-z0-9]+$/i.test(word)) return new RegExp(`(^|[^a-z0-9])(${w})(?![a-z0-9])`, flags);
  if (/^[가-힣]{1,2}$/.test(word)) return new RegExp(`(^|[^가-힣])(${w})(?![가-힣])`, flags);
  return new RegExp(`()(${w})`, flags);
}

const COLOR_PATTERNS: { re: RegExp; color: string; len: number }[] = [
  ...COLOR_NAMES.map((c) => ({ word: c, color: COLOR_SYNONYMS[c] ?? c })),
  ...Object.entries(COLOR_SYNONYMS).filter(([w]) => !COLOR_NAMES.includes(w)).map(([word, color]) => ({ word, color })),
].map(({ word, color }) => ({ re: wordRe(word), color, len: word.length }));

/** The first color written in the text (longest word wins at the same spot): its representative name + the matched text */
function findColor(text: string): { color: string; matched: string } | null {
  let best: { color: string; matched: string; index: number; len: number } | null = null;
  for (const p of COLOR_PATTERNS) {
    const m = p.re.exec(text);
    if (!m) continue;
    const index = m.index + m[1].length;
    if (!best || index < best.index || (index === best.index && p.len > best.len)) {
      best = { color: p.color, matched: m[2], index, len: p.len };
    }
  }
  return best && { color: best.color, matched: best.matched };
}

// Real sizes only: women's 44–88, men's 90–120, trouser inches 28–36, shoes 220–300 mm
const isNumericSize = (n: number) =>
  [44, 55, 66, 77, 88].includes(n) || (n >= 90 && n <= 120 && n % 5 === 0) || (n >= 28 && n <= 36) ||
  (n >= 220 && n <= 300 && n % 5 === 0);
const SIZE_SUFFIX = String.raw`\s*(?:사이즈|싸이즈|mm)?`;
const SHOE_RANGE_RE = new RegExp(String.raw`(?<!\d)(\d{3})\s*[-~]\s*(\d{3})(?!\d)${SIZE_SUFFIX}`, "i");
// A number size may have a letter size glued after it ("77L") — the number wins
const NUMBER_SIZE_RE = new RegExp(String.raw`(?<!\d)(\d{2,3})(?!\d)(?:XXL|XL|L|M|S)?(?![A-Za-z])${SIZE_SUFFIX}`, "gi");
const LETTER_SIZE_RE = /(?<![A-Za-z])(XXXL|XXL|XL|XS|S|M|L|FREE|F)(?![A-Za-z])(\s*(?:사이즈|싸이즈))?/i;
const WORD_SIZE_RE = /원\s*사이즈|프리\s*사이즈|프리/;

/** The size in the text and the piece of text it came from */
function findSize(text: string): { size: string; matched: string } | null {
  const range = SHOE_RANGE_RE.exec(text);
  if (range && isNumericSize(+range[1]) && isNumericSize(+range[2])) return { size: `${range[1]}-${range[2]}`, matched: range[0] };
  for (const m of text.matchAll(NUMBER_SIZE_RE)) {
    if (isNumericSize(+m[1])) return { size: m[1], matched: m[0] };
  }
  const letter = LETTER_SIZE_RE.exec(text);
  if (letter) return { size: letter[1].toUpperCase(), matched: letter[0] };
  const word = WORD_SIZE_RE.exec(text);
  if (word) return { size: word[0].startsWith("원") ? "F" : "FREE", matched: word[0] };
  return null;
}

// "2개", "2장", "2족", "1점", "1 SET", "2세트", "총 2장", "x2", "×2", "*2"
const QTY_RE = /(총\s*)?(\d+)\s*(개|장|벌|족|점|ea|set|세트)|(?:^|\s)[x×*]\s*(\d+)(?=$|\s)/gi;
const QTY_UNIT: Record<string, string> = { ea: "개", set: "세트" };

function takeQuantity(text: string): { rest: string; quantityNote: string } {
  const all = [...text.matchAll(QTY_RE)];
  if (!all.length) return { rest: text, quantityNote: "" };
  // "총 2장" (the total) wins over a per-line count
  const m = all.find((x) => x[1]) ?? all[0];
  const n = Number(m[2] ?? m[4]);
  const unit = m[3] ? QTY_UNIT[m[3].toLowerCase()] ?? m[3] : "개";
  return { rest: removeFirst(text, m[0]), quantityNote: n > 1 ? `수량 ${n}${unit}` : "" };
}

function removeFirst(text: string, piece: string): string {
  const i = text.toLowerCase().indexOf(piece.toLowerCase());
  return i < 0 ? text : text.slice(0, i) + " " + text.slice(i + piece.length);
}

// Noise around product names: marketing banners "<남은수량 빅 세일>", bracketed notes "[ G / F ]", emoji, "**",
// "매장판(제품)", and option labels ("사이즈 :", "컬러ㅡ")
const NOISE_RES: RegExp[] = [
  /<[^>]*>/g,
  /\[[^\]]*\]/g,
  new RegExp(String.raw`[\p{Extended_Pictographic}️]`, "gu"),
  /\*+/g,
  /매장판제품|매장완제품|매장판/g,
  /(?<!원\s?|프리\s?)(사이즈|싸이즈|컬러|색상|수량|color|size|qty)\s*[:：ㅡ/]?/gi,
  /ㅡ/g,
];
const stripNoise = (text: string) => NOISE_RES.reduce((s, re) => s.replace(re, " "), text);
const tidy = (text: string) =>
  text.split(/[\s,/]+/).filter((t) => t && !/^[-~.:]+$/.test(t)).join(" ").replace(/[\s\-~.:]+$/, "").trim();

/** The line is only a color and/or size (and maybe a count): "블랙 66", "화이트", "그레이/66", "블랙  1개" */
export function isOptionOnlyLine(line: string): boolean {
  let rest = stripNoise(takeQuantity(line).rest);
  const c = findColor(rest);
  if (c) rest = removeFirst(rest, c.matched);
  const s = findSize(rest);
  if (s) rest = removeFirst(rest, s.matched);
  return (!!c || !!s) && tidy(rest) === "";
}

/** The line is only a count/total: "총 2장", "1개" */
export function isQuantityOnlyLine(line: string): boolean {
  const { rest } = takeQuantity(line);
  return rest !== line && tidy(stripNoise(rest)) === "";
}

export function findBrand(text: string, dict: DictEntry[]): DictEntry | null {
  let best: DictEntry | null = null;
  for (const entry of dict) {
    const name = entry.full_name.trim();
    if (!name) continue;
    if (wordRe(name).test(text) && (!best || name.length > best.full_name.trim().length)) best = entry;
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
    brand_raw = wordRe(brand.full_name.trim()).exec(rest)?.[2] ?? brand.full_name;
    // Remove every spelling of the same brand ("지포* [ G / F ]"), so e.g. the F of "G / F" isn't read as a size
    for (const e of dict) {
      if (e.short_form === brand.short_form && e.full_name.trim()) rest = rest.replace(new RegExp(wordRe(e.full_name.trim()).source, "gi"), "$1 ");
    }
  }

  const qty = takeQuantity(rest);
  rest = stripNoise(qty.rest);

  const c = findColor(rest);
  if (c) rest = removeFirst(rest, c.matched);
  const s = findSize(rest);
  if (s) rest = removeFirst(rest, s.matched);

  return {
    brand_raw,
    brand_short: brand ? brand.short_form : "",
    brandMatched: !!brand,
    product_name: tidy(rest),
    color: c?.color ?? "",
    size: s?.size ?? "",
    quantityNote: qty.quantityNote,
  };
}

/**
 * Parse an option line (color+size[+quantity]). Without a known color word, whatever is left after removing
 * size/quantity is treated as the color (e.g. a new color name).
 */
export function parseOption(option: string): { color: string; size: string; quantityNote: string } {
  const { rest: withoutQty, quantityNote } = takeQuantity(option);
  let rest = stripNoise(withoutQty);
  const c = findColor(rest);
  if (c) rest = removeFirst(rest, c.matched);
  const s = findSize(rest);
  if (s) rest = removeFirst(rest, s.matched);
  return { color: c?.color ?? tidy(rest), size: s?.size ?? "", quantityNote };
}

/** splitProducts result (one product) → suggested card values */
export function suggestItemFields(item: ProductItem, dict: DictEntry[]): ProductSuggestion {
  if (item.kind === "free") return suggestProductFields(item.text, dict);
  // Not "brand / product / option" when the last line has neither a color nor a size (e.g. it's a remark), or when the
  // middle line already holds the color/size ("스웨터 / 컬러ㅡ그레이 / 사이즈ㅡ110") → read the whole block as free text
  if ((!findColor(item.option) && !findSize(item.option)) || findColor(item.product) || findSize(item.product)) {
    return suggestProductFields([item.brand, item.product, item.option].join(" / "), dict);
  }
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
