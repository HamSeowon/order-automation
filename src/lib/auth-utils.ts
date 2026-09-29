// Login-related pure functions (shared by proxy, the server, and tests — no dependency on next/headers, the DB, etc.)

export const SESSION_COOKIE = "oa_session";
export const SESSION_DAYS = 30;
export const MAX_LOGIN_ATTEMPTS = 5;
export const LOCK_MINUTES = 15;
export const DEFAULT_AFTER_LOGIN = "/orders/new";

/**
 * Path to return to after login. Only same-site absolute paths are allowed, to prevent an open redirect
 * (e.g. "//evil.com", "/\\evil.com", "https://…" all fall back to the default path).
 */
export function safeNextPath(next: unknown): string {
  if (typeof next !== "string" || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) {
    return DEFAULT_AFTER_LOGIN;
  }
  // Also reject paths containing control characters or backslashes
  if (/[\u0000-\u001f\\]/.test(next)) return DEFAULT_AFTER_LOGIN;
  if (next === "/login" || next.startsWith("/login?") || next.startsWith("/login/")) return DEFAULT_AFTER_LOGIN;
  return next.slice(0, 500);
}

/**
 * IP used as the login-failure lockout key. In production (Vercel), the first value of x-forwarded-for is the real client IP.
 * Falls back to "local" if no header is present (e.g. local development).
 */
export function clientIpFrom(get: (name: string) => string | null): string {
  const forwarded = get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = forwarded || get("x-real-ip")?.trim() || "";
  return ip.slice(0, 100) || "local";
}

export const loginAttemptKey = (ip: string) => `ip:${ip}`;

/** Lockout notice message (minutes remaining, at least 1) */
export function lockedMessage(lockedUntil: string | Date, now: Date = new Date()): string {
  const minutes = Math.max(1, Math.ceil((new Date(lockedUntil).getTime() - now.getTime()) / 60000));
  return `로그인 시도가 너무 많아 잠시 잠겼습니다. ${minutes}분 후 다시 시도해 주세요.`;
}
