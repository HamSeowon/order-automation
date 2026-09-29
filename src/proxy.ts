import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth-utils";

// First-line block (spec 3.1-8): if there's no login cookie, redirect to the login screen (GET) / 401 (everything else).
// This only checks whether the cookie "exists" — each page / Server Action / Route Handler checks the real session against the DB (src/lib/auth.ts).
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
  // Exclude the login screen (and its Server Action POST) and static files
  matcher: ["/((?!login(?:/|$)|_next/static|_next/image|favicon\\.ico).*)"],
};
