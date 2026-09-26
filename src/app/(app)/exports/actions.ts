"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabase } from "@/lib/supabase/server";
import { authorize } from "@/lib/auth";
import { sanitizeExportFileName } from "@/lib/invoice";

// Server Action 은 직접 POST 로도 호출할 수 있으므로 모든 함수가 먼저 authorize() 로 로그인을 확인한다.

export type CreateExportResult =
  | { ok: true; id: string; fileName: string; orderCount: number }
  | { ok: false; error: string };

/**
 * 아직 내보내지 않은 주문 전부를 새 내보내기로 선점한다 (DB 함수 create_invoice_export).
 * 파일은 반환된 id 로 /exports/[id]/download 에서 받는다 (다시 받기도 같은 경로).
 * fileName 이 null 이면 DB가 기본 이름(YYYY-MM-DD.xlsx / _N)을 붙인다 — 그 사이 다른 사람이 내보내도 번호가 맞게.
 */
export async function createInvoiceExport(fileName: unknown, exportedBy: unknown): Promise<CreateExportResult> {
  const denied = await authorize();
  if (denied) return { ok: false, error: denied };
  const name = fileName === null ? null : sanitizeExportFileName(fileName);
  if (fileName !== null && !name) return { ok: false, error: "파일 이름을 확인해 주세요." };
  const by = typeof exportedBy === "string" ? exportedBy.trim().slice(0, 50) : "";

  try {
    const { data, error } = await createServerSupabase().rpc("create_invoice_export", {
      p_file_name: name,
      p_exported_by: by,
    });
    if (error) {
      if (error.message.includes("NO_ORDERS_TO_EXPORT")) {
        return { ok: false, error: "내보낼 주문이 없습니다. (이미 모두 내보냈거나, 방금 다른 사람이 내보냈습니다.)" };
      }
      return { ok: false, error: `내보내기 실패: ${error.message}` };
    }
    revalidatePath("/orders");
    revalidatePath("/exports");
    return { ok: true, id: data.id, fileName: data.file_name, orderCount: data.order_count };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "알 수 없는 오류" };
  }
}
