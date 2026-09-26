-- 주문 반자동화 시스템 초기 스키마 (기획서 4장)
--
-- 접근 방식: 브라우저는 Supabase에 직접 접근하지 않고, Next.js 서버가
-- secret(service_role) 키로만 DB에 접근한다. 따라서 두 테이블 모두 RLS를
-- 켜고 anon/authenticated 용 정책은 만들지 않는다 (= 공개 키로는 읽기/쓰기 불가).
-- 고객 개인정보(이름/전화/주소)가 공개 키로 노출되지 않게 하기 위함.

-- ---------------------------------------------------------------------------
-- updated_at 자동 갱신 트리거 함수
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
-- 텍스트 컬럼은 null 대신 빈 문자열('')을 기본값으로 둔다.
-- 파싱 결과에서 누락된 항목도 일단 저장할 수 있어야 하고(카드 화면에서 누락 강조),
-- 엑셀 조합 시 null 처리 분기를 줄이기 위함.
create table public.orders (
  id           uuid primary key default gen_random_uuid(),
  source_room  text not null default '',  -- 출처 지역 단톡방
  name         text not null default '',  -- 고객 이름
  phone        text not null default '',  -- 정규화: 010-1234-5678
  addr1        text not null default '',  -- 시/구/번지 (도로명 주소까지)
  addr2        text not null default '',  -- 나머지 주소 (건물명/동/호수)
  brand_raw    text not null default '',  -- 브랜드 원문 (예: AMAZING)
  brand_short  text not null default '',  -- 확정된 약칭 (매칭 없으면 brand_raw와 동일)
  product_name text not null default '',
  color        text not null default '',
  size         text not null default '',  -- 없을 수 있음
  vendor       text not null default '',  -- 거래처명
  note         text not null default '',  -- 참고사항
  created_by   text not null default '',  -- 입력한 사람
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table public.orders is '취합된 주문. 엑셀 내보내기: 이름/전화번호/주소(addr1+addr2)/상품명(brand_short-product_name-color[-size])';

-- 목록 화면 기본 정렬 및 날짜 필터
create index orders_created_at_idx on public.orders (created_at desc);
-- 출처 방 필터
create index orders_source_room_idx on public.orders (source_room);
-- 전화번호 검색 + (2차) 같은 날짜·같은 전화번호 중복 감지
create index orders_phone_idx on public.orders (phone);

create trigger orders_set_updated_at
  before update on public.orders
  for each row execute function public.set_updated_at();

alter table public.orders enable row level security;

-- ---------------------------------------------------------------------------
-- brand_dictionary
-- ---------------------------------------------------------------------------
-- 하나의 약칭에 여러 전체 이름이 매핑될 수 있음 (예: AMAZING, 어메이징 → AMZ).
-- full_name은 대소문자·앞뒤 공백 무시하고 유일해야 함.
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
