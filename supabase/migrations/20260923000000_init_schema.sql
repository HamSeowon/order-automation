-- Initial schema for the order semi-automation system (spec Section 4)
--
-- Access model: the browser never talks to Supabase directly; only the Next.js
-- server accesses the DB, using the secret (service_role) key. So both tables
-- have RLS enabled with no anon/authenticated policies (= unreachable with the
-- public key, for read or write). This keeps customer personal data (name/phone/address)
-- from ever being exposed through the public key.

-- ---------------------------------------------------------------------------
-- Trigger function that auto-updates updated_at
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- orders
-- ---------------------------------------------------------------------------
-- Text columns default to an empty string ('') instead of null.
-- Fields missing from the parsed result still need to be storable (so the card
-- screen can highlight what's missing), and this avoids extra null-handling
-- branches when assembling the Excel output.
create table public.orders (
  id           uuid primary key default gen_random_uuid(),
  source_room  text not null default '',  -- Source regional group chat
  name         text not null default '',  -- Customer name
  phone        text not null default '',  -- Normalized: 010-1234-5678
  addr1        text not null default '',  -- City/district/street number (up to the road-name address)
  addr2        text not null default '',  -- Rest of the address (building name/unit/floor)
  brand_raw    text not null default '',  -- Original brand text (e.g. AMAZING)
  brand_short  text not null default '',  -- Confirmed short form (same as brand_raw if unmatched)
  product_name text not null default '',
  color        text not null default '',
  size         text not null default '',  -- May be empty
  vendor       text not null default '',  -- Vendor/partner name
  note         text not null default '',  -- Notes
  created_by   text not null default '',  -- Who entered it
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table public.orders is 'Collected orders. Excel export: name/phone/address (addr1+addr2)/product name (brand_short-product_name-color[-size])';

-- Default sort and date filter for the list screen
create index orders_created_at_idx on public.orders (created_at desc);
-- Filter by source chat
create index orders_source_room_idx on public.orders (source_room);
-- Phone search + (phase 2) duplicate detection by same date + same phone
create index orders_phone_idx on public.orders (phone);

create trigger orders_set_updated_at
  before update on public.orders
  for each row execute function public.set_updated_at();

alter table public.orders enable row level security;

-- ---------------------------------------------------------------------------
-- brand_dictionary
-- ---------------------------------------------------------------------------
-- Multiple full names can map to the same short form (e.g. AMAZING, 어메이징 → AMZ).
-- full_name must be unique, ignoring case and surrounding whitespace.
create table public.brand_dictionary (
  id         uuid primary key default gen_random_uuid(),
  full_name  text not null check (btrim(full_name) <> ''),
  short_form text not null check (btrim(short_form) <> ''),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index brand_dictionary_full_name_key
  on public.brand_dictionary (lower(btrim(full_name)));

create trigger brand_dictionary_set_updated_at
  before update on public.brand_dictionary
  for each row execute function public.set_updated_at();

alter table public.brand_dictionary enable row level security;
