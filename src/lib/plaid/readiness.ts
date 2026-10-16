import type { AppEnv } from "@/lib/config";

/**
 * Whether bank linking can run, and if not, exactly what is missing. Pure, so the
 * Accounts page can explain the state without exposing any values.
 */

export type PlaidReadiness =
  | { ready: true; webhooks: boolean }
  | { ready: false; reason: "demo" | "missing_config"; missing: string[] };

export function plaidReadiness(
  env: Pick<
    AppEnv,
    | "DATA_SOURCE"
    | "AUTH_MODE"
    | "PLAID_CLIENT_ID"
    | "PLAID_SECRET"
    | "PLAID_ENV"
    | "PLAID_WEBHOOK_URL"
    | "TOKEN_ENCRYPTION_KEYS"
    | "TOKEN_ENCRYPTION_ACTIVE_KEY_ID"
    | "SUPABASE_SECRET_KEY"
    | "NEXT_PUBLIC_SUPABASE_URL"
  >,
): PlaidReadiness {
  if (env.DATA_SOURCE !== "supabase" || env.AUTH_MODE !== "supabase") {
    return { ready: false, reason: "demo", missing: [] };
  }
  const required = {
    PLAID_CLIENT_ID: env.PLAID_CLIENT_ID,
    PLAID_SECRET: env.PLAID_SECRET,
    TOKEN_ENCRYPTION_KEYS: env.TOKEN_ENCRYPTION_KEYS,
    TOKEN_ENCRYPTION_ACTIVE_KEY_ID: env.TOKEN_ENCRYPTION_ACTIVE_KEY_ID,
    SUPABASE_SECRET_KEY: env.SUPABASE_SECRET_KEY,
    NEXT_PUBLIC_SUPABASE_URL: env.NEXT_PUBLIC_SUPABASE_URL,
  };
  const missing = Object.entries(required)
    .filter(([, value]) => !value)
    .map(([name]) => name);
  if (env.PLAID_ENV !== "sandbox") missing.push("PLAID_ENV=sandbox");
  if (missing.length) return { ready: false, reason: "missing_config", missing };
  return { ready: true, webhooks: Boolean(env.PLAID_WEBHOOK_URL) };
}
