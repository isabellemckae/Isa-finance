# CLAUDE.md: ISA Finance conventions

@AGENTS.md

Private, single-user personal finance app. Read `PROJECT_PLAN.md` (scope and status),
`ARCHITECTURE.md` (design) and `docs/SECURITY.md` (threat model) before changing anything
non-trivial. Update the status section of `PROJECT_PLAN.md` when a phase item changes.

## Commands

```bash
npm run dev          # local dev (demo mode by default)
npm run lint         # ESLint
npm run typecheck    # tsc --noEmit
npm test             # Vitest unit tests
npm run test:db      # RLS/ownership tests on a throwaway local Postgres
npm run test:integration  # Supabase repository vs real PostgREST (Docker + local Postgres)
npm run test:e2e     # Playwright (demo mode)
npm run build        # production build
npm run check        # lint + typecheck + unit tests
```

Run `npm run check` after every meaningful change, and run `test:db` after any migration change.

## Hard rules (security)

- Never commit, log, or print secrets: Plaid tokens, API keys, service-role key,
  encryption keys. `.env*` files are git-ignored except `.env.example` (names only).
- Never ask the owner to paste secrets into chat. Explain where to set them instead.
- Secrets are read **only** through `src/lib/env.ts` (`server-only`). Only
  `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` may be public.
- Every page, server action and route handler that touches financial data calls
  `requireUser()` first and passes `user.id` down. Never trust a user id from input.
  Pages use `loadPageData()`; mutations go through `runAction()` in `src/lib/actions/run.ts`,
  which authorizes, binds the repository to the user and maps errors to safe messages.
- Validate every form field with the helpers in `src/lib/forms.ts` (strict money parsing,
  plain ids, bounded text). Ids are interpolated into PostgREST filters only after
  `idField`/UUID validation.
- The demo repository and the Supabase repository must enforce the same rules (for example,
  manual-only operations). Add a case to both `store.test.ts` and the integration test.
- Every new user-owned table: `user_id` column, RLS enabled and forced, the four owner
  policies, composite FK to parents, `revoke all from anon`, and a test in
  `supabase/tests/rls.test.sql`.
- The service-role client (`src/lib/supabase/admin.ts`) is only for the Plaid
  sync and webhook paths.
- No payment initiation, transfers or money movement, ever. The AI gets read-only tools only.
- Personal CFO tools (`src/lib/cfo/tools.ts`) read only the frozen `CfoContext`. They never
  take a user or id parameter, never return internal ids or tokens, and every new tool needs
  permission, isolation and accuracy tests in `tools.test.ts`. The model must not do
  arithmetic: add a deterministic tool instead.
- Plaid stays in `sandbox`. Production banking, live data and deployments need explicit
  owner approval.
- Don't connect live financial accounts or real data without authorization.

## Money and finance rules

- Money is an integer number of **minor units** (`amountMinor`), plus a `currency`. No floats
  for money and no `parseFloat` on amounts. Use `src/lib/finance/money.ts`.
- Sign: negative = money out of the account, positive = money in. Credit `current` =
  amount owed. Credit limits and available credit are **never** cash.
- All financial numbers come from pure functions in `src/lib/finance/*` with tests.
  The UI and the AI only display what these return.
- Always carry and display data status: `posted`, `pending`, `estimated`, `stale`,
  `unavailable`.
- Fictional data must be labeled. Demo entities have `isDemo: true` and the UI shows the
  demo banner.
- Dates for transactions are `YYYY-MM-DD` strings; use `src/lib/finance/dates.ts`, not
  `new Date('YYYY-MM-DD')` arithmetic.

## Code conventions

- TypeScript strict; no `any`. Validate all external input with Zod at the boundary.
- Server-only modules start with `import "server-only"`.
- Prefer Server Components. Client components only for interactivity (charts, nav, forms).
- UI primitives live in `src/components/ui` (shadcn-style). Use the design tokens in
  `globals.css`, not raw hex values.
- Accessibility: labeled controls, visible focus, sufficient contrast, and amounts
  announced with sign and context (`aria-label`).
- No silent placeholders. An unfinished feature renders an explicit "Planned for Phase N"
  state, and an unconfigured integration fails with a clear message.
- Next.js 16 is newer than most training data. Check `node_modules/next/dist/docs/`
  before using an unfamiliar API. Middleware is `src/proxy.ts`.
