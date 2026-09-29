// KakaoTalk group-chat order raw text → split into individual orders (spec Section 5).
// Contains only framework-independent pure functions (used on both server and client).

export type ParsedOrder = {
  name: string;
  phone: string;
  addr1: string;
  addr2: string;
  /** Raw product-related lines (item title, color/size/quantity, etc.). Used for brand/product/color/size suggestions on the card */
  productText: string;
  /** Product lines grouped into blocks by blank lines (used by splitProducts to decide the product count) */
  productBlocks: string[][];
  /** Whether the product came in via a label like "옷제목 ;" (label format is not interpreted as a block structure) */
  productLabeled: boolean;
  vendor: string;
  note: string;
  /** Raw lines that were split into this order (shown on the card for cross-checking) */
  raw: string;
};

const PHONE_RE = /01[016789][\s.\-)]*\d{3,4}[\s.\-]*\d{4}/;
const NAME_RE = /^[가-힣]{2,5}$/;
const ADDR_START_RE =
  /^(서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|충청|전북|전남|전라|경북|경남|경상|제주)/;
// Road name + building number (e.g. 백제고분로 212, 화곡로 55, 중앙로123번길 45, 반송로 88-1, 위례성대로 27번지)
const ROAD_NUMBER_RE = /[가-힣A-Za-z0-9](?:로|길)\s*\d+(?:번길\s*\d+)?(?:-\d+)?(?:번지)?/;
// Lines that look like the rest of the address after the road name (building name/unit/floor, etc.)
const ADDR_DETAIL_RE =
  /(\d+\s*(?:동|호|층|단지|차|번지)|아파트|빌라|상가|맨션|타워|오피스텔|빌딩|하우스|주택|apt|지하|\d+-\d+)/i;

// Unlabeled words that overlap the name pattern (2–5 Hangul characters) but aren't names
const NOT_NAME_WORDS = new Set([
  "블랙", "화이트", "네이비", "그레이", "회색", "베이지", "블루", "레드", "핑크", "그린",
  "카키", "브라운", "아이보리", "옐로우", "퍼플", "민트", "와인", "차콜", "오렌지", "실버", "골드",
  "검정", "흰색", "남색", "빨강", "파랑", "노랑", "초록", "소라", "연청", "진청", "중청",
  "프리", "사이즈", "수량", "주소", "성함", "전번", "감사합니다",
]);

type Field = "name" | "phone" | "addr" | "product" | "vendor" | "note";

const LABELS: [RegExp, Field][] = [
  [/^(성함|이름|받는\s*분|수령인)$/, "name"],
  [/^(전번|전화번호|전화|연락처|핸드폰|휴대폰|폰번호?)$/, "phone"],
  [/^(주소|배송지|받는\s*주소)$/, "addr"],
  [/^(옷\s*제목|상품명?|제품명?|품명|컬러|색상|사이즈|수량|컬러\s*\/\s*사이즈(\s*\/\s*수량)?)$/, "product"],
  [/^(거래처)$/, "vendor"],
  [/^(참고(사항)?|메모|요청(사항)?|비고)$/, "note"],
];

// Matches forms like "➡️ 성함 ; 최유리", "- 주소: ...", "▶전번 : ..."
const LABEL_LINE_RE = /^[\s➡️▶►→>\-*•·]*([가-힣A-Za-z\s/]{1,15}?)\s*[;:：]\s*(.*)$/u;

function matchLabel(line: string): { field: Field; value: string } | null {
  const m = line.match(LABEL_LINE_RE);
  if (!m) return null;
  const key = m[1].trim();
  for (const [re, field] of LABELS) {
    if (re.test(key)) return { field, value: m[2].trim() };
  }
  return null;
}

export function normalizePhone(input: string): string {
  const digits = input.replace(/\D/g, "");
  if (/^01\d{9}$/.test(digits)) return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
  if (/^01\d{8}$/.test(digits)) return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
  return input.trim();
}

/** Split an address into "city/district/road-name+number" (addr1) and the rest (addr2). If no road name is found, everything goes into addr1 */
export function splitAddress(addr: string): { addr1: string; addr2: string } {
  const text = addr.replace(/\s+/g, " ").trim();
  const m = ROAD_NUMBER_RE.exec(text);
  if (!m) return { addr1: text, addr2: "" };
  const end = m.index + m[0].length;
  return { addr1: text.slice(0, end).trim(), addr2: text.slice(end).replace(/^[\s,]+/, "").trim() };
}

type Draft = {
  name: string;
  phone: string;
  addrLines: string[];
  productBlocks: string[][];
  productLabeled: boolean;
  vendor: string;
  noteLines: string[];
  rawLines: string[];
};

const emptyDraft = (): Draft => ({
  name: "", phone: "", addrLines: [], productBlocks: [], productLabeled: false, vendor: "", noteLines: [], rawLines: [],
});

const hasContent = (d: Draft) =>
  !!(d.name || d.phone || d.addrLines.length || d.productBlocks.length || d.vendor || d.noteLines.length);

const isComplete = (d: Draft) => !!d.phone && d.addrLines.length > 0;

function looksLikeAddressContinuation(line: string, d: Draft): boolean {
  if (d.addrLines.length === 0) return false;
  // If the road name + number hasn't appeared yet, the next line is a continuation of the address (e.g. "서울시 송파구" / "백제고분로 212 ...")
  if (!ROAD_NUMBER_RE.test(d.addrLines.join(" "))) return true;
  return ROAD_NUMBER_RE.test(line) || ADDR_DETAIL_RE.test(line);
}

function toParsed(d: Draft): ParsedOrder {
  const { addr1, addr2 } = splitAddress(d.addrLines.join(" "));
  return {
    name: d.name,
    phone: d.phone ? normalizePhone(d.phone) : "",
    addr1,
    addr2,
    productText: d.productBlocks.flat().join(" / "),
    productBlocks: d.productBlocks,
    productLabeled: d.productLabeled,
    vendor: d.vendor,
    note: d.noteLines.join(" "),
    raw: d.rawLines.join("\n"),
  };
}


/**
 * Split raw text into individual orders.
 * A line-by-line state machine: labels take priority, otherwise fall back to detecting a phone number/name/address-start pattern.
 * An order is considered "complete" once it has both a phone number and an address; a subsequent line that isn't a continuation of the address then starts a new order.
 * Product lines are grouped into blocks separated by blank lines (one message, multiple products → splitProducts).
 */
export function segmentOrders(text: string): ParsedOrder[] {
  const orders: ParsedOrder[] = [];
  let d = emptyDraft();
  // Tracks which field should collect the lines following a label with no inline value (e.g. the line after "컬러/사이즈/수량 ;" is "블랙 1개")
  let pending: Field | null = null;
  // Whether the previous line (immediately above, no blank line in between) was a product line → decides whether to append to the same product block
  let prevWasProduct = false;

  const flush = () => {
    if (hasContent(d)) orders.push(toParsed(d));
    d = emptyDraft();
    pending = null;
    prevWasProduct = false;
  };

  const addProductLine = (value: string) => {
    const last = d.productBlocks[d.productBlocks.length - 1];
    if (prevWasProduct && last) last.push(value);
    else d.productBlocks.push([value]);
  };

  const assign = (field: Field, value: string) => {
    if (!value) return;
    switch (field) {
      case "name": d.name = value; break;
      case "phone": d.phone = value; break;
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
    if (field === "product") return isComplete(d) || (!!d.name && !!d.phone && d.productBlocks.length > 0);
    return false;
  };

  const put = (field: Field, value: string, line: string) => {
    if (startsNewOrder(field)) flush();
    assign(field, value);
    d.rawLines.push(line);
  };

  const lines = text.split(/\r?\n/).map((l) => l.trim());
  for (const [i, line] of lines.entries()) {
    if (!line) {
      prevWasProduct = false;
      continue;
    }
    const continuesProduct = prevWasProduct;
    // If the very next line (no blank line in between) is not a contact-info line, this line is the first line of a product block (e.g. Hangul brand "지포어" followed by "니트")
    const next = lines[i + 1] ?? "";
    const startsProductBlock = !!next && !PHONE_RE.test(next) && !ADDR_START_RE.test(next) && !matchLabel(next);
    // Only flipped back to true below when this line is actually treated as a product line
    let isProduct = false;

    const label = matchLabel(line);
    if (label) {
      if (label.field === "product") d.productLabeled = true;
      put(label.field, label.value, line);
      pending = label.value ? null : label.field;
    } else if (pending === "addr") {
      // The line after an address label with no inline value, e.g. "➡️ 주소 ;"
      d.addrLines.push(line);
      d.rawLines.push(line);
      pending = null;
    } else if (PHONE_RE.test(line)) {
      // A phone number (with the name attached on the same line, e.g. "최유리 01024567890")
      const phone = line.match(PHONE_RE)![0];
      const rest = line.replace(phone, " ").replace(/[,/]/g, " ").trim();
      if (d.phone) flush();
      if (NAME_RE.test(rest) && !NOT_NAME_WORDS.has(rest)) {
        if (d.name) flush();
        d.name = rest;
      }
      d.phone = phone;
      d.rawLines.push(line);
      pending = null;
    } else if (looksLikeAddressContinuation(line, d) && !ADDR_START_RE.test(line)) {
      d.addrLines.push(line);
      d.rawLines.push(line);
    } else if (ADDR_START_RE.test(line)) {
      put("addr", line, line);
      pending = null;
    } else if (
      NAME_RE.test(line) &&
      !NOT_NAME_WORDS.has(line) &&
      pending !== "product" &&
      // A short Hangul word in the middle of a product block (lines continuing with no blank line) is not a name but a product name/option (e.g. "가디건")
      !(continuesProduct && !d.phone && d.addrLines.length === 0) &&
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

/**
 * Split the products contained in one order (used to build one card per product).
 * - Label format ("➡️ 옷제목 ;") or blocks that are all single-liners → treated as one product, same as before
 * - Two or more blank-line-separated blocks, all with 2+ lines → one product per block
 * - Even a single block is read as brand/product-name/option structure if it has 3+ lines
 * - A block longer than 3 lines: the 4th line onward are other options of the same product → one product per option line
 * - A 2-line block is ambiguous about which line is which, so that block alone is kept as free text
 */
export function splitProducts(order: Pick<ParsedOrder, "productBlocks" | "productLabeled">): ProductItem[] {
  const blocks = order.productBlocks.filter((b) => b.length > 0);
  if (blocks.length === 0) return [{ kind: "free", text: "" }];

  const structured =
    !order.productLabeled &&
    ((blocks.length >= 2 && blocks.every((b) => b.length >= 2)) || (blocks.length === 1 && blocks[0].length >= 3));
  if (!structured) return [{ kind: "free", text: blocks.flat().join(" / ") }];

  return blocks.flatMap((b): ProductItem[] => {
    if (b.length < 3) return [{ kind: "free", text: b.join(" / ") }];
    const [brand, product, ...options] = b;
    return options.map((option) => ({ kind: "structured", brand, product, option }));
  });
}
