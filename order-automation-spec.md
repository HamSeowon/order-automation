# **Order Semi-Automation System — Planning Document**

This is the planning document for Claude Code to reference when starting implementation. 
   Background: we are semi-automating the order-handling process of my father's wholesale/retail business.
   Note: the app's UI is in Korean. Korean strings in this document (UI labels, button names, message labels, file names) are literal values and must be kept as-is.

---

## **1. Background and Problem Definition**

* My father receives orders separately from **10–20 regional merchant KakaoTalk group chats**.
* He manually collects the orders from each chat and posts a cleaned-up version to **a single group chat that the staff read**.
* The organized orders are ultimately managed in an **Excel file** (an existing fixed template).
* Product names often arrive as photos, so a person has to type them in manually. By convention, brand names are written in a shortened form (e.g. `Apple` → `AP`).
* Right now this entire process is manual, so it takes a long time and carries a risk of typos and missed orders.
**What this project solves**: **semi-automation**, not full automation. A person still does the final check, but repetitive typing and re-organizing work is reduced.

---

## **2. Requirements (confirmed)**

| Item | Details |
| ----- | ----- |
| Number of users | Up to 5 (my father + staff) |
| Concurrent use | Required — several people must be able to enter orders from different chats at the same time |
| Expected order volume | Not yet confirmed (orders come in steadily every day; scale will be learned during operation) |
| Existing Excel template | Fixed: 4 columns — **Name / Phone number / Address / Product name**. Product name is a `Brand-ProductName-Color-Size` combination |
| When product name is missing | A person looks at the photo and types it in |
| Brand notation | Shortened forms (managed in a dictionary, e.g. AMAZING → AMZ) |
| Personal data retention policy | No restrictions (no retention-period logic needed) |
| Deployment | Website (not a local tool; multiple people log in and use it) |

### **Technical constraints driven by the requirements**

* **Because concurrent use is required, browser local storage (localStorage) cannot be used** — a server + database architecture is mandatory.
* With only 5 users, sign-up and per-person accounts would be over-engineering. **Log in with a shared staff password + an admin password** (3.1-8, confirmed 2026-09-27).
* Since there are no restrictions on personal data retention, auto-deletion/expiry logic is out of scope.

---

## **3. Feature Scope**

### **3.1 MVP (first implementation scope)**

1. **Paste order text → automatic splitting (parsing)**
   * Paste raw text copied from a KakaoTalk group chat, and it is automatically split into individual orders
   * Handle both labeled formats (e.g. `➡️ 성함 ;`) and unlabeled formats (see the parsing logic in Section 5)
2. **Source chat indicator**
   * Select/record which regional group chat the order came from (`source_room` field)
   * **Changed 2026-10-06**: orders are now pasted from one combined chat, and the source is the tag on the last line of each order (→ `vendor`). The "출처 방" input was removed; new orders store `source_room` as an empty string (legacy column kept for existing data)
3. **Per-field review and edit screen**
   * Show parsing results as cards; a person reviews and can edit them
   * Visually flag missing required fields (name / phone / address)
4. **Apply brand dictionary**
   * Automatically replace full brand name → short form (if there is no match, keep the original text and flag it; a person adds it to the dictionary or edits it manually)
   * Dictionary CRUD (create/read/update/delete) management screen
5. **Order list that supports concurrent use**
   * Even when 5 people enter orders simultaneously, everyone's work lands in a single list without conflicts
6. **View, edit, and delete orders in the list**
   * Products, addresses, etc. can be freely edited even after saving (requirement: "make it easy to edit order items and addresses later")
7. **Export Excel shipping labels** (requirement added 2026-09-26, implemented in Section 9 step 6)
   * Clicking the **"엑셀 송장 내보내기" (Export Excel shipping labels) button on the order list screen** downloads a new `.xlsx` file (separate from the "전체 저장" (Save all — DB save) button on the order entry cards — decided 2026-09-26)
   * Default file name is today's date (KST), e.g. `2026-09-26.xlsx`; the name can be changed before downloading
   * From the second export on the same day, a number is appended: `2026-09-26_2.xlsx`, `_3`, …
   * **Only orders that have not been exported yet** go into the file; exported orders get their export time recorded in the DB to prevent duplicate exports
   * Column layout matches the existing Logen shipping template (`로젠(파일접수).xlsx`) exactly (see 4.3)
   * Even if two people click at the same time, the same order must not end up in two files (a single DB update claims orders from "not exported → exported")
   * Keep an export history (file name, time, count) so the same file can be downloaded again if the download failed or the file was lost
8. **Login** (requirement added 2026-09-27 and finalized as a shared-password scheme the same day; Section 9 step 7 — implemented 2026-09-27. DB: 4.5–4.7)
   * **All staff log in with one shared password** (no per-person accounts, no sign-up). The password is **6 digits**
   * **The admin (1 person, me)** logs in with a separate **admin password** (6 digits) → from the admin screen, can change the shared password and log everyone out. The admin can use all other features the same way
   * Passwords are **stored only as hashes** (Node built-in `crypto.scrypt`, with salt). Plaintext is never stored in the DB or logs
   * **Lock out after repeated login failures**: 5 consecutive failures from the same IP → 15-minute lock. While locked, even the correct password is rejected. If one IP is locked, other people (other IPs) can still log in
   * **Stay logged in for 30 days** (30 days from login time; cookie + DB session). **Logout button** (top menu)
   * **Changing the shared password immediately ends all existing staff logins** (used when a staff member leaves). The admin login stays active
   * **Without logging in, no page or API is accessible (including Server Actions and the label download)** — pages and download URLs (GET) redirect to the login screen (and return to the original URL after login); other requests get 401. First-line block in Next.js `proxy` + re-check the session inside every Server Action / Route Handler (do not rely on proxy alone). Admin features require an admin session
   * ~~**Keep the "entered by" field**~~ (removed 2026-10-06: the "입력자" input is gone and new orders store `created_by` as an empty string; existing records stay unchanged) — who entered an order is still typed directly into the "입력자" (Entered by) field on the order entry screen (remembered by the browser), as it is now. Existing orders' "entered by" records stay unchanged
   * Security note: 6 digits give only 1 million combinations, so per-IP lockout alone cannot fully stop automated attacks using many IPs. Since the site holds customers' personal data, check the login-failure records occasionally after deployment and, if needed, increase the number of digits or add a global failure limit

### **3.2 Second phase (after the MVP is stable)**

8. **Auto-generate a staff summary**
   * Generate a text block of collected orders organized by region/product → for copying and pasting into the staff group chat
9. **Detect duplicate/corrected orders**
   * If the same date + same phone number already exists in the list, show a warning (no automatic handling, notification only)

### **3.3 Long-term considerations (not in scope now)**

10. Daily aggregate statistics by region/product
11. Fully automatic collection when switching platforms, e.g. to Telegram (Bot API based) — moving 20 partner merchants over is a big burden, so this needs a separate decision

---

## **4. Data Model**

### **4.1 `orders` table**

| Column | Type | Description |
| ----- | ----- | ----- |
| id | uuid / serial | Primary key |
| source_room | text | Which regional group chat the order came from |
| name | text | Customer name |
| phone | text | Phone number (normalized: `010-1234-5678` format) |
| addr1 | text | City/district/street number (up to the road-name address) |
| addr2 | text | Rest of the address (building name / building no. / unit no., etc.) |
| brand_raw | text | Original brand text (e.g. AMAZING) |
| brand_short | text | Dictionary replacement result (e.g. AMZ) — if no match, stored the same as brand_raw |
| product_name | text | Product name |
| color | text | Color |
| size | text | Size (may be empty) |
| vendor | text | Vendor/partner name |
| note | text | Notes |
| created_by | text | Who entered it (one of the 5 people) |
| created_at | timestamp | Created time |
| updated_at | timestamp | Last modified time |
| order_group_id | uuid | ID grouping multiple product orders from the same message (one customer) (applied) |
| exported_at | timestamptz, null | Time exported to Excel. null means not yet exported (applied) |
| export_id | uuid, null | Which export file it went into → `exports.id` (applied) |

> Since 2026-10-06, source_room and created_by are legacy columns: no longer entered on screen, saved as empty strings for new orders, kept (not dropped) for existing data.

### **4.2 `brand_dictionary` table**

| Column | Type | Description |
| ----- | ----- | ----- |
| id | uuid / serial | Primary key |
| full_name | text | Full brand name (e.g. AMAZING) |
| short_form | text | Short form (e.g. AMZ) |

### **4.3 Excel shipping label column mapping (based on the Logen file-upload template)**

Analysis of the existing template `로젠(파일접수).xlsx` (2026-09-26):

* One sheet, `Sheet1`, with **5 columns (A–E)** and **no header row** — order data starts directly on row 1
* All cells are text (General format). Column widths: A 15 / B 16.88 / C 67.38 / D 57.5 / E 9.63
* The original also has an empty `Sheet2`, but **only create `Sheet1`** (decided 2026-09-26)
* 1 parcel = 1 row: products of one order group (order_group_id, "n합배") share one row (changed 2026-10-06; previously 1 product = 1 row)

| Column | Format seen in the template | Mapping |
| ----- | ----- | ----- |
| A | `Name (code)` | orders.name + " (" + code + ")" — code is the same value as column E; if the code is empty, name only |
| B | `010 1234 5678` (**spaces instead of hyphens**) | orders.phone with `-` replaced by spaces |
| C | `City/district road-name number, rest of address` (separated by **comma + space**) | orders.addr1 + ", " + orders.addr2 (addr1 only if addr2 is empty) |
| D | `short-productname-color size` + sometimes `  (memo)` | brand_short + "-" + product_name + "-" + color + (" " + size if size) + ("  (" + note + ")" if note) |
| D (n합배, 2026-10-06) | `n합배-` + products joined by `, ` | "n합배-" + each product's D value (without notes) joined by ", " + ("  (" + the group's distinct notes joined by " / " + ")" if any). A single product keeps the format above |
| E | Short code (e.g. 굿1) | Uses existing fields (no new column): orders.vendor, or orders.source_room if empty |

> Product name separator confirmed: `-` between brand, product name, and color; **a space before the size** (differs from the earlier assumption that size also used `-`).

### **4.4 `exports` table (applied)**

1 Excel export = 1 row. Used for same-day numbering (`_2`) and re-downloads.

| Column | Type | Description |
| ----- | ----- | ----- |
| id | uuid | Primary key |
| export_date | date | Export date (KST) |
| seq | int | Which export of the day (1, 2, …). (export_date, seq) is unique |
| file_name | text | The actual downloaded file name (including a user-changed name) |
| order_count | int | Number of orders included |
| exported_by | text | Who exported |
| exported_at | timestamptz | Export time |

Export is handled by a single DB function (RPC): create the exports row → run `update orders set exported_at = now(), export_id = … where exported_at is null` in the same transaction. Even if two people click at once, each order goes into only one file.

### **4.5 `app_credentials` table (migration prepared; login implemented in Section 9 step 7)**

Two rows of password hashes: `member` (shared staff) / `admin` (administrator).

| Column | Type | Description |
| ----- | ----- | ----- |
| role | text (PK) | `member` or `admin` |
| password_hash | text | scrypt hash (string including salt and parameters). Plaintext is not stored |
| updated_at | timestamptz | Last changed |

Initial setup is done not through the UI but with a command run once on the server (`npm run set-password`), since no admin password exists yet.

### **4.6 `app_sessions` table (migration prepared)**

| Column | Type | Description |
| ----- | ----- | ----- |
| id | uuid | Primary key |
| role | text | Which password was used to log in (`member` / `admin`) |
| token_hash | text | SHA-256 of the random token stored in the cookie. The raw token is not stored in the DB (so sessions can't be hijacked even if the DB leaks) |
| created_at | timestamptz | Login time |
| expires_at | timestamptz | Login + 30 days |
| last_seen_at | timestamptz | Last used |

Cookie: `HttpOnly`, `Secure` (in production), `SameSite=Lax`, 30 days. Logout = delete cookie + delete that session row. Log everyone out = delete all sessions with `role = 'member'`.

### **4.7 `login_attempts` table (migration prepared)**

| Column | Type | Description |
| ----- | ----- | ----- |
| key | text (PK) | Lockout key. Currently `ip:<client IP>` |
| failed_count | int | Consecutive failures |
| locked_until | timestamptz, null | Locked until this time |
| updated_at | timestamptz | Last failure |

DB function `register_login_failure(key, max_attempts, lock_minutes)` atomically increments by 1 → locks when the limit is reached. Failures during a lock do not extend the lock. After the lock expires, or 15 minutes after the last failure, counting restarts from 1. On successful login, the row is deleted.

---

## **5. Parsing Logic (already validated — porting as-is recommended)**

KakaoTalk raw text is inconsistent (labels present/absent, name/phone/address in varying order, irregular line breaks even within one order). The state-machine approach below has been validated against real example text.

**Core idea**:

1. Iterate line by line, recognizing labels (`➡️ 성함 ;`, `➡️ 전번 ;`, etc.) first
2. For unlabeled lines, use regex to detect a phone number (`01[0-9]-XXXX-XXXX` pattern) / name (2–5 pure Hangul characters) / start of an address (begins with a city/province name)
3. **An in-progress order is considered "complete" once it has both a phone number and an address**; if the next line looks like a new product name, start a new order
4. Split the address into "city/district/street number" and "rest of address" based on the `로`/`길` + number pattern

**Reference implementation**: Porting the `segmentOrders()`, `splitAddress()`, and `normalizePhone()` functions from the earlier prototype (`order-tool.html`) as-is is recommended. They are pure JS functions, so they can be ported without framework dependencies. Already validated with 3+ real example texts.

**When to apply the dictionary**: Don't auto-replace right after parsing. Instead, design it so the brand field on the review card is only pre-filled with a suggestion, and a person makes the final confirmation (to handle typos and new brands).

---

## **6. Proposed Architecture**

[Browser UI] ── API requests ──→ [Backend] ──→ [DB]

  - Paste/parse orders

  - Review/edit cards

  - Dictionary management screen

  - View/edit/delete order list

  - Excel download

| Component | Recommendation | Reason |
| ----- | ----- | ----- |
| Framework | Next.js | Frontend + backend in one project; easy to work with in Claude Code |
| DB | Supabase (Postgres) | Meets the concurrent-use requirement (a real database); can start on the free tier |
| Deployment | Vercel | Pairs well with Next.js; can start on the free tier (check the terms for commercial use — see TBD) |
| Auth | Custom password login (1 shared staff password + 1 admin password, scrypt hash, 30-day DB session) | No per-person accounts needed, so simpler than Supabase Auth (email-based). All DB access already happens only on the server (secret key), so the same structure just adds a session check |
| Excel generation | SheetJS (xlsx library) | Works on both client and server; validated in the existing prototype |

---

## **7. Screen Layout (draft)**

1. **Order entry screen**
   * Source chat selection (dropdown)
   * Paste raw text → auto-split button
   * List of split cards (each field editable; missing required fields highlighted)
   * Save-one / save-all buttons
2. **Order list screen**
   * Full order table (search/filter: date, source chat, name, phone number, etc.)
   * Per-row edit/delete
   * Excel download button
3. **Brand dictionary management screen**
   * List of full name ↔ short form (add/edit/delete)
4. **Login screen** (Section 9 step 7)
   * A single password input (6 digits). Without login, every page redirects here (and returns to the intended page after login)
   * Logout button in the top menu (if logged in as admin, show "관리자" (Admin) + a link to the admin screen)
5. **Admin screen** (admin only, Section 9 step 7)
   * Change the shared password (changing it logs out all staff)
   * Log everyone out (keeps the password, ends only staff sessions)
   * Change the admin password (after confirming the current admin password)
   * Login lockout status / unlock

---

## **8. Open Items (TBD — confirm before implementation)**

* [x] Separator for building the Excel product name — `short-productname-color size` per the Logen template (4.3)
* [x] Logen template column E code — use existing fields: vendor, or source_room if empty
* [x] `(memo)` at the end of column D — appended if there is a note (including quantity notes)
* [x] Export button location — a separate "엑셀 송장 내보내기" button on the order list screen
* [x] Orders edited after export — not re-exported; just marked "내보냄" (Exported) in the list
* [x] Sheet structure — `Sheet1` only
* [ ] Initial brand dictionary data (full list)
* [x] Permission differences among the 5 users — only the admin can use the admin screen (change shared password, log everyone out); all other features are the same for everyone (3.1-8)
* [x] Admin — 1 person (me), logs in with the admin password (2026-09-27)
* [x] Passwords — 6 digits (both shared and admin); lockout — 5 failures from the same IP → 15 minutes (2026-09-27)
* [x] Per-person accounts — none. All staff use the shared password; the "entered by" field is still typed manually (2026-09-27)
* [ ] Deployment domain: keep `xxx.vercel.app` or buy a custom domain
* [ ] Vercel free plan terms (non-commercial use) — decide whether to switch to the Pro plan ($20/month)

---

## **9. Proposed Implementation Order**

1. Set up DB schema (orders, brand_dictionary)
2. Port parsing logic (reuse JS functions from the existing `order-tool.html`)
3. Order entry screen (paste → review cards → save) — local real-use testing is possible at this point
4. Dictionary management screen
5. Order list view/edit/delete + filters
6. Excel shipping label export (Logen template, unexported orders only, per-day file numbering — 3.1 item 7, 4.3, 4.4)
7. Login (shared staff password + admin password, failure lockout, 30-day persistence, block all pages and APIs — 3.1-8, 4.5–4.7). — Implemented (2026-09-27)
8. Deploy (Vercel + Supabase connection)
9. Real-use testing → incorporate feedback on parsing edge cases
10. (Phase 2) Staff summary generation
11. (Phase 2) Duplicate order detection