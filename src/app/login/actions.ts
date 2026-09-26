"use server";

import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { clientIp, createSession, destroyCurrentSession } from "@/lib/auth";
import { LOCK_MINUTES, MAX_LOGIN_ATTEMPTS, lockedMessage, loginAttemptKey, safeNextPath } from "@/lib/auth-utils";
import { loadCredentialHashes, matchRole } from "@/lib/credentials";
import { isValidPin } from "@/lib/password";

export type LoginState = { error: string | null };

const WRONG = "비밀번호가 맞지 않습니다.";

/** 로그인 (기획서 3.1-8). 같은 IP에서 5회 연속 실패하면 15분 잠금 */
export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const pin = String(formData.get("pin") ?? "").trim();
  const next = safeNextPath(formData.get("next"));
  const key = loginAttemptKey(await clientIp());
  const supabase = createServerSupabase();

  try {
    const { data: attempt } = await supabase.from("login_attempts").select("locked_until").eq("key", key).maybeSingle();
    if (attempt?.locked_until && new Date(attempt.locked_until) > new Date()) {
      return { error: lockedMessage(attempt.locked_until) };
    }

    const hashes = await loadCredentialHashes();
    if (!hashes.member && !hashes.admin) {
      return { error: "비밀번호가 아직 설정되지 않았습니다. 관리자에게 문의하세요." };
    }

    // 형식이 틀린 입력도 실패 1회로 센다
    const role = isValidPin(pin) ? await matchRole(pin, hashes) : null;
    if (!role) {
      const { data: lockedUntil, error } = await supabase.rpc("register_login_failure", {
        p_key: key,
        p_max_attempts: MAX_LOGIN_ATTEMPTS,
        p_lock_minutes: LOCK_MINUTES,
      });
      if (error) return { error: `로그인 확인 중 오류가 났습니다: ${error.message}` };
      return { error: lockedUntil ? lockedMessage(lockedUntil) : WRONG };
    }

    await supabase.from("login_attempts").delete().eq("key", key);
    await createSession(role);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "알 수 없는 오류" };
  }
  // redirect 는 예외로 동작하므로 try 밖에서
  redirect(next);
}

/** 로그아웃: 현재 세션 삭제 후 로그인 화면으로 */
export async function logout(): Promise<void> {
  await destroyCurrentSession();
  redirect("/login");
}
