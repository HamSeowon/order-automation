import "server-only";
import type { createServerSupabase } from "@/lib/supabase/server";

type Supabase = ReturnType<typeof createServerSupabase>;

/** 최근 주문에서 쓴 출처 방 이름들 (드롭다운 후보). 최근에 쓴 순서 */
export async function loadRooms(supabase: Supabase): Promise<string[]> {
  const { data, error } = await supabase
    .from("orders")
    .select("source_room")
    .order("created_at", { ascending: false })
    .limit(1000);
  if (error) throw new Error(error.message);
  return [...new Set((data ?? []).map((r) => r.source_room).filter(Boolean))];
}
