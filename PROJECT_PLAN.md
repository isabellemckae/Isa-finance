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

### Phase 1 — Foundation (current)
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

### Phase 2 — Accounts, Transactions, Budget (demo data, then Supabase reads)
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
| Phase 1 — see checklist below | 🟡 In progress |

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
- [ ] Owner review of Phase 1 (required before Phase 2)

Phase 1 verification (latest run): ESLint clean · `tsc` clean · Vitest 103 tests passing ·
RLS SQL suite passing on PostgreSQL 16 · Playwright 14 tests (mobile + desktop) passing ·
`next build` succeeds.

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
