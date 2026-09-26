import type { Metadata } from "next";
import { connection } from "next/server";
import { requirePageSession } from "@/lib/auth";
import { createServerSupabase } from "@/lib/supabase/server";
import type { BrandEntry } from "@/lib/database.types";
import BrandManager from "./brand-manager";

export const metadata: Metadata = { title: "브랜드 딕셔너리 · 주문 반자동화" };

async function loadBrands(): Promise<{ entries: BrandEntry[]; loadError: string | null }> {
  try {
    const { data, error } = await createServerSupabase()
      .from("brand_dictionary")
      .select("*")
      .order("short_form")
      .order("full_name");
    if (error) return { entries: [], loadError: error.message };
    return { entries: data ?? [], loadError: null };
  } catch (e) {
    return { entries: [], loadError: e instanceof Error ? e.message : "알 수 없는 오류" };
  }
}

export default async function BrandsPage() {
  await connection();
  await requirePageSession();
  const { entries, loadError } = await loadBrands();

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-6">
      <h1 className="mb-1 text-xl font-bold">브랜드 딕셔너리</h1>
      <p className="mb-4 text-sm text-gray-600">
        주문 입력 화면에서 브랜드 원문을 줄임말로 자동 제안할 때 쓰는 목록입니다. 한 줄임말에 여러 이름(영문·한글 등)을 연결할 수 있습니다.
      </p>
      {loadError ? (
        <p className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
          목록을 불러오지 못했습니다: {loadError}
        </p>
      ) : (
        <BrandManager initialEntries={entries} />
      )}
    </main>
  );
}
