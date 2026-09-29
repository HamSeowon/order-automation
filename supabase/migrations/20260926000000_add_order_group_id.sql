-- ID grouping multiple product orders that came from one message (one customer).
-- When a message has multiple products, one orders row is created per product, sharing the same order_group_id.
-- A single-product order also gets its own group ID (existing rows are backfilled with a new ID each, via the default).
alter table public.orders
  add column order_group_id uuid not null default gen_random_uuid();

create index orders_order_group_id_idx on public.orders (order_group_id);
