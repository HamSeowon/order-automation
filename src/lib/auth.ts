import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import type { AppRole } from "@/lib/database.types";
import { SESSION_COOKIE, SESSION_DAYS, clientIpFrom } from "@/lib/auth-utils";

// 로그인 세션 (기획서 3.1-8, 4.6) — Data Access Layer.
// proxy 는 쿠키가 있는지만 보고, 실제 확인은 여기서 DB 세션으로 한다.
// 모든 페이지·Server Action·Route Handler 가 이 파일의 함수로 확인해야 한다.

export type Session = { id: string; role: AppRole };

export const UNAUTHORIZED_MESSAGE = "로그인이 필요합니다. 페이지를 새로고침한 뒤 다시 로그인해 주세요.";
export const FORBIDDEN_MESSAGE = "관리자만 할 수 있습니다.";

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

/** 현재 요청의 로그인 세션 (없거나 만료면 null). 한 번의 렌더 안에서는 한 번만 조회 */
export const getSession = cache(async (): Promise<Session | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token || token.length > 200) return null;
  const supabase = createServerSupabase();
  const { data, error } = await supabase
    .from("app_sessions")
    .select("id, role, last_seen_at")
    .eq("token_hash", hashToken(token))
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  if (error || !data) return null;
  // 마지막 사용 시각은 1시간에 한 번만 갱신 (매 요청 쓰기 방지)
  if (Date.now() - Date.parse(data.last_seen_at) > 60 * 60 * 1000) {
    await supabase.from("app_sessions").update({ last_seen_at: new Date().toISOString() }).eq("id", data.id);
  }
  return { id: data.id, role: data.role };
});

/** 페이지용: 로그인 안 했으면 로그인 화면으로 */
export async function requirePageSession(): Promise<Session> {
  const session = await getSession();
  if (!session) redirect("/login");
  return session;
}

/** 관리자 페이지용: 관리자가 아니면 주문 입력 화면으로 */
export async function requireAdminPage(): Promise<Session> {
  const session = await requirePageSession();
  if (session.role !== "admin") redirect("/orders/new");
  return session;
}

/**
 * Server Action / Route Handler 용. 통과하면 null, 막히면 사용자에게 보여줄 오류 문구.
 *   const denied = await authorize(); if (denied) return { ok: false, error: denied };
 */
export async function authorize(role: "member" | "admin" = "member"): Promise<string | null> {
  const session = await getSession();
  if (!session) return UNAUTHORIZED_MESSAGE;
  if (role === "admin" && session.role !== "admin") return FORBIDDEN_MESSAGE;
  return null;
}

/** 로그인 성공 시: 무작위 토큰 → 쿠키, 그 해시 → DB 세션 (30일) */
export async function createSession(role: AppRole): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  const { error } = await createServerSupabase()
    .from("app_sessions")
    .insert({ role, token_hash: hashToken(token), expires_at: expiresAt.toISOString() });
  if (error) throw new Error(`세션 저장 실패: ${error.message}`);
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

/** 로그아웃: 현재 세션 행 삭제 + 쿠키 삭제 */
export async function destroyCurrentSession(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) await createServerSupabase().from("app_sessions").delete().eq("token_hash", hashToken(token));
  store.delete(SESSION_COOKIE);
}

/** 로그인 실패 잠금 기준 IP */
export async function clientIp(): Promise<string> {
  const h = await headers();
  return clientIpFrom((name) => h.get(name));
}
