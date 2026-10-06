"use client";

import { useState } from "react";
import { suggestShortForm, type DictEntry } from "@/lib/product";
import { FIELD_LABELS, applyAddressPick, missingFields, parsePaste, type AddressPick, type OrderField } from "@/lib/orders";
import {
  cardRows, cardsFromPaste, emptyCard, emptyItem, invoicePreview, mergeCards, splitCard,
  type CardItem, type ItemField, type OrderCard, type SharedField,
} from "@/lib/order-cards";
import type { ExcludedMessage } from "@/lib/kakao";
import { addressNeedsCheck, nameNeedsCheck, phoneWarning } from "@/lib/parser";
import AddressSearch from "./address-search";
import { saveOrders } from "../actions";
import { createBrand } from "@/app/(app)/brands/actions";

/** Product names from recent orders, offered as autocomplete on the product-name field */
const RECENT_PRODUCTS_LIST_ID = "recent-product-names";

const newKey = () => crypto.randomUUID();
const cardMissing = (c: OrderCard) => missingFields(c.shared);
const isReady = (c: OrderCard) => cardMissing(c).length === 0 && c.items.length > 0;

export default function OrderEntry({ dict: initialDict, recentProducts }: { dict: DictEntry[]; recentProducts: string[] }) {
  // Adding to the dictionary directly from a card is reflected in this screen's suggestions immediately
  const [dict, setDict] = useState(initialDict);
  const [rawText, setRawText] = useState("");
  const [cards, setCards] = useState<OrderCard[]>([]);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [savingAll, setSavingAll] = useState(false);
  // Messages from the last paste that were not turned into cards (photos, waybill/exchange/sold-out notices, …)
  const [excluded, setExcluded] = useState<ExcludedMessage[]>([]);

  const handleParse = () => {
    const paste = parsePaste(rawText, dict);
    setExcluded(paste.excluded);
    const newCards = cardsFromPaste(paste, newKey);
    if (newCards.length === 0) {
      setMessage({ kind: "error", text: "분리된 주문이 없습니다. 원문을 확인해 주세요." });
      return;
    }
    const multi = newCards.filter((c) => c.items.length > 1).length;
    const suggested = newCards.filter((c) => c.merge).length;
    setCards((prev) => [...prev, ...newCards]);
    setRawText("");
    setMessage({
      kind: "ok",
      text:
        `주문 ${newCards.length}건으로 분리했습니다` +
        (multi ? ` (그중 ${multi}건은 상품 여러 개 → 합배)` : "") +
        (suggested ? `. 합배 제안 ${suggested}건을 카드에서 확인하세요` : "") +
        ". 카드 내용을 확인한 뒤 저장하세요.",
    });
  };

  const patchCard = (key: string, patch: (c: OrderCard) => Partial<OrderCard>) =>
    setCards((prev) => prev.map((c) => (c.key === key ? { ...c, ...patch(c), error: null } : c)));

  const updateShared = (key: string, field: SharedField, value: string) =>
    patchCard(key, (c) => ({
      shared: { ...c.shared, [field]: value },
      // Once a person edits the vendor, the "새 태그?" hint has been dealt with
      newTag: field === "vendor" ? false : c.newTag,
    }));

  const updateItem = (key: string, itemKey: string, field: ItemField, value: string) =>
    patchCard(key, (c) => ({
      items: c.items.map((it) => {
        if (it.key !== itemKey) return it;
        const next: CardItem = { ...it, [field]: value };
        if (field === "brand_short") next.brandShortEdited = true;
        if (field === "brand_raw" && !it.brandShortEdited) next.brand_short = suggestShortForm(value, dict) ?? "";
        return next;
      }),
    }));

  const addItem = (key: string) => patchCard(key, (c) => ({ items: [...c.items, emptyItem(newKey)] }));
  const removeItem = (key: string, itemKey: string) =>
    patchCard(key, (c) => ({ items: c.items.filter((it) => it.key !== itemKey) }));

  const split = (key: string) =>
    setCards((prev) => prev.flatMap((c) => (c.key === key ? splitCard(c, newKey) : [c])));

  /** Move the source card's products into the target card (n합배) */
  const merge = (sourceKey: string, targetKey: string) => {
    const source = cards.find((c) => c.key === sourceKey);
    const target = cards.find((c) => c.key === targetKey);
    if (!source || !target || sourceKey === targetKey) return;
    const targetName = target.shared.name || "이름 없음";
    const sameContact =
      source.shared.name.trim() === target.shared.name.trim() &&
      source.shared.phone.replace(/\D/g, "") === target.shared.phone.replace(/\D/g, "");
    if (sameContact) {
      setMessage({ kind: "ok", text: `'${targetName}' 카드로 합배했습니다.` });
    } else {
      setMessage({
        kind: "error",
        text: `받는 분 정보가 다른 카드를 합쳤습니다. 이름·전화·주소는 '${targetName}' 카드 기준입니다 — 확인하세요.`,
      });
    }
    setCards((prev) => {
      const src = prev.find((c) => c.key === sourceKey);
      if (!src) return prev;
      return prev.filter((c) => c.key !== sourceKey).map((c) => (c.key === targetKey ? mergeCards(c, src) : c));
    });
  };

  const dismissMerge = (key: string) => patchCard(key, () => ({ merge: null }));

  const addEmptyCard = () => setCards((prev) => [...prev, emptyCard(newKey)]);
  const removeCard = (key: string) => setCards((prev) => prev.filter((c) => c.key !== key));

  // Address-search result → addr1/addr2 (+ postal code for display)
  const pickAddress = (key: string, pick: AddressPick) =>
    patchCard(key, (c) => ({ shared: { ...c.shared, ...applyAddressPick(c.shared, pick) }, zonecode: pick.zonecode }));

  const addToDictionary = async (item: CardItem) => {
    const res = await createBrand({ full_name: item.brand_raw, short_form: item.brand_short });
    if (!res.ok) {
      setMessage({ kind: "error", text: res.error });
      return;
    }
    const nextDict = [...dict, { full_name: res.entry.full_name, short_form: res.entry.short_form }];
    setDict(nextDict);
    // Also re-suggest a short form, using the updated dictionary, for other products that had none
    setCards((prev) =>
      prev.map((c) => ({
        ...c,
        items: c.items.map((it) => {
          if (it.brandShortEdited || it.brand_short || !it.brand_raw.trim()) return it;
          const short = suggestShortForm(it.brand_raw, nextDict);
          return short ? { ...it, brand_short: short } : it;
        }),
      })),
    );
    setMessage({ kind: "ok", text: `딕셔너리에 '${res.entry.full_name}' → '${res.entry.short_form}' 추가했습니다.` });
  };

  const saveCards = async (targets: OrderCard[]) => {
    const keys = new Set(targets.map((c) => c.key));
    setCards((prev) => prev.map((c) => (keys.has(c.key) ? { ...c, saving: true, error: null } : c)));
    const result = await saveOrders(targets.flatMap(cardRows));
    if (result.ok) {
      setCards((prev) => prev.filter((c) => !keys.has(c.key)));
      setMessage({ kind: "ok", text: `주문 ${targets.length}건 (상품 ${result.ids.length}개) 저장했습니다.` });
    } else {
      setCards((prev) => prev.map((c) => (keys.has(c.key) ? { ...c, saving: false, error: result.error } : c)));
      setMessage({ kind: "error", text: result.error });
    }
  };

  const handleSaveAll = async () => {
    const ready = cards.filter(isReady);
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

  const readyCount = cards.filter(isReady).length;

  return (
    <div className="space-y-6">
      <section className="space-y-3 rounded-lg border border-gray-200 bg-white p-4">
        <textarea
          value={rawText}
          onChange={(e) => setRawText(e.target.value)}
          rows={10}
          placeholder="통합 주문방에서 복사한 주문 원문, 또는 '대화 내보내기' .txt 내용을 붙여넣으세요"
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
        <p className="text-xs text-gray-500">
          주문 출처는 각 주문 마지막 줄의 태그(예: 디, 장, 굿1)가 거래처 칸에 들어갑니다. 카드 1장 = 송장 1장이고,
          상품이 여러 개면 n합배로 묶여 송장 한 줄로 나갑니다.
        </p>
      </section>

      {message && (
        <p
          role="status"
          className={`rounded px-3 py-2 text-sm ${message.kind === "ok" ? "bg-green-50 text-green-800" : "bg-red-50 text-red-800"}`}
        >
          {message.text}
        </p>
      )}

      {excluded.length > 0 && <ExcludedList messages={excluded} />}

      <datalist id={RECENT_PRODUCTS_LIST_ID}>
        {recentProducts.map((p) => <option key={p} value={p} />)}
      </datalist>

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
            <OrderCardView
              key={card.key}
              index={i + 1}
              card={card}
              others={cards.map((c, j) => ({ card: c, index: j + 1 })).filter((o) => o.card.key !== card.key)}
              dict={dict}
              onShared={(f, v) => updateShared(card.key, f, v)}
              onItem={(itemKey, f, v) => updateItem(card.key, itemKey, f, v)}
              onAddItem={() => addItem(card.key)}
              onRemoveItem={(itemKey) => removeItem(card.key, itemKey)}
              onSplit={() => split(card.key)}
              onMergeInto={(targetKey) => merge(card.key, targetKey)}
              onDismissMerge={() => dismissMerge(card.key)}
              onSave={() => saveCards([card])}
              onAddBrand={addToDictionary}
              onRemove={() => removeCard(card.key)}
              onAddressPick={(pick) => pickAddress(card.key, pick)}
              onDismissError={() => patchCard(card.key, () => ({}))}
            />
          ))}
        </section>
      )}
    </div>
  );
}

const MERGE_REASON: Record<"same-contact" | "hapbae", string> = {
  "same-contact": "이름·전화·주소·태그가 같은 주문이 있습니다",
  hapbae: "합배 요청",
};

function OrderCardView({
  index, card, others, dict, onShared, onItem, onAddItem, onRemoveItem, onSplit, onMergeInto, onDismissMerge, onSave,
  onAddBrand, onRemove, onAddressPick, onDismissError,
}: {
  index: number;
  card: OrderCard;
  /** The other cards on screen (merge targets) */
  others: { card: OrderCard; index: number }[];
  dict: DictEntry[];
  onShared: (field: SharedField, value: string) => void;
  onItem: (itemKey: string, field: ItemField, value: string) => void;
  onAddItem: () => void;
  onRemoveItem: (itemKey: string) => void;
  onSplit: () => void;
  onMergeInto: (targetKey: string) => void;
  onDismissMerge: () => void;
  onSave: () => void;
  onAddBrand: (item: CardItem) => Promise<void>;
  onRemove: () => void;
  onAddressPick: (pick: AddressPick) => void;
  onDismissError: () => void;
}) {
  const f = card.shared;
  const missing = new Set<OrderField>(cardMissing(card));
  const [mergeTarget, setMergeTarget] = useState("");
  const n = card.items.length;
  const suggestedTarget = card.merge?.intoGroupId ? others.find((o) => o.card.groupId === card.merge?.intoGroupId) : undefined;
  const label = (o: { card: OrderCard; index: number }) => `#${o.index} ${o.card.shared.name || "(이름 없음)"}`;

  const input = (field: SharedField) => (
    <label className="flex min-w-0 flex-col text-xs">
      <span className={`mb-0.5 ${missing.has(field) ? "font-semibold text-red-600" : "text-gray-600"}`}>
        {FIELD_LABELS[field]}
        {missing.has(field) && " · 필수"}
      </span>
      <input
        value={f[field]}
        onChange={(e) => onShared(field, e.target.value)}
        className={`w-full min-w-0 rounded border px-2 py-1.5 text-sm ${missing.has(field) ? "border-red-400 bg-red-50" : "border-gray-300"}`}
      />
    </label>
  );

  return (
    <article className={`rounded-lg border bg-white p-4 ${missing.size || n === 0 ? "border-red-300" : "border-gray-200"}`}>
      <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">
          #{index} {f.name || "(이름 없음)"}
          {n > 1 && (
            <span
              title="상품 여러 개를 송장 1장으로 보냅니다 (엑셀 한 줄)."
              className="ml-2 rounded bg-indigo-50 px-1.5 py-0.5 text-xs font-medium text-indigo-700"
            >
              {n}합배
            </span>
          )}
        </h2>
        <div className="flex flex-wrap gap-2">
          {n > 1 && (
            <button
              onClick={onSplit}
              title="상품마다 별도 주문(송장)으로 나눕니다"
              className="rounded border border-gray-300 px-3 py-1 text-xs hover:bg-gray-50"
            >
              분리
            </button>
          )}
          <button
            onClick={onSave}
            disabled={card.saving || missing.size > 0 || n === 0}
            className="rounded bg-green-600 px-3 py-1 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-40"
          >
            {card.saving ? "저장 중…" : "저장"}
          </button>
          <button onClick={onRemove} disabled={card.saving} className="rounded border border-gray-300 px-3 py-1 text-xs hover:bg-gray-50">
            삭제
          </button>
        </div>
      </header>

      {card.merge && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs text-indigo-900">
          <span className="font-semibold">합배 제안</span>
          <span>
            {MERGE_REASON[card.merge.reason]}
            {card.merge.message && <> &lsquo;{card.merge.message}&rsquo;</>}
          </span>
          {suggestedTarget ? (
            <button
              onClick={() => onMergeInto(suggestedTarget.card.key)}
              className="rounded bg-indigo-600 px-2 py-1 font-medium text-white hover:bg-indigo-700"
            >
              {label(suggestedTarget)} 카드와 합치기
            </button>
          ) : (
            <span className="text-indigo-700">합칠 주문을 아래에서 골라 주세요.</span>
          )}
          <button onClick={onDismissMerge} className="rounded border border-indigo-300 px-2 py-1 hover:bg-indigo-100">
            무시
          </button>
        </div>
      )}

      {/* minmax(0, …) / min-w-0: grid and flex children default to min-width: auto, so an <input>'s intrinsic width
          would push the column (and the card) wider instead of letting the fields shrink */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-[minmax(0,1fr)_15rem]">
        <div className="min-w-0 space-y-3">
          <div className="grid grid-cols-2 gap-2">
            {input("name")}
            {input("phone")}
          </div>
          {phoneWarning(f.phone) && <p className="text-xs text-amber-700">⚠ {phoneWarning(f.phone)}</p>}
          {nameNeedsCheck(f.name) && (
            <p className="text-xs text-amber-700">
              <span className="mr-1 rounded bg-amber-100 px-1.5 py-0.5 font-medium text-amber-900">이름 확인</span>
              &lsquo;{f.name.trim()}&rsquo;은(는) 사람 이름이 아니라 상호·별명일 수 있습니다. 받는 분 이름이 맞는지 확인하세요.
            </p>
          )}
          <div className="grid gap-2 sm:grid-cols-2">
            {input("addr1")}
            {input("addr2")}
          </div>
          {addressNeedsCheck(f.addr1) && (
            <p className="text-xs text-amber-700">
              <span className="mr-1 rounded bg-amber-100 px-1.5 py-0.5 font-medium text-amber-900">주소 확인 필요</span>
              도로명 번호나 지번을 찾지 못했습니다. 아래 &lsquo;주소 검색&rsquo;으로 확인하세요.
            </p>
          )}
          <div className="flex flex-wrap items-start gap-3">
            <div className="min-w-0 flex-1">
              <AddressSearch query={f.addr1} emphasize={addressNeedsCheck(f.addr1)} onPick={onAddressPick} />
            </div>
            {card.zonecode && (
              <span className="text-xs text-gray-500" title="확인용으로만 표시합니다. 송장 엑셀에는 들어가지 않습니다.">
                우편번호 {card.zonecode}
              </span>
            )}
          </div>

          <div className="space-y-2 rounded border border-gray-200 p-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-gray-700">상품 {n}개</span>
              {card.itemNumbers.length > 0 && (
                <span title="사진과 대조하는 용도입니다. 송장 엑셀에는 들어가지 않습니다." className="font-mono text-gray-500">
                  품번 {card.itemNumbers.join(" · ")}
                </span>
              )}
            </div>
            {card.items.map((item) => (
              <ItemRow
                key={item.key}
                item={item}
                dict={dict}
                canRemove={n > 1}
                onChange={(field, value) => onItem(item.key, field, value)}
                onRemove={() => onRemoveItem(item.key)}
                onAddBrand={() => onAddBrand(item)}
              />
            ))}
            {n === 0 && <p className="text-xs text-red-700">상품이 없습니다. 상품을 추가하세요.</p>}
            <button onClick={onAddItem} className="rounded border border-gray-300 px-2 py-1 text-xs hover:bg-gray-50">
              + 상품 추가 (합배)
            </button>
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            {input("vendor")}
            {input("note")}
          </div>
          {card.newTag && f.vendor.trim() && (
            <p className="text-xs text-amber-700">
              <span className="mr-1 rounded bg-amber-100 px-1.5 py-0.5 font-medium text-amber-900">새 태그?</span>
              마지막 줄 &lsquo;{f.vendor.trim()}&rsquo;을(를) 거래처 태그로 넣었습니다. 등록된 태그 목록에 없으니 맞는지 확인하세요.
            </p>
          )}
          <p className="text-xs text-gray-600">
            엑셀 상품명 미리보기: <span className="font-mono text-gray-900">{invoicePreview(card) || "—"}</span>
          </p>
          {others.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 text-xs text-gray-600">
              <span>다른 카드와 합배:</span>
              <select
                value={mergeTarget}
                onChange={(e) => setMergeTarget(e.target.value)}
                className="rounded border border-gray-300 px-1 py-0.5"
              >
                <option value="">카드 선택</option>
                {others.map((o) => (
                  <option key={o.card.key} value={o.card.key}>
                    {label(o)}
                  </option>
                ))}
              </select>
              <button
                onClick={() => mergeTarget && onMergeInto(mergeTarget)}
                disabled={!mergeTarget}
                className="rounded border border-gray-300 px-2 py-0.5 hover:bg-gray-50 disabled:opacity-40"
              >
                이 카드의 상품을 그 카드로 합치기
              </button>
            </div>
          )}
          {card.error && (
            <p className="flex items-start justify-between gap-2 rounded bg-red-50 px-2 py-1 text-xs text-red-800">
              {card.error}
              <button onClick={onDismissError} aria-label="오류 닫기">✕</button>
            </p>
          )}
        </div>
        {card.raw && (
          <section className="min-w-0 self-start rounded border border-gray-200 bg-gray-50">
            <h3 className="border-b border-gray-200 px-2 py-1 text-xs font-semibold text-gray-600">주문 원문</h3>
            <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words p-2 text-xs text-gray-700">{card.raw}</pre>
          </section>
        )}
      </div>
    </article>
  );
}

const ITEM_LABELS: Record<ItemField, string> = {
  brand_raw: "브랜드 원문",
  brand_short: "브랜드 약칭",
  product_name: "상품명",
  color: "색상",
  size: "사이즈",
  note: "상품 메모",
};

function ItemRow({
  item, dict, canRemove, onChange, onRemove, onAddBrand,
}: {
  item: CardItem;
  dict: DictEntry[];
  canRemove: boolean;
  onChange: (field: ItemField, value: string) => void;
  onRemove: () => void;
  onAddBrand: () => Promise<void>;
}) {
  const [addingBrand, setAddingBrand] = useState(false);
  const brandUnknown = !!item.brand_raw.trim() && !suggestShortForm(item.brand_raw, dict);
  // Only color/size came in the text (the product is in the photo) → ask for the product name
  const needsProductName = !item.product_name.trim();

  const field = (name: ItemField, warn = false) => (
    <label className="flex min-w-0 flex-col text-xs">
      <span className={`mb-0.5 ${warn ? "font-semibold text-amber-700" : "text-gray-600"}`}>
        {ITEM_LABELS[name]}
        {warn && " · 입력 필요"}
      </span>
      <input
        value={item[name]}
        list={name === "product_name" ? RECENT_PRODUCTS_LIST_ID : undefined}
        onChange={(e) => onChange(name, e.target.value)}
        className={`w-full min-w-0 rounded border px-2 py-1.5 text-sm ${warn ? "border-amber-400 bg-amber-50" : "border-gray-300"}`}
      />
    </label>
  );

  return (
    <div className="space-y-1 border-t border-gray-100 pt-2 first:border-t-0 first:pt-0">
      <div className="grid grid-cols-2 items-end gap-2 sm:grid-cols-[repeat(2,minmax(0,1fr))_minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,0.7fr)_minmax(0,1fr)_auto]">
        {field("brand_raw")}
        {field("brand_short")}
        {field("product_name", needsProductName)}
        {field("color")}
        {field("size")}
        {field("note")}
        <button
          onClick={onRemove}
          disabled={!canRemove}
          title={canRemove ? "이 상품 빼기" : "상품이 하나뿐입니다 (카드를 삭제하세요)"}
          className="whitespace-nowrap rounded border border-gray-300 px-2 py-1.5 text-xs hover:bg-gray-50 disabled:opacity-30"
        >
          빼기
        </button>
      </div>
      {needsProductName && (
        <p className="text-xs text-amber-700">
          <span className="mr-1 rounded bg-amber-100 px-1.5 py-0.5 font-medium text-amber-900">상품명 입력 필요</span>
          사진을 보고 상품명을 입력하세요 (최근 상품명 자동완성).
        </p>
      )}
      {brandUnknown && (
        <p className="flex flex-wrap items-center gap-2 text-xs text-amber-700">
          &lsquo;{item.brand_raw}&rsquo;은(는) 브랜드 딕셔너리에 없습니다.
          {item.brand_short.trim() ? (
            <button
              onClick={async () => {
                setAddingBrand(true);
                await onAddBrand();
                setAddingBrand(false);
              }}
              disabled={addingBrand}
              className="rounded border border-amber-300 bg-amber-50 px-2 py-0.5 font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-40"
            >
              {addingBrand ? "추가 중…" : `딕셔너리에 추가: ${item.brand_raw.trim()} → ${item.brand_short.trim()}`}
            </button>
          ) : (
            <span>약칭을 입력하면 딕셔너리에 바로 추가할 수 있습니다.</span>
          )}
        </p>
      )}
    </div>
  );
}

/** Folded list of the messages the last paste did not turn into cards, grouped by reason (photos etc. are counted only) */
function ExcludedList({ messages }: { messages: ExcludedMessage[] }) {
  const byReason = new Map<string, ExcludedMessage[]>();
  for (const m of messages) byReason.set(m.reason, [...(byReason.get(m.reason) ?? []), m]);
  const summary = [...byReason].map(([reason, list]) => `${reason} ${list.length}`).join(" · ");

  return (
    <details className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm">
      <summary className="cursor-pointer text-gray-700">
        제외된 메시지 <b>{messages.length}</b>개 <span className="text-xs text-gray-500">({summary})</span>
      </summary>
      <div className="mt-2 space-y-3">
        {[...byReason].map(([reason, list]) => (
          <div key={reason}>
            <h3 className="mb-1 text-xs font-semibold text-gray-600">
              {reason} · {list.length}개
            </h3>
            {reason === "사진·이모티콘·파일" ? (
              <p className="text-xs text-gray-500">사진·이모티콘·파일 알림은 개수만 표시합니다.</p>
            ) : (
              <ul className="space-y-1">
                {list.map((m, i) => (
                  <li key={i} className="rounded bg-gray-50 p-2">
                    {m.time && <span className="mb-0.5 block text-[11px] text-gray-500">{m.time}{m.sender && ` · ${m.sender}`}</span>}
                    <pre className="whitespace-pre-wrap text-xs text-gray-800">{m.text}</pre>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    </details>
  );
}
