-- Excel shipping-label export (spec 3.1-7, 4.3, 4.4)
-- - exports: one export = one row. Used for same-day numbering (_2, _3, …) and re-downloads
-- - orders.exported_at / export_id: marks exported orders → only not-yet-exported orders go into the next file

create table public.exports (
  id          uuid primary key default gen_random_uuid(),
  export_date date not null,                 -- Export date (KST)
  seq         int  not null check (seq > 0), -- Which export of the day this is
  file_name   text not null check (btrim(file_name) <> ''),
  order_count int  not null default 0,
  exported_by text not null default '',
  exported_at timestamptz not null default now(),
  unique (export_date, seq)
);

comment on table public.exports is 'Excel shipping-label export history. orders.export_id links back to which orders went into it';

alter table public.exports enable row level security;

alter table public.orders
  add column exported_at timestamptz,
  add column export_id   uuid references public.exports (id) on delete set null;

-- For querying "not yet exported" orders (claiming export targets + list filter)
create index orders_not_exported_idx on public.orders (created_at) where exported_at is null;
create index orders_export_id_idx on public.orders (export_id);

-- ---------------------------------------------------------------------------
-- Export-claiming function
-- ---------------------------------------------------------------------------
-- In one transaction: compute the day's sequence number → create the exports row → stamp exported_at/export_id
-- on every not-yet-exported order.
-- If two people call this at the same time, an advisory lock serializes them, and the second call only picks up
-- whatever orders are left.
-- Raises the 'NO_ORDERS_TO_EXPORT' exception (rolling back entirely, leaving no orphaned exports row) if there's
-- nothing to export.
-- If p_file_name is null, uses the default name (YYYY-MM-DD.xlsx, YYYY-MM-DD_N.xlsx from the second export onward).
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
  -- Process exports one at a time (prevents duplicate sequence numbers and guarantees claim order)
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

-- Callable by the server (service_role) only. Blocked from the public key (anon) via Supabase's default privileges.
revoke execute on function public.create_invoice_export(text, text) from public, anon, authenticated;
grant execute on function public.create_invoice_export(text, text) to service_role;

-- For previewing the next default file name (default value of the file-name field before downloading)
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
