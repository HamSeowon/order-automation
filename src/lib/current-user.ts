"use client";

import { useSyncExternalStore } from "react";

// 입력자(현재 사용자) 이름은 브라우저별로 기억 (편의 기능). 저장소 접근이 막혀 있어도 동작해야 함.
// 로그인 기능이 생기면(9장 7번) 그쪽 정보로 대체.
const KEY = "order-entry:created_by";
const EVENT = "order-entry:created_by-change";

function read(): string {
  try { return localStorage.getItem(KEY) ?? ""; } catch { return ""; }
}

export function setCurrentUserName(v: string) {
  try { localStorage.setItem(KEY, v); } catch {}
  window.dispatchEvent(new Event(EVENT));
}

function subscribe(onChange: () => void) {
  window.addEventListener(EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

export function useCurrentUserName(): string {
  return useSyncExternalStore(subscribe, read, () => "");
}
