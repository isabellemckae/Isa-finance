# ISA Finance — Security

Threat model, controls, and key management. Applies to all phases.

## 1. Assets

| Asset | Sensitivity |
|---|---|
| Plaid access tokens | Critical: they grant ongoing read access to bank data. |
| Supabase service-role key | Critical: it bypasses RLS. |
| Token encryption keys | Critical: with the database, they reveal Plaid tokens. |
| OpenAI API key | High: billing abuse. |
| Transactions, balances, account metadata | High: personal financial data. |
| Session cookies / TOTP secret | High: account takeover. |

## 2. Threat model (STRIDE summary)

| Threat | Example | Controls |
|---|---|---|
| **Spoofing** | Credential stuffing, stolen password | Supabase Auth, TOTP MFA required (AAL2), login rate limit, single-user allowlist, sign-ups disabled. |
| | Forged Plaid webhook | ES256 JWT verification, body SHA-256 check, 5-min `iat` window. |
| **Tampering** | Edit another user's rows via PostgREST with the publishable key | RLS on every table, `anon` revoked, composite ownership FKs, column-level grants. |
| | Modify provider transaction data | Provider rows not updatable by `authenticated`; edits go to `transaction_overrides`. |
| | Audit log tampering | `audit_events` update/delete blocked by trigger. |
| **Repudiation** | "I didn't change that" | `audit_events` for auth, connection, sync, and AI tool events. |
| **Information disclosure** | Secrets in client bundle | Only `NEXT_PUBLIC_SUPABASE_URL` / publishable key are public; secrets read via `server-only` `env.ts`. |
| | Tokens in logs | Logging helper redacts known secret patterns; errors from Plaid are reduced to `error_code`. |
| | Shared cache leaks data | `cacheComponents` off, `Cache-Control: private, no-store` on app routes. |
| | Data sent to OpenAI | Only when `OPENAI_API_KEY` is set. Tool results are minimized (no account numbers beyond the last 4, no tokens, no internal ids, sanitized and truncated text, ≤ 25 transactions per search); requests use `store: false`; tool outputs are never persisted; provider errors are never shown. |
| | XSS exfiltration | Nonce CSP with `strict-dynamic`, React escaping, no `dangerouslySetInnerHTML` with user data. |
| | Clickjacking | `frame-ancestors 'none'`, `X-Frame-Options: DENY`. |
| **Denial of service** | CFO cost abuse | Auth + MFA, same-origin check, 8 requests/min, daily request and token caps in `ai_usage_daily`, 6 tool rounds / 12 calls / 900 output tokens per turn, 45 s timeout. Set a budget limit in the OpenAI dashboard too. |
| **Elevation of privilege** | Prompt injection via merchant name ("ignore previous instructions…") | AI has read-only tools only over a frozen snapshot, user bound server-side, no tool parameter selects a user or id, tool text sanitized and marked untrusted. Amounts in answers are checked against tool results and unverified ones are flagged. Tested in `src/lib/cfo/*.test.ts`. |
| | Service role misuse | Service-role client only in `src/lib/supabase/admin.ts` (`server-only`), used only by Plaid sync/webhook code. |

## 3. Security headers

Set in `src/proxy.ts` and `next.config.ts`:
`Content-Security-Policy` (per-request nonce), `Strict-Transport-Security`
(2 years, includeSubDomains, preload), `X-Content-Type-Options: nosniff`,
`X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`,
`Permissions-Policy` (camera/mic/geolocation off), `Cross-Origin-Opener-Policy: same-origin`,
`Cache-Control: private, no-store` on application routes. `X-Powered-By` disabled.

## 4. Key management: Plaid token encryption

**Storage.** Keys are 32 random bytes, base64-encoded, held only in the hosting
provider's encrypted environment settings (Vercel: Project → Settings → Environment
Variables, "Sensitive"). They are never stored in Supabase, git, or logs.

Generate a key locally (never paste it into chat or commit it):

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

**Rotation** (planned or after suspected exposure):

1. Generate a new key `k(n+1)`. Prepend it to `TOKEN_ENCRYPTION_KEYS` and set
   `TOKEN_ENCRYPTION_ACTIVE_KEY_ID=k(n+1)`. Deploy. New writes use the new key, and old
   ciphertexts still decrypt.
2. Run `npm run tokens:reencrypt` with the new keyring and the service-role key in the
   environment (it reads `.env.local` if present). It decrypts each secret written with an
   older key and re-encrypts it with the active key, updating a row only if it hasn't
   changed since it was read. It prints counts and connection ids only.
3. Verify that no rows reference the old key id, then remove the old key from the
   keyring and deploy.
4. If a key was **compromised**, also rotate the Plaid tokens themselves with
   `/item/access_token/invalidate`, and rotate the Plaid secret in the Plaid dashboard.

**Recovery.** If all keys are lost, stored tokens cannot be decrypted. This is by
design. Recovery path: delete the affected `bank_connection_secrets` rows, mark the
connections `login_required`, and re-link each institution through Plaid Link. Item
history in Plaid is retained, so transactions re-sync. Keep an offline backup of the
keyring (for example in a password manager) to avoid this.

**Supabase service-role key rotation.** Rotate it in Supabase (Project Settings → API
keys), update the hosting environment, and redeploy. Rotate the publishable key the
same way.

## 5. Owner checklist before any live data (Phase 5 gate)

- [ ] Supabase: public sign-ups disabled; email confirmations on; MFA (TOTP) enabled;
      leaked-password protection on; Point-in-time recovery or backups configured.
- [ ] RLS tests pass against the hosted project (`supabase test db` or `npm run test:db`).
- [ ] `REQUIRE_MFA=true`, `AUTH_MODE=supabase`, `ALLOWED_USER_EMAIL` set.
- [ ] Encryption keyring generated, backed up offline, rotation drill performed.
- [ ] Plaid production approval and OAuth institution registration complete.
- [ ] Rate limiting moved to a shared store.
- [ ] OpenAI data-handling terms reviewed; usage limits set in the OpenAI dashboard.
- [ ] Vercel deployment protection / custom domain with HTTPS only.

## 6. Plaid integration controls (Phase 4, sandbox)

| Control | Where |
|---|---|
| Sandbox only: client hard-wired to `PlaidEnvironments.sandbox`; config rejects other `PLAID_ENV`; only `public-sandbox-`/`access-sandbox-` tokens accepted; non-sandbox webhooks rejected | `src/lib/plaid/client.ts`, `service.ts`, `src/lib/config.ts` |
| Only the `transactions` product; no transfer, payment, auth or processor products | `client.ts` |
| Access tokens encrypted (AES-256-GCM, AAD = connection + user) before storage; the database refuses anything not in ciphertext format; never returned to the browser or logged | `src/lib/security/token-crypto.ts`, `create_plaid_connection` |
| Link, exchange and reconnect routes: same-origin check, auth + MFA, per-user rate limit, 1 KB JSON bodies; ownership checked for every connection id | `src/app/api/plaid/*` |
| Webhooks: no session; ES256 JWT signature, key by `kid` (cached), 5-minute `iat` window, raw-body SHA-256, 64 KB cap, per-IP rate limit, idempotent by body hash (failed attempts may be retried) | `webhook-verify.ts`, `service.ts`, `src/proxy.ts` |
| Sync: whole result and cursor committed in one transaction with an optimistic cursor check; owner derived from the connection row; service-role-only SQL functions | `supabase/migrations/…000500_plaid_sync.sql` |
| Plaid errors reduced to their code; users see fixed messages | `client.ts`, `service.ts` |
