-- 엑셀 송장 내보내기 (기획서 3.1-7, 4.3, 4.4)
-- - exports: 내보내기 1회 = 1행. 같은 날 번호(_2, _3 …)와 재다운로드에 사용
-- - orders.exported_at / export_id: 내보낸 주문 표시 → 아직 안 내보낸 주문만 다음 파일에 들어감

create table public.exports (
  id          uuid primary key default gen_random_uuid(),
  export_date date not null,                 -- 내보낸 날짜 (KST)
  seq         int  not null check (seq > 0), -- 그날 몇 번째 내보내기인지
  file_name   text not null check (btrim(file_name) <> ''),
  order_count int  not null default 0,
  exported_by text not null default '',
  exported_at timestamptz not null default now(),
  unique (export_date, seq)
);

comment on table public.exports is '엑셀 송장 내보내기 기록. orders.export_id 로 어떤 주문이 들어갔는지 연결';

alter table public.exports enable row level security;

alter table public.orders
  add column exported_at timestamptz,
  add column export_id   uuid references public.exports (id) on delete set null;

-- "아직 안 내보낸 주문" 조회용 (내보내기 대상 선점 + 목록 필터)
create index orders_not_exported_idx on public.orders (created_at) where exported_at is null;
create index orders_export_id_idx on public.orders (export_id);

-- ---------------------------------------------------------------------------
-- 내보내기 선점 함수
-- ---------------------------------------------------------------------------
-- 한 트랜잭션에서: 그날 번호 계산 → exports 행 생성 → 아직 안 내보낸 주문 전부에 exported_at/export_id 기록.
-- 동시에 두 명이 호출해도 advisory lock 으로 순서대로 처리되고, 두 번째 호출은 남은 주문만 가져간다.
-- 내보낼 주문이 없으면 'NO_ORDERS_TO_EXPORT' 예외 → 전체 롤백 (빈 exports 행이 남지 않음).
-- p_file_name 이 null 이면 기본 이름(YYYY-MM-DD.xlsx, 두 번째부터 YYYY-MM-DD_N.xlsx)을 쓴다.
create or replace function public.create_invoice_export(
  p_file_name   text,
  p_exported_by text
)
returns public.exports
language plpgsql
set search_path = ''
as $$
declare
  v_date   date := (now() at time zone 'Asia/Seoul')::date;
  v_seq    int;
  v_export public.exports;
  v_count  int;
begin
  -- 내보내기를 한 번에 하나씩만 처리 (번호 중복 방지 + 주문 선점 순서 보장)
  perform pg_advisory_xact_lock(hashtext('create_invoice_export'));

  select coalesce(max(seq), 0) + 1 into v_seq
  from public.exports
  where export_date = v_date;

  insert into public.exports (export_date, seq, file_name, exported_by)
  values (
    v_date,
    v_seq,
    coalesce(
      nullif(btrim(p_file_name), ''),
      to_char(v_date, 'YYYY-MM-DD') || case when v_seq > 1 then '_' || v_seq else '' end || '.xlsx'
    ),
    coalesce(p_exported_by, '')
  )
  returning * into v_export;

  update public.orders
  set exported_at = v_export.exported_at,
      export_id   = v_export.id
  where exported_at is null;
  get diagnostics v_count = row_count;

  if v_count = 0 then
    raise exception 'NO_ORDERS_TO_EXPORT';
  end if;

  update public.exports set order_count = v_count where id = v_export.id
  returning * into v_export;

  return v_export;
end;
$$;

-- 서버(service_role)만 호출 가능. Supabase 기본 권한으로 공개 키(anon)에서 호출되지 않도록 막는다.
revoke execute on function public.create_invoice_export(text, text) from public, anon, authenticated;
grant execute on function public.create_invoice_export(text, text) to service_role;

-- 다음 기본 파일 이름 미리보기용 (다운로드 전 이름 입력칸 기본값)
create or replace function public.next_invoice_export_seq()
returns int
language sql
stable
set search_path = ''
as $$
  select coalesce(max(seq), 0) + 1
  from public.exports
  where export_date = (now() at time zone 'Asia/Seoul')::date;
$$;

revoke execute on function public.next_invoice_export_seq() from public, anon, authenticated;
grant execute on function public.next_invoice_export_seq() to service_role;
