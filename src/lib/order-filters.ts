// 주문 목록 필터 (URL 검색 파라미터 ↔ DB 조건). 순수 함수만 둔다.
// 날짜는 한국 시간(KST, UTC+9) 기준 — "오늘 들어온 주문"이 자정 기준으로 맞게 잘리도록.

import { normalizePhone } from "@/lib/parser";

export type OrderFilters = {
  /** YYYY-MM-DD (KST, 포함) */
  from: string;
  /** YYYY-MM-DD (KST, 포함) */
  to: string;
  room: string;
  /** 이름/전화/주소/상품 검색어 */
  q: string;
  /** 송장 내보내기 상태: "" 전체 / pending 아직 안 내보냄 / exported 내보냄 */
  status: ExportStatus;
  /** 1부터 */
  page: number;
};

export const PAGE_SIZE = 100;

export type ExportStatus = "" | "pending" | "exported";
const EXPORT_STATUSES: readonly ExportStatus[] = ["", "pending", "exported"];

type SearchParams = Record<string, string | string[] | undefined>;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

function validDate(s: string): string {
  if (!DATE_RE.test(s)) return "";
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(s) ? s : "";
}

export function parseFilters(sp: SearchParams): OrderFilters {
  const page = Number.parseInt(first(sp.page), 10);
  return {
    from: validDate(first(sp.from).trim()),
    to: validDate(first(sp.to).trim()),
    room: first(sp.room).trim().slice(0, 100),
    q: first(sp.q).trim().slice(0, 50),
    status: EXPORT_STATUSES.find((s) => s === first(sp.status)) ?? "",
    page: Number.isFinite(page) && page > 0 ? page : 1,
  };
}

/** 필터 → URL 쿼리 문자열 (빈 값·1페이지는 생략) */
export function filtersToQuery(f: Partial<OrderFilters>): string {
  const p = new URLSearchParams();
  if (f.from) p.set("from", f.from);
  if (f.to) p.set("to", f.to);
  if (f.room) p.set("room", f.room);
  if (f.q) p.set("q", f.q);
  if (f.status) p.set("status", f.status);
  if (f.page && f.page > 1) p.set("page", String(f.page));
  const s = p.toString();
  return s ? `?${s}` : "";
}

const addDays = (ymd: string, days: number) => {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

/** KST 날짜 범위 → created_at 조건 (to 는 다음 날 0시 미만) */
export function kstRange(from: string, to: string): { gte?: string; lt?: string } {
  return {
    ...(from && { gte: `${from}T00:00:00+09:00` }),
    ...(to && { lt: `${addDays(to, 1)}T00:00:00+09:00` }),
  };
}

/** 지금 기준 KST 날짜 (YYYY-MM-DD). daysAgo 만큼 이전 날짜 */
export function kstDate(now: Date = new Date(), daysAgo = 0): string {
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return addDays(kst.toISOString().slice(0, 10), -daysAgo);
}

/**
 * 검색어를 PostgREST or() 필터에 안전하게 넣을 수 있게 정리.
 * or() 문법에서 의미가 있는 , ( ) 와 ilike 와일드카드 % * _ 및 역슬래시·따옴표를 제거한다.
 */
export function sanitizeSearch(q: string): string {
  return q.replace(/[,()%*_\\"']/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * 전화번호 검색어 → 저장 형식(010-1234-5678)에 맞춘 검색 패턴.
 * 숫자만 입력해도 찾을 수 있게: 전체 번호는 정규화, 8자리는 가운데·끝 4자리, 그 외는 그대로.
 */
export function phoneSearchTerm(q: string): string {
  const digits = q.replace(/\D/g, "");
  if (!digits || digits.length !== q.replace(/[\s-]/g, "").length) return q; // 숫자 외 문자가 있으면 가공 안 함
  if (digits.length === 10 || digits.length === 11) return normalizePhone(digits);
  if (digits.length === 8) return `${digits.slice(0, 4)}-${digits.slice(4)}`;
  return digits;
}

/** 검색어 → PostgREST or() 조건 문자열 (검색어가 비면 null) */
export function searchOrCondition(rawQ: string): string | null {
  const q = sanitizeSearch(rawQ);
  if (!q) return null;
  const phone = sanitizeSearch(phoneSearchTerm(q));
  return [
    `name.ilike.*${q}*`,
    `phone.ilike.*${phone}*`,
    `addr1.ilike.*${q}*`,
    `addr2.ilike.*${q}*`,
    `product_name.ilike.*${q}*`,
    `brand_raw.ilike.*${q}*`,
    `brand_short.ilike.*${q}*`,
  ].join(",");
}
