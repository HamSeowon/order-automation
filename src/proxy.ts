import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth-utils";

// 1차 차단 (기획서 3.1-8): 로그인 쿠키가 없으면 로그인 화면으로 (GET) / 401 (그 외).
// 쿠키가 "있는지만" 본다 — 진짜 세션인지는 각 page / Server Action / Route Handler 가 DB로 확인 (src/lib/auth.ts).
export function proxy(req: NextRequest) {
  if (req.cookies.has(SESSION_COOKIE)) return NextResponse.next();

  if (req.method === "GET" || req.method === "HEAD") {
    const url = new URL("/login", req.url);
    const next = req.nextUrl.pathname + req.nextUrl.search;
    if (next !== "/") url.searchParams.set("next", next);
    return NextResponse.redirect(url);
  }
  return new NextResponse("로그인이 필요합니다.", { status: 401 });
}

export const config = {
  // 로그인 화면(및 로그인 Server Action POST)과 정적 파일은 제외
  matcher: ["/((?!login(?:/|$)|_next/static|_next/image|favicon\\.ico).*)"],
};
