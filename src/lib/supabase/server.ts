import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

// 서버 전용 Supabase 클라이언트 (secret / service_role 키 사용 → RLS 우회).
// 테이블에 anon 정책이 없으므로 DB 접근은 반드시 이 클라이언트를 통해서만 한다.
// "server-only" 덕분에 클라이언트 컴포넌트에서 import 하면 빌드가 실패한다.
export function createServerSupabase() {
  const url = process.env.SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secretKey) {
    throw new Error("SUPABASE_URL / SUPABASE_SECRET_KEY 환경변수가 설정되지 않았습니다 (.env.local 확인).");
  }
  return createClient<Database>(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
