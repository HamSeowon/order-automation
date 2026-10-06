// KakaoTalk group-chat order raw text → split into individual orders (spec Section 5).
// Contains only framework-independent pure functions (used on both server and client).

import { COLOR_NAMES, isOptionOnlyLine, isQuantityOnlyLine } from "./product";

export type ParsedOrder = {
  name: string;
  phone: string;
  addr1: string;
  addr2: string;
  /** Raw product-related lines (item title, color/size/quantity, etc.). Used for brand/product/color/size suggestions on the card */
  productText: string;
  /** Product lines grouped into blocks by blank lines (used by splitProducts to decide the product count) */
  productBlocks: string[][];
  /** Parallel to productBlocks: the line started with a bullet (✅ ▶ •) or an item number ("1871- 그레이") → it starts a product */
  productStarts?: boolean[][];
  /** Whether the product came in via a label like "옷제목 ;" (label format is not interpreted as a block structure) */
  productLabeled: boolean;
  /** Source tag from the order's last line (e.g. 디, 장, 골마) — goes into Excel columns A/E */
  vendor: string;
  /** The vendor came from a short last line that isn't in KNOWN_TAGS (shown as "새 태그?" on the card) */
  newTag: boolean;
  /** Item numbers / product codes taken out of the product lines ("1857", "PO52384") — shown on the card for matching the photo, never exported */
  itemNumbers: string[];
  note: string;
  /** Raw lines that were split into this order (shown on the card for cross-checking) */
  raw: string;
  /** Index of the chat message the order started in (only when messages were passed in) */
  messageIndex?: number;
};

/**
 * Source tags written on the last line of each order in the combined order chat (most frequent first).
 * A tag line becomes the order's vendor and closes the order. Add new tags here once they're confirmed.
 */
export const KNOWN_TAGS: readonly string[] = [
  "디", "장", "마", "티", "악", "골마", "띠", "연", "리더", "동", "K", "라라", "페리", "평", "굿1", "굿2",
  "멍", "오로라", "열", "봉", "대일", "닛", "스타", "마녀", "닥", "천", "럭", "수정",
];
const TAG_TYPOS: Record<string, string> = { k: "K", 폐리: "페리" };
const KNOWN_TAG_SET = new Set(KNOWN_TAGS);

/** The line as a known tag (typos corrected), or null */
export function knownTag(line: string): string | null {
  const t = line.trim();
  const tag = TAG_TYPOS[t] ?? t;
  return KNOWN_TAG_SET.has(tag) ? tag : null;
}

// Mobile (010/011/016–019), internet (070), safe numbers (050X), Seoul (02) and area codes (031–064), with any mix of
// spaces/dots/hyphens/~/ㆍ between the groups ("010. 1234. 5678", "010- 1234 5678", "010~1234~5678", "(01012345678"),
// or written internationally (+82 10-1234-5678).
// Never part of a longer digit run, and never right after "digits-" — so a Logen waybill (452-1234-5678) isn't a phone.
const PHONE_SEP = String.raw`[\s.\-~ㆍ·]{0,4}`;
const PHONE_SRC =
  String.raw`(?:\+82[\s.\-]{0,2}(?:\(0\)|0)?|(?<!\d)(?<!\d[-.~])0)` +
  String.raw`(?:1[016789]|70|50\d|2|3[1-3]|4[1-4]|5[1-5]|6[1-4])[\s.\-~ㆍ·)]{0,4}\d{3,4}${PHONE_SEP}\d{4}(?!\d)`;
const PHONE_RE = new RegExp(PHONE_SRC);
const PHONE_RE_G = new RegExp(PHONE_SRC, "g");

/** Every phone number written in the text, as written */
export function findPhones(text: string): string[] {
  return text.match(PHONE_RE_G) ?? [];
}
const NAME_RE = /^[가-힣]{2,5}$/;
// Start of an address: a province/metropolitan city ("경기도", "충남서산시", "전남광주통합특별시"…), or — with no province —
// "○○시 ○○구/군/읍/면/동/로/길" ("창원시 마산회원구", "목포시산정로436", "포항시남구") or "○○구 ○○로/길/동" ("강남구 삼성로243")
const ADDR_START_RE = new RegExp(
  "^(서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|충청|전북|전남|전라|경북|경남|경상|제주)" +
    String.raw`|^[가-힣]{1,4}시\s*[가-힣0-9]*?(구|군|읍|면|동|로|길)(\s|\d|$)` +
    String.raw`|^[가-힣]{1,3}구\s+[가-힣0-9]+(로|길|동)`,
);
// Road name + building number (e.g. 백제고분로 212, 화곡로 55, 중앙로123번길 45, 반송로 88-1, 위례성대로 27번지,
// 이촌로61길39, 백자로 94길 59 — the road's own "61길" is part of the name, the building number comes after)
// A number followed by 동/호/층 is a building/unit number, not a road's building number ("인창해모로 614동")
const ROAD_NUMBER_RE = /[가-힣A-Za-z0-9](?:로|길)(?:\s*\d+(?:번|가)?길)?\s*\d+(?:-\d+)?(?:번지)?(?![\d동호층가])/;
// Lot-number (jibun) address: neighborhood + lot number (주안동148-37, 인창동43, 명서동 75-4, 연제동7-9번지) — not "101동"
const JIBUN_RE = /[가-힣](?:동|리|가)\s*\d+(?:-\d+)?(?:번지)?(?![\d동호층가])/;
// An administrative-area word (대신동, 광안동, 오전동, 삼향읍, 남악리, 효자동3가)
const ADMIN_AREA_RE = /^[가-힣]+(동|읍|면|리)$|^[가-힣]+\d가$/;
// A postal code in front of the address ("우편번호 04713,", "(42116)")
const POSTAL_PREFIX_RE = /^(?:우편번호\s*[:：]?\s*)?\(?\s*\d{5}\s*\)?\s*[,.]?\s*/;
const POSTAL_ONLY_RE = /^(?:우편번호\s*[:：]?\s*)?\(?\s*\d{5}\s*\)?[,.]?$/;
// An address label written without a colon ("받는주소 서울시 …")
const ADDR_LABEL_NO_COLON_RE = /^(받는\s*(?:분\s*)?주소|배송지|주소)\s+/;
// Spoken endings and door codes written after the address
const ADDR_SPOKEN_END_RE = /\s*(입니다|이에요|예요)\s*[~!.]*$/;
const DOOR_CODE_RE = /\s*(\(?\s*(?:공동\s*)?(?:현관\s*)?(?:비번|비밀번호).*)$/;
// Lines that look like the rest of the address after the road name (building name/unit/floor, etc.)
const ADDR_DETAIL_RE =
  /(\d+\s*(?:동|호|층|단지|차|번지)|아파트|빌라|상가|맨션|타워|오피스텔|빌딩|하우스|주택|apt|지하|\d+-\d+)/i;

// Unlabeled words that overlap the name pattern (2–5 Hangul characters) but aren't names
const NOT_NAME_WORDS = new Set([
  ...COLOR_NAMES,
  "프리", "사이즈", "수량", "주소", "성함", "전번", "감사합니다", "주소변경", "발주", "합배", "주문", "주문서", "주문장",
  "받는분주소", "받는주소", "핸폰", "입고중", "통합", "단독", "연락처", "전화번호", "핸드폰", "휴대폰", "배송지", "받는분", "받는이",
]);

// Common Korean surnames (two-character ones first) — a name that doesn't start with one gets an "이름 확인" flag
const SURNAMES_2 = ["남궁", "황보", "제갈", "선우", "독고", "사공", "서문", "동방"];
const SURNAMES = new Set(
  ("김이박최정강조윤장임한오서신권황안송류유전홍고문양손배백허남심노하곽성차주우구민나진지엄채원천방공현함변염여추도소석선설마길연위표명기반왕금옥육인맹제모탁국어은편용예봉경사부가복태목형피두감음빈동온호범좌팽승간상갈시화견당")
    .split(""),
);
// Words that mark a shop or nickname rather than a person in the name position
const NOT_PERSON_RE = /카페|헤어|샵|숍|클로젯|상회|상사|마트|가게|공방|부티크|언니|이모|사장|매장|스튜디오|뷰티|네일|살롱|의류|패션|분식|식당|치킨|공업사|미용실/;

/** The name doesn't look like a person's name (shop name, nickname…) → show "이름 확인" on the card */
export function nameNeedsCheck(name: string): boolean {
  const n = name.trim();
  if (!n) return false;
  if (!/^[가-힣]{2,4}$/.test(n) || NOT_PERSON_RE.test(n)) return true;
  if (SURNAMES_2.some((s) => n.startsWith(s))) return false;
  return !SURNAMES.has(n[0]);
}

const looksLikePersonName = (s: string) => /^[가-힣]{2,4}$/.test(s) && !nameNeedsCheck(s);

/**
 * A name-position token → the Hangul name, plus whatever was attached to it (goes to the note):
 * "젤리(보미)" → 젤리 + "(보미)", "신하은ON" → 신하은 + "ON", "강민서 (" → 강민서, "하늘분식 조서준" → 조서준 + "하늘분식",
 * "김 수희" → 김수희. Returns null when the text doesn't look like a name at all.
 */
function parseNameToken(text: string): { name: string; extra: string } | null {
  const s = text.replace(/[.,;:~!/]+$/, "").trim();
  // Family name written apart from the given name
  const spaced = /^([가-힣])\s([가-힣]{1,3})$/.exec(s);
  if (spaced && SURNAMES.has(spaced[1])) return { name: spaced[1] + spaced[2], extra: "" };
  // Shop name followed by the person's name
  const pair = /^([가-힣]{2,10})\s+([가-힣]{2,4})$/.exec(s);
  if (pair && looksLikePersonName(pair[2]) && !looksLikePersonName(pair[1]) && !NOT_NAME_WORDS.has(pair[2])) {
    return { name: pair[2], extra: pair[1] };
  }
  // Name with a nickname in parentheses or a short Latin code glued on
  const m = /^([가-힣]{2,5})\s*(\([^)]*\)?|[A-Za-z]{1,4})?$/.exec(s);
  if (!m || NOT_NAME_WORDS.has(m[1]) || knownTag(m[1])) return null;
  const extra = (m[2] ?? "").trim();
  return { name: m[1], extra: extra === "(" ? "" : extra };
}

// Signals that a line describes a product (used for lines after the contact info): a color word, a clothing/shoe size,
// a quantity, a product code (PO12345) or a lone 4-digit item number
const PRODUCT_SIZE_RE = /(^|[^\d])(44|55|66|77|88|90|95|100|105|110|115|2[2-9][05]|2[89]|3[0-6])(?!\d)|(^|[^A-Za-z])(XS|S|M|L|XL|XXL|FREE)(?![A-Za-z])/i;
const PRODUCT_QTY_RE = /\d+\s*(개|장|벌|족|점|ea|set|세트)/i;
const PRODUCT_CODE_RE = /PO\d{4,}|^\d{4}[.)/]?$/i;
const COLOR_WORD_RE = new RegExp(COLOR_NAMES.join("|"));

function looksLikeProduct(line: string): boolean {
  return PRODUCT_SIZE_RE.test(line) || PRODUCT_QTY_RE.test(line) || PRODUCT_CODE_RE.test(line) || COLOR_WORD_RE.test(line);
}

// An unlisted tag candidate: a short last line (≤4 chars) that isn't a number, size, color or product hint
const TAG_CANDIDATE_RE = /^[가-힣A-Za-z0-9]{1,4}$/;
const isTagCandidate = (line: string) =>
  TAG_CANDIDATE_RE.test(line) && !/^\d+$/.test(line) && !NOT_NAME_WORDS.has(line) && !looksLikeProduct(line);

type Field = "name" | "phone" | "addr" | "product" | "vendor" | "note";

const NAME_LABEL_RE = /^(성함|이름|받는\s*(분|이|사람)|받으시는\s*분|받을\s*(분|사람)|수령인|수취인|주문자|고객명?)$/;
const LABELS: [RegExp, Field][] = [
  [NAME_LABEL_RE, "name"],
  [/^(전번|전화번호|전화|연락처|핸드폰|핸폰|휴대폰|폰번호?|번호|HP)$/i, "phone"],
  [/^(주소|배송지|받는\s*(분\s*)?주소|배송\s*주소|수령\s*주소)$/, "addr"],
  [/^(옷\s*제목|상품명?|제품명?|품명|품번|주문\s*상품|컬러|색상|사이즈|수량|컬러\s*\/\s*사이즈(\s*\/\s*수량)?)$/, "product"],
  [/^(거래처)$/, "vendor"],
  [/^(참고(사항)?|메모|요청(사항)?|비고)$/, "note"],
];

// Leading bullets/emoji before a label: "➡️ 성함 ;", "■ 주문자 :", "✔️상품명:", "*이름:", "🔹 연락처 :"
const LABEL_PREFIX = String.raw`[\s\p{Extended_Pictographic}️⃣■□▪▫◆◇●○•·▶►→>\-*#✔✓]*`;
// Matches forms like "➡️ 성함 ; 최유리", "- 주소: ...", "▶전번 : ..."
// also numbered ("1.성함 : …", "2) 주소: …") and with a period ("주소. 경기 …" — only label words are accepted as keys)
const LABEL_LINE_RE = new RegExp(String.raw`^${LABEL_PREFIX}(?:\d+\s*[.)]\s*)?([가-힣A-Za-z\s/]{1,15}?)\s*[;:：.]\s*(.*)$`, "u");
// A recipient label on its own line with nothing after it ("받는이", "✔받는사람", "받으시는분") — only marks where the
// recipient's details start
const RECIPIENT_MARK_RE = new RegExp(String.raw`^${LABEL_PREFIX}(받는\s*(분|이|사람)|받으시는\s*분|받을\s*(분|사람)|수령인)\s*[;:：]?\s*$`, "u");
// The sender's details ("보내는이", "보내는분: …", "보내는사람 이가은") are not the recipient — ignored up to the next blank line
const SENDER_RE = new RegExp(String.raw`^${LABEL_PREFIX}(보내는\s*(이|분|사람)|보낸\s*사람|발송인)`, "u");
// Form headers with no content of their own: "■ 발주", "@@@주문장@@@", "<주문서>"
const FORM_HEADER_RE = new RegExp(String.raw`^${LABEL_PREFIX}[@<\[(]*\s*(발주|주문서|주문장)\s*[@>\])!.]*$`, "u");

const looksLikeAddress = (s: string) => ADDR_START_RE.test(s) || ROAD_NUMBER_RE.test(s);

/** Text (phone already removed) holding both a name and an address: "오지우 인천 연수구 …" or "… 4455호 최민서." */
function splitNameAndAddress(text: string): { nameText: string; addr: string } | null {
  const toks = text.split(/\s+/).filter(Boolean);
  if (toks.length < 2) return null;
  const after = toks.slice(1).join(" ");
  // (not when the whole text already reads as an address: "광주 서구 …" — "광주" is the city, not a name)
  if (!ADDR_START_RE.test(text) && parseNameToken(toks[0]) && ADDR_START_RE.test(after)) return { nameText: toks[0], addr: after };
  const lastText = toks[toks.length - 1];
  const last = parseNameToken(lastText);
  const before = toks.slice(0, -1).join(" ");
  // At the end, accept a person-like name or a name with a nickname in parentheses ("헤어하나(별이네)")
  if (last && (looksLikePersonName(last.name) || last.extra.startsWith("(")) && looksLikeAddress(before)) {
    return { nameText: lastText, addr: before };
  }
  return null;
}

/** An address line ending with a 3-character person's name ("…렉시안906동 1305호 김서준") → address + name */
function trailingPersonName(line: string): { addr: string; name: string } | null {
  const m = /^(.*\S)\s+([가-힣]{3})[.,]?$/.exec(line.trim());
  return m && looksLikePersonName(m[2]) && looksLikeAddress(m[1]) ? { addr: m[1], name: m[2] } : null;
}

function matchLabel(line: string): { field: Field; value: string } | null {
  const m = line.match(LABEL_LINE_RE);
  if (!m) return null;
  const key = m[1].trim();
  for (const [re, field] of LABELS) {
    if (re.test(key)) return { field, value: m[2].trim() };
  }
  return null;
}

/** Digits only; an international +82 number becomes the domestic form (+82 10… → 010…) */
function phoneDigits(input: string): string {
  const d = input.replace(/\D/g, "");
  return /^\s*\+\s*82/.test(input) ? `0${d.slice(2).replace(/^0/, "")}` : d;
}

/** Format as 010-1234-5678 / 02-123-4567 / 031-123-4567 / 0505-123-4567. Anything else is returned as typed (trimmed) */
export function normalizePhone(input: string): string {
  const d = phoneDigits(input);
  // prefix length + middle length; the last group is always 4 digits
  const fmt = (prefix: number) => `${d.slice(0, prefix)}-${d.slice(prefix, d.length - 4)}-${d.slice(-4)}`;
  if (/^050\d/.test(d) && (d.length === 11 || d.length === 12)) return fmt(4);
  if (/^02/.test(d) && (d.length === 9 || d.length === 10)) return fmt(2);
  if (/^0[1-9]\d/.test(d) && (d.length === 10 || d.length === 11)) return fmt(3);
  return input.trim();
}

/** Card warning when the phone number's digit count doesn't fit its prefix (null = looks fine, or empty) */
export function phoneWarning(phone: string): string | null {
  const t = phone.trim();
  if (!t) return null;
  const d = phoneDigits(t);
  if (!d) return "전화번호에 숫자가 없습니다";
  if (d.startsWith("010")) return d.length === 11 ? null : `010 번호는 11자리여야 합니다 (지금 ${d.length}자리)`;
  const ok =
    (/^01[16789]/.test(d) && (d.length === 10 || d.length === 11)) ||
    (/^050\d/.test(d) && (d.length === 11 || d.length === 12)) ||
    (/^02/.test(d) && (d.length === 9 || d.length === 10)) ||
    (/^0[3-7]\d/.test(d) && (d.length === 10 || d.length === 11));
  return ok ? null : `전화번호 자릿수를 확인하세요 (지금 ${d.length}자리)`;
}

/**
 * Split an address into "city/district/road-name+number" (addr1) and the rest (addr2).
 * Without a road number, split after the lot number (jibun); without either, after the last 동/읍/면/리 word before the
 * first part with digits (or right before that part) — e.g. "부산수영구 광안동 | 쌍용예가아파트513동 455호".
 */
export function splitAddress(addr: string): { addr1: string; addr2: string } {
  const text = addr.replace(/\s+/g, " ").trim();
  // Whichever comes first: a lot number written before an apartment whose name ends in 로 ("인창동43 인창해모로 …")
  const road = ROAD_NUMBER_RE.exec(text);
  const jibun = JIBUN_RE.exec(text);
  const m = road && jibun ? (jibun.index < road.index ? jibun : road) : (road ?? jibun);
  if (m) {
    const end = m.index + m[0].length;
    return { addr1: text.slice(0, end).trim(), addr2: text.slice(end).replace(/^[\s,]+/, "").trim() };
  }
  const toks = text.split(" ");
  const firstDigit = toks.findIndex((t) => /\d/.test(t));
  if (firstDigit <= 0) return { addr1: text, addr2: "" };
  let cut = firstDigit;
  for (let k = firstDigit - 1; k > 0; k--) {
    if (ADMIN_AREA_RE.test(toks[k])) {
      cut = k + 1;
      break;
    }
  }
  return { addr1: toks.slice(0, cut).join(" "), addr2: toks.slice(cut).join(" ") };
}

/**
 * Address-line clean-up before parsing: drop a postal code in front ("(42116) 대구 …", "우편번호 04713, 서울 …") and
 * add the missing colon to an address label ("받는주소 서울시 …" → "받는주소: 서울시 …")
 */
function normalizeAddressLine(line: string): string {
  const postal = POSTAL_PREFIX_RE.exec(line);
  if (postal && postal[0] && ADDR_START_RE.test(line.slice(postal[0].length))) line = line.slice(postal[0].length);
  const label = ADDR_LABEL_NO_COLON_RE.exec(line);
  if (label && ADDR_START_RE.test(line.slice(label[0].length))) line = `${label[1]}: ${line.slice(label[0].length)}`;
  return line;
}

const PROVINCE_INSIDE_RE = /^([가-힣]{2,5}?)((?:서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주)\S*\s.*)$/;

/** A name/shop name glued to the province ("카페모아경남 통영시 …") → two lines: the name, then the address */
function splitGluedName(line: string): string[] {
  const m = PROVINCE_INSIDE_RE.exec(line);
  return m && !ADDR_START_RE.test(line) && parseNameToken(m[1]) && ADDR_START_RE.test(m[2]) ? [m[1], m[2]] : [line];
}

/** addr1 has neither a road number nor a lot number → "주소 확인 필요" (use the address search) */
export function addressNeedsCheck(addr1: string): boolean {
  const a = addr1.trim();
  return !!a && !ROAD_NUMBER_RE.test(a) && !JIBUN_RE.test(a);
}

type Draft = {
  name: string;
  phone: string;
  addrLines: string[];
  productBlocks: string[][];
  productStarts: boolean[][];
  productLabeled: boolean;
  vendor: string;
  newTag: boolean;
  itemNumbers: string[];
  noteLines: string[];
  rawLines: string[];
  messageIndex: number;
};

const emptyDraft = (): Draft => ({
  name: "", phone: "", addrLines: [], productBlocks: [], productStarts: [], productLabeled: false, vendor: "", newTag: false,
  itemNumbers: [], noteLines: [], rawLines: [], messageIndex: -1,
});

// A product line that starts a product of its own: a bullet ("✅️사우스 …", "▶ …") or an item number with text after it
// ("1871- 그레이", "1858. 그레이/66")
const PRODUCT_START_RE = new RegExp(String.raw`^(?:[✅✔☑▶►•]|\p{Extended_Pictographic})|^\d{4}\s*[-.)/]\s*\S`, "u");

/**
 * A product line minus the things that must not reach the label: item numbers (4 digits — "1857.", "1857)", "품번 1857",
 * "▫️제품 / 품번 1857", "골프화1583", "1759.1760") and product codes (PO52384), which are returned separately for the card,
 * plus dates/times ("9월23일", "9.22", "★ … 13시 40분"). Only product lines go through here, so address numbers are untouched.
 */
export function cleanProductLine(line: string): { text: string; itemNumbers: string[] } {
  const found: string[] = [];
  const take = (...nums: string[]) => {
    found.push(...nums);
    return " ";
  };
  let t = line
    .replace(/PO\s?(\d{4,6})/gi, (_, d: string) => take(`PO${d}`))
    .replace(/(?:▫️?\s*)?(?:제품\s*\/\s*)?품번\s*[:：]?\s*(\d{4})(?!\d)/g, (_, d: string) => take(d))
    .replace(/(?<!\d)(?<!\d[.,])(\d{4})\s*[.,/]\s*(\d{4})(?!\d)/g, (_, a: string, b: string) => take(a, b))
    // ("…/1557", "…-1288", "1878-1" too; not a decimal/time, and not a unit number "1705호")
    .replace(/(?<!\d)(?<!\d[.,:])(\d{4})(?!\d|\s*(?:mm|원|년|동|호|층))/gi, (_, d: string) => take(d))
    .replace(/\d{1,2}\s*월\s*\d{1,2}\s*일|\d{1,2}\s*시\s*\d{1,2}\s*분|★/g, " ");
  if (/^\s*\d{1,2}[./]\d{1,2}\.?\s*$/.test(t)) t = "";
  // punctuation left at the start by a removed number ("1857) 로고…", "1435. 55사이즈", "1871- 그레이")
  t = t.replace(/^[\s.)/\-]+/, "").trim();
  return { text: t, itemNumbers: [...new Set(found)] };
}

const hasContent = (d: Draft) =>
  !!(d.name || d.phone || d.addrLines.length || d.productBlocks.length || d.vendor || d.noteLines.length);

const isComplete = (d: Draft) => !!d.phone && d.addrLines.length > 0;
const samePhone = (a: string, b: string) => a.replace(/\D/g, "") === b.replace(/\D/g, "");
const hasContact = (d: Draft) => !!(d.name || d.phone || d.addrLines.length);

function looksLikeAddressContinuation(line: string, d: Draft, prevWasAddr: boolean, directlyUnder: boolean): boolean {
  if (d.addrLines.length === 0) return false;
  // If the road name + number hasn't appeared yet, the next address line continues it (e.g. "서울시 송파구" / "백제고분로 212 ...") —
  // but only right after the address (blank lines allowed) or when it looks like an address detail, and never a lone name,
  // so a tag or remark further down isn't glued onto an address that simply has no road number
  const sofar = d.addrLines.join(" ");
  if (!ROAD_NUMBER_RE.test(sofar) && !JIBUN_RE.test(sofar)) {
    return ADDR_DETAIL_RE.test(line) || (prevWasAddr && !NAME_RE.test(line));
  }
  if (ROAD_NUMBER_RE.test(line) || ADDR_DETAIL_RE.test(line)) return true;
  // A building-name line right under the address, no blank line in between ("중흥S클라스 파크뷰" / "720/7896")
  // (a whole line in parentheses without digits is a remark: "(검수 잘해서 보내주세요.)")
  return (
    directlyUnder && !parseNameToken(line) && !knownTag(line) && !/^\([^\d]*\)$/.test(line) &&
    !COLOR_WORD_RE.test(line) && !PRODUCT_QTY_RE.test(line) && !PRODUCT_CODE_RE.test(line)
  );
}

function toParsed(d: Draft): ParsedOrder {
  // A door code written after the address goes to the note; a spoken ending ("…호입니다~") is dropped
  let addr = d.addrLines.join(" ");
  const door = DOOR_CODE_RE.exec(addr);
  if (door) {
    addr = addr.slice(0, door.index);
    d.noteLines.push(door[1].trim());
  }
  const { addr1, addr2 } = splitAddress(addr.replace(ADDR_SPOKEN_END_RE, ""));
  return {
    name: d.name,
    phone: d.phone ? normalizePhone(d.phone) : "",
    addr1,
    addr2,
    productText: d.productBlocks.flat().join(" / "),
    productBlocks: d.productBlocks,
    productStarts: d.productStarts,
    productLabeled: d.productLabeled,
    vendor: d.vendor,
    newTag: d.newTag,
    itemNumbers: d.itemNumbers,
    ...(d.messageIndex >= 0 && { messageIndex: d.messageIndex }),
    note: d.noteLines.join(" "),
    raw: d.rawLines.join("\n"),
  };
}


/**
 * Split raw text into individual orders.
 * A line-by-line state machine: labels take priority, otherwise fall back to detecting a phone number/name/address-start pattern.
 * An order is considered "complete" once it has both a phone number and an address; a subsequent line that isn't a continuation of the address then starts a new order.
 * Product lines are grouped into blocks separated by blank lines (one message, multiple products → splitProducts).
 * Pass an array of chat messages (splitKakaoPaste) to use message boundaries as order-boundary hints; a plain string keeps the line-only rules.
 */
export function segmentOrders(input: string | readonly string[]): ParsedOrder[] {
  const byMessage = typeof input !== "string";
  const orders: ParsedOrder[] = [];
  let d = emptyDraft();
  // Tracks which field should collect the lines following a label with no inline value (e.g. the line after "컬러/사이즈/수량 ;" is "블랙 1개")
  let pending: Field | null = null;
  // Whether the previous line (immediately above, no blank line in between) was a product line → decides whether to append to the same product block
  let prevWasProduct = false;
  // Whether the previous non-blank line was part of the address (decides whether an address with no road number continues)
  let prevWasAddr = false;
  // …and whether that address line was the line directly above (no blank line in between)
  let addrDirectlyAbove = false;
  // A source tag closed the current order: lines that bring new contact info start the next order, anything else is a note
  let closed = false;
  // How the lines after a complete order's contact info are read when no new contact info follows: as product lines or as a note
  let tailKind: "product" | "note" | null = null;
  // Index of the chat message being read (orders remember where they started — used to compare message dates)
  let messageNo = -1;
  // Inside a "보내는이" block (until the next blank line): those lines describe the sender, not the recipient
  let inSender = false;

  const flush = () => {
    if (hasContent(d)) orders.push(toParsed(d));
    d = emptyDraft();
    if (byMessage) d.messageIndex = messageNo;
    pending = null;
    prevWasProduct = false;
    closed = false;
    tailKind = null;
    inSender = false;
  };

  // Name text → name (+ whatever was glued to it goes to the note)
  const setName = (text: string) => {
    const tok = parseNameToken(text);
    d.name = tok ? tok.name : text.replace(/[.,;:~!/]+$/, "").trim();
    if (tok?.extra) d.noteLines.push(tok.extra);
  };

  const addProductLine = (value: string) => {
    const { text, itemNumbers } = cleanProductLine(value);
    for (const n of itemNumbers) if (!d.itemNumbers.includes(n)) d.itemNumbers.push(n);
    if (!text) return;
    const start = PRODUCT_START_RE.test(value.trim());
    const last = d.productBlocks.length - 1;
    if (prevWasProduct && last >= 0) {
      d.productBlocks[last].push(text);
      d.productStarts[last].push(start);
    } else {
      d.productBlocks.push([text]);
      d.productStarts.push([start]);
    }
  };

  const assign = (field: Field, value: string) => {
    if (!value) return;
    switch (field) {
      case "name": {
        // "■ 주문자 :윤서준 /010 5715 8415" — the phone can come inside the name value
        const phones = findPhones(value);
        if (phones.length && !d.phone) assign("phone", phones.join(" / "));
        const text = phones.reduce((s, p) => s.replace(p, " "), value).replace(/[,/]/g, " ").trim();
        // The address written under the name label (with the name at the end, or no name at all)
        const both = parseNameToken(text) ? null : splitNameAndAddress(text);
        if (both) {
          setName(both.nameText);
          d.addrLines.push(both.addr);
        } else if (!parseNameToken(text) && looksLikeAddress(text)) {
          d.addrLines.push(text);
        } else {
          setName(text);
        }
        break;
      }
      case "phone": {
        // "연락처: 010-1234-5678 / 070-123-4567" → first number is the phone, the others go to the note
        const [first, ...others] = findPhones(value);
        d.phone = first ?? value;
        for (const p of others) d.noteLines.push(`다른 번호 ${normalizePhone(p)}`);
        break;
      }
      case "addr": d.addrLines.push(value); break;
      case "product": addProductLine(value); break;
      case "vendor": d.vendor = value; break;
      case "note": d.noteLines.push(value); break;
    }
  };

  // Whether the current order must be closed out before accepting a new value (the same field is already filled, or a new product arrives on an already-complete order)
  const startsNewOrder = (field: Field): boolean => {
    if (field === "name") return !!d.name;
    if (field === "phone") return !!d.phone;
    if (field === "addr") return d.addrLines.length > 0 && isComplete(d);
    // With message boundaries known, a complete order was already closed at the end of its message, so product lines
    // later in the same message (e.g. contact first, product after) belong to the current order
    if (field === "product") return !byMessage && (isComplete(d) || (!!d.name && !!d.phone && d.productBlocks.length > 0));
    return false;
  };

  const put = (field: Field, value: string, line: string) => {
    if (startsNewOrder(field)) flush();
    assign(field, value);
    d.rawLines.push(line);
  };

  // Messages are joined with a blank line so the "next line" lookahead below never reaches into the next message
  const messages = byMessage ? input : [input];
  const lines: string[] = [];
  const messageStarts = new Map<number, string>();
  // For each line, the index of the last non-blank line of its scope (its message, or the whole text without boundaries)
  const scopeLast: number[] = [];
  for (const message of messages) {
    if (lines.length) lines.push("");
    messageStarts.set(lines.length, message);
    const start = lines.length;
    lines.push(...message.split(/\r?\n/).flatMap((l) => splitGluedName(l.trim())).map(normalizeAddressLine));
    let last = lines.length - 1;
    while (last > start && !lines[last]) last--;
    for (let k = start; k < lines.length; k++) scopeLast[k] = last;
  }

  // Scan from line i to the end of its scope, stopping at a known tag (which closes the order)
  const scanRest = (i: number, hit: (line: string) => boolean): boolean => {
    for (let j = i; j <= scopeLast[i]; j++) {
      const l = lines[j];
      if (!l) continue;
      if (j > i && knownTag(l)) return false;
      if (hit(l)) return true;
    }
    return false;
  };
  const bringsContact = (l: string) => {
    if (PHONE_RE.test(l) || ADDR_START_RE.test(l)) return true;
    const lbl = matchLabel(l);
    return !!lbl && (lbl.field === "name" || lbl.field === "phone" || lbl.field === "addr");
  };

  for (const [i, line] of lines.entries()) {
    const message = messageStarts.get(i);
    if (message !== undefined) messageNo++;
    // A new chat message closes the current order once it's complete (or tagged) — or once it has contact info and the
    // new message brings its own phone number. Product-only messages (e.g. "1828" before the contact) still merge forward.
    if (message !== undefined && i > 0 && (closed || isComplete(d) || (hasContact(d) && PHONE_RE.test(message)))) flush();
    if (message !== undefined) prevWasProduct = false;
    if (!line) {
      prevWasProduct = false;
      addrDirectlyAbove = false;
      inSender = false;
      continue;
    }
    if (byMessage && d.messageIndex < 0) d.messageIndex = messageNo;
    const tag = knownTag(line);
    // A postal code on a line of its own ("우편번호  04713") isn't needed (the Logen template has no postal-code column)
    if (POSTAL_ONLY_RE.test(line)) {
      d.rawLines.push(line);
      continue;
    }
    // The sender's block ("보내는이" + the next lines up to a blank line) is kept in the raw text only
    if (SENDER_RE.test(line) || (inSender && !tag)) {
      inSender = true;
      d.rawLines.push(line);
      continue;
    }
    // A bare recipient label ("받는이", "✔받는사람") only marks where the recipient's details start;
    // a form header ("■ 발주", "@@@주문장@@@") carries nothing
    if (RECIPIENT_MARK_RE.test(line) || FORM_HEADER_RE.test(line)) {
      if (closed) flush();
      d.rawLines.push(line);
      pending = null;
      continue;
    }
    // After a tag, the next order starts with the next line that brings contact info (or a label)
    if (closed && (scanRest(i, bringsContact) || matchLabel(line))) flush();
    let isAddr = false;
    const continuesProduct = prevWasProduct;
    // If the very next line (no blank line in between) is not a contact-info line, this line is the first line of a product block (e.g. Hangul brand "지포어" followed by "니트")
    const next = lines[i + 1] ?? "";
    const startsProductBlock = !!next && !PHONE_RE.test(next) && !ADDR_START_RE.test(next) && !matchLabel(next);
    // Only flipped back to true below when this line is actually treated as a product line
    let isProduct = false;

    const label = matchLabel(line);
    if (label) {
      // Further product labels of a labeled form ("■ 상품명 :" → "■ 수량 :") continue the same order until it's complete
      if (label.field === "product" && d.productLabeled && !isComplete(d)) {
        assign("product", label.value);
        d.rawLines.push(line);
      } else {
        put(label.field, label.value, line);
      }
      if (label.field === "product") d.productLabeled = true;
      // A name label with nothing after it ("받을사람:") just marks the recipient block; the name comes on its own line
      pending = label.value || label.field === "name" ? null : label.field;
      isAddr = label.field === "addr";
    } else if (pending === "addr") {
      // The line after an address label with no inline value, e.g. "➡️ 주소 ;"
      d.addrLines.push(line);
      d.rawLines.push(line);
      pending = null;
      isAddr = true;
    } else if (tag && hasContact(d)) {
      // Source tag (last line of an order) → vendor; it also closes the order
      d.vendor = tag;
      d.rawLines.push(line);
      pending = null;
      closed = true;
    } else if (closed) {
      // Remarks after the tag that don't start a new order (e.g. "○○○ 다시 주문")
      d.noteLines.push(line);
      d.rawLines.push(line);
    } else if (PHONE_RE.test(line)) {
      // A phone number (with the name attached on the same line, e.g. "최유리 01024567890", "김하은010 9500 9364", "강민서 (01021431123")
      const [phone, ...others] = findPhones(line);
      const rest = [phone, ...others].reduce((s, p) => s.replace(p, " "), line).replace(/[,/]/g, " ").trim();
      // The rest is a name, or a name plus the address ("…4455호 최민서.", "오지우 … 인천 연수구 …")
      const both = parseNameToken(rest) ? null : splitNameAndAddress(rest);
      const nameText = both ? both.nameText : rest;
      const name = parseNameToken(nameText)?.name ?? "";
      if (d.phone && !samePhone(d.phone, phone)) {
        // A second, different number before the order is complete (and not with a different name) is an extra number
        // for the same order → note. Otherwise it's the next order.
        if (!isComplete(d) && !(name && d.name && name !== d.name)) others.unshift(phone);
        else flush();
      }
      if (name && d.name && name !== d.name) flush();
      if (name && !d.name) setName(nameText);
      if (both && !isComplete(d)) {
        d.addrLines.push(both.addr);
        isAddr = true;
      }
      if (!d.phone) d.phone = phone;
      for (const p of others) if (!samePhone(d.phone, p)) d.noteLines.push(`다른 번호 ${normalizePhone(p)}`);
      d.rawLines.push(line);
      pending = null;
    } else if (looksLikeAddressContinuation(line, d, prevWasAddr, addrDirectlyAbove) && !ADDR_START_RE.test(line)) {
      d.addrLines.push(line);
      d.rawLines.push(line);
      isAddr = true;
    } else if (ADDR_START_RE.test(line)) {
      // An address line can end with the recipient's name ("…1305호 김서준", phone on the next line)
      const trailing = d.name ? null : trailingPersonName(line);
      put("addr", trailing ? trailing.addr : line, line);
      if (trailing) setName(trailing.name);
      pending = null;
      isAddr = true;
    } else if (isComplete(d) && !pending && !scanRest(i, bringsContact)) {
      // Lines after the contact info with no new contact info before the tag/end: they still belong to this order
      if (!d.name && !tag && parseNameToken(line)) {
        setName(line);
      } else if (i === scopeLast[i] && d.name && isTagCandidate(line)) {
        // A short unlisted last line after name+phone+address → probably a new tag (flagged on the card)
        d.vendor = line;
        d.newTag = true;
        closed = true;
      } else if (parseNameToken(line)?.name !== d.name) {
        tailKind ??= scanRest(i, looksLikeProduct) ? "product" : "note";
        if (tailKind === "product") {
          addProductLine(line);
          isProduct = true;
        } else {
          d.noteLines.push(line);
        }
      }
      d.rawLines.push(line);
    } else if (
      parseNameToken(line) &&
      !tag &&
      pending !== "product" &&
      // A short Hangul word in the middle of a product block (lines continuing with no blank line) is not a name but a
      // product name/option (e.g. "가디건") — unless the phone number comes right after it ("235" / "강예린" / "010-…")
      !(continuesProduct && !d.phone && d.addrLines.length === 0 && !PHONE_RE.test(next)) &&
      !startsProductBlock
    ) {
      put("name", line, line);
      pending = null;
    } else if (pending) {
      assign(pending, line);
      d.rawLines.push(line);
      isProduct = pending === "product";
    } else {
      // Treat any other line as product information
      put("product", line, line);
      isProduct = true;
    }
    prevWasProduct = isProduct;
    prevWasAddr = isAddr;
    addrDirectlyAbove = isAddr;
  }
  flush();
  return orders;
}

/**
 * One product within a single message. Block format ("brand line / product-name line / option line") is structured,
 * anything else (label format, one-liners, etc.) is kept as free raw text.
 */
export type ProductItem =
  | { kind: "structured"; brand: string; product: string; option: string }
  | { kind: "free"; text: string };

// Option lines starting with a label ("색상(사진참조)크림", "사이즈/66", "Color : 그레이") describe one product together
const OPTION_LABEL_RE = /^(색상|컬러|사이즈|싸이즈|수량|color|size|qty)/i;

/**
 * Split the products contained in one order (one product = one orders row; together they are one n합배 parcel).
 * - Lines starting with a bullet (✅ ▶ •) or an item number ("1871- 그레이"), 2 or more of them → one product per start
 * - A block with 2+ option-only lines ("블랙 66" / "화이트 66") → one product per option line, sharing the block's
 *   product lines (or the block right above when the block has nothing else); a total line ("총 2장") is not a product
 * - Label format ("➡️ 옷제목 ;") or blocks that are all single-liners → treated as one product
 * - Two or more blank-line-separated blocks, all with 2+ lines → one product per block
 * - Even a single block is read as brand/product-name/option structure if it has 3+ lines
 * - A block longer than 3 lines: the 4th line onward are other options of the same product → one product per option line
 * - A 2-line block is ambiguous about which line is which, so that block alone is kept as free text
 * - Option lines that all start with a label are one product's options together
 */
export function splitProducts(
  order: Pick<ParsedOrder, "productBlocks" | "productLabeled"> & Partial<Pick<ParsedOrder, "productStarts">>,
): ProductItem[] {
  const kept = order.productBlocks
    .map((lines, i) => ({ lines, starts: order.productStarts?.[i] ?? [] }))
    .filter((b) => b.lines.length > 0);
  const blocks = kept.map((b) => b.lines);
  if (blocks.length === 0) return [{ kind: "free", text: "" }];

  if (!order.productLabeled) {
    // Several products written one after another, each starting with a bullet or an item number
    // ("✅️사우스 …" / "✅️지포어 …", "1871- 그레이" / "1858- 그레이/66") → one product per start, with the lines under it
    const lines = kept.flatMap((b) => b.lines.map((line, i) => ({ line, start: !!b.starts[i] })));
    if (lines.filter((l) => l.start).length >= 2) {
      const header: string[] = [];
      const segments: string[][] = [];
      for (const { line, start } of lines) {
        if (start) segments.push([line]);
        else if (segments.length) segments[segments.length - 1].push(line);
        else header.push(line);
      }
      return segments.map((seg) => ({ kind: "free", text: [...header, ...seg].join(" / ") }));
    }

    // Two or more option-only lines in a block ("블랙 66" / "화이트 66", "블랙" / "화이트") → one product per option,
    // sharing the product lines of that block — or of the block right above when the block has nothing else
    if (blocks.some(hasSeveralOptions)) {
      const out: ProductItem[][] = [];
      blocks.forEach((b, i) => {
        const options = b.filter(isOptionOnlyLine);
        if (!hasSeveralOptions(b)) {
          out.push(b.length >= 3 ? structuredItems(b) : [{ kind: "free", text: b.join(" / ") }]);
          return;
        }
        let header = b.filter((l) => !isOptionOnlyLine(l) && !isQuantityOnlyLine(l));
        if (!header.length && i > 0 && !blocks[i - 1].some(isOptionOnlyLine)) {
          header = blocks[i - 1];
          out.pop();
        }
        const product = header.slice(1).join(" ");
        out.push(
          options.map((option): ProductItem =>
            header.length >= 2
              ? { kind: "structured", brand: header[0], product, option }
              : { kind: "free", text: [...header, option].join(" / ") },
          ),
        );
      });
      return out.flat();
    }
  }

  const structured =
    !order.productLabeled &&
    ((blocks.length >= 2 && blocks.every((b) => b.length >= 2)) || (blocks.length === 1 && blocks[0].length >= 3));
  if (!structured) return [{ kind: "free", text: blocks.flat().join(" / ") }];

  return blocks.flatMap((b): ProductItem[] =>
    b.length < 3 ? [{ kind: "free", text: b.join(" / ") }] : structuredItems(b),
  );
}

/** 2+ option-only lines that are separate products — not labeled lines of one product ("컬러ㅡ그레이" / "사이즈ㅡ110") */
function hasSeveralOptions(b: string[]): boolean {
  const options = b.filter(isOptionOnlyLine);
  return options.length >= 2 && !options.every((o) => OPTION_LABEL_RE.test(o));
}

/** A block of 3+ lines read as brand / product name / option line(s) */
function structuredItems(b: string[]): ProductItem[] {
  const [brand, product, ...options] = b;
  // Labeled option lines ("색상(사진참조)크림" / "사이즈/66") describe one product together, not one product each
  if (options.length > 1 && options.every((o) => OPTION_LABEL_RE.test(o))) {
    return [{ kind: "structured", brand, product, option: options.join(" ") }];
  }
  return options.map((option) => ({ kind: "structured", brand, product, option }));
}
