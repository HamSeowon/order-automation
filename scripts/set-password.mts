// 로그인 비밀번호 설정 (기획서 4.5): 직원 공용(member) / 관리자(admin)
//
//   npm run set-password            → 어떤 비밀번호를 바꿀지 물어봄
//   npm run set-password -- member  → 직원 공용 비밀번호
//   npm run set-password -- admin   → 관리자 비밀번호
//
// 비밀번호는 화면에 보이지 않게 두 번 입력받는다 (명령 인자로 받지 않음 — 셸 기록에 남지 않도록).
// 바꾼 쪽의 기존 로그인 세션은 모두 끊는다 (공용 비밀번호를 바꾸면 직원 전원 로그아웃).

import { createInterface } from "node:readline";
import { createClient } from "@supabase/supabase-js";
import { hashPassword, isValidPin, verifyPassword } from "../src/lib/password.ts";

type Role = "member" | "admin";
const LABEL: Record<Role, string> = { member: "직원 공용 비밀번호", admin: "관리자 비밀번호" };

function fail(message: string): never {
  console.error(`\n✖ ${message}`);
  process.exit(1);
}

/** 한 줄 입력. hidden 이면 입력한 글자를 화면에 표시하지 않는다 */
function ask(question: string, hidden = false): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) {
      const out = rl as unknown as { _writeToOutput: (s: string) => void; output: NodeJS.WriteStream };
      out._writeToOutput = (s: string) => {
        // 질문 문구는 보여주고, 그 뒤 입력 글자는 숨김
        if (s.startsWith(question)) out.output.write(question);
        else if (s.includes("\n") || s.includes("\r")) out.output.write("\n");
      };
    }
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

async function main() {
  if (!process.stdin.isTTY) {
    fail("비밀번호를 숨겨서 입력받아야 해서, 직접 연 터미널(PowerShell 등)에서 실행해 주세요.");
  }
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) fail("SUPABASE_URL / SUPABASE_SECRET_KEY 가 없습니다 (.env.local 확인).");

  let role = process.argv[2] as Role | undefined;
  if (role && role !== "member" && role !== "admin") fail(`알 수 없는 종류: ${role} (member 또는 admin)`);
  if (!role) {
    const pick = (await ask("어떤 비밀번호를 설정할까요? 1) 직원 공용  2) 관리자  [1/2]: ")).trim();
    if (pick === "1") role = "member";
    else if (pick === "2") role = "admin";
    else fail("1 또는 2 를 입력해 주세요.");
  }

  const pin = await ask(`${LABEL[role]} (숫자 6자리): `, true);
  if (!isValidPin(pin)) fail("비밀번호는 숫자 6자리여야 합니다.");
  const again = await ask("한 번 더 입력: ", true);
  if (pin !== again) fail("두 번 입력한 비밀번호가 다릅니다.");

  const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  // 공용과 관리자 비밀번호가 같으면 직원이 관리자로 로그인되므로 거부
  const other: Role = role === "member" ? "admin" : "member";
  const { data: otherRow, error: loadError } = await supabase
    .from("app_credentials")
    .select("password_hash")
    .eq("role", other)
    .maybeSingle();
  if (loadError) fail(`확인 실패: ${loadError.message}`);
  if (otherRow && (await verifyPassword(pin, otherRow.password_hash))) {
    fail(`${LABEL[other]}와 같은 번호는 쓸 수 없습니다.`);
  }

  const { error } = await supabase
    .from("app_credentials")
    .upsert({ role, password_hash: await hashPassword(pin) }, { onConflict: "role" });
  if (error) fail(`저장 실패: ${error.message}`);

  const { data: ended, error: sessionError } = await supabase.from("app_sessions").delete().eq("role", role).select("id");
  if (sessionError) fail(`비밀번호는 바뀌었지만 기존 로그인 끊기에 실패했습니다: ${sessionError.message}`);

  console.log(`\n✔ ${LABEL[role]}를 설정했습니다.${ended?.length ? ` 기존 로그인 ${ended.length}개를 끊었습니다.` : ""}`);
}

main().catch((e) => fail(e instanceof Error ? e.message : String(e)));
