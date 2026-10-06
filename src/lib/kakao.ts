// Pasted KakaoTalk text → individual chat messages, with non-order messages set aside (pure functions).
// Accepts both a plain copy from the app (no headers — passed through as one message) and an exported chat
// ("대화 내보내기" .txt in English or Korean, PC export/copy). Message boundaries are later used as order-boundary hints.

import { findPhones } from "@/lib/parser";

export type KakaoMessage = { sender: string; time: string; text: string };
export type ExcludedMessage = KakaoMessage & { reason: ExcludeReason };
export type KakaoPaste = {
  messages: KakaoMessage[];
  excluded: ExcludedMessage[];
  /** true when chat headers were found (the text was split into messages) */
  structured: boolean;
};

export type ExcludeReason =
  | "시스템 메시지"
  | "사진·이모티콘·파일"
  | "송장번호(교환·배송 안내)"
  | "안내(교환·품절·취소 등)"
  | "구분선·짧은 답장"
  | "합배 요청 (카드에 합치기 제안으로 표시)";

type Header = { time: string; sender: string; text: string };

// Each pattern captures (1) time, (2) sender — absent on system lines — and (3) the first line of the message
const HEADERS: RegExp[] = [
  // English export: "Sep 21, 2026 at 1:32 AM, 보낸사람 : 내용" / system: "Sep 21, 2026 at 12:42 AM: X invited Y ."
  /^([A-Z][a-z]{2} \d{1,2}, \d{4} at \d{1,2}:\d{2} [AP]M)(?:, (.+?) : |: )(.*)$/,
  // Korean mobile export: "2026년 9월 21일 오전 1:32, 홍길동 : 내용" (Android) / "2026. 9. 21. 오전 1:32, 홍길동 : 내용" (iOS)
  // System lines have no " : " ("2026년 9월 21일 오전 1:32, 홍길동님이 들어왔습니다.")
  /^(\d{4}(?:년 \d{1,2}월 \d{1,2}일|\. \d{1,2}\. \d{1,2}\.) (?:오전|오후) \d{1,2}:\d{2})(?:, (.+?) : |: |, )(.*)$/,
];
// PC export / multi-message copy: "[홍길동] [오후 1:32] 내용" — sender comes first
const PC_HEADER = /^\[([^\]]+)\] \[((?:오전|오후|AM|PM) \d{1,2}:\d{2}|\d{1,2}:\d{2} (?:AM|PM))\] (.*)$/;

// Lines that belong to no message: date separators and the export file's title lines
const SKIP_LINES: RegExp[] = [
  /^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday), [A-Z][a-z]+ \d{1,2}, \d{4}$/,
  /^-*\s*\d{4}년 \d{1,2}월 \d{1,2}일 [월화수목금토일]요일\s*-*$/,
  /^Date Saved\s*:/,
  /^저장한 날짜\s*:/,
  /^Talk_.*\.txt$/,
  /^.+ 님과 카카오톡 대화$/,
];

// A deleted message shows up as a header-less line glued to the previous message
const DELETED_LINE = /^(The message has been deleted\.|삭제된 메시지입니다\.)$/;

const MEDIA_RE =
  /^(Photo|\d+ photos|Emoticons?|Video|\d+ videos|Voice message|File: .+|사진|사진 \d+장|이모티콘|동영상|음성메시지|파일: .+)$/i;
const SYSTEM_RE = /\b(invited|joined|left)\b|님이 (들어왔습니다|나갔습니다|초대했습니다)|님을 초대했습니다/;
// Logen waybill number — messages carrying one are exchange/shipping notices, not new orders
const WAYBILL_RE = /(^|[^\d])452-\d{4}-\d{4}(?!\d)/;
const NOTICE_RE = /교환|품절|누락|마감|예약|리오더|취소|반품/;
const HAPBAE_RE = /합배|같이\s*보내/;
const FILLER_RE = /^([\sㅡ\-=~_.·*]+|넵|네|넹|예|ㅇㅋ|ㅇㅇ|확인|감사합니다)$/;

function matchHeader(line: string): Header | null {
  for (const re of HEADERS) {
    const m = re.exec(line);
    if (m) return { time: m[1], sender: m[2] ?? "", text: m[3] };
  }
  const pc = PC_HEADER.exec(line);
  return pc ? { sender: pc[1], time: pc[2], text: pc[3] } : null;
}

/** Why this message is not an order (null = keep it). A message with a phone number is never treated as a notice */
export function excludeReason(m: KakaoMessage): ExcludeReason | null {
  const text = m.text;
  if (!m.sender && SYSTEM_RE.test(text)) return "시스템 메시지";
  if (MEDIA_RE.test(text)) return "사진·이모티콘·파일";
  if (WAYBILL_RE.test(text)) return "송장번호(교환·배송 안내)";
  // …unless it asks for combined shipping ("합배") — those are merged with an order later
  if (findPhones(text).length === 0 && NOTICE_RE.test(text) && !HAPBAE_RE.test(text)) return "안내(교환·품절·취소 등)";
  if (FILLER_RE.test(text)) return "구분선·짧은 답장";
  return null;
}

const clean = (text: string) =>
  text.replace(/^﻿/, "").replace(/\r\n?/g, "\n").replace(/[  ]/g, " ");

const joinLines = (lines: string[]) =>
  lines
    .filter((l) => !DELETED_LINE.test(l.trim()))
    .map((l) => l.trimEnd())
    .join("\n")
    .trim();

export function splitKakaoPaste(input: string): KakaoPaste {
  const lines = clean(input).split("\n");
  if (!lines.some((l) => matchHeader(l))) {
    const text = joinLines(lines);
    return { structured: false, messages: text ? [{ sender: "", time: "", text }] : [], excluded: [] };
  }

  const raw: { sender: string; time: string; lines: string[] }[] = [];
  // Lines before the first header (e.g. the tail of a message cut off by a partial copy) still form a message
  let cur: (typeof raw)[number] = { sender: "", time: "", lines: [] };
  raw.push(cur);
  for (const line of lines) {
    const h = matchHeader(line);
    if (h) {
      cur = { sender: h.sender, time: h.time, lines: [h.text] };
      raw.push(cur);
    } else if (!SKIP_LINES.some((re) => re.test(line.trim()))) {
      cur.lines.push(line);
    }
  }

  const messages: KakaoMessage[] = [];
  const excluded: ExcludedMessage[] = [];
  for (const r of raw) {
    const m = { sender: r.sender, time: r.time, text: joinLines(r.lines) };
    if (!m.text) continue;
    const reason = excludeReason(m);
    if (reason) excluded.push({ ...m, reason });
    else messages.push(m);
  }
  return { structured: true, messages, excluded };
}
