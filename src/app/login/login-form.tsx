"use client";

import { useActionState } from "react";
import { login, type LoginState } from "./actions";

export default function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(login, { error: null });

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="next" value={next} />
      <input
        name="pin"
        type="password"
        inputMode="numeric"
        autoComplete="current-password"
        pattern="\d{6}"
        maxLength={6}
        required
        autoFocus
        aria-label="비밀번호"
        placeholder="••••••"
        className="w-full rounded border border-gray-300 px-3 py-2 text-center font-mono text-2xl tracking-[0.5em]"
      />
      {state.error && (
        <p role="alert" className="rounded bg-red-50 px-3 py-2 text-sm text-red-800">
          {state.error}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700 disabled:opacity-40"
      >
        {pending ? "확인 중…" : "로그인"}
      </button>
    </form>
  );
}
