import type { Metadata } from "next";
import { connection } from "next/server";
import { requirePageSession } from "@/lib/auth";
import { createServerSupabase } from "@/lib/supabase/server";
import type { DictEntry } from "@/lib/product";
import OrderEntry from "./order-entry";

export const metadata: Metadata = { title: "주문 입력 · 주문 반자동화" };

/** How many recent orders to scan, and how many distinct product names to offer as autocomplete */
const RECENT_ORDERS = 1000;
const RECENT_PRODUCT_NAMES = 300;

async function loadInitialData(): Promise<{ dict: DictEntry[]; recentProducts: string[]; loadError: string | null }> {
  try {
    const supabase = createServerSupabase();
    const [dictRes, productRes] = await Promise.all([
      supabase.from("brand_dictionary").select("full_name, short_form"),
      // Product names of recent orders (most recent first) — the autocomplete for orders that came with only color/size
      supabase
        .from("orders")
        .select("product_name")
        .neq("product_name", "")
        .order("created_at", { ascending: false })
        .limit(RECENT_ORDERS),
    ]);
    const error = dictRes.error ?? productRes.error;
    if (error) return { dict: dictRes.data ?? [], recentProducts: [], loadError: error.message };
    const recentProducts = [...new Set((productRes.data ?? []).map((r) => r.product_name.trim()).filter(Boolean))].slice(
      0,
      RECENT_PRODUCT_NAMES,
    );
    return { dict: dictRes.data ?? [], recentProducts, loadError: null };
  } catch (e) {
    return { dict: [], recentProducts: [], loadError: e instanceof Error ? e.message : "알 수 없는 오류" };
  }
}

export default async function NewOrderPage() {
  await connection();
  await requirePageSession();
  const { dict, recentProducts, loadError } = await loadInitialData();

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-6">
      <h1 className="mb-4 text-xl font-bold">주문 입력</h1>
      {loadError && (
        <p className="mb-4 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          DB에 연결하지 못했습니다 — 붙여넣기·분리는 되지만 브랜드 제안과 저장은 동작하지 않습니다. ({loadError})
        </p>
      )}
      <OrderEntry dict={dict} recentProducts={recentProducts} />
    </main>
  );
}
