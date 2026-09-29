"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabase } from "@/lib/supabase/server";
import { authorize } from "@/lib/auth";
import { sanitizeExportFileName } from "@/lib/invoice";

// Server Actions can also be called directly via POST, so every function checks login with authorize() first.

export type CreateExportResult =
  | { ok: true; id: string; fileName: string; orderCount: number }
  | { ok: false; error: string };

/**
 * Claim every not-yet-exported order into a new export (DB function create_invoice_export).
 * The file is then downloaded from /exports/[id]/download using the returned id (re-downloads use the same route).
 * If fileName is null, the DB attaches a default name (YYYY-MM-DD.xlsx / _N) — so the numbering stays correct even if someone else exports in between.
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
