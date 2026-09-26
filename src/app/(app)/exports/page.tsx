import type { Metadata } from "next";
import { connection } from "next/server";
import { requirePageSession } from "@/lib/auth";
import { createServerSupabase } from "@/lib/supabase/server";
import type { InvoiceExport } from "@/lib/database.types";

export const metadata: Metadata = { title: "내보내기 기록 · 주문 반자동화" };

const timeFormat = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

async function loadExports(): Promise<{ exports: InvoiceExport[]; loadError: string | null }> {
  try {
    const { data, error } = await createServerSupabase()
      .from("exports")
      .select("*")
      .order("exported_at", { ascending: false })
      .limit(200);
    if (error) return { exports: [], loadError: error.message };
    return { exports: data ?? [], loadError: null };
  } catch (e) {
    return { exports: [], loadError: e instanceof Error ? e.message : "알 수 없는 오류" };
  }
}

export default async function ExportsPage() {
  await connection();
  await requirePageSession();
  const { exports, loadError } = await loadExports();

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-6">
      <h1 className="mb-1 text-xl font-bold">내보내기 기록</h1>
      <p className="mb-4 text-sm text-gray-600">
        엑셀 송장을 내보낸 기록입니다 (최근 200건). 파일을 잃어버렸거나 다운로드가 안 됐으면 &lsquo;다시 받기&rsquo;를 누르세요.
        다시 받으면 그 파일에 들어간 주문들의 <b>현재 내용</b>으로 만들어집니다 (내보낸 뒤 수정했다면 수정된 내용).
      </p>
      {loadError ? (
        <p className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
          기록을 불러오지 못했습니다: {loadError}
        </p>
      ) : exports.length === 0 ? (
        <p className="rounded-lg border border-gray-200 bg-white px-4 py-10 text-center text-sm text-gray-500">
          아직 내보낸 기록이 없습니다. 주문 목록에서 &lsquo;엑셀 송장 내보내기&rsquo;를 누르세요.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-gray-50 text-left text-xs text-gray-600">
              <tr>
                <th className="px-4 py-2 font-medium">날짜</th>
                <th className="px-4 py-2 font-medium">시각</th>
                <th className="px-4 py-2 font-medium">파일 이름</th>
                <th className="px-4 py-2 text-right font-medium">주문 수</th>
                <th className="px-4 py-2 font-medium">내보낸 사람</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {exports.map((e) => (
                <tr key={e.id} className="border-t border-gray-100">
                  <td className="whitespace-nowrap px-4 py-2">
                    {e.export_date}
                    {e.seq > 1 && <span className="ml-1 text-xs text-gray-500">({e.seq}번째)</span>}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2 text-gray-600">{timeFormat.format(new Date(e.exported_at))}</td>
                  <td className="px-4 py-2 font-mono text-xs">{e.file_name}</td>
                  <td className="px-4 py-2 text-right">{e.order_count}</td>
                  <td className="px-4 py-2 text-gray-600">{e.exported_by}</td>
                  <td className="px-4 py-2 text-right">
                    <a
                      href={`/exports/${e.id}/download`}
                      className="rounded border border-gray-300 px-3 py-1 text-xs hover:bg-gray-50"
                    >
                      다시 받기
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
