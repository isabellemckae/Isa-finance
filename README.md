# ISA Finance

A private, single-user, mobile-first **Personal CFO**. It consolidates balances and
transactions, tracks budgets, and answers questions with an AI assistant whose numbers
come only from deterministic, tested application code.

> **Status: Phase 3 complete.** Accounts, Activity, Budget and the Personal CFO are built.
> Data comes from **clearly labeled fictional demo data** or from your own Supabase project.
> No bank is connected. The CFO uses OpenAI only when you set `OPENAI_API_KEY`; without
> it, it gives calculated (non-AI) answers. Plaid (Phase 4) is sandbox-only.
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
| Dashboard (safe-to-spend, balances, income/spending, budget, bills, savings, cash flow, insights) | ✅ |
| Accounts: groups, connection health, credit utilization, detail, nicknames, hide, manual accounts and balance history | ✅ |
| Activity: search, filters, review queue, categories/notes/exclusions as overrides, transfer linking, CSV import with preview and dedupe, manual entry | ✅ |
| Budget: monthly plan, planned vs actual, month-over-month, bills, income (incl. irregular), savings goals, debt payoff, paycheck allocation | ✅ |
| Supabase-backed data (`DATA_SOURCE=supabase`) with RLS | ✅ Verified against local Postgres + PostgREST. **Not yet run against your hosted project** |
| Demo mode with temporary in-memory edits | ✅ |
| Supabase Auth: password sign-in, TOTP MFA, allowlist, rate limits | ✅ Implemented. **Needs your Supabase project for end-to-end verification** |
| Personal CFO chat: 15 read-only tools, conversation history, follow-ups, verified amounts, offline fallback | ✅ Calculated answers work today. **AI answers need your OpenAI key** |
| Proactive insights (unusual or duplicate charges, spikes, low-cash forecast, budget, bills, savings) and weekly/monthly briefings | ✅ |
| Plaid (sandbox) linking, reconnect, disconnect | ⏸ Phase 4. Buttons are shown disabled |

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
npm run test:integration  # Supabase repository vs real PostgREST: needs Postgres + Docker
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
   - Set `DATA_SOURCE=supabase` to store your own data (manual accounts, CSV imports,
     budgets, goals) in Supabase. Leave it as `demo` to keep previewing fictional data
     behind real sign-in.
   - On first sign-in you'll be asked to enroll an authenticator app.
2. **OpenAI** (Personal CFO, optional): create a project-scoped API key at
   platform.openai.com and set a monthly budget limit on that project. Put it in
   `OPENAI_API_KEY` (`.env.local`, or your host's encrypted settings). Optionally set
   `OPENAI_MODEL`, `CFO_DAILY_REQUEST_LIMIT` and `CFO_DAILY_TOKEN_LIMIT`. Requests are
   sent with `store: false`. Review OpenAI's API data-usage policy, and ask about
   zero-data-retention if you want it.
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
src/lib/data/           repository interface, demo store, Supabase repository
src/lib/actions/        server actions (validated, authorized, audited)
src/lib/security/       CSP, rate limiting
supabase/migrations/    schema + RLS
supabase/tests/         RLS / ownership tests + integration seed
scripts/                integration test runner (PostgREST in Docker)
tests/e2e/              Playwright
```
