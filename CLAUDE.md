@AGENTS.md

# 주문 반자동화 시스템

- 기획서: `order-automation-spec.md` (구현 순서는 9장)
- 스택: Next.js (App Router, `src/`) + Supabase Postgres + Tailwind
- DB 스키마 변경은 `supabase/migrations/` 에 새 마이그레이션 파일로 추가하고, `src/lib/database.types.ts` 도 함께 갱신
- DB 접근은 서버에서만 `createServerSupabase()` (`src/lib/supabase/server.ts`) 로 한다. 테이블은 RLS on + anon 정책 없음 → 브라우저에서 Supabase 직접 호출 금지 (고객 개인정보 보호)
- 파서(`src/lib/parser.ts`)·상품 제안(`src/lib/product.ts`)은 순수 함수. 원문 → 카드 초안 변환은 `draftsFromText` (`src/lib/orders.ts`). 파싱 예외 케이스를 고칠 때는 `src/lib/parser.test.ts` / `src/lib/orders.test.ts` 에 실제 원문 예시를 먼저 추가
- 엑셀 송장: 로젠 양식 변환은 `src/lib/invoice.ts`(순수), 파일 생성은 `src/lib/invoice-xlsx.ts`. `xlsx`(SheetJS)는 npm 레지스트리판(0.18.5, 보안 권고 있음)이 아니라 공식 CDN tarball(0.20.3)로 설치되어 있음 — 업데이트도 `https://cdn.sheetjs.com/` 에서
- 송장 내보내기 선점은 DB 함수 `create_invoice_export` 한 곳에서만 (동시 내보내기 중복 방지). 실제 DB에서 이 함수를 테스트로 호출하면 실제 미내보냄 주문이 전부 "내보냄" 처리되므로 PGlite 로 검증할 것
- 로그인(공용 비밀번호 + 관리자 비밀번호): `src/proxy.ts` 는 쿠키 유무만 보는 1차 차단일 뿐. 실제 확인은 `src/lib/auth.ts` — **새 page 는 `requirePageSession()`(관리자 화면은 `requireAdminPage()`), 새 Server Action / Route Handler 는 맨 앞에서 `authorize()`** 를 반드시 호출. layout 에서의 확인만으로는 막히지 않음(화면 이동 시 layout 은 다시 실행되지 않음). 로그인이 필요한 화면은 `src/app/(app)/` 아래에 둔다
- 비밀번호 첫 설정/재설정: `npm run set-password -- member|admin` (직접 연 터미널에서만 — 숨김 입력)
- 검증: `npm test && npm run typecheck && npm run lint && npm run build`
