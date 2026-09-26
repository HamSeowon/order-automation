import type { Metadata } from "next";
import { connection } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { requireAdminPage } from "@/lib/auth";
import AdminPanel, { type AdminOverview } from "./admin-panel";

export const metadata: Metadata = { title: "관리 · 주문 반자동화" };

async function loadOverview(): Promise<AdminOverview> {
  const supabase = createServerSupabase();
  const now = new Date().toISOString();
  const [creds, members, admins, attempts] = await Promise.all([
    supabase.from("app_credentials").select("role, updated_at"),
    supabase.from("app_sessions").select("id", { count: "exact", head: true }).eq("role", "member").gt("expires_at", now),
    supabase.from("app_sessions").select("id", { count: "exact", head: true }).eq("role", "admin").gt("expires_at", now),
    supabase.from("login_attempts").select("*").order("updated_at", { ascending: false }).limit(50),
  ]);
  const error = creds.error ?? members.error ?? admins.error ?? attempts.error;
  if (error) throw new Error(error.message);
  const updated = Object.fromEntries((creds.data ?? []).map((c) => [c.role, c.updated_at]));
  return {
    memberPinUpdatedAt: updated.member ?? null,
    adminPinUpdatedAt: updated.admin ?? null,
    memberSessions: members.count ?? 0,
    adminSessions: admins.count ?? 0,
    attempts: (attempts.data ?? []).map((a) => ({ ...a, locked: !!a.locked_until && Date.parse(a.locked_until) > Date.parse(now) })),
  };
}

export default async function AdminPage() {
  await connection();
  await requireAdminPage();
  const overview = await loadOverview();

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-6">
      <h1 className="mb-1 text-xl font-bold">관리</h1>
      <p className="mb-6 text-sm text-gray-600">관리자만 볼 수 있는 화면입니다. 비밀번호는 모두 숫자 6자리입니다.</p>
      <AdminPanel overview={overview} />
    </main>
  );
}
