import "server-only";
import type { createServerSupabase } from "@/lib/supabase/server";

type Supabase = ReturnType<typeof createServerSupabase>;

/** Source-chat names used in recent orders (dropdown candidates), most recently used first */
export async function loadRooms(supabase: Supabase): Promise<string[]> {
  const { data, error } = await supabase
    .from("orders")
    .select("source_room")
    .order("created_at", { ascending: false })
    .limit(1000);
  if (error) throw new Error(error.message);
  return [...new Set((data ?? []).map((r) => r.source_room).filter(Boolean))];
}
