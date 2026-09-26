import type { Metadata } from "next";
import Form from "next/form";
import Link from "next/link";
import { connection } from "next/server";
import { requirePageSession } from "@/lib/auth";
import { createServerSupabase } from "@/lib/supabase/server";
import type { Order } from "@/lib/database.types";
import {
  PAGE_SIZE, filtersToQuery, kstDate, kstRange, parseFilters, searchOrCondition, type OrderFilters,
} from "@/lib/order-filters";
import { defaultExportFileName } from "@/lib/invoice";
import { loadRooms } from "./data";
import ExportPanel from "./export-panel";
import OrdersTable from "./orders-table";

export const metadata: Metadata = { title: "주문 목록 · 주문 반자동화" };

/** 내보내기 패널용: 아직 안 내보낸 주문 수 + 다음 기본 파일 이름 */
async function loadExportInfo(): Promise<{ pendingCount: number; defaultFileName: string; unavailable: string | null }> {
  const fallbackName = defaultExportFileName(kstDate(), 1);
  try {
    const supabase = createServerSupabase();
    const [pendingRes, seqRes] = await Promise.all([
      supabase.from("orders").select("*", { count: "exact", head: true }).is("exported_at", null),
      supabase.rpc("next_invoice_export_seq"),
    ]);
    const error = pendingRes.error ?? seqRes.error;
    if (error) {
      return {
        pendingCount: 0,
        defaultFileName: fallbackName,
        unavailable: `${error.message} — supabase/migrations/20260927000000_invoice_exports.sql 이 DB에 적용됐는지 확인하세요.`,
      };
    }
    return { pendingCount: pendingRes.count ?? 0, defaultFileName: defaultExportFileName(kstDate(), seqRes.data ?? 1), unavailable: null };
  } catch (e) {
    return { pendingCount: 0, defaultFileName: fallbackName, unavailable: e instanceof Error ? e.message : "알 수 없는 오류" };
  }
}

async function loadOrders(f: OrderFilters): Promise<{ orders: Order[]; total: number; rooms: string[]; loadError: string | null }> {
  try {
    const supabase = createServerSupabase();
    let query = supabase
      .from("orders")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      // 같은 시각에 저장된 묶음 카드들이 붙어서 보이도록
      .order("order_group_id")
      .order("id");
    const range = kstRange(f.from, f.to);
    if (range.gte) query = query.gte("created_at", range.gte);
    if (range.lt) query = query.lt("created_at", range.lt);
    if (f.room) query = query.eq("source_room", f.room);
    if (f.status === "pending") query = query.is("exported_at", null);
    if (f.status === "exported") query = query.not("exported_at", "is", null);
    const search = searchOrCondition(f.q);
    if (search) query = query.or(search);

    const start = (f.page - 1) * PAGE_SIZE;
    const [{ data, count, error }, rooms] = await Promise.all([
      query.range(start, start + PAGE_SIZE - 1),
      loadRooms(supabase),
    ]);
    if (error) return { orders: [], total: 0, rooms, loadError: error.message };
    return { orders: data ?? [], total: count ?? 0, rooms, loadError: null };
  } catch (e) {
    return { orders: [], total: 0, rooms: [], loadError: e instanceof Error ? e.message : "알 수 없는 오류" };
  }
}

export default async function OrdersPage({ searchParams }: PageProps<"/orders">) {
  await connection();
  await requirePageSession();
  const filters = parseFilters(await searchParams);
  const [{ orders, total, rooms, loadError }, exportInfo] = await Promise.all([loadOrders(filters), loadExportInfo()]);
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const roomOptions = filters.room && !rooms.includes(filters.room) ? [filters.room, ...rooms] : rooms;
  const today = kstDate();
  const hasFilter = !!(filters.from || filters.to || filters.room || filters.q || filters.status);

  // 빠른 날짜 선택 (다른 필터는 유지)
  const preset = (from: string, to: string) => `/orders${filtersToQuery({ ...filters, from, to, page: 1 })}`;

  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-6">
      <h1 className="mb-4 text-xl font-bold">주문 목록</h1>

      <ExportPanel {...exportInfo} />

      <Form action="/orders" className="mb-2 flex flex-wrap items-end gap-2 rounded-lg border border-gray-200 bg-white p-4 text-sm">
        <label className="flex flex-col">
          <span className="mb-1 text-xs text-gray-600">시작일</span>
          <input type="date" name="from" defaultValue={filters.from} className="rounded border border-gray-300 px-2 py-1.5" />
        </label>
        <label className="flex flex-col">
          <span className="mb-1 text-xs text-gray-600">종료일</span>
          <input type="date" name="to" defaultValue={filters.to} className="rounded border border-gray-300 px-2 py-1.5" />
        </label>
        <label className="flex flex-col">
          <span className="mb-1 text-xs text-gray-600">출처 방</span>
          <select name="room" defaultValue={filters.room} className="w-44 rounded border border-gray-300 px-2 py-1.5">
            <option value="">전체</option>
            {roomOptions.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </label>
        <label className="flex flex-col">
          <span className="mb-1 text-xs text-gray-600">송장</span>
          <select name="status" defaultValue={filters.status} className="rounded border border-gray-300 px-2 py-1.5">
            <option value="">전체</option>
            <option value="pending">아직 안 내보냄</option>
            <option value="exported">내보냄</option>
          </select>
        </label>
        <label className="flex flex-col">
          <span className="mb-1 text-xs text-gray-600">검색 (이름·전화·주소·상품)</span>
          <input
            type="search"
            name="q"
            defaultValue={filters.q}
            placeholder="예: 홍길동, 5678"
            className="w-56 rounded border border-gray-300 px-2 py-1.5"
          />
        </label>
        <button type="submit" className="rounded bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700">
          조회
        </button>
        {hasFilter && (
          <Link href="/orders" className="rounded border border-gray-300 px-4 py-2 hover:bg-gray-50">
            초기화
          </Link>
        )}
      </Form>

      <div className="mb-4 flex flex-wrap gap-3 text-xs">
        <span className="text-gray-500">빠른 선택:</span>
        <Link href={preset(today, today)} className="text-blue-700 hover:underline">오늘</Link>
        <Link href={preset(kstDate(new Date(), 1), kstDate(new Date(), 1))} className="text-blue-700 hover:underline">어제</Link>
        <Link href={preset(kstDate(new Date(), 6), today)} className="text-blue-700 hover:underline">최근 7일</Link>
        <Link href={preset("", "")} className="text-blue-700 hover:underline">전체 기간</Link>
      </div>

      {loadError ? (
        <p className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
          주문을 불러오지 못했습니다: {loadError}
        </p>
      ) : (
        <>
          <p className="mb-2 text-sm text-gray-700">
            총 <b>{total.toLocaleString()}</b>건
            {total > PAGE_SIZE && ` · ${filters.page}/${lastPage} 페이지`}
          </p>
          {orders.length === 0 ? (
            <p className="rounded-lg border border-gray-200 bg-white px-4 py-10 text-center text-sm text-gray-500">
              {hasFilter ? "조건에 맞는 주문이 없습니다." : "저장된 주문이 없습니다."}
            </p>
          ) : (
            <OrdersTable orders={orders} />
          )}
          {lastPage > 1 && (
            <nav className="mt-4 flex items-center justify-center gap-4 text-sm">
              {filters.page > 1 ? (
                <Link href={`/orders${filtersToQuery({ ...filters, page: filters.page - 1 })}`} className="text-blue-700 hover:underline">
                  ← 이전
                </Link>
              ) : <span className="text-gray-300">← 이전</span>}
              <span>{filters.page} / {lastPage}</span>
              {filters.page < lastPage ? (
                <Link href={`/orders${filtersToQuery({ ...filters, page: filters.page + 1 })}`} className="text-blue-700 hover:underline">
                  다음 →
                </Link>
              ) : <span className="text-gray-300">다음 →</span>}
            </nav>
          )}
        </>
      )}
    </main>
  );
}
