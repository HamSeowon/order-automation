"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Order } from "@/lib/database.types";
import {
  FIELD_LABELS, GROUP_SHARED_FIELDS, ORDER_FIELDS, excelProductName, missingFields,
  type OrderDraft, type OrderField,
} from "@/lib/orders";
import { invoiceCode } from "@/lib/invoice";
import { deleteOrder, updateOrder } from "./actions";

const dateFormat = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const toDraft = (o: Order): OrderDraft =>
  Object.fromEntries(ORDER_FIELDS.map((f) => [f, o[f] ?? ""])) as OrderDraft;

export default function OrdersTable({ orders }: { orders: Order[] }) {
  // Order count per group visible on this page (used for the group badge and the "apply to whole group" option)
  const groupSizes = new Map<string, number>();
  for (const o of orders) groupSizes.set(o.order_group_id, (groupSizes.get(o.order_group_id) ?? 0) + 1);

  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
      <table className="w-full min-w-[960px] text-sm">
        <thead className="bg-gray-50 text-left text-xs text-gray-600">
          <tr>
            <th className="px-3 py-2 font-medium">등록</th>
            <th className="px-3 py-2 font-medium">이름</th>
            <th className="px-3 py-2 font-medium">전화번호</th>
            <th className="px-3 py-2 font-medium">주소</th>
            <th className="px-3 py-2 font-medium">상품명 (송장)</th>
            <th className="px-3 py-2 font-medium">참고</th>
            <th className="w-32 px-3 py-2" />
          </tr>
        </thead>
        <tbody>
          {orders.map((order, i) => {
            const size = groupSizes.get(order.order_group_id) ?? 1;
            const prevSameGroup = i > 0 && orders[i - 1].order_group_id === order.order_group_id;
            return (
              <OrderRow
                key={`${order.id}:${order.updated_at}`}
                order={order}
                groupSize={size}
                continuesGroup={prevSameGroup}
              />
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function OrderRow({ order, groupSize, continuesGroup }: { order: Order; groupSize: number; continuesGroup: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<OrderDraft>(() => toDraft(order));
  const [applyToGroup, setApplyToGroup] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<{ text: string; conflict: boolean } | null>(null);

  const inGroup = groupSize > 1;
  const missing = new Set(missingFields(draft));

  const save = async () => {
    setPending(true);
    setError(null);
    const res = await updateOrder(order.id, draft, order.updated_at, inGroup && applyToGroup);
    setPending(false);
    if (!res.ok) return setError({ text: res.error, conflict: !!res.conflict });
    // Once the server's revalidatePath re-renders the list, this row is recreated with a new key
    setEditing(false);
  };

  const remove = async () => {
    const label = `${order.name} / ${excelProductName(order) || "(상품 없음)"}`;
    if (!window.confirm(`이 주문을 삭제할까요?\n${label}`)) return;
    setPending(true);
    const res = await deleteOrder(order.id);
    setPending(false);
    if (!res.ok) setError({ text: res.error, conflict: false });
  };

  const groupBorder = inGroup ? "border-l-4 border-l-indigo-300" : "border-l-4 border-l-transparent";
  const rowBorder = continuesGroup ? "border-t border-dashed border-gray-200" : "border-t border-gray-200";

  if (editing) {
    const field = (f: OrderField, className = "") => (
      <label key={f} className={`flex flex-col text-xs ${className}`}>
        <span className={`mb-0.5 ${missing.has(f) ? "font-semibold text-red-600" : "text-gray-600"}`}>
          {FIELD_LABELS[f]}
          {inGroup && GROUP_SHARED_FIELDS.includes(f) && applyToGroup && " ⧉"}
        </span>
        <input
          value={draft[f]}
          onChange={(e) => setDraft((d) => ({ ...d, [f]: e.target.value }))}
          className={`rounded border px-2 py-1 text-sm ${missing.has(f) ? "border-red-400 bg-red-50" : "border-gray-300"}`}
        />
      </label>
    );
    return (
      <tr className={`${rowBorder} ${groupBorder} bg-blue-50/40`}>
        <td colSpan={7} className="space-y-3 px-3 py-3">
          <div className="grid grid-cols-2 gap-2">
            {field("name")}
            {field("phone")}
          </div>
          <div className="grid gap-2 md:grid-cols-2">
            {field("addr1")}
            {field("addr2")}
          </div>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
            {field("brand_raw")}
            {field("brand_short")}
            {field("product_name")}
            {field("color")}
            {field("size")}
          </div>
          <div className="grid gap-2 md:grid-cols-2">
            {field("vendor")}
            {field("note")}
          </div>
          <p className="text-xs text-gray-600">
            엑셀 상품명: <span className="font-mono text-gray-900">{excelProductName(draft) || "—"}</span>
          </p>
          {order.exported_at && (
            <p className="text-xs text-amber-700">
              이미 송장으로 내보낸 주문입니다. 수정해도 다음 송장 파일에 다시 들어가지 않습니다
              (내보내기 기록에서 &lsquo;다시 받기&rsquo;를 하면 수정된 내용으로 받아집니다).
            </p>
          )}
          {inGroup && (
            <label className="flex items-center gap-2 text-xs text-gray-700">
              <input type="checkbox" checked={applyToGroup} onChange={(e) => setApplyToGroup(e.target.checked)} />
              같은 묶음의 다른 주문 {groupSize - 1}건에도 이름·전화·주소·거래처(⧉ 표시)를 똑같이 반영
            </label>
          )}
          {error && <ErrorLine error={error} onRefresh={() => router.refresh()} />}
          <div className="flex gap-2">
            <button
              onClick={save}
              disabled={pending || missing.size > 0}
              className="rounded bg-green-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-40"
            >
              {pending ? "저장 중…" : "저장"}
            </button>
            <button
              onClick={() => {
                setEditing(false);
                setDraft(toDraft(order));
                setError(null);
              }}
              disabled={pending}
              className="rounded border border-gray-300 px-4 py-1.5 text-xs hover:bg-gray-50"
            >
              취소
            </button>
          </div>
        </td>
      </tr>
    );
  }

  return (
    <>
      <tr className={`${rowBorder} ${groupBorder} align-top`}>
        <td className="whitespace-nowrap px-3 py-2 text-xs text-gray-600">
          {dateFormat.format(new Date(order.created_at))}
          {inGroup && !continuesGroup && (
            <span className="ml-1 rounded bg-indigo-50 px-1 text-[10px] font-medium text-indigo-700">{groupSize}합배</span>
          )}
          {order.exported_at && (
            <span
              title={`송장 내보냄: ${dateFormat.format(new Date(order.exported_at))}`}
              className="mt-0.5 block w-fit rounded bg-emerald-50 px-1 text-[10px] font-medium text-emerald-700"
            >
              내보냄 {dateFormat.format(new Date(order.exported_at))}
            </span>
          )}
        </td>
        <td className="whitespace-nowrap px-3 py-2 font-medium">{order.name}</td>
        <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">{order.phone}</td>
        <td className="px-3 py-2">
          {order.addr1}
          {order.addr2 && <span className="text-gray-600"> {order.addr2}</span>}
        </td>
        <td className="px-3 py-2 font-mono text-xs">{excelProductName(order)}</td>
        <td className="px-3 py-2 text-xs text-gray-600">
          {/* invoiceCode: vendor, or the legacy source_room for orders saved before tags existed — same code as the Excel E column */}
          {[invoiceCode(order) && `거래처: ${invoiceCode(order)}`, order.note].filter(Boolean).join(" · ")}
        </td>
        <td className="whitespace-nowrap px-3 py-2 text-right">
          <button
            onClick={() => setEditing(true)}
            disabled={pending}
            className="mr-1 rounded border border-gray-300 px-2.5 py-1 text-xs hover:bg-gray-50"
          >
            수정
          </button>
          <button
            onClick={remove}
            disabled={pending}
            className="rounded border border-red-200 px-2.5 py-1 text-xs text-red-700 hover:bg-red-50 disabled:opacity-40"
          >
            삭제
          </button>
        </td>
      </tr>
      {error && (
        <tr className={groupBorder}>
          <td colSpan={7} className="px-3 pb-2">
            <ErrorLine error={error} onRefresh={() => router.refresh()} />
          </td>
        </tr>
      )}
    </>
  );
}

function ErrorLine({ error, onRefresh }: { error: { text: string; conflict: boolean }; onRefresh: () => void }) {
  return (
    <p className="flex flex-wrap items-center gap-2 rounded bg-red-50 px-2 py-1 text-xs text-red-800">
      {error.text}
      {error.conflict && (
        <button onClick={onRefresh} className="rounded border border-red-300 px-2 py-0.5 font-medium hover:bg-red-100">
          새로고침
        </button>
      )}
    </p>
  );
}
