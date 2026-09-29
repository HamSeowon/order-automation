"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabase } from "@/lib/supabase/server";
import { authorize } from "@/lib/auth";
import type { BrandEntry } from "@/lib/database.types";
import { brandKey, parseBrandLines, validateBrand } from "@/lib/brands";

// Server Actions can also be called directly via POST, so every function checks login with authorize() first.

export type BrandResult = { ok: true; entry: BrandEntry } | { ok: false; error: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_IMPORT = 2000;

function dbError(error: { code?: string; message: string }): string {
  // Violates brand_dictionary_full_name_key (lower(btrim(full_name)))
  if (error.code === "23505") return "이미 등록된 브랜드 이름입니다 (대소문자·공백 무시).";
  return `DB 오류: ${error.message}`;
}

function revalidate() {
  revalidatePath("/brands");
  revalidatePath("/orders/new");
}

export async function createBrand(input: unknown): Promise<BrandResult> {
  const denied = await authorize();
  if (denied) return { ok: false, error: denied };
  const v = validateBrand(input);
  if (!v.ok) return v;
  try {
    const { data, error } = await createServerSupabase().from("brand_dictionary").insert(v.value).select().single();
    if (error) return { ok: false, error: dbError(error) };
    revalidate();
    return { ok: true, entry: data };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "알 수 없는 오류" };
  }
}

export async function updateBrand(id: unknown, input: unknown): Promise<BrandResult> {
  const denied = await authorize();
  if (denied) return { ok: false, error: denied };
  if (typeof id !== "string" || !UUID_RE.test(id)) return { ok: false, error: "잘못된 항목입니다." };
  const v = validateBrand(input);
  if (!v.ok) return v;
  try {
    const { data, error } = await createServerSupabase()
      .from("brand_dictionary")
      .update(v.value)
      .eq("id", id)
      .select()
      .maybeSingle();
    if (error) return { ok: false, error: dbError(error) };
    if (!data) return { ok: false, error: "이미 삭제된 항목입니다. 새로고침 해주세요." };
    revalidate();
    return { ok: true, entry: data };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "알 수 없는 오류" };
  }
}

export async function deleteBrand(id: unknown): Promise<{ ok: true } | { ok: false; error: string }> {
  const denied = await authorize();
  if (denied) return { ok: false, error: denied };
  if (typeof id !== "string" || !UUID_RE.test(id)) return { ok: false, error: "잘못된 항목입니다." };
  try {
    const { error } = await createServerSupabase().from("brand_dictionary").delete().eq("id", id);
    if (error) return { ok: false, error: dbError(error) };
    revalidate();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "알 수 없는 오류" };
  }
}

export type ImportResult =
  | {
      ok: true;
      added: number;
      updated: number;
      unchanged: number;
      errors: { line: number; text: string }[];
      /** Full list after import (for refreshing the screen) */
      entries: BrandEntry[];
    }
  | { ok: false; error: string };

/**
 * Bulk-register multiple lines. For a full name that already exists (ignoring case/whitespace), only the short form is updated.
 * The unique index is an expression index, so PostgREST upsert can't be used — instead we diff against the existing list and split into insert/update.
 */
export async function importBrands(text: unknown): Promise<ImportResult> {
  const denied = await authorize();
  if (denied) return { ok: false, error: denied };
  if (typeof text !== "string" || !text.trim()) return { ok: false, error: "붙여넣은 내용이 없습니다." };
  const { entries, errors } = parseBrandLines(text);
  if (entries.length === 0) return { ok: false, error: "해석할 수 있는 줄이 없습니다. \"전체이름 = 줄임말\" 형식으로 적어주세요." };
  if (entries.length > MAX_IMPORT) return { ok: false, error: `한 번에 ${MAX_IMPORT}줄까지만 등록할 수 있습니다.` };

  try {
    const supabase = createServerSupabase();
    const { data: existing, error: loadError } = await supabase.from("brand_dictionary").select("id, full_name, short_form");
    if (loadError) return { ok: false, error: dbError(loadError) };
    const byKey = new Map((existing ?? []).map((e) => [brandKey(e.full_name), e]));

    const toInsert = [];
    const toUpdate = [];
    let unchanged = 0;
    for (const entry of entries) {
      const cur = byKey.get(brandKey(entry.full_name));
      if (!cur) toInsert.push(entry);
      else if (cur.short_form !== entry.short_form) toUpdate.push({ id: cur.id, short_form: entry.short_form });
      else unchanged++;
    }

    if (toInsert.length) {
      const { error } = await supabase.from("brand_dictionary").insert(toInsert);
      if (error) return { ok: false, error: dbError(error) };
    }
    for (const u of toUpdate) {
      const { error } = await supabase.from("brand_dictionary").update({ short_form: u.short_form }).eq("id", u.id);
      if (error) return { ok: false, error: dbError(error) };
    }
    revalidate();
    const { data: all, error: reloadError } = await supabase.from("brand_dictionary").select("*");
    if (reloadError) return { ok: false, error: dbError(reloadError) };
    return { ok: true, added: toInsert.length, updated: toUpdate.length, unchanged, errors, entries: all ?? [] };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "알 수 없는 오류" };
  }
}
