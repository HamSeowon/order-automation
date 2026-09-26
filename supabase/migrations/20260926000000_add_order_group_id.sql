-- 한 메시지(한 고객)에서 나온 여러 상품 주문을 묶는 ID.
-- 메시지 하나에 상품이 여러 개면 상품마다 orders 행을 만들고 같은 order_group_id 를 준다.
-- 상품 1개짜리 주문도 자기만의 그룹 ID를 가진다 (기존 행은 default 로 각자 새 ID가 채워짐).
alter table public.orders
  add column order_group_id uuid not null default gen_random_uuid();

create index orders_order_group_id_idx on public.orders (order_group_id);
