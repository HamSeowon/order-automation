"use client";

import { useState } from "react";
import type { BrandEntry } from "@/lib/database.types";
import { createBrand, deleteBrand, importBrands, updateBrand } from "./actions";

type Message = { kind: "ok" | "error"; text: string } | null;

const byShortThenName = (a: BrandEntry, b: BrandEntry) =>
  a.short_form.localeCompare(b.short_form) || a.full_name.localeCompare(b.full_name);

export default function BrandManager({ initialEntries }: { initialEntries: BrandEntry[] }) {
  const [entries, setEntries] = useState(initialEntries);
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState<Message>(null);

  const q = query.trim().toLowerCase();
  const visible = q
    ? entries.filter((e) => e.full_name.toLowerCase().includes(q) || e.short_form.toLowerCase().includes(q))
    : entries;

  const upsertLocal = (entry: BrandEntry) =>
    setEntries((prev) => [...prev.filter((e) => e.id !== entry.id), entry].sort(byShortThenName));

  return (
    <div className="space-y-6">
      <AddForm
        onAdded={(entry) => {
          upsertLocal(entry);
          setMessage({ kind: "ok", text: `'${entry.full_name}' → '${entry.short_form}' 추가했습니다.` });
        }}
        onError={(text) => setMessage({ kind: "error", text })}
      />

      <ImportForm onImported={(all) => setEntries([...all].sort(byShortThenName))} onMessage={setMessage} />

      {message && (
        <p
          role="status"
          className={`rounded px-3 py-2 text-sm ${message.kind === "ok" ? "bg-green-50 text-green-800" : "bg-red-50 text-red-800"}`}
        >
          {message.text}
        </p>
      )}

      <section className="rounded-lg border border-gray-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 px-4 py-3">
          <span className="text-sm">
            전체 <b>{entries.length}</b>건{q && ` · 검색 결과 ${visible.length}건`}
          </span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="이름 또는 줄임말 검색"
            className="w-56 rounded border border-gray-300 px-2 py-1.5 text-sm"
          />
        </div>
        {visible.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-gray-500">
            {entries.length === 0 ? "등록된 브랜드가 없습니다. 위에서 추가하거나 목록을 붙여넣어 일괄 등록하세요." : "검색 결과가 없습니다."}
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs text-gray-600">
              <tr>
                <th className="px-4 py-2 font-medium">브랜드 전체 이름</th>
                <th className="px-4 py-2 font-medium">줄임말</th>
                <th className="w-40 px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {visible.map((entry) => (
                <BrandRow
                  key={entry.id}
                  entry={entry}
                  onUpdated={(e) => {
                    upsertLocal(e);
                    setMessage({ kind: "ok", text: `'${e.full_name}' 수정했습니다.` });
                  }}
                  onDeleted={() => {
                    setEntries((prev) => prev.filter((e) => e.id !== entry.id));
                    setMessage({ kind: "ok", text: `'${entry.full_name}' 삭제했습니다.` });
                  }}
                  onError={(text) => setMessage({ kind: "error", text })}
                />
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

function AddForm({ onAdded, onError }: { onAdded: (e: BrandEntry) => void; onError: (msg: string) => void }) {
  const [fullName, setFullName] = useState("");
  const [shortForm, setShortForm] = useState("");
  const [pending, setPending] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPending(true);
    const res = await createBrand({ full_name: fullName, short_form: shortForm });
    setPending(false);
    if (!res.ok) return onError(res.error);
    setFullName("");
    setShortForm("");
    onAdded(res.entry);
  };

  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-2 rounded-lg border border-gray-200 bg-white p-4">
      <label className="flex flex-col text-sm">
        <span className="mb-1 font-medium">브랜드 전체 이름</span>
        <input
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          placeholder="예: AMAZING"
          className="w-64 rounded border border-gray-300 px-2 py-1.5"
        />
      </label>
      <label className="flex flex-col text-sm">
        <span className="mb-1 font-medium">줄임말</span>
        <input
          value={shortForm}
          onChange={(e) => setShortForm(e.target.value)}
          placeholder="예: AMZ"
          className="w-32 rounded border border-gray-300 px-2 py-1.5"
        />
      </label>
      <button
        type="submit"
        disabled={pending || !fullName.trim() || !shortForm.trim()}
        className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-40"
      >
        {pending ? "추가 중…" : "추가"}
      </button>
    </form>
  );
}

function ImportForm({ onImported, onMessage }: { onImported: (all: BrandEntry[]) => void; onMessage: (m: Message) => void }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [pending, setPending] = useState(false);

  const submit = async () => {
    setPending(true);
    const res = await importBrands(text);
    setPending(false);
    if (!res.ok) return onMessage({ kind: "error", text: res.error });
    const skipped = res.errors.length
      ? ` 해석하지 못한 줄 ${res.errors.length}개: ${res.errors.slice(0, 5).map((e) => `${e.line}번째 줄 "${e.text}"`).join(", ")}${res.errors.length > 5 ? " …" : ""}`
      : "";
    onMessage({
      kind: res.errors.length ? "error" : "ok",
      text: `일괄 등록 완료 — 추가 ${res.added}건, 줄임말 변경 ${res.updated}건, 변경 없음 ${res.unchanged}건.${skipped}`,
    });
    onImported(res.entries);
    if (!res.errors.length) setText("");
  };

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="text-sm text-blue-700 underline underline-offset-2">
        목록 붙여넣어 일괄 등록하기
      </button>
    );
  }

  return (
    <section className="space-y-2 rounded-lg border border-gray-200 bg-white p-4">
      <h2 className="text-sm font-semibold">일괄 등록</h2>
      <p className="text-xs text-gray-600">
        한 줄에 하나씩 <code>전체이름 = 줄임말</code> 형식으로 적거나, 엑셀에서 두 열(전체이름, 줄임말)을 그대로 복사해 붙여넣으세요.
        이미 있는 이름은 줄임말만 바뀝니다.
      </p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={8}
        placeholder={"AMAZING = AMZ\n어메이징 = AMZ\nPXG = PXG"}
        className="w-full rounded border border-gray-300 p-2 font-mono text-sm"
      />
      <div className="flex gap-2">
        <button
          onClick={submit}
          disabled={pending || !text.trim()}
          className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-40"
        >
          {pending ? "등록 중…" : "일괄 등록"}
        </button>
        <button onClick={() => setOpen(false)} className="rounded border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50">
          닫기
        </button>
      </div>
    </section>
  );
}

function BrandRow({
  entry, onUpdated, onDeleted, onError,
}: {
  entry: BrandEntry;
  onUpdated: (e: BrandEntry) => void;
  onDeleted: () => void;
  onError: (msg: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [fullName, setFullName] = useState(entry.full_name);
  const [shortForm, setShortForm] = useState(entry.short_form);
  const [pending, setPending] = useState(false);

  const save = async () => {
    setPending(true);
    const res = await updateBrand(entry.id, { full_name: fullName, short_form: shortForm });
    setPending(false);
    if (!res.ok) return onError(res.error);
    setEditing(false);
    onUpdated(res.entry);
  };

  const remove = async () => {
    if (!window.confirm(`'${entry.full_name}' → '${entry.short_form}' 항목을 삭제할까요?`)) return;
    setPending(true);
    const res = await deleteBrand(entry.id);
    setPending(false);
    if (!res.ok) return onError(res.error);
    onDeleted();
  };

  if (editing) {
    return (
      <tr className="border-t border-gray-100 bg-blue-50/40">
        <td className="px-4 py-2">
          <input
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            className="w-full rounded border border-gray-300 px-2 py-1"
            aria-label="브랜드 전체 이름"
          />
        </td>
        <td className="px-4 py-2">
          <input
            value={shortForm}
            onChange={(e) => setShortForm(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && save()}
            className="w-full rounded border border-gray-300 px-2 py-1"
            aria-label="줄임말"
          />
        </td>
        <td className="space-x-1 px-4 py-2 text-right">
          <button onClick={save} disabled={pending} className="rounded bg-green-600 px-3 py-1 text-xs font-medium text-white disabled:opacity-40">
            저장
          </button>
          <button
            onClick={() => {
              setEditing(false);
              setFullName(entry.full_name);
              setShortForm(entry.short_form);
            }}
            disabled={pending}
            className="rounded border border-gray-300 px-3 py-1 text-xs"
          >
            취소
          </button>
        </td>
      </tr>
    );
  }

  return (
    <tr className="border-t border-gray-100">
      <td className="px-4 py-2">{entry.full_name}</td>
      <td className="px-4 py-2 font-mono font-semibold">{entry.short_form}</td>
      <td className="space-x-1 px-4 py-2 text-right">
        <button onClick={() => setEditing(true)} disabled={pending} className="rounded border border-gray-300 px-3 py-1 text-xs hover:bg-gray-50">
          수정
        </button>
        <button onClick={remove} disabled={pending} className="rounded border border-red-200 px-3 py-1 text-xs text-red-700 hover:bg-red-50">
          삭제
        </button>
      </td>
    </tr>
  );
}
