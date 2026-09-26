"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabase } from "@/lib/supabase/server";
import { authorize } from "@/lib/auth";
import type { Order, OrderUpdate } from "@/lib/database.types";
import { FIELD_LABELS, GROUP_SHARED_FIELDS, missingFields, toOrderInsert } from "@/lib/orders";

// Server Action 은 직접 POST 로도 호출할 수 있으므로 모든 함수가 먼저 authorize() 로 로그인을 확인한다.

const MAX_BATCH = 200;

export type SaveOrdersResult =
  | { ok: true; ids: string[] }
  | { ok: false; error: string };

export async function saveOrders(inputs: unknown[]): Promise<SaveOrdersResult> {
  const denied = await authorize();
  if (denied) return { ok: false, error: denied };
  if (!Array.isArray(inputs) || inputs.length === 0) {
    return { ok: false, error: "저장할 주문이 없습니다." };
  }
  if (inputs.length > MAX_BATCH) {
    return { ok: false, error: `한 번에 ${MAX_BATCH}건까지만 저장할 수 있습니다.` };
  }

  const rows = inputs.map(toOrderInsert);
  for (const [i, row] of rows.entries()) {
    const missing = missingFields(row);
    if (missing.length) {
      return { ok: false, error: `${i + 1}번째 주문에 필수 항목이 비어 있습니다: ${missing.map((f) => FIELD_LABELS[f]).join(", ")}` };
    }
  }

  try {
    const supabase = createServerSupabase();
    const { data, error } = await supabase.from("orders").insert(rows).select("id");
    if (error) return { ok: false, error: `DB 저장 실패: ${error.message}` };
    revalidatePath("/orders");
    return { ok: true, ids: data.map((r) => r.id) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "알 수 없는 오류" };
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type UpdateOrderResult =
  | { ok: true; order: Order; groupUpdated: number }
  | { ok: false; error: string; conflict?: boolean };

/**
 * 주문 1건 수정.
 * - expectedUpdatedAt: 화면에 불러왔을 때의 updated_at. 그 사이 다른 사람이 고쳤으면 덮어쓰지 않고 conflict 반환 (동시 사용 대비)
 * - applyToGroup: true 면 같은 order_group_id 의 다른 주문에도 이름·전화·주소 등 공유 필드를 반영
 */
export async function updateOrder(
  id: unknown,
  input: unknown,
  expectedUpdatedAt: unknown,
  applyToGroup: unknown,
): Promise<UpdateOrderResult> {
  const denied = await authorize();
  if (denied) return { ok: false, error: denied };
  if (typeof id !== "string" || !UUID_RE.test(id)) return { ok: false, error: "잘못된 주문입니다." };
  if (typeof expectedUpdatedAt !== "string" || !expectedUpdatedAt) return { ok: false, error: "잘못된 요청입니다." };

  const row = toOrderInsert(input);
  // 그룹은 목록 화면에서 바꾸지 않는다
  delete row.order_group_id;
  const missing = missingFields(row);
  if (missing.length) {
    return { ok: false, error: `필수 항목이 비어 있습니다: ${missing.map((f) => FIELD_LABELS[f]).join(", ")}` };
  }

  try {
    const supabase = createServerSupabase();
    const { data, error } = await supabase
      .from("orders")
      .update(row)
      .eq("id", id)
      .eq("updated_at", expectedUpdatedAt)
      .select()
      .maybeSingle();
    if (error) return { ok: false, error: `DB 저장 실패: ${error.message}` };
    if (!data) {
      return {
        ok: false,
        conflict: true,
        error: "그 사이 다른 사람이 이 주문을 수정했거나 삭제했습니다. 새로고침해서 최신 내용을 확인한 뒤 다시 수정해 주세요.",
      };
    }

    let groupUpdated = 0;
    if (applyToGroup === true) {
      const shared: OrderUpdate = {};
      for (const f of GROUP_SHARED_FIELDS) shared[f] = row[f] ?? "";
      const { data: others, error: groupError } = await supabase
        .from("orders")
        .update(shared)
        .eq("order_group_id", data.order_group_id)
        .neq("id", id)
        .select("id");
      if (groupError) return { ok: false, error: `이 주문은 저장됐지만 묶음 반영에 실패했습니다: ${groupError.message}` };
      groupUpdated = others?.length ?? 0;
    }

    revalidatePath("/orders");
    return { ok: true, order: data, groupUpdated };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "알 수 없는 오류" };
  }
}

export async function deleteOrder(id: unknown): Promise<{ ok: true } | { ok: false; error: string }> {
  const denied = await authorize();
  if (denied) return { ok: false, error: denied };
  if (typeof id !== "string" || !UUID_RE.test(id)) return { ok: false, error: "잘못된 주문입니다." };
  try {
    const { error } = await createServerSupabase().from("orders").delete().eq("id", id);
    if (error) return { ok: false, error: `DB 삭제 실패: ${error.message}` };
    revalidatePath("/orders");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "알 수 없는 오류" };
  }
}
