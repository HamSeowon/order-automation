import Link from "next/link";
import { getSession } from "@/lib/auth";
import { logout } from "@/app/login/actions";

// 로그인 후 화면 공통 틀 (메뉴 + 로그아웃).
// 주의: layout 은 화면 이동 때 다시 실행되지 않으므로 여기서의 확인만으로는 막을 수 없다.
// 각 page 가 requirePageSession() 을, 각 Server Action 이 authorize() 를 따로 호출한다.
export default async function AppLayout({ children }: LayoutProps<"/">) {
  const session = await getSession();

  return (
    <>
      <nav className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 text-sm">
          <span className="font-bold">주문 반자동화</span>
          <Link href="/orders/new" className="text-gray-700 hover:text-blue-600">주문 입력</Link>
          <Link href="/orders" className="text-gray-700 hover:text-blue-600">주문 목록</Link>
          <Link href="/brands" className="text-gray-700 hover:text-blue-600">브랜드 딕셔너리</Link>
          <Link href="/exports" className="text-gray-700 hover:text-blue-600">내보내기 기록</Link>
          {session?.role === "admin" && (
            <Link href="/admin" className="text-gray-700 hover:text-blue-600">관리</Link>
          )}
          <span className="ml-auto flex items-center gap-3">
            {session?.role === "admin" && (
              <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800">관리자</span>
            )}
            {session && (
              <form action={logout}>
                <button type="submit" className="rounded border border-gray-300 px-3 py-1 text-xs hover:bg-gray-50">
                  로그아웃
                </button>
              </form>
            )}
          </span>
        </div>
      </nav>
      {children}
    </>
  );
}
