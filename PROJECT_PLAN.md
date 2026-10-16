# ISA Finance — Project Plan

ISA Finance is a private, single-user, mobile-first "Personal CFO" web application.
It consolidates bank and credit accounts, tracks transactions and budgets, and offers
an AI assistant whose numbers come exclusively from deterministic application services.

This document is the source of truth for **scope, phases, and status**. Architecture
details live in [`ARCHITECTURE.md`](ARCHITECTURE.md); the threat model and key
management live in [`docs/SECURITY.md`](docs/SECURITY.md); working conventions live in
[`CLAUDE.md`](CLAUDE.md).

---

## 1. Guiding principles

1. **Security before features.** No live financial data until auth, RLS, secret handling
   and the Plaid design have been reviewed by the owner.
2. **Deterministic money.** Every number shown to the user (or to the AI) is computed by
   tested application code using integer minor units. The language model never computes
   or invents figures.
3. **Honest data.** Posted, pending, estimated, stale and unavailable data are visibly
   distinguished. Fictional data is always labeled as fictional.
4. **Incremental, reviewable phases.** One phase at a time; each ends with lint,
   typecheck, tests, and an updated status table below.
5. **No money movement.** The application never initiates payments or transfers.

## 2. Technology decisions

| Concern | Choice | Notes |
|---|---|---|
| Framework | Next.js 16 (App Router) + React 19 + TypeScript (strict) | Generated with `create-next-app@16.4.2`. `cacheComponents` is **disabled** (see ARCHITECTURE §7). |
| Styling | Tailwind CSS v4 + shadcn/ui conventions | Components are shadcn-style and live in `src/components/ui`; design tokens are CSS variables. |
| Database | Supabase Postgres | SQL migrations in `supabase/migrations`, RLS on every user-owned table. |
| Auth | Supabase Auth (email + password) + TOTP MFA (AAL2) | Single-user allowlist; public sign-ups disabled. |
| Bank data | Plaid (Link, `/transactions/sync`, webhooks) | **Sandbox only** until reviewed. |
| AI | OpenAI API (server-side only), function/tool calling | Read-only tools backed by deterministic services. |
| Charts | Recharts 3 | |
| Validation | Zod 4 | Every server input (actions, route handlers, env). |
| Unit tests | Vitest 5 | Finance services, auth access logic, crypto, rate limiting. |
| DB tests | Plain SQL assertions run on local Postgres 16 | RLS / ownership tests (`supabase/tests`). |
| E2E | Playwright | Runs against demo mode. |
| Hosting | Vercel-compatible | No deployment without explicit approval. |

## 3. Repository structure

```
isa-finance/
├── PROJECT_PLAN.md          ← scope, phases, status (this file)
├── ARCHITECTURE.md          ← data model, auth, Plaid, calculations, AI design
├── CLAUDE.md                ← persistent conventions & security rules
├── README.md                ← setup, local dev, deployment
├── .env.example             ← variable names only, never real values
├── docs/
│   └── SECURITY.md          ← threat model, key management & rotation
├── supabase/
│   ├── migrations/          ← ordered SQL migrations (schema + RLS)
│   └── tests/               ← RLS / ownership tests + local runner
├── src/
│   ├── proxy.ts             ← session refresh, route gating, CSP nonce, no-store
│   ├── app/
│   │   ├── (auth)/          ← login, MFA setup, MFA verify
│   │   ├── (app)/           ← authenticated shell: dashboard, accounts, transactions,
│   │   │                      budget, cfo, settings
│   │   └── api/             ← route handlers (Plaid, CFO) — later phases
│   ├── components/
│   │   ├── ui/              ← shadcn-style primitives
│   │   ├── layout/          ← app shell, bottom nav, side nav, banners
│   │   ├── dashboard/       ← dashboard cards
│   │   └── charts/          ← Recharts wrappers
│   └── lib/
│       ├── env.ts           ← zod-validated environment (server-only)
│       ├── auth/            ← data access layer, access policy, actions
│       ├── supabase/        ← server / proxy / (later) admin clients
│       ├── security/        ← CSP, rate limiting
│       ├── finance/         ← deterministic calculation services (pure)
│       └── data/            ← repository interface + demo dataset
└── tests/
    └── e2e/                 ← Playwright specs
```

## 4. Application routes

| Route | Phase | Purpose |
|---|---|---|
| `/login` | 1 | Email/password sign-in (rate limited). |
| `/mfa/setup` | 1 | TOTP enrollment (QR code). |
| `/mfa/verify` | 1 | TOTP challenge to reach AAL2. |
| `/` | 1 | Dashboard (fictional data in Phase 1). |
| `/accounts` | 2 | Accounts, connection health, nicknames, reconnect/disconnect. |
| `/transactions` | 2 | Unified history, filters, edits, notes, CSV import. |
| `/budget` | 2 | Monthly plan, planned vs actual, goals, paycheck allocation. |
| `/cfo` | 3 | Personal CFO chat. |
| `/settings` | 1 (minimal) / 2 | Security (MFA status), sign-out, data mode. |
| `POST /api/plaid/link-token` | 4 | Create Link token (sandbox). |
| `POST /api/plaid/exchange` | 4 | Exchange public token server-side; encrypt + store access token. |
| `POST /api/plaid/webhook` | 4 | Verified, idempotent webhook receiver. |
| `POST /api/cfo/chat` | 3 | Streaming CFO endpoint with read-only tools. |

## 5. Phases, deliverables, acceptance criteria

### Phase 0 — Planning ✅
- Deliverables: this plan, `ARCHITECTURE.md`, `CLAUDE.md`, `docs/SECURITY.md`.
- Acceptance: owner reviews architecture, threat model, and phase boundaries.

### Phase 1 — Foundation ✅
Deliverables:
1. Next.js scaffold, lint/typecheck/test tooling, CI-ready scripts.
2. Full database schema + RLS migrations, with ownership tests on local Postgres.
3. Auth foundation: Supabase SSR clients, proxy session refresh, data access layer
   (`requireUser`), MFA enrollment/verification, single-user allowlist, sign-out.
4. Security baseline: nonce-based CSP, security headers, `no-store` on app routes,
   rate limiter, zod-validated environment.
5. Design system (blush / charcoal / white, dark mode), mobile bottom nav, desktop side nav.
6. Deterministic finance services: money, balances, classification, transfers,
   deduplication, budgets, safe-to-spend, cash flow, savings, debt simulation.
7. Dashboard populated with clearly labeled fictional data.

Acceptance criteria:
- `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:db`, `npm run build`,
  `npm run test:e2e` all pass.
- Every user-owned table has RLS enabled and a passing cross-user isolation test.
- Dashboard shows a persistent "Fictional demo data" label; no real institution data.
- Credit availability is never included in cash; pending and stale data are labeled.
- No secret is readable from client bundles (`NEXT_PUBLIC_*` limited to Supabase URL + publishable key).

### Phase 2 — Accounts, Transactions, Budget ✅ (awaiting owner review)
- Accounts page (connection health, nicknames, masked ids, manual accounts).
- Transactions page (filters, search, category edits via overrides, notes, exclusions,
  CSV import with dedupe preview).
- Budget page (income plan, fixed/variable, goals, paycheck allocation, MoM comparison).
- Supabase-backed repository implementation behind the same interface as the demo one.
- Acceptance: user edits never mutate provider data; CSV re-import is idempotent;
  RLS tests cover every new write path.

### Phase 3 — Personal CFO
- `/cfo` chat UI, `POST /api/cfo/chat`, OpenAI tool calling with a fixed read-only tool
  registry, data minimization, conversation persistence, audit events.
- Acceptance: every numeric claim in an answer is traceable to a tool result; tool
  arguments are zod-validated; prompt-injection tests (malicious merchant names) pass.

### Phase 4 — Plaid sandbox integration
- Link token / exchange / webhook routes, AES-256-GCM token encryption with external
  keyring, webhook JWT verification, idempotent `/transactions/sync` with cursor
  recovery, reconnection (update mode) and disconnection (`/item/remove`).
- Acceptance: end-to-end sandbox link with `user_good`; webhook replay is a no-op;
  interrupted sync resumes from last committed cursor.

### Phase 5 — Review gate (owner approval required)
- Security review, key-rotation drill, backup/restore drill, institution compatibility
  checks (Discover, United Heritage Credit Union) in Plaid's institution search.
- **Only after explicit approval:** Plaid production access, production deploy.

## 6. Status

| Item | Status |
|---|---|
| Phase 0 planning docs | ✅ Complete |
| Phase 1 foundation | ✅ Complete, reviewed and approved by the owner |
| Phase 2 accounts, transactions, budget, Supabase data | ✅ Complete, **awaiting owner review before Phase 3** |
| Phase 3 Personal CFO | ⏸ Not started (needs approval) |

Phase 1 checklist:

- [x] Scaffold (Next.js 16, Tailwind v4, ESLint, Vitest, Playwright)
- [x] Database schema + RLS migrations
- [x] RLS ownership tests on local Postgres
- [x] Deterministic finance services + unit tests
- [x] Auth foundation (Supabase SSR, proxy, DAL, MFA pages, allowlist). Logic unit tested;
      end-to-end sign-in/MFA **not yet verified** against a real Supabase project (needs owner setup)
- [x] Security baseline (CSP nonce, headers, no-store, rate limiter, env validation)
- [x] Design system, app shell, bottom navigation, dark mode. shadcn-style components are
      hand-written in `src/components/ui` because the shadcn registry was unreachable from the
      build environment. Same conventions (cva + `cn` + Radix Slot)
- [x] Dashboard with fictional data
- [x] Owner review of Phase 1

Phase 2 checklist:

- [x] Migration `…000300_phase2_data_access.sql`: RLS-respecting latest-balance view and
      SECURITY INVOKER helpers (manual account, idempotent CSV import, budget upsert/copy)
- [x] RLS tests for every new write path (`supabase/tests/rls_phase2.test.sql`)
- [x] Repository write API, implemented twice: in-memory demo store and Supabase (RLS)
- [x] Supabase repository verified against a real PostgREST + Postgres stack with all
      migrations (`npm run test:integration`), including cross-user isolation, a
      wrong-user-binding check, forged-token rejection and >1000-row pagination
- [x] Accounts: grouped list, summary, connection health, credit utilization, detail page,
      nickname/hide, manual accounts (create, balance updates with history, delete)
- [x] Transactions: search, type/date/account/category/status filters in the URL,
      day grouping, review queue, edits as overrides (category, merchant, note, exclusion,
      transfer mode), manual transfer linking/unlinking, CSV import with preview,
      idempotent re-import and possible-duplicate detection, manual entry
- [x] Budget: month plan with fixed/variable/savings/debt, planned vs actual, copy last
      month, unbudgeted spending, month-over-month (day-for-day), bills, income (multiple +
      irregular), savings goals, debt payoff comparison, paycheck allocation
- [x] Settings: calculation preferences (safety buffer, expected income, time zone)
- [x] Demo mode preserved; edits work in memory and are labeled temporary
- [x] Mobile review on an emulated iPhone 15 viewport (light + dark)

Not done in Phase 2 (by design): Plaid linking (Phase 4), the AI Personal CFO (Phase 3).
Reconnect and disconnect buttons are visible but disabled, with an explanation.

Phase 2 verification (latest run): ESLint clean · `tsc` clean · Vitest **164** unit tests ·
RLS SQL suites (Phase 1 + Phase 2) passing on PostgreSQL 16 · **11** PostgREST integration
tests · Playwright **67** tests (iPhone 15 emulation + desktop) · `next build` succeeds.

Caveats: the iPhone runs use Chromium with iPhone 15 viewport, touch and user agent.
WebKit/Safari is not installed in the build environment, so test on a real iPhone at
review. Supabase was verified locally (Postgres 16 + PostgREST 12), not against your
hosted project.

_Status is updated at the end of each working session; see the git log for detail._

## 7. Known risks & open decisions

| # | Risk / decision | Mitigation / owner action |
|---|---|---|
| R1 | Plaid coverage for **United Heritage Credit Union** is unverified; small credit unions may be OAuth-less, partially supported, or absent. | Check in Plaid Dashboard → Institution status during Phase 4; CSV import is the fallback. |
| R2 | **Discover** is an OAuth institution in Plaid; production requires OAuth registration and Plaid's production approval. | Owner applies for Plaid production access only at Phase 5. |
| R3 | In-memory rate limiting is per-instance on serverless platforms. | Acceptable for single-user Phase 1; move to a shared store (e.g. Upstash Redis) before public deployment. |
| R4 | Supabase service-role key bypasses RLS. | Used only in server-only modules for Plaid sync/webhooks (Phase 4); never imported into client code; lint rule + `server-only` guard. |
| R5 | Sending financial data to OpenAI. | Data minimization: aggregates and truncated transaction lists only; no account numbers, tokens, or full names. Owner must accept OpenAI data-handling terms; consider zero-data-retention eligibility. |
| R6 | Encryption key loss makes stored Plaid tokens unrecoverable. | Documented recovery: re-link items via Plaid Link (tokens are re-issuable). See `docs/SECURITY.md`. |
| R7 | Repository originally provided (GetAgeFit-website) is public and unrelated. | ISA Finance lives in its own private repository. |
| R8 | Demo-mode edits live in server memory, shared by everyone using that server, and reset on restart or each day. | Demo mode is local-only and refused in production. A banner and form notes say edits are temporary. |
| R9 | Pages load the last 13 months of transactions per request; fine for one person, slower with years of history. | Add server-side filtering/pagination in SQL if history grows (Phase 4+). |
| R10 | Supabase integration is verified against local PostgREST 12, not the hosted Supabase stack (Auth/GoTrue, newer PostgREST). | Run `npm run test:db` against the hosted project and smoke-test sign-in at review. |
