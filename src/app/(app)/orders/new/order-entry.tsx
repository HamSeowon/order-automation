"use client";

import { useState } from "react";
import { suggestShortForm, type DictEntry } from "@/lib/product";
import {
  FIELD_LABELS, GROUP_SHARED_FIELDS, draftsFromText, emptyOrderDraft, excelProductName, missingFields,
  type OrderDraft, type OrderField,
} from "@/lib/orders";
import { saveOrders } from "../actions";
import { createBrand } from "@/app/(app)/brands/actions";
import { setCurrentUserName, useCurrentUserName } from "@/lib/current-user";

type Card = {
  key: string;
  /** 같은 메시지에서 나온 카드 묶음 ID (orders.order_group_id). 직접 추가한 카드는 null → 저장 시 새 그룹 */
  groupId: string | null;
  fields: OrderDraft;
  /** 이 카드로 분리된 원문 (대조용) */
  raw: string;
  /** 사람이 약칭을 직접 고쳤으면 브랜드 원문이 바뀌어도 약칭을 자동으로 덮어쓰지 않음 */
  brandShortEdited: boolean;
  saving: boolean;
  error: string | null;
};

export default function OrderEntry({ dict: initialDict, rooms }: { dict: DictEntry[]; rooms: string[] }) {
  // 카드에서 바로 딕셔너리에 추가하면 이 화면의 제안에도 즉시 반영
  const [dict, setDict] = useState(initialDict);
  const [sourceRoom, setSourceRoom] = useState("");
  const [rawText, setRawText] = useState("");
  const [cards, setCards] = useState<Card[]>([]);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [savingAll, setSavingAll] = useState(false);

  const createdBy = useCurrentUserName();

  const newKey = () => crypto.randomUUID();

  const handleParse = () => {
    const drafts = draftsFromText(rawText, dict, { source_room: sourceRoom, created_by: createdBy });
    if (drafts.length === 0) {
      setMessage({ kind: "error", text: "분리된 주문이 없습니다. 원문을 확인해 주세요." });
      return;
    }
    const newCards: Card[] = drafts.map((draft) => ({
      key: newKey(),
      groupId: draft.groupId,
      raw: draft.raw,
      fields: draft.fields,
      brandShortEdited: false,
      saving: false,
      error: null,
    }));
    const groupCount = new Set(drafts.map((d) => d.groupId)).size;
    setCards((prev) => [...prev, ...newCards]);
    setRawText("");
    setMessage({
      kind: "ok",
      text: `주문 ${groupCount}건 → 카드 ${drafts.length}장으로 분리했습니다. 카드 내용을 확인한 뒤 저장하세요.`,
    });
  };

  const addEmptyCard = () =>
    setCards((prev) => [
      ...prev,
      {
        key: newKey(), groupId: null, raw: "", brandShortEdited: false, saving: false, error: null,
        fields: emptyOrderDraft(sourceRoom, createdBy),
      },
    ]);

  const patchCard = (key: string, patch: Partial<Card>) =>
    setCards((prev) => prev.map((c) => (c.key === key ? { ...c, ...patch } : c)));

  const updateField = (key: string, field: OrderField, value: string) =>
    setCards((prev) => {
      const target = prev.find((c) => c.key === key);
      const shared = !!target?.groupId && GROUP_SHARED_FIELDS.includes(field);
      return prev.map((c) => {
        // 이름/전화/주소 등은 같은 묶음의 다른 카드에도 반영
        if (shared && c.key !== key && c.groupId === target.groupId) {
          return { ...c, fields: { ...c.fields, [field]: value }, error: null };
        }
        if (c.key !== key) return c;
        const fields = { ...c.fields, [field]: value };
        let brandShortEdited = c.brandShortEdited;
        if (field === "brand_short") brandShortEdited = true;
        if (field === "brand_raw" && !c.brandShortEdited) {
          fields.brand_short = suggestShortForm(value, dict) ?? "";
        }
        return { ...c, fields, brandShortEdited, error: null };
      });
    });

  const addToDictionary = async (card: Card) => {
    const { brand_raw, brand_short } = card.fields;
    const res = await createBrand({ full_name: brand_raw, short_form: brand_short });
    if (!res.ok) {
      setMessage({ kind: "error", text: res.error });
      return;
    }
    const nextDict = [...dict, { full_name: res.entry.full_name, short_form: res.entry.short_form }];
    setDict(nextDict);
    // 약칭이 비어 있던 다른 카드들도 새 딕셔너리로 다시 제안
    setCards((prev) =>
      prev.map((c) => {
        if (c.brandShortEdited || c.fields.brand_short || !c.fields.brand_raw.trim()) return c;
        const short = suggestShortForm(c.fields.brand_raw, nextDict);
        return short ? { ...c, fields: { ...c.fields, brand_short: short } } : c;
      }),
    );
    setMessage({ kind: "ok", text: `딕셔너리에 '${res.entry.full_name}' → '${res.entry.short_form}' 추가했습니다.` });
  };

  const removeCard = (key: string) => setCards((prev) => prev.filter((c) => c.key !== key));

  const saveCards = async (targets: Card[]) => {
    const keys = new Set(targets.map((c) => c.key));
    setCards((prev) => prev.map((c) => (keys.has(c.key) ? { ...c, saving: true, error: null } : c)));
    const result = await saveOrders(targets.map((c) => ({ ...c.fields, order_group_id: c.groupId })));
    if (result.ok) {
      setCards((prev) => prev.filter((c) => !keys.has(c.key)));
      setMessage({ kind: "ok", text: `${result.ids.length}건 저장했습니다.` });
    } else {
      setCards((prev) => prev.map((c) => (keys.has(c.key) ? { ...c, saving: false, error: result.error } : c)));
      setMessage({ kind: "error", text: result.error });
    }
  };

  const handleSaveAll = async () => {
    const ready = cards.filter((c) => missingFields(c.fields).length === 0);
    if (ready.length === 0) {
      setMessage({ kind: "error", text: "필수 항목이 모두 채워진 카드가 없습니다." });
      return;
    }
    setSavingAll(true);
    await saveCards(ready);
    setSavingAll(false);
    const skipped = cards.length - ready.length;
    if (skipped > 0) {
      setMessage((m) => (m?.kind === "ok" ? { kind: "ok", text: `${m.text} 필수 항목이 빠진 ${skipped}건은 남겨두었습니다.` } : m));
    }
  };

  const readyCount = cards.filter((c) => missingFields(c.fields).length === 0).length;

  return (
    <div className="space-y-6">
      <section className="space-y-3 rounded-lg border border-gray-200 bg-white p-4">
        <div className="flex flex-wrap gap-3">
          <label className="flex flex-col text-sm">
            <span className="mb-1 font-medium">출처 방</span>
            <input
              list="room-options"
              value={sourceRoom}
              onChange={(e) => setSourceRoom(e.target.value)}
              placeholder="예: 대구 상인방"
              className="w-56 rounded border border-gray-300 px-2 py-1.5"
            />
            <datalist id="room-options">
              {rooms.map((r) => <option key={r} value={r} />)}
            </datalist>
          </label>
          <label className="flex flex-col text-sm">
            <span className="mb-1 font-medium">입력자</span>
            <input
              value={createdBy}
              onChange={(e) => setCurrentUserName(e.target.value)}
              placeholder="이름"
              className="w-40 rounded border border-gray-300 px-2 py-1.5"
            />
          </label>
        </div>
        <textarea
          value={rawText}
          onChange={(e) => setRawText(e.target.value)}
          rows={10}
          placeholder="카톡 단톡방에서 복사한 주문 원문을 붙여넣으세요"
          className="w-full rounded border border-gray-300 p-2 font-mono text-sm"
        />
        <div className="flex flex-wrap gap-2">
          <button
            onClick={handleParse}
            disabled={!rawText.trim()}
            className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-40"
          >
            자동 분리
          </button>
          <button onClick={addEmptyCard} className="rounded border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50">
            빈 카드 추가 (직접 입력)
          </button>
        </div>
        <p className="text-xs text-gray-500">출처 방·입력자는 분리할 때 새 카드에 채워지고, 카드마다 따로 고칠 수 있습니다.</p>
      </section>

      {message && (
        <p
          role="status"
          className={`rounded px-3 py-2 text-sm ${message.kind === "ok" ? "bg-green-50 text-green-800" : "bg-red-50 text-red-800"}`}
        >
          {message.text}
        </p>
      )}

      {cards.length > 0 && (
        <section className="space-y-4">
          <div className="sticky top-0 z-10 flex items-center justify-between rounded-lg border border-gray-200 bg-white/95 px-4 py-2 backdrop-blur">
            <span className="text-sm">
              카드 {cards.length}건 · 저장 가능 <b>{readyCount}</b>건
            </span>
            <button
              onClick={handleSaveAll}
              disabled={savingAll || readyCount === 0}
              className="rounded bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-40"
            >
              {savingAll ? "저장 중…" : `전체 저장 (${readyCount}건)`}
            </button>
          </div>
          {cards.map((card, i) => (
            <OrderCard
              key={card.key}
              index={i + 1}
              card={card}
              groupLabel={groupLabel(cards, card)}
              dict={dict}
              onChange={(f, v) => updateField(card.key, f, v)}
              onSave={() => saveCards([card])}
              onAddBrand={() => addToDictionary(card)}
              onRemove={() => removeCard(card.key)}
              onDismissError={() => patchCard(card.key, { error: null })}
            />
          ))}
        </section>
      )}
    </div>
  );
}

/** 같은 묶음 카드가 여러 장이면 "묶음 1/3" 표시 */
function groupLabel(cards: Card[], card: Card): string | null {
  if (!card.groupId) return null;
  const members = cards.filter((c) => c.groupId === card.groupId);
  return members.length > 1 ? `묶음 ${members.indexOf(card) + 1}/${members.length}` : null;
}

function OrderCard({
  index, card, groupLabel, dict, onChange, onSave, onAddBrand, onRemove, onDismissError,
}: {
  index: number;
  card: Card;
  groupLabel: string | null;
  dict: DictEntry[];
  onChange: (field: OrderField, value: string) => void;
  onSave: () => void;
  onAddBrand: () => Promise<void>;
  onRemove: () => void;
  onDismissError: () => void;
}) {
  const f = card.fields;
  const missing = new Set(missingFields(f));
  const brandUnknown = !!f.brand_raw.trim() && !suggestShortForm(f.brand_raw, dict);
  const [addingBrand, setAddingBrand] = useState(false);

  const input = (field: OrderField, className = "") => (
    <label className={`flex flex-col text-xs ${className}`}>
      <span className={`mb-0.5 ${missing.has(field) ? "font-semibold text-red-600" : "text-gray-600"}`}>
        {FIELD_LABELS[field]}
        {missing.has(field) && " · 필수"}
      </span>
      <input
        value={f[field]}
        onChange={(e) => onChange(field, e.target.value)}
        className={`rounded border px-2 py-1.5 text-sm ${missing.has(field) ? "border-red-400 bg-red-50" : "border-gray-300"}`}
      />
    </label>
  );

  return (
    <article className={`rounded-lg border bg-white p-4 ${missing.size ? "border-red-300" : "border-gray-200"}`}>
      <header className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold">
          #{index} {f.name || "(이름 없음)"}
          {groupLabel && (
            <span
              title="같은 메시지에서 나온 카드입니다. 이름·전화·주소를 고치면 묶음 전체에 반영됩니다."
              className="ml-2 rounded bg-indigo-50 px-1.5 py-0.5 text-xs font-medium text-indigo-700"
            >
              {groupLabel}
            </span>
          )}
        </h2>
        <div className="flex gap-2">
          <button
            onClick={onSave}
            disabled={card.saving || missing.size > 0}
            className="rounded bg-green-600 px-3 py-1 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-40"
          >
            {card.saving ? "저장 중…" : "저장"}
          </button>
          <button onClick={onRemove} disabled={card.saving} className="rounded border border-gray-300 px-3 py-1 text-xs hover:bg-gray-50">
            삭제
          </button>
        </div>
      </header>

      <div className="grid gap-4 md:grid-cols-[1fr_16rem]">
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {input("name")}
            {input("phone")}
            {input("source_room")}
            {input("created_by")}
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {input("addr1")}
            {input("addr2")}
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            {input("brand_raw")}
            {input("brand_short")}
            {input("product_name", "sm:col-span-1")}
            {input("color")}
            {input("size")}
          </div>
          {brandUnknown && (
            <p className="flex flex-wrap items-center gap-2 text-xs text-amber-700">
              &lsquo;{f.brand_raw}&rsquo;은(는) 브랜드 딕셔너리에 없습니다.
              {f.brand_short.trim() ? (
                <button
                  onClick={async () => {
                    setAddingBrand(true);
                    await onAddBrand();
                    setAddingBrand(false);
                  }}
                  disabled={addingBrand}
                  className="rounded border border-amber-300 bg-amber-50 px-2 py-0.5 font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-40"
                >
                  {addingBrand ? "추가 중…" : `딕셔너리에 추가: ${f.brand_raw.trim()} → ${f.brand_short.trim()}`}
                </button>
              ) : (
                <span>약칭을 입력하면 딕셔너리에 바로 추가할 수 있습니다.</span>
              )}
            </p>
          )}
          <div className="grid gap-2 sm:grid-cols-2">
            {input("vendor")}
            {input("note")}
          </div>
          <p className="text-xs text-gray-600">
            엑셀 상품명 미리보기: <span className="font-mono text-gray-900">{excelProductName(f) || "—"}</span>
          </p>
          {card.error && (
            <p className="flex items-start justify-between gap-2 rounded bg-red-50 px-2 py-1 text-xs text-red-800">
              {card.error}
              <button onClick={onDismissError} aria-label="오류 닫기">✕</button>
            </p>
          )}
        </div>
        {card.raw && (
          <pre className="max-h-60 overflow-auto whitespace-pre-wrap rounded bg-gray-50 p-2 text-xs text-gray-700">
            {card.raw}
          </pre>
        )}
      </div>
    </article>
  );
}
