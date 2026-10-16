# ISA Finance — Architecture

Covers the database, authentication, bank integration, financial calculations, and the
Personal CFO (AI agent). Threat model and key management: [`docs/SECURITY.md`](docs/SECURITY.md).

---

## 1. System overview

```
 Browser (mobile-first UI)
   │  HTTPS, httpOnly Supabase session cookies, CSP with per-request nonce
   ▼
 Next.js (Vercel-compatible, Node runtime)
   ├─ proxy.ts ─────────── refresh session · optimistic route gating · CSP · no-store
   ├─ Server Components ── requireUser() (DAL) → repository → finance services
   ├─ Server Actions ───── zod-validated mutations (user session, RLS enforced)
   └─ Route Handlers ───── /api/plaid/* (service role, server-only)
                           /api/cfo/chat (user session + read-only tool registry)
   │                 │                          │
   ▼                 ▼                          ▼
 Supabase         Plaid API (sandbox)       OpenAI API
 (Postgres+RLS,   tokens encrypted with     receives minimized, computed
  Auth, MFA)      app-held keyring          summaries only
```

**Trust boundaries**

1. Browser ↔ server: the browser never talks to Supabase *data* tables directly and
   never sees Plaid or OpenAI credentials. All reads happen in Server Components and
   all writes in Server Actions / Route Handlers.
2. Server ↔ Postgres: user-scoped requests use the user's JWT (RLS enforced). Only the
   Plaid sync/webhook path uses the service role, in `server-only` modules.
3. Server ↔ OpenAI: the model sees tool *results* (already computed), never raw tables,
   SQL, tokens, or account numbers.

## 2. Data access pattern

```
page.tsx (Server Component)
  └─ loadPageData()                      src/lib/data/load.ts (React cache, once per request)
       ├─ requireUser()                  src/lib/auth/dal.ts
       └─ getRepository(user)            src/lib/data/index.ts → repository bound to user.id
            ├─ DemoRepository            in-memory fictional dataset (demo mode)
            └─ SupabaseRepository        user-JWT client, RLS + explicit user_id filters
                 └─ finance services     src/lib/finance/* (pure, tested)

form → server action (src/lib/actions/*)
  └─ zod validation (src/lib/forms.ts)
       └─ runAction()                    requireUser → repository → audit → revalidatePath
            └─ repository write API      overrides, links, manual records, plans, goals
```

- The repository interface (`src/lib/data/repository.ts`) has one read
  (`getFinancialData`), one history read, and a narrow write API. Repositories are bound to
  the authenticated user when created, so no method takes a user id.
- `DATA_SOURCE=demo` uses `DemoRepository`. Fictional data is generated per day and edits
  are applied in memory, so every screen can be previewed. Edits reset on restart.
- `DATA_SOURCE=supabase` uses `SupabaseRepository` with the signed-in user's session
  client. Rows are validated with Zod (`src/lib/data/supabase/rows.ts`), reads page through
  PostgREST's 1000-row limit, and Postgres error codes map to user-safe messages. The
  service-role key is not used.
- Multi-step operations shared by both repositories live in `src/lib/data/operations.ts`
  (post-import transfer detection, rejecting a transfer).
- There is no silent fallback: a Supabase user is never shown demo data, and demo auth
  can only be combined with demo data (config validation).

## 3. Database design

All tables live in `public`, have RLS **enabled and forced**, and `anon` has no
privileges. Every user-owned table carries `user_id uuid not null references auth.users`.

### 3.1 Conventions

- **Money:** `bigint` minor units (cents) + `currency char(3)` (ISO 4217). Never `float`
  or `money` type. Column names end in `_minor`.
- **Sign convention (app-wide):** `amount_minor < 0` = money leaving the account,
  `> 0` = money entering it. Plaid uses the opposite sign; conversion happens once, at
  ingestion (`fromPlaidAmount`).
- **Credit balances:** for credit accounts `current_minor` is the amount owed (positive =
  owed). `available_minor` on a credit account is *available credit*, never cash.
- **Dates:** transaction dates are calendar `date`s (institution-local). Timestamps are
  `timestamptz`.
- **Ownership integrity:** child tables use **composite foreign keys**
  `(parent_id, user_id) → parent(id, user_id)`, so a row can never reference another
  user's parent even if a policy were mis-written.
- **Provider data is immutable to users:** user edits go to `transaction_overrides`;
  column-level grants restrict what `authenticated` may update.
- `created_at` / `updated_at` on every mutable table (`updated_at` maintained by trigger).

### 3.2 Tables

| Table | Purpose | User privileges (RLS-scoped) |
|---|---|---|
| `profiles` | display name, base currency, timezone, safety buffer | select, update(selected cols) |
| `institutions` | reference data (name, Plaid institution id) | select |
| `bank_connections` | a Plaid Item / manual / CSV source; status, consent expiry, sync cursor, last sync times | select |
| `bank_connection_secrets` | encrypted Plaid access token + key id | **none** (service role only) |
| `accounts` | checking/savings/credit/loan/manual; mask, nickname, currency | select, insert(manual), update(nickname, is_hidden) |
| `balance_snapshots` | current / available / limit over time, `as_of`, source | select, insert(manual accounts) |
| `transaction_categories` | per-user categories with `kind` (expense/income/transfer) | full CRUD on non-system rows |
| `transactions` | original provider/import data, pending/posted, external ids, dedupe hash | select, insert(manual/csv), update/delete(manual only) |
| `transaction_overrides` | user category, merchant rename, note, budget exclusion, transfer override | full CRUD |
| `transfer_links` | pairs of legs (transfer / credit-card payment) | full CRUD |
| `budgets` | one per user per month (`month` = first day) | full CRUD |
| `budget_allocations` | planned amount per category; kind fixed/variable/savings/debt | full CRUD |
| `income_sources` | salary/freelance/etc., cadence, irregular flag | full CRUD |
| `recurring_bills` | amount (or estimate), cadence, next due, autopay | full CRUD |
| `savings_goals` | target, saved, target date | full CRUD |
| `debt_goals` | APR (basis points), minimum & planned payment, strategy | full CRUD |
| `financial_forecasts` | stored inputs, assumptions, results, `data_as_of` | select, insert, delete |
| `ai_conversations` / `ai_messages` | Personal CFO history | select, insert, delete |
| `sync_runs` | synchronization history per connection | select |
| `webhook_events` | Plaid webhook idempotency log | **none** (service role only) |
| `audit_events` | append-only security/audit log | select (own rows); insert via server; update/delete blocked by trigger |

Key constraints (see `supabase/migrations/20261016000100_initial_schema.sql`):

- `transactions`: `unique (user_id, source, external_id)`; partial unique
  `(account_id, dedupe_hash)` for CSV imports; check `status in ('pending','posted')`.
- `accounts`: `unique (connection_id, provider_account_id)`; `mask ~ '^[0-9A-Za-z]{2,4}$'`.
- `balance_snapshots`: `unique (account_id, as_of)`.
- `budgets`: `unique (user_id, month)`, `month` must be the first of a month.
- `budget_allocations`: `unique (budget_id, category_id)`, `planned_minor >= 0`.
- `transfer_links`: each leg may appear in at most one link.
- `webhook_events`: `unique (body_sha256)` for idempotency.

Indexes cover `(user_id, posted_date desc)`, `(account_id, posted_date desc)`,
`(user_id, category)` lookups, and every foreign key.

### 3.3 Row Level Security

Policy template for user-owned tables:

```sql
create policy "owner can read"   on t for select to authenticated using (user_id = (select auth.uid()));
create policy "owner can insert" on t for insert to authenticated with check (user_id = (select auth.uid()));
create policy "owner can update" on t for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "owner can delete" on t for delete to authenticated using (user_id = (select auth.uid()));
```

Plus: `revoke all ... from anon`, column-level `grant update (...)`, no policies at all on
secret/webhook tables, and composite FKs for cross-table ownership. Tests in
`supabase/tests/rls.test.sql` simulate two users and assert isolation for every table.

### 3.4 Phase 2 helpers (`…000300_phase2_data_access.sql`)

| Object | Purpose |
|---|---|
| `account_latest_balances` view | Latest snapshot per account; `security_invoker = true`, so RLS applies. |
| `create_manual_account(...)` | Manual account and opening balance in one transaction. |
| `import_transactions(account, batch, rows jsonb)` | CSV rows → `transactions` with `on conflict do nothing`. Idempotent through `(account_id, dedupe_hash)`; max 5000 rows. |
| `ensure_budget`, `upsert_budget_allocation`, `copy_budget` | Month budgets created on demand; allocation upsert; copy last month without overwriting. |

All are **SECURITY INVOKER** with `search_path = ''`, executable by `authenticated` only.
They add atomicity, never privileges, and are covered by `supabase/tests/rls_phase2.test.sql`.

### 3.5 New-user bootstrap

`handle_new_user()` (security definer trigger on `auth.users`) creates the profile and
seeds default categories. Public sign-ups must be **disabled** in Supabase; the app also
enforces `ALLOWED_USER_EMAIL`.

## 4. Authentication & authorization

| Layer | Mechanism |
|---|---|
| Identity | Supabase Auth, email + password. Public sign-up disabled in the Supabase dashboard. |
| MFA | TOTP via `supabase.auth.mfa` (enroll → challenge → verify). `REQUIRE_MFA=true` (default) forces enrollment; sessions must reach **AAL2** before any financial page renders. |
| Session | `@supabase/ssr` httpOnly cookies, refreshed in `proxy.ts`. |
| Optimistic gate | `proxy.ts` redirects unauthenticated requests to `/login` (UX only — not trusted). |
| Authoritative gate | `requireUser()` in `src/lib/auth/dal.ts`: validates the user with the Auth server (`getUser`), checks the allowlist, checks AAL, returns a narrow `{ id, email }`. Called by every page, action, and route handler that touches financial data. |
| Policy logic | `resolveAccess()` in `src/lib/auth/access.ts` is a pure function (unit tested) deciding `allow` / `login` / `mfa-setup` / `mfa-verify` / `forbidden`. |
| Database | RLS with `auth.uid()` — final enforcement even if app code is wrong. |
| Rate limiting | Login and MFA verification: 5 attempts / 15 min per IP+email key. CFO and Plaid routes get their own limits. |

**Demo mode.** `AUTH_MODE=demo` lets the UI run locally without Supabase. It is refused
when `NODE_ENV=production`, and it can only ever serve the fictional dataset (the demo
repository has no database access). A banner states that authentication is disabled.

## 5. Bank integration (Plaid), sandbox only, as built in Phase 4

Code lives in `src/lib/plaid/`. `service.ts` (link, sync, reconnect, disconnect, webhooks)
and `sync.ts` (pagination) depend only on two interfaces in `ports.ts`:
`PlaidGateway` (the Plaid API; real implementation `client.ts`) and `PlaidStore` (privileged
database writes; real implementation `supabase-store.ts` with the service-role client).
`deps.ts` wires them together and refuses to run unless `plaidReadiness()` passes.

### 5.1 Flow

1. **Link.** The Accounts page calls `POST /api/plaid/link-token` (same-origin, auth + MFA,
   rate-limited). The server calls `/link/token/create` with `client_user_id = user.id`,
   product `transactions` (730 days), the webhook URL and the OAuth redirect URI if
   configured. With a `connectionId`, it opens Link in **update mode** with that Item's
   access token instead.
2. Plaid Link (loaded from cdn.plaid.com, iframe UI) returns a one-time `public_token`.
3. **Exchange.** `POST /api/plaid/exchange` accepts only `public-sandbox-…` tokens, calls
   `/item/public_token/exchange`, refuses (and removes) any non-`access-sandbox-` token, looks
   up the institution, encrypts the access token, and calls `create_plaid_connection`
   (institution + connection + secret in one transaction). It then runs the first sync. If
   that sync fails, the link is kept and the user can **Sync now**. The access token never
   leaves the server.
4. **OAuth institutions** (e.g. Discover) redirect back to `/accounts/oauth`, which resumes
   Link with the link token saved in `sessionStorage` and `receivedRedirectUri`.
5. **Reconnect.** After update-mode Link succeeds, `POST /api/plaid/reconnect` asks Plaid
   (`/item/get`) whether the Item is healthy. Only then is the connection set back to
   `active` and synced.
6. **Disconnect.** `/item/remove` at Plaid first (Items that are already gone are fine; any
   other failure changes nothing), then `disconnect_plaid_connection` deletes the token,
   clears the cursor and marks the connection `disconnected`. History is kept.

### 5.2 Token encryption

- AES-256-GCM, 96-bit random IV, AAD = `isa-finance:plaid-token:v1:<connection>:<user>`
  (binds a ciphertext to its row). Format `v1.<keyId>.<iv>.<ciphertext+tag>` (base64url).
- Keyring from env: `TOKEN_ENCRYPTION_KEYS="k2:<base64 32B>,k1:<base64 32B>"`,
  `TOKEN_ENCRYPTION_ACTIVE_KEY_ID=k2`. Old keys keep decrypting; new writes use the active
  key; `npm run tokens:reencrypt` migrates old ciphertexts. Keys never touch the database.
  `create_plaid_connection` rejects any value that isn't in ciphertext format.

### 5.3 Webhooks (`POST /api/plaid/webhook`)

- Exempt from the session check in `src/proxy.ts`. It is authenticated by signature instead.
- Body capped at 64 KB; per-IP rate limit.
- `Plaid-Verification` JWT: `alg` must be ES256, the key is fetched by `kid` from
  `/webhook_verification_key/get` (cached 24 h, unknown kids cached 60 s), expired keys are
  rejected, `iat` must be within 5 minutes, and `request_body_sha256` must equal the
  SHA-256 of the exact raw body.
- Non-sandbox `environment` values are rejected.
- Idempotency: `webhook_events` keyed by body hash. A duplicate returns 200 without
  processing, unless the earlier attempt failed (Plaid's retry is then processed).
- `TRANSACTIONS` `SYNC_UPDATES_AVAILABLE` (and the legacy update codes): sync runs after the
  response via `after()`.
- `ITEM` `ERROR` / `PENDING_EXPIRATION` / `PENDING_DISCONNECT` / `USER_PERMISSION_REVOKED` /
  `LOGIN_REPAIRED`: the connection status is updated, and `LOGIN_REPAIRED` also syncs.

### 5.4 Cursor-based sync and recovery

```
cursor0 = connection.transactions_cursor
loop (≤ 100 pages of 500):
  page = /transactions/sync(cursor)
  buffer added / modified / removed (latest operation per transaction id wins)
  on TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION → discard buffer, restart from cursor0 (≤ 3 times)
until has_more = false
apply_plaid_sync(connection, cursor0, next_cursor, payload)   -- one DB transaction:
  lock connection row; reject if cursor ≠ cursor0 (SQLSTATE PT409 → "superseded")
  upsert accounts (never touching nickname / hidden), balance snapshots
  upsert transactions on (user, 'plaid', external_id) with category matched by name
  pending → posted: superseded_by + carry the user's overrides to the posted transaction
  removed → is_removed (never deleted)
  commit new cursor, last_successful_sync_at, status back to active
record sync_runs (trigger, counts, cursors, error code only)
afterwards: transfer detection for the owner (same as CSV imports)
```

Because the cursor is committed atomically with the data, an interrupted or failed sync
restarts from the last committed cursor, and replays are idempotent. Plaid error codes
map to connection states. `ITEM_LOGIN_REQUIRED` → `login_required`, revoked access →
`revoked`, invalid Item → `error`. Transient errors (rate limits, institution down) leave
the status alone. The UI offers **Reconnect** for every state that needs it.

### 5.5 Mapping (`mapping.ts`)

Every Plaid object is validated with Zod. Invalid or unrepresentable records (e.g.
unofficial currencies, sub-cent amounts) are skipped and counted, never guessed. Plaid's
positive-is-outflow amount is flipped once (`fromPlaidAmount`). Credit `current` stays the
amount owed and `available` stays available credit (never cash). Text is stripped of
control and bidi characters and truncated. Masks keep at most the last 4 characters.
Plaid personal-finance categories map onto the default categories, and unmapped ones stay
uncategorized.

### 5.6 Safeguards

- Sandbox only, enforced in four places: config (`PLAID_ENV`), the client's hard-wired
  base path, the token prefixes, and the webhook environment. Production requires a
  reviewed code change at the Phase 5 gate.
- No `/transfer`, `/payment_initiation`, `/auth` or `/processor` products.
- Demo mode never contacts Plaid. Its connections are derived from fictional accounts
  and have no actions.
- Institution compatibility (Discover uses OAuth; United Heritage Credit Union is
  unverified) is checked in Phase 5. CSV import covers unsupported institutions.

## 6. Financial calculation rules

All implemented as pure functions in `src/lib/finance`, with unit tests.

### 6.1 Money
- Integer minor units; `assertSafeMinor` rejects non-integers and unsafe integers.
- Decimal inputs (Plaid floats, CSV strings) are parsed **from their string form** into
  minor units; values with more precision than the currency allows are rejected, not
  rounded silently.
- Mixing currencies in one sum throws. Formatting via `Intl.NumberFormat`.

### 6.2 Balances
| Metric | Rule |
|---|---|
| Total cash | Σ `current` of depository accounts (checking, savings, manual cash). |
| Available cash | Σ `available` of depository accounts **where the institution provides it**; result flagged *partial* if any account lacks it. |
| Credit card debt | Σ `current` (amount owed) of credit accounts. Credit limits and available credit are reported separately and **never** added to cash. |
| Net worth | assets (depository + investment + manual assets) − liabilities (credit + loans). |
| Staleness | a synced balance is *stale* when `as_of` is older than 24 h (manual balances: 31 days); stale and missing balances are listed in the result. |

### 6.3 Transaction classification
- Each transaction resolves an *effective* category = override → provider mapping → uncategorized.
- **Spending** (for a period) = −Σ amounts of expense-kind transactions, net of refunds,
  excluding: budget-excluded, transfer-linked legs, credit-card payments, removed rows.
  Reported as posted and pending components.
- **Income** = Σ inflows of income-kind transactions, same exclusions.

### 6.4 Transfers & credit card payments
A pair (outflow A, inflow B) is linked when: different accounts owned by the user, equal
absolute amount and currency, dates within 3 days, neither leg already linked. If B (or A
for the inflow side) is a credit account the link kind is `credit_card_payment`.
Ambiguous candidates (more than one match) are left unlinked and surfaced for review.
Transfer-category transactions with no matching leg are excluded from spending/income
and flagged as "unmatched transfer".

### 6.5 Deduplication
1. Provider identity: `(source, external_id)` upsert.
2. Pending → posted: a posted transaction whose `pending_external_id` matches a pending
   row supersedes it; user overrides migrate to the posted row.
3. CSV: `dedupe_hash = sha256(account_id | date | amount_minor | normalized description | ordinal)`
   where *ordinal* counts identical rows within the same file — re-importing a file is a
   no-op while genuine same-day duplicates are preserved.
4. Cross-source (CSV vs provider): same account, same amount, dates within 3 days,
   similar normalized description → reported as a *possible duplicate* for the user to
   confirm; never auto-deleted.

### 6.6 Budgets
- Remaining per category = planned − actual (actual per §6.3, for the budget month).
- Savings and debt allocations measure money *moved* out of cash accounts in that
  category (transfers, card payments), not spending.
- Status: `not_started`, `on_track`, `near_limit` (≥ 90%), `at_plan` (exactly planned),
  `over`. Over-budget is reported as negative remaining, not clamped.
- Month-over-month: a month in progress is compared day for day with the same days of
  the previous month. Past months are compared in full.
- Planned income = Σ expected deposits with known amounts in the month. Irregular or
  unknown-amount sources are listed separately and never guessed.

### 6.6a Paycheck allocation
For the next salary paycheck until the following one: bills due in that window, debt
payments due in that window (max of planned and minimum), and an even share (monthly ÷
paychecks this month, rounded half up) of essential variable budget (excluding categories
already covered by bills), savings contributions, and flexible budget. The remainder is
"unassigned"; a negative remainder is shown as a shortfall.

### 6.6b CSV import
Strict parser (quoted fields, CRLF, BOM). Columns are detected from headers (Date,
Description, Amount, or Debit/Credit). Dates are accepted only as ISO or US formats, and
amounts accept `$`, thousands separators, parentheses and trailing minus. Rows that can't
be read are reported by line and skipped, never guessed. Re-import is idempotent through
the §6.5 hash. Rows resembling bank-synced transactions are flagged and skipped unless the
user opts in. The server re-parses the file on confirm rather than trusting rows from the
browser, then runs transfer detection.

### 6.6c Review queue
A transaction needs review when it is uncategorized spending, an uncategorized inflow, a
transfer-category leg with no match, or one side of an ambiguous transfer match.

### 6.7 Safe-to-spend
```
safe = spendable cash
     − bills due before horizon (unpaid)
     − remaining essential (fixed + essential variable) budget for horizon
     − planned savings contributions remaining
     − planned debt payments due before horizon
     − pending outflows not reflected in balances (only when falling back to current balance)
     − safety buffer
     + expected income before horizon   (only if the user opts in; default off)
```
Spendable cash comes from checking and cash accounts in a healthy connection state. Savings,
money-market, CD, and HSA accounts are set aside (disclosed as an assumption), credit
availability is never included, and disconnected accounts are excluded with a warning.
It uses `available` when provided, else `current` (flagged). Bills that share a category with an
essential budget line are subtracted from that line's reserve to avoid double counting. The result
includes every component, the explicit assumptions, and warnings for stale or missing
data and accounts in an error state. A negative result is reported as a shortfall.

### 6.8 Debt & savings
- Debt payoff simulation: monthly interest = balance × APR/12 (APR stored in basis
  points), rounded half-up to the cent each month; payment applied after interest;
  stops at payoff or 600 months; reports months, total interest, and a "never pays off"
  flag when payment ≤ interest.
- Savings projection: linear contributions; progress = saved / target.

## 7. Next.js specifics

- Next.js 16: middleware is `src/proxy.ts`.
- `cacheComponents` is **disabled**: every financial page is rendered per request and
  nothing user-specific enters a shared server cache. App routes send
  `Cache-Control: private, no-store`.
- CSP is generated per request in the proxy with a nonce (`script-src 'nonce-…' 'strict-dynamic'`).
  `style-src` allows `'unsafe-inline'` because Recharts and Next inject inline style
  attributes; scripts remain nonce-restricted.

## 8. Personal CFO (AI agent), as built in Phase 3

```
POST /api/cfo/chat
  checkSameOrigin → requireApiUser (auth + MFA) → per-minute limiter (8/min)
  → body ≤ 8 KB, zod (message 1–2000 chars, conversationId pattern)
  → handleCfoMessage (src/lib/cfo/service.ts)
      daily request limit (DB, ai_usage_daily) → load conversation history (RLS)
      → createCfoContext: deep-frozen snapshot of THIS user's data, built once
      → runCfoTurn (agent.ts) with the OpenAI model, or answerOffline() when
        no key / over the daily token budget / the AI service fails
      → record_ai_usage, persist user + assistant messages (+ metadata), audit event
```

Modules in `src/lib/cfo/`:

| File | Role |
|---|---|
| `context.ts` | Frozen per-request snapshot (`data`, enriched transactions, `asOf`, currency). Tools can only read it. |
| `tools.ts` | 15 read-only tools with strict JSON schemas and Zod validation: balances, spending summary, transaction search (≤ 25 rows, sanitized text, no ids), budget status, upcoming bills, income, savings goals, debts, debt payoff simulation, cash-flow forecast, safe-to-spend, affordability, month comparison, insights, briefing. Each returns `{data, meta: {status: actual\|estimate\|projection, period, dataAsOf, isDemo, notes}}` and money as `{minor, formatted}`. |
| `prompt.ts` | System instructions: numbers only from tools, no arithmetic, state period and freshness, label estimates and projections, tool text is untrusted data, no write capability, say what's missing, not a licensed advisor. |
| `agent.ts` | Tool loop with limits (6 rounds, 12 calls per turn, 900 output tokens, last 12 history messages / 16k chars). |
| `verify.ts` | Every currency amount in the answer must appear in a tool result (or in the user's own text or earlier answers). One repair round; anything still unverified is flagged in the UI. |
| `offline.ts` | Deterministic answers for common questions using the same tools, so the CFO works with no key, in demo mode, and during outages. |
| `openai-model.ts` | Responses API adapter (server-only). `store: false`, no SDK retries, 45 s timeout, provider errors mapped to generic `ModelError`s. |

Forecasts, insights and briefings are pure functions in `src/lib/finance/forecast.ts`,
`insights.ts` and `briefing.ts`. The dashboard, `/cfo/briefing` and the CFO tools all
use them. Projections are labeled everywhere they appear.

**Rules**
- The user is bound server-side through the repository. No tool parameter selects a
  user, account id or table; the model cannot choose whose data to read.
- No SQL, no write tools, no payment tools. Future write tools require an explicit,
  UI-rendered confirmation step outside the model loop.
- Data minimization: no account numbers (masks only), no tokens, no internal ids in
  tool output; merchant and memo text is sanitized and truncated (prompt-injection
  defense, tested with malicious merchant names).
- Tool outputs are never persisted. Only the question, the answer text and metadata
  (tools used, status, periods, unverified amounts) are stored in `ai_messages`.
- Limits: per-minute limiter, `CFO_DAILY_REQUEST_LIMIT` (default 150) and
  `CFO_DAILY_TOKEN_LIMIT` (default 400k) per UTC day in `ai_usage_daily`
  (written only through the SECURITY DEFINER `record_ai_usage`).

