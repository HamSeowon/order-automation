@AGENTS.md

# Order Semi-Automation System

- Spec: `order-automation-spec.md` (implementation order is in Section 9)
- Stack: Next.js (App Router, `src/`) + Supabase Postgres + Tailwind
- For DB schema changes, add a new migration file under `supabase/migrations/` and update `src/lib/database.types.ts` at the same time
- DB access happens only on the server, via `createServerSupabase()` (`src/lib/supabase/server.ts`). Tables have RLS on with no anon policies → never call Supabase directly from the browser (protects customer personal data)
- The parser (`src/lib/parser.ts`) and product suggestions (`src/lib/product.ts`) are pure functions. Raw text → card draft conversion is `draftsFromText` (`src/lib/orders.ts`). When fixing a parsing edge case, first add the real raw-text example to `src/lib/parser.test.ts` / `src/lib/orders.test.ts`
- Excel shipping labels: Logen template conversion is in `src/lib/invoice.ts` (pure); file generation is in `src/lib/invoice-xlsx.ts`. `xlsx` (SheetJS) is installed from the official CDN tarball (0.20.3), not the npm registry version (0.18.5, which has a security advisory) — update it from `https://cdn.sheetjs.com/` as well
- Claiming orders for a label export happens only in the DB function `create_invoice_export` (prevents duplicates from concurrent exports). Calling this function as a test against the real DB marks every real unexported order as "exported", so verify it with PGlite instead
- Login (shared password + admin password): `src/proxy.ts` is only a first-line block that checks whether the cookie exists. The real check is in `src/lib/auth.ts` — **every new page must call `requirePageSession()` (admin screens: `requireAdminPage()`), and every new Server Action / Route Handler must call `authorize()` at the very start**. A check in the layout alone does not protect anything (layouts don't re-run on client-side navigation). Screens that require login go under `src/app/(app)/`
- First-time password setup / reset: `npm run set-password -- member|admin` (only in a terminal you opened yourself — input is hidden)
- Verify: `npm test && npm run typecheck && npm run lint && npm run build`