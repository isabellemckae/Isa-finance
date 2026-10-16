import "server-only";
import { getEnv } from "@/lib/env";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { SupabaseRepository } from "@/lib/data/supabase/repository";
import { linkDetectedTransfers } from "@/lib/data/operations";
import { parseKeyring } from "@/lib/security/token-crypto";
import { createPlaidGateway } from "./client";
import { PlaidNotConfiguredError, type PlaidGateway } from "./ports";
import { plaidReadiness } from "./readiness";
import type { PlaidDeps } from "./service";
import { SupabasePlaidStore } from "./supabase-store";

/**
 * Wires the Plaid service to the real gateway, the service-role store and the
 * encryption keyring. Throws `PlaidNotConfiguredError` (naming variables, never
 * values) when anything is missing.
 */

let gateway: PlaidGateway | null = null;

export function getPlaidDeps(): PlaidDeps {
  const env = getEnv();
  const readiness = plaidReadiness(env);
  if (!readiness.ready) {
    throw new PlaidNotConfiguredError(
      readiness.reason === "demo"
        ? "Bank linking needs Supabase mode. Demo mode uses fictional data only."
        : `Bank linking isn't configured. Missing: ${readiness.missing.join(", ")}.`,
    );
  }
  gateway ??= createPlaidGateway({ clientId: env.PLAID_CLIENT_ID!, secret: env.PLAID_SECRET! });
  const admin = createSupabaseAdminClient();
  return {
    gateway,
    store: new SupabasePlaidStore(admin),
    keyring: parseKeyring(env.TOKEN_ENCRYPTION_KEYS, env.TOKEN_ENCRYPTION_ACTIVE_KEY_ID),
    now: () => new Date(),
    webhookUrl: env.PLAID_WEBHOOK_URL,
    redirectUri: env.PLAID_REDIRECT_URI,
    // Same transfer detection as CSV imports, scoped to the connection's owner.
    afterSync: async (userId) => {
      await linkDetectedTransfers(new SupabaseRepository(admin, userId), new Date());
    },
  };
}
