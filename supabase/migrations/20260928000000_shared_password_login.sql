-- 로그인 (기획서 3.1-8, 4.5~4.7) — 테이블만 먼저 준비. 앱 코드는 9장 7단계에서 구현.
--
-- 2026-09-27 결정: 사람별 계정 없음. 직원 전원이 공용 비밀번호(숫자 6자리) 하나로 로그인하고,
-- 관리자(1명)는 별도 관리자 비밀번호로 로그인해 공용 비밀번호 변경·전원 로그아웃을 한다.
-- 입력자(orders.created_by)는 지금처럼 주문 입력 화면에서 직접 적는다 (기존 기록도 그대로).
--
-- - 비밀번호는 앱(Node crypto.scrypt)에서 해시해서 password_hash 에만 저장. 평문은 어디에도 저장하지 않는다.
-- - 세션은 DB에 저장 (쿠키에는 무작위 토큰, DB에는 그 SHA-256 해시만) → 공용 비밀번호를 바꾸면 직원 세션을 즉시 끊을 수 있음.
-- - 로그인 실패 잠금은 이름이 없으므로 접속 IP 기준 (login_attempts.key = 'ip:<주소>').

-- ---------------------------------------------------------------------------
-- 비밀번호 (공용 1개 + 관리자 1개)
-- ---------------------------------------------------------------------------
create table public.app_credentials (
  role          text primary key check (role in ('member', 'admin')),  -- member = 직원 공용, admin = 관리자
  password_hash text not null,
  updated_at    timestamptz not null default now()
);

comment on table public.app_credentials is '로그인 비밀번호 해시. member(직원 공용) / admin(관리자) 각 1행. 첫 설정은 npm run set-password';

create trigger app_credentials_set_updated_at
  before update on public.app_credentials
  for each row execute function public.set_updated_at();

alter table public.app_credentials enable row level security;

-- ---------------------------------------------------------------------------
-- 로그인 세션 (30일)
-- ---------------------------------------------------------------------------
create table public.app_sessions (
  id           uuid primary key default gen_random_uuid(),
  role         text not null check (role in ('member', 'admin')),  -- 어떤 비밀번호로 로그인했는지
  token_hash   text not null unique,       -- 쿠키 토큰의 SHA-256 (hex). 원본 토큰은 저장하지 않음
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null,       -- 로그인 시각 + 30일
  last_seen_at timestamptz not null default now(),
  check (expires_at > created_at)
);

comment on table public.app_sessions is '로그인 세션 (30일). 공용 비밀번호 변경 시 member 세션 전체 삭제 = 전원 로그아웃';

create index app_sessions_role_idx on public.app_sessions (role);
create index app_sessions_expires_at_idx on public.app_sessions (expires_at);

alter table public.app_sessions enable row level security;

-- ---------------------------------------------------------------------------
-- 로그인 실패 잠금
-- ---------------------------------------------------------------------------
create table public.login_attempts (
  key          text primary key,           -- 'ip:<주소>' (나중에 다른 기준을 더해도 스키마 변경 불필요)
  failed_count int not null default 0 check (failed_count >= 0),
  locked_until timestamptz,
  updated_at   timestamptz not null default now()
);

comment on table public.login_attempts is '로그인 실패 횟수/잠금 (접속 IP 기준). 로그인 성공 시 해당 행 삭제';

alter table public.login_attempts enable row level security;

-- 실패 1회 기록 (원자적). 한도에 닿으면 p_lock_minutes 동안 잠금. 반환값: 잠금 해제 시각 (잠기지 않았으면 null)
-- 횟수를 1부터 다시 세는 경우: 지난 잠금이 풀린 뒤 / 잠기지 않은 상태에서 마지막 실패 후 p_lock_minutes 가 지난 뒤
-- 이미 잠긴 동안의 실패는 잠금을 연장하지 않는다.
create or replace function public.register_login_failure(
  p_key          text,
  p_max_attempts int,
  p_lock_minutes int
)
returns timestamptz
language plpgsql
set search_path = ''
as $$
declare
  v_row public.login_attempts;
begin
  insert into public.login_attempts as a (key, failed_count, locked_until, updated_at)
  values (
    p_key,
    1,
    case when 1 >= p_max_attempts then now() + make_interval(mins => p_lock_minutes) end,
    now()
  )
  on conflict (key) do update
  set failed_count = case
        when a.locked_until > now() then a.failed_count
        when a.locked_until is not null
          or a.updated_at < now() - make_interval(mins => p_lock_minutes) then 1
        else a.failed_count + 1
      end,
      locked_until = case
        when a.locked_until > now() then a.locked_until
        when (case
                when a.locked_until is not null
                  or a.updated_at < now() - make_interval(mins => p_lock_minutes) then 1
                else a.failed_count + 1
              end) >= p_max_attempts
          then now() + make_interval(mins => p_lock_minutes)
        else null
      end,
      updated_at = now()
  returning * into v_row;

  return v_row.locked_until;
end;
$$;

revoke execute on function public.register_login_failure(text, int, int) from public, anon, authenticated;
grant execute on function public.register_login_failure(text, int, int) to service_role;
