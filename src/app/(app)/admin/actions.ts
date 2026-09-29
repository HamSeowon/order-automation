"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabase } from "@/lib/supabase/server";
import { authorize, getSession } from "@/lib/auth";
import { loadCredentialHashes, setCredential } from "@/lib/credentials";
import { verifyPassword } from "@/lib/password";

// Admin screen (spec 3.1-8, Section 7 item 5). Every function here requires an admin session.

export type AdminResult = { ok: true; message: string } | { ok: false; error: string };

const fail = (e: unknown): AdminResult => ({ ok: false, error: e instanceof Error ? e.message : "알 수 없는 오류" });

/** Change the shared staff password → logs out every staff member */
export async function changeMemberPin(pin: unknown, confirm: unknown): Promise<AdminResult> {
  const denied = await authorize("admin");
  if (denied) return { ok: false, error: denied };
  if (typeof pin !== "string" || pin !== confirm) return { ok: false, error: "두 번 입력한 비밀번호가 다릅니다." };
  try {
    const res = await setCredential("member", pin);
    if (!res.ok) return res;
    revalidatePath("/admin");
    return { ok: true, message: `직원 공용 비밀번호를 바꿨습니다. 기존 직원 로그인 ${res.endedSessions}개를 끊었습니다.` };
  } catch (e) {
    return fail(e);
  }
}

/** Change the admin password (verifies the current admin password). Keeps the caller's own admin login, ends other admin logins */
export async function changeAdminPin(current: unknown, pin: unknown, confirm: unknown): Promise<AdminResult> {
  const denied = await authorize("admin");
  if (denied) return { ok: false, error: denied };
  if (typeof current !== "string" || typeof pin !== "string") return { ok: false, error: "잘못된 요청입니다." };
  if (pin !== confirm) return { ok: false, error: "두 번 입력한 새 비밀번호가 다릅니다." };
  try {
    const { admin } = await loadCredentialHashes();
    if (!admin || !(await verifyPassword(current, admin))) return { ok: false, error: "현재 관리자 비밀번호가 맞지 않습니다." };
    const session = await getSession();
    const res = await setCredential("admin", pin, session?.id);
    if (!res.ok) return res;
    revalidatePath("/admin");
    return { ok: true, message: "관리자 비밀번호를 바꿨습니다." };
  } catch (e) {
    return fail(e);
  }
}

/** Keep the password as-is, just end every staff login */
export async function logoutAllMembers(): Promise<AdminResult> {
  const denied = await authorize("admin");
  if (denied) return { ok: false, error: denied };
  try {
    const { data, error } = await createServerSupabase().from("app_sessions").delete().eq("role", "member").select("id");
    if (error) return { ok: false, error: error.message };
    revalidatePath("/admin");
    return { ok: true, message: `직원 로그인 ${data?.length ?? 0}개를 끊었습니다.` };
  } catch (e) {
    return fail(e);
  }
}

/** Clear a login lockout/failure record */
export async function unlockLogin(key: unknown): Promise<AdminResult> {
  const denied = await authorize("admin");
  if (denied) return { ok: false, error: denied };
  if (typeof key !== "string" || !key.startsWith("ip:")) return { ok: false, error: "잘못된 요청입니다." };
  try {
    const { error } = await createServerSupabase().from("login_attempts").delete().eq("key", key);
    if (error) return { ok: false, error: error.message };
    revalidatePath("/admin");
    return { ok: true, message: "잠금을 풀었습니다." };
  } catch (e) {
    return fail(e);
  }
}
