-- 로컬 개발용 시드 (`npx supabase db reset` 시 실행). 운영 DB에는 적용되지 않음.
-- 브랜드 딕셔너리 초기 전체 목록은 미확정(기획서 8장) — 확정되면 여기에 추가.
insert into public.brand_dictionary (full_name, short_form) values
  ('AMAZING', 'AMZ'),
  ('어메이징', 'AMZ');
