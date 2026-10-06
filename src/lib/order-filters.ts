// Order list filters (URL search params ↔ DB conditions). Pure functions only.
// Dates are in Korea time (KST, UTC+9) — so "orders received today" is cut off correctly at midnight.

import { normalizePhone } from "@/lib/parser";

export type OrderFilters = {
  /** YYYY-MM-DD (KST, inclusive) */
  from: string;
  /** YYYY-MM-DD (KST, inclusive) */
  to: string;
  /** Search term across name/phone/address/product/vendor tag */
  q: string;
  /** Invoice-export status: "" all / pending not yet exported / exported already exported */
  status: ExportStatus;
  /** 1-based */
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
    q: first(sp.q).trim().slice(0, 50),
    status: EXPORT_STATUSES.find((s) => s === first(sp.status)) ?? "",
    page: Number.isFinite(page) && page > 0 ? page : 1,
  };
}

/** Filters → URL query string (empty values and page 1 are omitted) */
export function filtersToQuery(f: Partial<OrderFilters>): string {
  const p = new URLSearchParams();
  if (f.from) p.set("from", f.from);
  if (f.to) p.set("to", f.to);
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

/** KST date range → created_at condition (to is exclusive of the following day's midnight) */
export function kstRange(from: string, to: string): { gte?: string; lt?: string } {
  return {
    ...(from && { gte: `${from}T00:00:00+09:00` }),
    ...(to && { lt: `${addDays(to, 1)}T00:00:00+09:00` }),
  };
}

/** Current KST date (YYYY-MM-DD). daysAgo shifts it that many days into the past */
export function kstDate(now: Date = new Date(), daysAgo = 0): string {
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return addDays(kst.toISOString().slice(0, 10), -daysAgo);
}

/**
 * Clean up a search term so it's safe to put inside a PostgREST or() filter.
 * Strips the , ( ) characters that are meaningful in or() syntax, ilike wildcards % * _, and backslashes/quotes.
 */
export function sanitizeSearch(q: string): string {
  return q.replace(/[,()%*_\\"']/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Phone search term → a pattern matching the stored format (010-1234-5678).
 * So digits-only input still finds matches: normalize full numbers, split 8-digit input into middle+last 4, leave everything else as-is.
 */
export function phoneSearchTerm(q: string): string {
  const digits = q.replace(/\D/g, "");
  if (!digits || digits.length !== q.replace(/[\s-]/g, "").length) return q; // leave untouched if it contains non-digit characters
  if (digits.length === 10 || digits.length === 11) return normalizePhone(digits);
  if (digits.length === 8) return `${digits.slice(0, 4)}-${digits.slice(4)}`;
  return digits;
}

/** Search term → PostgREST or() condition string (null if the term is empty) */
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
    `vendor.ilike.*${q}*`,
  ].join(",");
}
