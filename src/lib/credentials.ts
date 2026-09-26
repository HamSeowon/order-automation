import "server-only";
import { createServerSupabase } from "@/lib/supabase/server";
import type { AppRole } from "@/lib/database.types";
import { hashPassword, isValidPin, verifyPassword } from "@/lib/password";

// 직원 공용 / 관리자 비밀번호 (기획서 4.5). 해시 비교와 변경은 모두 여기서.

type Hashes = Partial<Record<AppRole, string>>;

export async function loadCredentialHashes(): Promise<Hashes> {
  const { data, error } = await createServerSupabase().from("app_credentials").select("role, password_hash");
  if (error) throw new Error(error.message);
  return Object.fromEntries((data ?? []).map((r) => [r.role, r.password_hash]));
}

/**
 * 입력한 비밀번호가 어느 쪽인지. 관리자 비밀번호가 우선.
 * 어느 쪽이 맞았는지 응답 시간으로 드러나지 않게 설정된 해시는 항상 둘 다 비교한다.
 */
export async function matchRole(pin: string, hashes: Hashes): Promise<AppRole | null> {
  const [admin, member] = await Promise.all([
    hashes.admin ? verifyPassword(pin, hashes.admin) : Promise.resolve(false),
    hashes.member ? verifyPassword(pin, hashes.member) : Promise.resolve(false),
  ]);
  return admin ? "admin" : member ? "member" : null;
}

const OTHER: Record<AppRole, AppRole> = { member: "admin", admin: "member" };
const LABEL: Record<AppRole, string> = { member: "직원 공용 비밀번호", admin: "관리자 비밀번호" };

/**
 * 비밀번호 변경. 성공하면 그 종류의 기존 로그인을 모두 끊는다 (keepSessionId 는 유지 — 관리자 본인).
 * 공용과 관리자 비밀번호가 같으면 직원이 관리자로 로그인되므로 거부한다.
 */
export async function setCredential(
  role: AppRole,
  pin: string,
  keepSessionId?: string,
): Promise<{ ok: true; endedSessions: number } | { ok: false; error: string }> {
  if (!isValidPin(pin)) return { ok: false, error: "비밀번호는 숫자 6자리여야 합니다." };
  const hashes = await loadCredentialHashes();
  const other = hashes[OTHER[role]];
  if (other && (await verifyPassword(pin, other))) {
    return { ok: false, error: `${LABEL[OTHER[role]]}와 같은 번호는 쓸 수 없습니다.` };
  }

  const supabase = createServerSupabase();
  const { error } = await supabase
    .from("app_credentials")
    .upsert({ role, password_hash: await hashPassword(pin) }, { onConflict: "role" });
  if (error) return { ok: false, error: `저장 실패: ${error.message}` };

  let query = supabase.from("app_sessions").delete().eq("role", role);
  if (keepSessionId) query = query.neq("id", keepSessionId);
  const { data: ended, error: sessionError } = await query.select("id");
  if (sessionError) return { ok: false, error: `비밀번호는 바뀌었지만 기존 로그인 끊기에 실패했습니다: ${sessionError.message}` };
  return { ok: true, endedSessions: ended?.length ?? 0 };
}
