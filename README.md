# ISA Finance

A private, single-user, mobile-first **Personal CFO**. It consolidates balances and
transactions, tracks budgets, and (in Phase 3) answers questions with an AI assistant
whose numbers come only from deterministic, tested application code.

> **Status: Phase 1 (foundation).** The dashboard runs on **clearly labeled fictional data**.
> No bank is connected and no real financial data exists anywhere in this project.
> See [`PROJECT_PLAN.md`](PROJECT_PLAN.md) for exactly what is built and what is planned.

| Document | Contents |
|---|---|
| [`PROJECT_PLAN.md`](PROJECT_PLAN.md) | Scope, phases, acceptance criteria, status, risks |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | Database, auth, Plaid design, calculation rules, AI design |
| [`docs/SECURITY.md`](docs/SECURITY.md) | Threat model, headers, key management and rotation |
| [`CLAUDE.md`](CLAUDE.md) | Conventions and security rules for contributors (human or AI) |

## What works today

| Area | State |
|---|---|
| Dashboard (safe-to-spend, cash, debt, net worth, income, spending, budget, bills, savings, cash flow, categories, accounts, activity, insights) | ✅ Working on **fictional data** |
| Finance services: money, balances, classification, transfers, dedupe, budgets, safe-to-spend, debt and savings | ✅ Implemented, unit tested |
| Database schema, Row Level Security, ownership constraints | ✅ Migrations + tests on local Postgres. **Not yet applied to a hosted project** |
| Supabase Auth: password sign-in, TOTP MFA, allowlist, rate limits | ✅ Implemented. **Awaits your Supabase project for end-to-end verification** |
| Security headers, nonce CSP, `no-store`, env validation | ✅ Implemented, tested |
| Accounts, Activity, Budget pages | 🟡 Explicit "Planned for Phase 2" screens |
| Personal CFO chat (OpenAI) | 🟡 Phase 3. The dashboard insight panel is rule-based, not AI |
| Plaid (sandbox) | 🟡 Phase 4: designed, not implemented |
| Supabase-backed data | 🟡 Phase 2. `DATA_SOURCE=supabase` fails loudly instead of showing demo data |

## Local development

Requirements: Node 20.9+ (tested with Node 22) and npm.

```bash
npm install
cp .env.example .env.local     # demo mode; no secrets required
npm run dev                    # http://localhost:3000
```

In demo mode sign-in is disabled and a banner says so. Demo mode is refused when
`NODE_ENV=production`, so it cannot be deployed by accident.

### Checks

```bash
npm run check       # lint + typecheck + unit tests
npm run build       # production build
npm run test:e2e    # Playwright (starts its own dev server in demo mode)
npm run test:db     # RLS tests: needs a local PostgreSQL superuser via PG* env vars
```

`test:db` creates a throwaway database, emulates Supabase's roles and `auth` schema,
applies `supabase/migrations/*`, and asserts cross-user isolation for every table.
Never point it at a hosted project.

## Configuration: what you need to set up (when you're ready)

Never paste secrets into chat, issues, or source files. Put them in `.env.local` for local
use, and in your host's encrypted environment settings for deployments. `.env.example`
lists every variable.

1. **Supabase** (to enable real sign-in):
   - Create a project. Run the SQL in `supabase/migrations/` in order (SQL editor, or
     `supabase db push` with the Supabase CLI).
   - Authentication → Providers: keep Email enabled, **disable new sign-ups**, and create your
     single user under Authentication → Users.
   - Authentication → MFA: enable **TOTP**. Turn on leaked-password protection.
   - Set `AUTH_MODE=supabase`, `NEXT_PUBLIC_SUPABASE_URL`,
     `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` and `ALLOWED_USER_EMAIL`.
     Keep `DATA_SOURCE=demo` until Phase 2.
   - On first sign-in you'll be asked to enroll an authenticator app.
2. **OpenAI** (Phase 3): an API key with a monthly usage limit set in the OpenAI dashboard.
3. **Plaid** (Phase 4): sandbox `client_id` and sandbox secret only.
4. **Encryption keyring** (Phase 4): generated locally, as described in `docs/SECURITY.md`.

The `SUPABASE_SECRET_KEY` (service role) is not needed until Phase 4.

## Security assumptions

- One user. Public sign-up is disabled in Supabase, and the app also enforces `ALLOWED_USER_EMAIL`.
- Every financial read and write goes through the server. The browser never queries
  Supabase tables directly. `requireUser()` re-validates the session with the Auth server,
  and Row Level Security is the final enforcement layer.
- Only the Supabase URL and publishable key are exposed to the browser.
- Bank data stays read-only. The app never initiates payments or transfers.
- Rate limiting is in-memory per instance. That is fine for local and single-instance use;
  move it to a shared store before any public deployment (`PROJECT_PLAN.md`, risk R3).
- See `docs/SECURITY.md` for the full threat model.

## Deployment

The app is Vercel-compatible (`npm run build`, Node runtime, no special adapters).
**Do not deploy yet.** Deployment and any live banking require an explicit review (Phase 5
gate in `PROJECT_PLAN.md`). When approved, set `AUTH_MODE=supabase` and the Supabase
variables in the Vercel project, enable deployment protection, and use HTTPS only.

## Project structure

```
src/proxy.ts            session refresh, optimistic gating, CSP nonce, no-store
src/app/(auth)/         login, MFA setup/verify
src/app/(app)/          authenticated shell + dashboard and section pages
src/lib/finance/        deterministic calculation services (pure, tested)
src/lib/auth/           access policy, data access layer, server actions
src/lib/data/           repository interface + fictional demo dataset
src/lib/security/       CSP, rate limiting
supabase/migrations/    schema + RLS
supabase/tests/         RLS / ownership tests
tests/e2e/              Playwright
```
