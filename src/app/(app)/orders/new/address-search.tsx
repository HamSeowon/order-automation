"use client";

import Script from "next/script";
import { useRef, useState } from "react";
import type { AddressPick } from "@/lib/orders";

// Kakao (Daum) postcode service — free, no API key, no server-side call, no .env entry.
//
// Privacy: customer data leaves this app only when a staff member presses "주소 검색" on a card. Then the browser loads
// Kakao's script and sends the search text (the parsed address, which they can edit in the search box) to Kakao.
// Names and phone numbers are never sent. Nothing is loaded or sent before the button is pressed.
const POSTCODE_SRC = "https://t1.daumcdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js";

type PostcodeData = {
  roadAddress: string;
  autoRoadAddress?: string;
  jibunAddress: string;
  buildingName: string;
  zonecode: string;
};

declare global {
  interface Window {
    daum?: {
      Postcode: new (options: {
        oncomplete: (data: PostcodeData) => void;
        width?: string;
        height?: string;
      }) => { embed: (element: HTMLElement, options?: { q?: string; autoClose?: boolean }) => void };
    };
  }
}

/**
 * "주소 검색" button + the search embedded in the card (an embed instead of a popup: the script loads asynchronously on the
 * first click, and a popup opened after that would be caught by popup blockers).
 * The script is only rendered after the first click; next/script loads it once, and onReady runs on every open.
 */
export default function AddressSearch({
  query, emphasize, onPick,
}: {
  /** Pre-filled search text (the parsed addr1), so staff usually only click the right result */
  query: string;
  /** The parsed address has no road/lot number → highlight the button */
  emphasize: boolean;
  onPick: (pick: AddressPick) => void;
}) {
  const [open, setOpen] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  const embed = () => {
    const box = boxRef.current;
    if (!box || !window.daum) return;
    box.innerHTML = "";
    new window.daum.Postcode({
      width: "100%",
      height: "100%",
      oncomplete: (data) => {
        onPick({
          roadAddress: data.roadAddress || data.autoRoadAddress || data.jibunAddress,
          buildingName: data.buildingName,
          zonecode: data.zonecode,
        });
        setOpen(false);
      },
    }).embed(box, { q: query.trim(), autoClose: false });
  };

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => {
          setLoadError(false);
          setOpen((o) => !o);
        }}
        className={`rounded border px-2 py-1 text-xs font-medium ${
          emphasize
            ? "border-amber-400 bg-amber-100 text-amber-900 hover:bg-amber-200"
            : "border-gray-300 text-gray-700 hover:bg-gray-50"
        }`}
      >
        {open ? "주소 검색 닫기" : "주소 검색"}
      </button>
      {open && (
        <>
          <div ref={boxRef} className="h-[420px] w-full overflow-hidden rounded border border-gray-300" />
          <Script src={POSTCODE_SRC} onReady={embed} onError={() => setLoadError(true)} />
          {loadError && <p className="text-xs text-red-700">주소 검색을 불러오지 못했습니다. 인터넷 연결을 확인해 주세요.</p>}
        </>
      )}
    </div>
  );
}
