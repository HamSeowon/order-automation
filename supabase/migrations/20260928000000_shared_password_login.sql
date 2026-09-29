-- Login (spec 3.1-8, 4.5–4.7) — tables only for now. App code is implemented in Section 9 step 7.
--
-- Decided 2026-09-27: no per-person accounts. Every staff member logs in with one shared
-- password (6 digits); the admin (1 person) logs in with a separate admin password to change the
-- shared password and log everyone out.
-- The "entered by" field (orders.created_by) is still typed directly on the order-entry screen, as before
-- (existing records are unaffected).
--
-- - The password is hashed by the app (Node crypto.scrypt) and only the hash is stored in password_hash. Plaintext is never stored anywhere.
-- - Sessions are stored in the DB (a random token in the cookie, only its SHA-256 hash in the DB) → changing the shared password can immediately end staff sessions.
-- - Login-failure lockout has no per-person identity to key on, so it's keyed by client IP (login_attempts.key = 'ip:<address>').

-- ---------------------------------------------------------------------------
-- Passwords (1 shared + 1 admin)
-- ---------------------------------------------------------------------------
create table public.app_credentials (
  role          text primary key check (role in ('member', 'admin')),  -- member = shared staff, admin = administrator
  password_hash text not null,
  updated_at    timestamptz not null default now()
);

comment on table public.app_credentials is 'Login password hashes. One row each for member (shared staff) / admin. Initial setup via npm run set-password';

create trigger app_credentials_set_updated_at
  before update on public.app_credentials
  for each row execute function public.set_updated_at();

alter table public.app_credentials enable row level security;

-- ---------------------------------------------------------------------------
-- Login sessions (30 days)
-- ---------------------------------------------------------------------------
create table public.app_sessions (
  id           uuid primary key default gen_random_uuid(),
  role         text not null check (role in ('member', 'admin')),  -- Which password was used to log in
  token_hash   text not null unique,       -- SHA-256 (hex) of the cookie token. The raw token is never stored
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null,       -- Login time + 30 days
  last_seen_at timestamptz not null default now(),
  check (expires_at > created_at)
);

comment on table public.app_sessions is 'Login sessions (30 days). Deleting all member sessions on a shared-password change logs everyone out';

create index app_sessions_role_idx on public.app_sessions (role);
create index app_sessions_expires_at_idx on public.app_sessions (expires_at);

alter table public.app_sessions enable row level security;

-- ---------------------------------------------------------------------------
-- Login-failure lockout
-- ---------------------------------------------------------------------------
create table public.login_attempts (
  key          text primary key,           -- 'ip:<address>' (a schema change won't be needed if another key is added later)
  failed_count int not null default 0 check (failed_count >= 0),
  locked_until timestamptz,
  updated_at   timestamptz not null default now()
);

comment on table public.login_attempts is 'Login failure count / lockout (keyed by client IP). The row is deleted on a successful login';

alter table public.login_attempts enable row level security;

-- Atomically records one failure. Locks for p_lock_minutes once the limit is reached. Returns the unlock time (null if not locked)
-- Counting restarts from 1 when: the previous lock has expired / it wasn't locked and p_lock_minutes has passed since the last failure
-- Failures that occur while already locked do not extend the lock.
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
