// 카톡 단톡방 주문 원문 → 주문 단위 분리 (기획서 5장).
// 프레임워크 의존성 없는 순수 함수만 둔다 (서버/클라이언트 양쪽에서 사용).

export type ParsedOrder = {
  name: string;
  phone: string;
  addr1: string;
  addr2: string;
  /** 상품 관련 원문 줄들 (옷제목, 컬러/사이즈/수량 등). 카드에서 브랜드/상품/색상/사이즈 제안에 사용 */
  productText: string;
  /** 상품 줄을 빈 줄 기준으로 묶은 블록들 (splitProducts 에서 상품 개수 판단에 사용) */
  productBlocks: string[][];
  /** "옷제목 ;" 같은 라벨로 상품이 들어왔는지 (라벨 형식이면 블록 구조로 해석하지 않음) */
  productLabeled: boolean;
  vendor: string;
  note: string;
  /** 이 주문으로 분리된 원문 줄들 (카드에서 대조용으로 표시) */
  raw: string;
};

const PHONE_RE = /01[016789][\s.\-)]*\d{3,4}[\s.\-]*\d{4}/;
const NAME_RE = /^[가-힣]{2,5}$/;
const ADDR_START_RE =
  /^(서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|충청|전북|전남|전라|경북|경남|경상|제주)/;
// 도로명 + 건물번호 (예: 올림픽로 145, 마곡서1로 100, 중앙로123번길 45, 쌍미천로 190-1, 위례광장로 163번지)
const ROAD_NUMBER_RE = /[가-힣A-Za-z0-9](?:로|길)\s*\d+(?:번길\s*\d+)?(?:-\d+)?(?:번지)?/;
// 도로명 이후 나머지 주소로 보이는 줄 (건물명/동/호수 등)
const ADDR_DETAIL_RE =
  /(\d+\s*(?:동|호|층|단지|차|번지)|아파트|빌라|상가|맨션|타워|오피스텔|빌딩|하우스|주택|apt|지하|\d+-\d+)/i;

// 라벨 없는 줄이 이름 패턴(한글 2~5자)과 겹치지만 이름이 아닌 단어들
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

// "➡️ 성함 ; 박시연", "- 주소: ...", "▶전번 : ..." 형태
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

/** 주소를 "시/구/도로명+번호"(addr1)와 나머지(addr2)로 분리. 도로명을 못 찾으면 전부 addr1 */
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
  // 아직 도로명+번호가 안 나왔으면 다음 줄은 주소의 이어지는 부분 (예: "서울시 송파구" / "올림픽로 145 ...")
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
 * 원문 텍스트를 주문 단위로 분리한다.
 * 줄 단위 상태 기계: 라벨 우선 → 라벨 없으면 전화번호/이름/주소 패턴 판별.
 * 전화번호 + 주소를 모두 확보한 주문은 "완료"로 보고, 그 뒤 주소의 연속이 아닌 줄이 오면 새 주문을 시작한다.
 * 상품 줄은 빈 줄 기준으로 블록을 나눠 둔다 (한 메시지 여러 상품 → splitProducts).
 */
export function segmentOrders(text: string): ParsedOrder[] {
  const orders: ParsedOrder[] = [];
  let d = emptyDraft();
  // 값이 비어 있는 라벨 뒤 줄들을 해당 필드로 모으기 위한 상태 (예: "컬러/사이즈/수량 ;" 다음 줄 "블랙 1개")
  let pending: Field | null = null;
  // 직전 줄이 (빈 줄 없이 바로 위에 있는) 상품 줄이었는지 → 같은 상품 블록으로 이어 붙일지 판단
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

  // 새 값이 들어올 때 현재 주문을 마감해야 하는지 (같은 필드가 이미 차 있거나, 이미 완료된 주문에 새 상품이 오는 경우)
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
    // 빈 줄 없이 바로 다음 줄이 연락처가 아닌 줄이면, 이 줄은 상품 블록의 첫 줄 (예: 한글 브랜드 "지포어" 다음 줄 "니트")
    const next = lines[i + 1] ?? "";
    const startsProductBlock = !!next && !PHONE_RE.test(next) && !ADDR_START_RE.test(next) && !matchLabel(next);
    // 이 줄이 상품 줄로 처리되는 경우에만 아래에서 true 로 되돌린다
    let isProduct = false;

    const label = matchLabel(line);
    if (label) {
      if (label.field === "product") d.productLabeled = true;
      put(label.field, label.value, line);
      pending = label.value ? null : label.field;
    } else if (pending === "addr") {
      // "➡️ 주소 ;" 처럼 값 없는 주소 라벨 다음 줄
      d.addrLines.push(line);
      d.rawLines.push(line);
      pending = null;
    } else if (PHONE_RE.test(line)) {
      // 전화번호 (같은 줄에 이름이 붙어 있는 경우: "심춘선 01087698178")
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
      // 상품 블록 한가운데(빈 줄 없이 이어지는 줄)의 짧은 한글은 이름이 아니라 상품명/옵션 (예: "가디건")
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
      // 그 외 줄은 상품 정보로 취급
      put("product", line, line);
      isProduct = true;
    }
    prevWasProduct = isProduct;
  }
  flush();
  return orders;
}

/**
 * 한 메시지 안의 상품 하나. 블록 형식("브랜드 줄 / 상품명 줄 / 옵션 줄")이면 structured,
 * 그 외(라벨 형식, 한 줄짜리 등)는 원문 그대로 free.
 */
export type ProductItem =
  | { kind: "structured"; brand: string; product: string; option: string }
  | { kind: "free"; text: string };

/**
 * 주문 하나에 들어 있는 상품들을 나눈다 (상품 수만큼 카드를 만들기 위해 사용).
 * - 라벨 형식("➡️ 옷제목 ;")이거나 블록이 한 줄짜리들뿐이면 → 기존처럼 전체가 상품 1개
 * - 빈 줄로 구분된 블록이 2개 이상이고 모두 2줄 이상 → 블록마다 상품
 * - 블록이 1개뿐이어도 3줄 이상이면 브랜드/상품명/옵션 구조로 본다
 * - 3줄을 넘는 블록의 4번째 줄부터는 같은 상품의 다른 옵션 → 옵션 줄마다 상품 1개
 * - 2줄짜리 블록은 어느 줄이 무엇인지 모호하므로 그 블록만 free 로 둔다
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
