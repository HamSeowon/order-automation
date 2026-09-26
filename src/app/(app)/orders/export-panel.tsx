"use client";

import { useState } from "react";
import Link from "next/link";
import { createInvoiceExport } from "@/app/(app)/exports/actions";
import { setCurrentUserName, useCurrentUserName } from "@/lib/current-user";

type Done = { id: string; fileName: string; orderCount: number };

/**
 * "엑셀 송장 내보내기" — 아직 내보내지 않은 주문 전체를 로젠 양식 .xlsx 로 받는다 (목록 필터와 무관).
 * 파일 이름 기본값은 오늘 날짜(같은 날 두 번째부터 _N), 받기 전에 바꿀 수 있다.
 */
export default function ExportPanel({
  pendingCount, defaultFileName, unavailable,
}: {
  pendingCount: number;
  defaultFileName: string;
  /** 마이그레이션 미적용 등으로 내보내기를 쓸 수 없을 때 이유 */
  unavailable: string | null;
}) {
  const exportedBy = useCurrentUserName();
  const [open, setOpen] = useState(false);
  const [fileName, setFileName] = useState(defaultFileName);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Done | null>(null);

  if (unavailable) {
    return (
      <p className="mb-4 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
        엑셀 송장 내보내기를 쓸 수 없습니다: {unavailable}
      </p>
    );
  }

  const start = () => {
    setFileName(defaultFileName);
    setError(null);
    setDone(null);
    setOpen(true);
  };

  const submit = async () => {
    setPending(true);
    setError(null);
    // 기본 이름을 그대로 두면 null → DB가 실제 번호로 이름을 붙인다 (그 사이 다른 사람이 내보냈어도 _N 이 맞게)
    const name = fileName.trim() === defaultFileName ? null : fileName;
    const res = await createInvoiceExport(name, exportedBy);
    setPending(false);
    if (!res.ok) return setError(res.error);
    setOpen(false);
    setDone(res);
    // 다운로드 시작 (실패해도 아래 '다시 받기' 링크나 내보내기 기록에서 받을 수 있음)
    const a = document.createElement("a");
    a.href = `/exports/${res.id}/download`;
    a.download = res.fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  return (
    <section className="mb-4 rounded-lg border border-gray-200 bg-white p-4 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p>
          아직 내보내지 않은 주문 <b className={pendingCount ? "text-blue-700" : ""}>{pendingCount.toLocaleString()}</b>건
          <span className="ml-2 text-xs text-gray-500">(위 조회 조건과 상관없이 전체 기준)</span>
        </p>
        <div className="flex items-center gap-3">
          <Link href="/exports" className="text-xs text-gray-600 hover:underline">내보내기 기록</Link>
          {!open && (
            <button
              onClick={start}
              disabled={pendingCount === 0}
              className="rounded bg-emerald-600 px-4 py-2 font-medium text-white hover:bg-emerald-700 disabled:opacity-40"
            >
              엑셀 송장 내보내기
            </button>
          )}
        </div>
      </div>

      {open && (
        <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-gray-100 pt-3">
          <label className="flex flex-col">
            <span className="mb-1 text-xs text-gray-600">파일 이름</span>
            <input
              value={fileName}
              onChange={(e) => setFileName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !pending && submit()}
              className="w-64 rounded border border-gray-300 px-2 py-1.5 font-mono"
              autoFocus
            />
          </label>
          <label className="flex flex-col">
            <span className="mb-1 text-xs text-gray-600">내보내는 사람</span>
            <input
              value={exportedBy}
              onChange={(e) => setCurrentUserName(e.target.value)}
              placeholder="이름"
              className="w-32 rounded border border-gray-300 px-2 py-1.5"
            />
          </label>
          <button
            onClick={submit}
            disabled={pending || !fileName.trim()}
            className="rounded bg-emerald-600 px-4 py-2 font-medium text-white hover:bg-emerald-700 disabled:opacity-40"
          >
            {pending ? "내보내는 중…" : `${pendingCount}건 내보내고 다운로드`}
          </button>
          <button onClick={() => setOpen(false)} disabled={pending} className="rounded border border-gray-300 px-4 py-2 hover:bg-gray-50">
            취소
          </button>
          <p className="w-full text-xs text-gray-500">
            내보낸 주문은 &lsquo;내보냄&rsquo;으로 표시되어 다음 파일에 다시 들어가지 않습니다. 수정은 계속 할 수 있습니다.
          </p>
        </div>
      )}

      {error && <p className="mt-3 rounded bg-red-50 px-3 py-2 text-red-800">{error}</p>}
      {done && (
        <p className="mt-3 rounded bg-green-50 px-3 py-2 text-green-800">
          {done.orderCount}건을 <b className="font-mono">{done.fileName}</b>(으)로 내보냈습니다. 다운로드가 시작되지 않으면{" "}
          <a href={`/exports/${done.id}/download`} className="font-medium underline">여기를 눌러 다시 받기</a>.
        </p>
      )}
    </section>
  );
}
