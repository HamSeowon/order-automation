import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import type { AppRole } from "@/lib/database.types";
import { SESSION_COOKIE, SESSION_DAYS, clientIpFrom } from "@/lib/auth-utils";

// Login session (spec 3.1-8, 4.6) — Data Access Layer.
// proxy only checks whether the cookie exists; the real check happens here against the DB session.
// Every page, Server Action, and Route Handler must check in through the functions in this file.

export type Session = { id: string; role: AppRole };

export const UNAUTHORIZED_MESSAGE = "로그인이 필요합니다. 페이지를 새로고침한 뒤 다시 로그인해 주세요.";
export const FORBIDDEN_MESSAGE = "관리자만 할 수 있습니다.";

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

/** The current request's login session (null if missing or expired). Looked up only once per render */
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
  // Only refresh last_seen_at once per hour (avoid a write on every request)
  if (Date.now() - Date.parse(data.last_seen_at) > 60 * 60 * 1000) {
    await supabase.from("app_sessions").update({ last_seen_at: new Date().toISOString() }).eq("id", data.id);
  }
  return { id: data.id, role: data.role };
});

/** For pages: redirect to the login screen if not logged in */
export async function requirePageSession(): Promise<Session> {
  const session = await getSession();
  if (!session) redirect("/login");
  return session;
}

/** For admin pages: redirect to the order-entry screen if not an admin */
export async function requireAdminPage(): Promise<Session> {
  const session = await requirePageSession();
  if (session.role !== "admin") redirect("/orders/new");
  return session;
}

/**
 * For Server Actions / Route Handlers. Returns null if allowed, or an error message to show the user if denied.
 *   const denied = await authorize(); if (denied) return { ok: false, error: denied };
 */
export async function authorize(role: "member" | "admin" = "member"): Promise<string | null> {
  const session = await getSession();
  if (!session) return UNAUTHORIZED_MESSAGE;
  if (role === "admin" && session.role !== "admin") return FORBIDDEN_MESSAGE;
  return null;
}

/** On successful login: a random token → cookie, its hash → DB session (30 days) */
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

/** Logout: delete the current session row + delete the cookie */
export async function destroyCurrentSession(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) await createServerSupabase().from("app_sessions").delete().eq("token_hash", hashToken(token));
  store.delete(SESSION_COOKIE);
}

/** IP used as the login-failure lockout key */
export async function clientIp(): Promise<string> {
  const h = await headers();
  return clientIpFrom((name) => h.get(name));
}
