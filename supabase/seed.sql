-- Local development seed (runs on `npx supabase db reset`). Never applied to production.
-- The full initial brand-dictionary list isn't finalized yet (spec Section 8) — add entries here once it is.
insert into public.brand_dictionary (full_name, short_form) values
  ('AMAZING', 'AMZ'),
  ('어메이징', 'AMZ');
