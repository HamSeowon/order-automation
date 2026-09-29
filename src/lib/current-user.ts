"use client";

import { useSyncExternalStore } from "react";

// The "entered by" (current user) name is remembered per browser, as a convenience. Must keep working even if storage access is blocked.
// Superseded once login carries this information (Section 9, step 7).
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
