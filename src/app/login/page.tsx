import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { safeNextPath } from "@/lib/auth-utils";
import LoginForm from "./login-form";

export const metadata: Metadata = { title: "로그인 · 주문 반자동화" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const sp = await searchParams;
  const next = safeNextPath(Array.isArray(sp.next) ? sp.next[0] : sp.next);
  // Redirect immediately if already logged in
  if (await getSession()) redirect(next);

  return (
    <main className="flex flex-1 items-center justify-center px-4 py-16">
      <div className="w-full max-w-xs rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <h1 className="mb-1 text-lg font-bold">주문 반자동화</h1>
        <p className="mb-5 text-sm text-gray-600">비밀번호(숫자 6자리)를 입력하세요.</p>
        <LoginForm next={next} />
      </div>
    </main>
  );
}
