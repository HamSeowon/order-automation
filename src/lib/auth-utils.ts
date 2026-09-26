// 로그인 관련 순수 함수 (proxy·서버·테스트 공용 — next/headers, DB 등에 의존하지 않음)

export const SESSION_COOKIE = "oa_session";
export const SESSION_DAYS = 30;
export const MAX_LOGIN_ATTEMPTS = 5;
export const LOCK_MINUTES = 15;
export const DEFAULT_AFTER_LOGIN = "/orders/new";

/**
 * 로그인 후 돌아갈 경로. 열린 리다이렉트를 막기 위해 같은 사이트의 절대 경로만 허용
 * ("//evil.com", "/\\evil.com", "https://…" 등은 기본 경로로).
 */
export function safeNextPath(next: unknown): string {
  if (typeof next !== "string" || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) {
    return DEFAULT_AFTER_LOGIN;
  }
  // 제어 문자·역슬래시가 섞인 경로도 거부
  if (/[\u0000-\u001f\\]/.test(next)) return DEFAULT_AFTER_LOGIN;
  if (next === "/login" || next.startsWith("/login?") || next.startsWith("/login/")) return DEFAULT_AFTER_LOGIN;
  return next.slice(0, 500);
}

/**
 * 로그인 실패 잠금 기준 IP. 배포 환경(Vercel)은 x-forwarded-for 첫 값이 실제 접속 IP.
 * 헤더가 없으면(로컬 개발 등) "local".
 */
export function clientIpFrom(get: (name: string) => string | null): string {
  const forwarded = get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = forwarded || get("x-real-ip")?.trim() || "";
  return ip.slice(0, 100) || "local";
}

export const loginAttemptKey = (ip: string) => `ip:${ip}`;

/** 잠금 안내 문구 (남은 분, 최소 1분) */
export function lockedMessage(lockedUntil: string | Date, now: Date = new Date()): string {
  const minutes = Math.max(1, Math.ceil((new Date(lockedUntil).getTime() - now.getTime()) / 60000));
  return `로그인 시도가 너무 많아 잠시 잠겼습니다. ${minutes}분 후 다시 시도해 주세요.`;
}
