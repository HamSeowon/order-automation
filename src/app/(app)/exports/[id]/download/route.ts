import { createServerSupabase } from "@/lib/supabase/server";
import { authorize } from "@/lib/auth";
import { contentDisposition } from "@/lib/invoice";
import { buildInvoiceWorkbook } from "@/lib/invoice-xlsx";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 내보내기 1건의 송장 파일. 처음 받기와 다시 받기 모두 이 경로 — 항상 그 내보내기에 들어간 주문의 현재 내용으로 만든다 */
export async function GET(_req: Request, ctx: RouteContext<"/exports/[id]/download">) {
  // 고객 개인정보가 담긴 파일 — 로그인 필수
  const denied = await authorize();
  if (denied) return new Response(denied, { status: 401 });

  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return new Response("잘못된 요청입니다.", { status: 400 });

  const supabase = createServerSupabase();
  const { data: exp, error: expError } = await supabase.from("exports").select("*").eq("id", id).maybeSingle();
  if (expError) return new Response(`DB 오류: ${expError.message}`, { status: 500 });
  if (!exp) return new Response("내보내기 기록을 찾을 수 없습니다.", { status: 404 });

  const { data: orders, error } = await supabase
    .from("orders")
    .select("*")
    .eq("export_id", id)
    // 주문이 들어온 순서대로, 같은 메시지의 상품은 붙여서
    .order("created_at")
    .order("order_group_id")
    .order("id");
  if (error) return new Response(`DB 오류: ${error.message}`, { status: 500 });

  const body = buildInvoiceWorkbook(orders ?? []);
  return new Response(body, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": contentDisposition(exp.file_name),
      "Cache-Control": "no-store",
    },
  });
}
