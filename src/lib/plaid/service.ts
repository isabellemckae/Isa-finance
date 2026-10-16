import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { ConnectionStatus } from "@/lib/finance/types";
import { decryptToken, encryptToken, type Keyring } from "@/lib/security/token-crypto";
import { mapAll, mapAccount, mapBalance } from "./mapping";
import {
  CursorConflictError,
  PlaidError,
  type ApplySyncResult,
  type ConnectionRecord,
  type PlaidGateway,
  type PlaidStore,
  type SyncTrigger,
} from "./ports";
import { collectTransactionsSync } from "./sync";
import { verifyPlaidWebhook, WebhookVerificationError } from "./webhook-verify";

/**
 * Plaid orchestration: linking, syncing, reconnecting, disconnecting and webhooks.
 * Framework-free; routes supply the authenticated user id and the real gateway/store.
 *
 * Invariants:
 * - Access tokens are decrypted only inside these functions and never returned.
 * - Every user-initiated operation checks that the connection belongs to that user.
 * - Only sandbox items are accepted (public and access token prefixes are checked).
 * - Plaid error messages are never surfaced; users see a fixed message per error code.
 */

export interface PlaidDeps {
  gateway: PlaidGateway;
  store: PlaidStore;
  keyring: Keyring;
  now: () => Date;
  webhookUrl?: string;
  /** OAuth return URL registered with Plaid (needed for OAuth institutions). */
  redirectUri?: string;
  /** Post-sync housekeeping for the owner (transfer detection). Failures don't fail the sync. */
  afterSync?: (userId: string) => Promise<void>;
}

/** A failure that is safe to show the user as-is. */
export class PlaidActionError extends Error {
  constructor(
    message: string,
    readonly code: string = "ACTION_FAILED",
  ) {
    super(message);
    this.name = "PlaidActionError";
  }
}

const NOT_FOUND = () => new PlaidActionError("That bank connection wasn't found.", "NOT_FOUND");

export const publicTokenSchema = z
  .string()
  .trim()
  .regex(/^public-sandbox-[A-Za-z0-9-]{8,200}$/, "Only Plaid sandbox connections are allowed.");

export const connectionIdSchema = z.string().uuid("Invalid connection.");

/** Plaid error codes that change what the connection needs from the user. */
export function statusForErrorCode(code: string): ConnectionStatus | null {
  switch (code) {
    case "ITEM_LOGIN_REQUIRED":
    case "INVALID_CREDENTIALS":
    case "INVALID_MFA":
    case "INVALID_UPDATED_USERNAME":
      return "login_required";
    case "PENDING_EXPIRATION":
      return "pending_expiration";
    case "USER_PERMISSION_REVOKED":
    case "ACCESS_NOT_GRANTED":
      return "revoked";
    case "ITEM_NOT_FOUND":
    case "INVALID_ACCESS_TOKEN":
    case "ITEM_LOCKED":
    case "NO_ACCOUNTS":
      return "error";
    default:
      return null;
  }
}

export function messageForErrorCode(code: string): string {
  switch (statusForErrorCode(code)) {
    case "login_required":
      return "Your bank needs you to sign in again. Use Reconnect.";
    case "revoked":
      return "Access to this bank was revoked. Reconnect to restore it.";
    case "error":
      return "This connection needs to be linked again.";
  }
  switch (code) {
    case "RATE_LIMIT_EXCEEDED":
    case "TRANSACTIONS_LIMIT":
      return "Plaid is limiting requests right now. Try again in a few minutes.";
    case "PRODUCT_NOT_READY":
      return "Transactions are still loading from your bank. Try again shortly.";
    case "INSTITUTION_DOWN":
    case "INSTITUTION_NOT_RESPONDING":
    case "INSTITUTION_NOT_AVAILABLE":
      return "Your bank isn't responding right now. Try again later.";
    default:
      return "Couldn't reach your bank right now. Your existing data is unchanged.";
  }
}

function token(deps: PlaidDeps, conn: ConnectionRecord): string {
  if (!conn.ciphertext || conn.status === "disconnected") {
    throw new PlaidActionError("This connection is disconnected. Link the bank again to resume.", "DISCONNECTED");
  }
  return decryptToken(conn.ciphertext, { connectionId: conn.id, userId: conn.userId }, deps.keyring);
}

async function ownedConnection(deps: PlaidDeps, userId: string, connectionId: string): Promise<ConnectionRecord> {
  const id = connectionIdSchema.safeParse(connectionId);
  if (!id.success) throw NOT_FOUND();
  const conn = await deps.store.getConnection(id.data, userId);
  if (!conn || conn.userId !== userId) throw NOT_FOUND();
  return conn;
}

// ---------------------------------------------------------------------------
// Link
// ---------------------------------------------------------------------------

export async function createLinkToken(
  deps: PlaidDeps,
  userId: string,
  options: { connectionId?: string } = {},
): Promise<{ linkToken: string; expiration: string; mode: "create" | "update" }> {
  if (options.connectionId) {
    const conn = await ownedConnection(deps, userId, options.connectionId);
    const { linkToken, expiration } = await deps.gateway.createLinkToken({
      userId,
      accessToken: token(deps, conn),
      webhookUrl: deps.webhookUrl,
      redirectUri: deps.redirectUri,
    });
    return { linkToken, expiration, mode: "update" };
  }
  const { linkToken, expiration } = await deps.gateway.createLinkToken({
    userId,
    webhookUrl: deps.webhookUrl,
    redirectUri: deps.redirectUri,
  });
  return { linkToken, expiration, mode: "create" };
}

export interface LinkResult {
  connectionId: string;
  institutionName: string | null;
  sync: SyncSummary | null;
  syncError: string | null;
}

export async function exchangePublicToken(deps: PlaidDeps, userId: string, publicToken: string): Promise<LinkResult> {
  const parsed = publicTokenSchema.safeParse(publicToken);
  if (!parsed.success) throw new PlaidActionError("Only Plaid sandbox connections are allowed.", "NOT_SANDBOX");

  const { accessToken, itemId } = await deps.gateway.exchangePublicToken(parsed.data);
  if (!accessToken.startsWith("access-sandbox-")) {
    // Defense in depth: never keep a non-sandbox token, even if one were issued.
    await deps.gateway.removeItem(accessToken).catch(() => undefined);
    throw new PlaidActionError("Only Plaid sandbox connections are allowed.", "NOT_SANDBOX");
  }

  const item = await deps.gateway.getItem(accessToken);
  const institutionName = item.institutionId
    ? await deps.gateway.getInstitutionName(item.institutionId).catch(() => null)
    : null;

  const connectionId = randomUUID();
  const encrypted = encryptToken(accessToken, { connectionId, userId }, deps.keyring);
  try {
    await deps.store.createConnection({
      connectionId,
      userId,
      itemId,
      institution: item.institutionId ? { plaidId: item.institutionId, name: institutionName ?? "Bank" } : null,
      keyId: encrypted.keyId,
      ciphertext: encrypted.ciphertext,
      consentExpiresAt: item.consentExpiresAt,
    });
  } catch (error) {
    // Don't leave an orphaned Item at Plaid if we couldn't store it.
    await deps.gateway.removeItem(accessToken).catch(() => undefined);
    throw error;
  }
  await deps.store.audit(userId, "plaid.connection.created", connectionId, { institution: institutionName });

  try {
    const sync = await syncConnection(deps, { connectionId, trigger: "initial", userId });
    return { connectionId, institutionName, sync, syncError: null };
  } catch (error) {
    // The link itself succeeded; the first sync can be retried.
    const message = error instanceof PlaidActionError ? error.message : "The first sync didn't finish. Use Sync now to retry.";
    return { connectionId, institutionName, sync: null, syncError: message };
  }
}

// ---------------------------------------------------------------------------
// Sync
// ---------------------------------------------------------------------------

export interface SyncSummary {
  status: "synced" | "superseded";
  counts: ApplySyncResult;
  skipped: number;
  updateStatus: string | null;
}

export async function syncConnection(
  deps: PlaidDeps,
  input: { connectionId: string; trigger: SyncTrigger; userId?: string },
): Promise<SyncSummary> {
  const conn = input.userId
    ? await ownedConnection(deps, input.userId, input.connectionId)
    : await deps.store.getConnection(input.connectionId);
  if (!conn) throw NOT_FOUND();
  if (conn.status === "revoked") {
    throw new PlaidActionError(messageForErrorCode("USER_PERMISSION_REVOKED"), "USER_PERMISSION_REVOKED");
  }
  const accessToken = token(deps, conn);
  const runId = await deps.store.startSyncRun({
    connectionId: conn.id,
    userId: conn.userId,
    trigger: input.trigger,
    cursorBefore: conn.cursor,
  });

  try {
    const now = deps.now();
    const collected = await collectTransactionsSync({ gateway: deps.gateway, accessToken, cursor: conn.cursor, now });
    let { accounts, balances } = collected;
    if (accounts.length === 0) {
      const raw = await deps.gateway.getAccounts(accessToken);
      accounts = mapAll(raw, mapAccount).rows;
      balances = mapAll(raw, (r) => mapBalance(r, now)).rows;
    }
    const counts = await deps.store.applySync({
      connectionId: conn.id,
      cursorBefore: collected.cursorBefore,
      cursorAfter: collected.cursorAfter,
      accounts,
      balances,
      added: collected.added,
      modified: collected.modified,
      removed: collected.removed,
    });
    await deps.store.finishSyncRun(runId, { status: "succeeded", counts, cursorAfter: collected.cursorAfter });
    if (deps.afterSync && (counts.added || counts.modified || counts.removed)) {
      await deps.afterSync(conn.userId).catch((e: unknown) =>
        console.error("plaid_after_sync_failed", { name: e instanceof Error ? e.name : typeof e }),
      );
    }
    await deps.store.audit(conn.userId, "plaid.sync.succeeded", conn.id, {
      trigger: input.trigger,
      added: counts.added,
      modified: counts.modified,
      removed: counts.removed,
    });
    return { status: "synced", counts, skipped: collected.skipped, updateStatus: collected.updateStatus };
  } catch (error) {
    if (error instanceof CursorConflictError) {
      // Another sync committed first and already has these changes.
      await deps.store.finishSyncRun(runId, { status: "failed", errorCode: "CURSOR_CONFLICT" });
      return { status: "superseded", counts: { accounts: 0, added: 0, modified: 0, removed: 0 }, skipped: 0, updateStatus: null };
    }
    const code = error instanceof PlaidError ? error.code : "INTERNAL_ERROR";
    await deps.store.finishSyncRun(runId, { status: "failed", errorCode: code.slice(0, 100) });
    if (error instanceof PlaidError) {
      const status = statusForErrorCode(error.code);
      if (status) await deps.store.setStatus(conn.id, status, error.code);
      await deps.store.audit(conn.userId, "plaid.sync.failed", conn.id, { trigger: input.trigger, code: error.code });
      throw new PlaidActionError(messageForErrorCode(error.code), error.code);
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Reconnect (after Link update mode) and disconnect
// ---------------------------------------------------------------------------

export async function completeReconnect(deps: PlaidDeps, userId: string, connectionId: string): Promise<SyncSummary> {
  const conn = await ownedConnection(deps, userId, connectionId);
  const item = await deps.gateway.getItem(token(deps, conn));
  if (item.errorCode) {
    const status = statusForErrorCode(item.errorCode) ?? "error";
    await deps.store.setStatus(conn.id, status, item.errorCode);
    throw new PlaidActionError(messageForErrorCode(item.errorCode), item.errorCode);
  }
  await deps.store.setStatus(conn.id, "active", null);
  await deps.store.audit(userId, "plaid.connection.reconnected", conn.id);
  return syncConnection(deps, { connectionId: conn.id, trigger: "manual", userId });
}

const IGNORABLE_ON_REMOVE = new Set(["ITEM_NOT_FOUND", "INVALID_ACCESS_TOKEN"]);

export async function disconnectConnection(deps: PlaidDeps, userId: string, connectionId: string): Promise<void> {
  const conn = await ownedConnection(deps, userId, connectionId);
  if (conn.ciphertext && conn.status !== "disconnected") {
    try {
      await deps.gateway.removeItem(token(deps, conn));
    } catch (error) {
      if (!(error instanceof PlaidError && IGNORABLE_ON_REMOVE.has(error.code))) {
        throw new PlaidActionError("Couldn't reach Plaid to remove the connection. Nothing was changed; try again.", "REMOVE_FAILED");
      }
    }
  }
  await deps.store.markDisconnected(conn.id);
  await deps.store.audit(userId, "plaid.connection.disconnected", conn.id);
}

// ---------------------------------------------------------------------------
// Webhooks
// ---------------------------------------------------------------------------

export const webhookBodySchema = z.object({
  webhook_type: z.string().min(1).max(60),
  webhook_code: z.string().min(1).max(60),
  item_id: z.string().min(1).max(200).nullable().optional(),
  environment: z.string().max(20).optional(),
  error: z.object({ error_code: z.string().max(100).optional() }).nullable().optional(),
});

const SYNC_CODES = new Set(["SYNC_UPDATES_AVAILABLE", "DEFAULT_UPDATE", "INITIAL_UPDATE", "HISTORICAL_UPDATE", "TRANSACTIONS_REMOVED"]);

export type WebhookOutcome =
  | { result: "rejected"; reason: string }
  | { result: "duplicate" }
  | { result: "ignored" }
  | { result: "accepted"; followUp: (() => Promise<void>) | null };

/**
 * Verifies, de-duplicates and dispatches a webhook. Status changes happen before the
 * response; a sync (if needed) is returned as `followUp` for the route to run after
 * responding, because Plaid expects a fast reply.
 */
export async function handleWebhook(
  deps: PlaidDeps,
  input: { rawBody: string; verificationHeader: string | null },
): Promise<WebhookOutcome> {
  let bodySha256: string;
  try {
    ({ bodySha256 } = await verifyPlaidWebhook({
      rawBody: input.rawBody,
      verificationHeader: input.verificationHeader,
      getKey: (kid) => deps.gateway.getWebhookKey(kid),
      now: deps.now(),
    }));
  } catch (error) {
    if (error instanceof WebhookVerificationError) return { result: "rejected", reason: error.message };
    throw error;
  }

  let json: unknown;
  try {
    json = JSON.parse(input.rawBody);
  } catch {
    return { result: "rejected", reason: "Body is not JSON." };
  }
  const parsed = webhookBodySchema.safeParse(json);
  if (!parsed.success) return { result: "rejected", reason: "Unexpected webhook shape." };
  const body = parsed.data;
  if (body.environment && body.environment !== "sandbox") return { result: "rejected", reason: "Non-sandbox webhook." };

  const recorded = await deps.store.recordWebhook({
    bodySha256,
    type: body.webhook_type,
    code: body.webhook_code,
    itemId: body.item_id ?? null,
  });
  if (recorded === "duplicate") return { result: "duplicate" };

  try {
    return await dispatchWebhook(deps, body, bodySha256);
  } catch (error) {
    // Marked failed so Plaid's retry of this same body is processed again.
    await deps.store.markWebhook(bodySha256, "failed").catch(() => undefined);
    throw error;
  }
}

async function dispatchWebhook(
  deps: PlaidDeps,
  body: z.infer<typeof webhookBodySchema>,
  bodySha256: string,
): Promise<WebhookOutcome> {
  const conn = body.item_id ? await deps.store.getConnectionByItemId(body.item_id) : null;
  if (!conn || conn.status === "disconnected") {
    await deps.store.markWebhook(bodySha256, "ignored");
    return { result: "ignored" };
  }

  const finish = (status: "processed" | "ignored" | "failed") => deps.store.markWebhook(bodySha256, status);
  const syncLater = () => async () => {
    try {
      await syncConnection(deps, { connectionId: conn.id, trigger: "webhook" });
      await finish("processed");
    } catch {
      // The failure is recorded on the sync run and connection; the next webhook or
      // manual sync resumes from the last committed cursor.
      await finish("failed");
    }
  };

  if (body.webhook_type === "TRANSACTIONS" && SYNC_CODES.has(body.webhook_code)) {
    return { result: "accepted", followUp: syncLater() };
  }

  if (body.webhook_type === "ITEM") {
    const audit = (action: string) => deps.store.audit(conn.userId, action, conn.id, { code: body.webhook_code });
    switch (body.webhook_code) {
      case "ERROR": {
        const code = body.error?.error_code ?? "ITEM_ERROR";
        await deps.store.setStatus(conn.id, statusForErrorCode(code) ?? "error", code);
        await audit("plaid.item.error");
        await finish("processed");
        return { result: "accepted", followUp: null };
      }
      case "PENDING_EXPIRATION":
      case "PENDING_DISCONNECT":
        await deps.store.setStatus(conn.id, "pending_expiration", body.webhook_code);
        await audit("plaid.item.pending_expiration");
        await finish("processed");
        return { result: "accepted", followUp: null };
      case "USER_PERMISSION_REVOKED":
      case "USER_ACCOUNT_REVOKED":
        await deps.store.setStatus(conn.id, "revoked", body.webhook_code);
        await audit("plaid.item.revoked");
        await finish("processed");
        return { result: "accepted", followUp: null };
      case "LOGIN_REPAIRED":
        await deps.store.setStatus(conn.id, "active", null);
        await audit("plaid.item.login_repaired");
        return { result: "accepted", followUp: syncLater() };
      case "NEW_ACCOUNTS_AVAILABLE":
        await audit("plaid.item.new_accounts_available");
        await finish("processed");
        return { result: "accepted", followUp: null };
    }
  }

  await finish("ignored");
  return { result: "ignored" };
}
