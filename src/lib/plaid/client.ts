import "server-only";
import { Configuration, CountryCode, PlaidApi, PlaidEnvironments, Products } from "plaid";
import { PlaidError, type PlaidGateway, type PlaidItemInfo, type SyncPage } from "./ports";
import { plaidJwkSchema, type PlaidJwk } from "./webhook-verify";

/**
 * The real Plaid gateway. Sandbox only: the base path is hard-wired to
 * `PlaidEnvironments.sandbox`, independent of configuration, so no setting can point
 * this code at production. Enabling production requires a reviewed code change
 * (Phase 5 gate, see PROJECT_PLAN.md).
 *
 * Only read products are requested (`transactions`). No transfer, payment
 * initiation, auth or processor products are ever used.
 */

const CLIENT_NAME = "ISA Finance";
const KEY_CACHE_MS = 24 * 60 * 60 * 1000;
const NEGATIVE_KEY_CACHE_MS = 60 * 1000;
const MAX_CACHED_KEYS = 20;

export function toPlaidError(error: unknown): PlaidError {
  if (error instanceof PlaidError) return error;
  // The SDK throws axios errors; read only Plaid's documented error fields from them.
  if (typeof error === "object" && error !== null && (error as { isAxiosError?: unknown }).isAxiosError === true) {
    const e = error as { code?: string; response?: { status?: number; data?: { error_code?: unknown; error_type?: unknown } } };
    const data = e.response?.data;
    const code = typeof data?.error_code === "string" ? data.error_code : e.code === "ECONNABORTED" ? "TIMEOUT" : "NETWORK_ERROR";
    const type = typeof data?.error_type === "string" ? data.error_type : "API_ERROR";
    return new PlaidError(code, type, e.response?.status ?? null);
  }
  return new PlaidError("UNKNOWN_ERROR");
}

async function call<T>(fn: () => Promise<{ data: T }>): Promise<T> {
  try {
    return (await fn()).data;
  } catch (error) {
    // Never rethrow the raw error: it may carry request bodies with tokens.
    throw toPlaidError(error);
  }
}

export function createPlaidGateway(options: { clientId: string; secret: string; timeoutMs?: number }): PlaidGateway {
  const api = new PlaidApi(
    new Configuration({
      basePath: PlaidEnvironments.sandbox,
      baseOptions: {
        timeout: options.timeoutMs ?? 30_000,
        headers: { "PLAID-CLIENT-ID": options.clientId, "PLAID-SECRET": options.secret, "Plaid-Version": "2020-09-14" },
      },
    }),
  );
  const keyCache = new Map<string, { jwk: PlaidJwk | null; at: number }>();

  return {
    async createLinkToken({ userId, accessToken, webhookUrl, redirectUri }) {
      const data = await call(() =>
        api.linkTokenCreate({
          client_name: CLIENT_NAME,
          language: "en",
          country_codes: [CountryCode.Us],
          user: { client_user_id: userId },
          ...(accessToken
            ? { access_token: accessToken }
            : { products: [Products.Transactions], transactions: { days_requested: 730 } }),
          ...(webhookUrl ? { webhook: webhookUrl } : {}),
          ...(redirectUri ? { redirect_uri: redirectUri } : {}),
        }),
      );
      return { linkToken: data.link_token, expiration: data.expiration };
    },

    async exchangePublicToken(publicToken) {
      const data = await call(() => api.itemPublicTokenExchange({ public_token: publicToken }));
      return { accessToken: data.access_token, itemId: data.item_id };
    },

    async getItem(accessToken): Promise<PlaidItemInfo> {
      const data = await call(() => api.itemGet({ access_token: accessToken }));
      return {
        itemId: data.item.item_id,
        institutionId: data.item.institution_id ?? null,
        errorCode: data.item.error?.error_code ?? null,
        consentExpiresAt: data.item.consent_expiration_time ?? null,
      };
    },

    async getInstitutionName(institutionId) {
      const data = await call(() => api.institutionsGetById({ institution_id: institutionId, country_codes: [CountryCode.Us] }));
      return data.institution.name ?? null;
    },

    async getAccounts(accessToken) {
      const data = await call(() => api.accountsGet({ access_token: accessToken }));
      return data.accounts;
    },

    async transactionsSync(accessToken, cursor, count): Promise<SyncPage> {
      const data = await call(() =>
        api.transactionsSync({
          access_token: accessToken,
          count,
          ...(cursor ? { cursor } : {}),
          options: { include_personal_finance_category: true },
        }),
      );
      return {
        added: data.added,
        modified: data.modified,
        removed: data.removed,
        accounts: data.accounts ?? [],
        nextCursor: data.next_cursor,
        hasMore: data.has_more,
        updateStatus: data.transactions_update_status ?? null,
      };
    },

    async removeItem(accessToken) {
      await call(() => api.itemRemove({ access_token: accessToken }));
    },

    async getWebhookKey(kid) {
      const cached = keyCache.get(kid);
      const ttl = cached?.jwk ? KEY_CACHE_MS : NEGATIVE_KEY_CACHE_MS;
      if (cached && Date.now() - cached.at < ttl) return cached.jwk;
      let jwk: PlaidJwk | null = null;
      try {
        const data = await call(() => api.webhookVerificationKeyGet({ key_id: kid }));
        const parsed = plaidJwkSchema.safeParse(data.key);
        jwk = parsed.success ? parsed.data : null;
      } catch (error) {
        if (!(error instanceof PlaidError && error.status === 400)) throw error;
      }
      if (keyCache.size >= MAX_CACHED_KEYS) keyCache.delete(keyCache.keys().next().value as string);
      keyCache.set(kid, { jwk, at: Date.now() });
      return jwk;
    },
  };
}
