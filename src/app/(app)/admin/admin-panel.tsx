"use client";

import { useState } from "react";
import { changeAdminPin, changeMemberPin, logoutAllMembers, unlockLogin, type AdminResult } from "./actions";

export type AdminOverview = {
  memberPinUpdatedAt: string | null;
  adminPinUpdatedAt: string | null;
  memberSessions: number;
  adminSessions: number;
  /** locked: 서버에서 계산한 현재 잠김 여부 */
  attempts: { key: string; failed_count: number; locked_until: string | null; updated_at: string; locked: boolean }[];
};

const fmt = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

type Message = { kind: "ok" | "error"; text: string } | null;
const toMessage = (r: AdminResult): Message => (r.ok ? { kind: "ok", text: r.message } : { kind: "error", text: r.error });

function Feedback({ message }: { message: Message }) {
  if (!message) return null;
  return (
    <p role="status" className={`rounded px-3 py-2 text-sm ${message.kind === "ok" ? "bg-green-50 text-green-800" : "bg-red-50 text-red-800"}`}>
      {message.text}
    </p>
  );
}

function PinInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex flex-col text-xs text-gray-600">
      <span className="mb-1">{label}</span>
      <input
        type="password"
        inputMode="numeric"
        autoComplete="new-password"
        maxLength={6}
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, ""))}
        className="w-32 rounded border border-gray-300 px-2 py-1.5 font-mono text-base tracking-widest text-gray-900"
      />
    </label>
  );
}

const section = "space-y-3 rounded-lg border border-gray-200 bg-white p-4";
const primary = "rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-40";

export default function AdminPanel({ overview }: { overview: AdminOverview }) {
  return (
    <div className="space-y-6">
      <MemberPinSection overview={overview} />
      <LogoutAllSection count={overview.memberSessions} />
      <AdminPinSection updatedAt={overview.adminPinUpdatedAt} />
      <AttemptsSection attempts={overview.attempts} />
    </div>
  );
}

function MemberPinSection({ overview }: { overview: AdminOverview }) {
  const [pin, setPin] = useState("");
  const [confirm, setConfirm] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<Message>(null);

  const submit = async () => {
    if (!window.confirm("직원 공용 비밀번호를 바꾸면 직원 전원이 로그아웃됩니다. 계속할까요?")) return;
    setPending(true);
    const res = await changeMemberPin(pin, confirm);
    setPending(false);
    setMessage(toMessage(res));
    if (res.ok) {
      setPin("");
      setConfirm("");
    }
  };

  return (
    <section className={section}>
      <h2 className="font-semibold">직원 공용 비밀번호</h2>
      <p className="text-xs text-gray-600">
        {overview.memberPinUpdatedAt ? `마지막 변경: ${fmt.format(new Date(overview.memberPinUpdatedAt))}` : "아직 설정되지 않았습니다."}
        {" · "}현재 로그인한 직원 기기 {overview.memberSessions}개. 직원이 그만두면 여기서 바꾸세요 — 바꾸면 직원 전원이 로그아웃됩니다.
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <PinInput label="새 비밀번호" value={pin} onChange={setPin} />
        <PinInput label="한 번 더" value={confirm} onChange={setConfirm} />
        <button onClick={submit} disabled={pending || pin.length !== 6 || confirm.length !== 6} className={primary}>
          {pending ? "바꾸는 중…" : "바꾸기"}
        </button>
      </div>
      <Feedback message={message} />
    </section>
  );
}

function LogoutAllSection({ count }: { count: number }) {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<Message>(null);

  const submit = async () => {
    if (!window.confirm("직원 전원을 로그아웃시킬까요? (비밀번호는 그대로)")) return;
    setPending(true);
    setMessage(toMessage(await logoutAllMembers()));
    setPending(false);
  };

  return (
    <section className={section}>
      <h2 className="font-semibold">직원 전원 로그아웃</h2>
      <p className="text-xs text-gray-600">비밀번호는 그대로 두고, 로그인해 있는 직원 기기 {count}개를 모두 로그아웃시킵니다. (관리자는 유지)</p>
      <button onClick={submit} disabled={pending || count === 0} className="rounded border border-red-300 px-4 py-2 text-sm text-red-700 hover:bg-red-50 disabled:opacity-40">
        {pending ? "처리 중…" : "전원 로그아웃"}
      </button>
      <Feedback message={message} />
    </section>
  );
}

function AdminPinSection({ updatedAt }: { updatedAt: string | null }) {
  const [current, setCurrent] = useState("");
  const [pin, setPin] = useState("");
  const [confirm, setConfirm] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<Message>(null);

  const submit = async () => {
    setPending(true);
    const res = await changeAdminPin(current, pin, confirm);
    setPending(false);
    setMessage(toMessage(res));
    if (res.ok) {
      setCurrent("");
      setPin("");
      setConfirm("");
    }
  };

  return (
    <section className={section}>
      <h2 className="font-semibold">관리자 비밀번호</h2>
      <p className="text-xs text-gray-600">
        {updatedAt ? `마지막 변경: ${fmt.format(new Date(updatedAt))}. ` : ""}직원 공용 비밀번호와 같은 번호는 쓸 수 없습니다.
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <PinInput label="현재 비밀번호" value={current} onChange={setCurrent} />
        <PinInput label="새 비밀번호" value={pin} onChange={setPin} />
        <PinInput label="한 번 더" value={confirm} onChange={setConfirm} />
        <button
          onClick={submit}
          disabled={pending || current.length !== 6 || pin.length !== 6 || confirm.length !== 6}
          className={primary}
        >
          {pending ? "바꾸는 중…" : "바꾸기"}
        </button>
      </div>
      <Feedback message={message} />
    </section>
  );
}

function AttemptsSection({ attempts }: { attempts: AdminOverview["attempts"] }) {
  const [message, setMessage] = useState<Message>(null);
  const [pendingKey, setPendingKey] = useState<string | null>(null);

  const unlock = async (key: string) => {
    setPendingKey(key);
    setMessage(toMessage(await unlockLogin(key)));
    setPendingKey(null);
  };

  return (
    <section className={section}>
      <h2 className="font-semibold">로그인 실패 기록</h2>
      <p className="text-xs text-gray-600">같은 접속 위치(IP)에서 5번 연속 틀리면 15분 동안 잠깁니다. 직원이 잠겼다고 하면 여기서 풀 수 있습니다.</p>
      {attempts.length === 0 ? (
        <p className="text-sm text-gray-500">기록이 없습니다.</p>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-gray-600">
            <tr>
              <th className="py-1 font-medium">접속 위치</th>
              <th className="py-1 font-medium">연속 실패</th>
              <th className="py-1 font-medium">상태</th>
              <th className="py-1 font-medium">마지막 실패</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {attempts.map((a) => {
              const locked = a.locked;
              return (
                <tr key={a.key} className="border-t border-gray-100">
                  <td className="py-1.5 font-mono text-xs">{a.key.replace(/^ip:/, "")}</td>
                  <td className="py-1.5">{a.failed_count}회</td>
                  <td className="py-1.5">
                    {locked ? (
                      <span className="text-red-700">잠김 ({fmt.format(new Date(a.locked_until!))}까지)</span>
                    ) : (
                      <span className="text-gray-500">—</span>
                    )}
                  </td>
                  <td className="py-1.5 text-xs text-gray-600">{fmt.format(new Date(a.updated_at))}</td>
                  <td className="py-1.5 text-right">
                    <button
                      onClick={() => unlock(a.key)}
                      disabled={pendingKey === a.key}
                      className="rounded border border-gray-300 px-2.5 py-1 text-xs hover:bg-gray-50 disabled:opacity-40"
                    >
                      {locked ? "잠금 풀기" : "기록 지우기"}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <Feedback message={message} />
    </section>
  );
}
