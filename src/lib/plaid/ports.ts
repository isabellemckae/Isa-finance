import type { ConnectionStatus } from "@/lib/finance/types";
import type { AccountRow, BalanceRow, TransactionRow } from "./mapping";
import type { PlaidJwk } from "./webhook-verify";

/**
 * Boundaries of the Plaid integration. `PlaidGateway` wraps Plaid's API (implemented in
 * `client.ts`); `PlaidStore` wraps the privileged database operations (implemented in
 * `store.ts` with the service-role client). The orchestration in `service.ts` and
 * `sync.ts` only sees these interfaces, so it is tested with fakes.
 */

/** A Plaid API failure reduced to its documented code and type. Messages are never surfaced. */
export class PlaidError extends Error {
  constructor(
    readonly code: string,
    readonly type: string = "API_ERROR",
    readonly status: number | null = null,
  ) {
    super(`Plaid error ${code}`);
    this.name = "PlaidError";
  }
}

export class PlaidNotConfiguredError extends Error {
  constructor(message = "Bank linking isn't configured.") {
    super(message);
    this.name = "PlaidNotConfiguredError";
  }
}

/** Another sync committed first; this run's results are stale and were discarded. */
export class CursorConflictError extends Error {
  constructor() {
    super("Sync cursor changed during the sync.");
    this.name = "CursorConflictError";
  }
}

export interface SyncPage {
  added: unknown[];
  modified: unknown[];
  removed: unknown[];
  accounts: unknown[];
  nextCursor: string;
  hasMore: boolean;
  /** Plaid's `transactions_update_status`, e.g. NOT_READY, HISTORICAL_UPDATE_COMPLETE. */
  updateStatus: string | null;
}

export interface PlaidItemInfo {
  itemId: string;
  institutionId: string | null;
  errorCode: string | null;
  consentExpiresAt: string | null;
}

export interface PlaidGateway {
  createLinkToken(input: {
    userId: string;
    accessToken?: string;
    webhookUrl?: string;
    redirectUri?: string;
  }): Promise<{ linkToken: string; expiration: string }>;
  exchangePublicToken(publicToken: string): Promise<{ accessToken: string; itemId: string }>;
  getItem(accessToken: string): Promise<PlaidItemInfo>;
  getInstitutionName(institutionId: string): Promise<string | null>;
  getAccounts(accessToken: string): Promise<unknown[]>;
  transactionsSync(accessToken: string, cursor: string | null, count: number): Promise<SyncPage>;
  removeItem(accessToken: string): Promise<void>;
  getWebhookKey(kid: string): Promise<PlaidJwk | null>;
}

export interface ConnectionRecord {
  id: string;
  userId: string;
  itemId: string;
  status: ConnectionStatus;
  cursor: string | null;
  institutionName: string | null;
  /** Encrypted access token; null once disconnected. */
  ciphertext: string | null;
}

export type SyncTrigger = "initial" | "webhook" | "manual" | "scheduled";

export interface ApplySyncInput {
  connectionId: string;
  cursorBefore: string | null;
  cursorAfter: string;
  accounts: AccountRow[];
  balances: BalanceRow[];
  added: TransactionRow[];
  modified: TransactionRow[];
  removed: string[];
}

export interface ApplySyncResult {
  accounts: number;
  added: number;
  modified: number;
  removed: number;
}

export interface PlaidStore {
  createConnection(input: {
    connectionId: string;
    userId: string;
    itemId: string;
    institution: { plaidId: string; name: string } | null;
    keyId: string;
    ciphertext: string;
    consentExpiresAt: string | null;
  }): Promise<void>;
  /** With `userId`, returns null unless the connection belongs to that user. */
  getConnection(connectionId: string, userId?: string): Promise<ConnectionRecord | null>;
  getConnectionByItemId(itemId: string): Promise<ConnectionRecord | null>;
  setStatus(connectionId: string, status: ConnectionStatus, errorCode: string | null): Promise<void>;
  startSyncRun(input: { connectionId: string; userId: string; trigger: SyncTrigger; cursorBefore: string | null }): Promise<string>;
  finishSyncRun(
    runId: string,
    result: { status: "succeeded" | "failed"; counts?: ApplySyncResult; cursorAfter?: string | null; errorCode?: string | null },
  ): Promise<void>;
  /** Applies one sync atomically and advances the cursor, or throws `CursorConflictError`. */
  applySync(input: ApplySyncInput): Promise<ApplySyncResult>;
  /**
   * Records a webhook by body hash; "duplicate" when the same body was already
   * received, unless that earlier attempt failed (then it is processed again).
   */
  recordWebhook(input: { bodySha256: string; type: string; code: string; itemId: string | null }): Promise<"new" | "duplicate">;
  markWebhook(bodySha256: string, status: "processed" | "ignored" | "failed"): Promise<void>;
  /** Deletes the stored token, clears the cursor and marks the connection disconnected. */
  markDisconnected(connectionId: string): Promise<void>;
  audit(userId: string, action: string, entityId: string | null, metadata?: Record<string, string | number | boolean | null>): Promise<void>;
}
