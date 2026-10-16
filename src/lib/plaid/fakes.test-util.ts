import { generateKeyPairSync, randomBytes, sign } from "node:crypto";
import type { ConnectionStatus } from "@/lib/finance/types";
import { parseKeyring } from "@/lib/security/token-crypto";
import type { TransactionRow } from "./mapping";
import {
  CursorConflictError,
  PlaidError,
  type ApplySyncInput,
  type ApplySyncResult,
  type ConnectionRecord,
  type PlaidGateway,
  type PlaidItemInfo,
  type PlaidStore,
  type SyncPage,
  type SyncTrigger,
} from "./ports";
import type { PlaidDeps } from "./service";
import { sha256Hex, type PlaidJwk } from "./webhook-verify";

/** Test doubles for the Plaid gateway and store. Not imported by application code. */

export const NOW = new Date("2026-10-16T18:00:00Z");

export function plaidTx(id: string, over: Record<string, unknown> = {}) {
  return {
    transaction_id: id,
    account_id: "acc-checking",
    amount: 10,
    iso_currency_code: "USD",
    date: "2026-10-15",
    name: `Purchase ${id}`,
    merchant_name: null,
    pending: false,
    pending_transaction_id: null,
    payment_channel: "online",
    personal_finance_category: { primary: "GENERAL_MERCHANDISE", detailed: null },
    ...over,
  };
}

export const plaidAccounts = [
  {
    account_id: "acc-checking",
    name: "Plaid Checking",
    official_name: "Plaid Gold Standard 0% Interest Checking",
    mask: "0000",
    type: "depository",
    subtype: "checking",
    balances: { available: 100, current: 110, limit: null, iso_currency_code: "USD", last_updated_datetime: null },
  },
  {
    account_id: "acc-card",
    name: "Plaid Credit Card",
    official_name: null,
    mask: "3333",
    type: "credit",
    subtype: "credit card",
    balances: { available: 6_600, current: 410, limit: 7_000, iso_currency_code: "USD", last_updated_datetime: null },
  },
];

export class FakeGateway implements PlaidGateway {
  pages: SyncPage[] = [];
  /** Errors thrown by successive transactionsSync calls (undefined = no error). */
  syncErrors: Array<PlaidError | undefined> = [];
  syncCalls: Array<string | null> = [];
  removed: string[] = [];
  linkTokenRequests: Array<{ userId: string; accessToken?: string; webhookUrl?: string }> = [];
  item: PlaidItemInfo = { itemId: "item-1", institutionId: "ins_109508", errorCode: null, consentExpiresAt: null };
  accessToken = "access-sandbox-11111111-2222-3333-4444-555555555555";
  removeError: PlaidError | null = null;
  webhookKeys = new Map<string, PlaidJwk>();
  private pageIndex = 0;

  async createLinkToken(input: { userId: string; accessToken?: string; webhookUrl?: string }) {
    this.linkTokenRequests.push(input);
    return { linkToken: `link-sandbox-${this.linkTokenRequests.length}`, expiration: "2026-10-16T22:00:00Z" };
  }
  async exchangePublicToken() {
    return { accessToken: this.accessToken, itemId: this.item.itemId };
  }
  async getItem() {
    return this.item;
  }
  async getInstitutionName() {
    return "First Platypus Bank";
  }
  async getAccounts() {
    return plaidAccounts;
  }
  async transactionsSync(_token: string, cursor: string | null): Promise<SyncPage> {
    this.syncCalls.push(cursor);
    const error = this.syncErrors.shift();
    if (error) {
      this.pageIndex = 0;
      throw error;
    }
    const page = this.pages[this.pageIndex];
    if (!page) throw new Error("No more fake pages");
    this.pageIndex = page.hasMore ? this.pageIndex + 1 : 0;
    return page;
  }
  async removeItem(accessToken: string) {
    if (this.removeError) throw this.removeError;
    this.removed.push(accessToken);
  }
  async getWebhookKey(kid: string) {
    return this.webhookKeys.get(kid) ?? null;
  }
}

export function page(over: Partial<SyncPage> = {}): SyncPage {
  return { added: [], modified: [], removed: [], accounts: plaidAccounts, nextCursor: "c1", hasMore: false, updateStatus: "HISTORICAL_UPDATE_COMPLETE", ...over };
}

interface StoredTx extends TransactionRow {
  removed: boolean;
  supersededBy: string | null;
}

export class MemoryStore implements PlaidStore {
  connections = new Map<string, ConnectionRecord & { keyId: string; errorCode: string | null }>();
  accounts = new Map<string, { connectionId: string; row: ApplySyncInput["accounts"][number] }>();
  balances: ApplySyncInput["balances"] = [];
  transactions = new Map<string, StoredTx>();
  runs = new Map<string, { trigger: SyncTrigger; status: string; errorCode?: string | null; counts?: ApplySyncResult }>();
  webhooks = new Map<string, string>();
  audits: Array<{ userId: string; action: string; entityId: string | null; metadata?: Record<string, unknown> }> = [];
  /** Makes the next status change fail, to test webhook retries. */
  failNextSetStatus = false;
  /** Simulates another sync committing between our read and write. */
  conflictOnce = false;

  async createConnection(input: Parameters<PlaidStore["createConnection"]>[0]) {
    for (const c of this.connections.values()) if (c.itemId === input.itemId) throw new Error("duplicate item");
    this.connections.set(input.connectionId, {
      id: input.connectionId,
      userId: input.userId,
      itemId: input.itemId,
      status: "active",
      cursor: null,
      institutionName: input.institution?.name ?? null,
      ciphertext: input.ciphertext,
      keyId: input.keyId,
      errorCode: null,
    });
  }
  async getConnection(id: string, userId?: string) {
    const c = this.connections.get(id);
    if (!c || (userId && c.userId !== userId)) return null;
    return { ...c };
  }
  async getConnectionByItemId(itemId: string) {
    for (const c of this.connections.values()) if (c.itemId === itemId) return { ...c };
    return null;
  }
  async setStatus(id: string, status: ConnectionStatus, errorCode: string | null) {
    if (this.failNextSetStatus) {
      this.failNextSetStatus = false;
      throw new Error("database unavailable");
    }
    const c = this.connections.get(id)!;
    c.status = status;
    c.errorCode = errorCode;
  }
  async startSyncRun(input: { trigger: SyncTrigger }) {
    const id = `run-${this.runs.size + 1}`;
    this.runs.set(id, { trigger: input.trigger, status: "running" });
    return id;
  }
  async finishSyncRun(runId: string, result: { status: string; errorCode?: string | null; counts?: ApplySyncResult }) {
    Object.assign(this.runs.get(runId)!, result);
  }
  async applySync(input: ApplySyncInput): Promise<ApplySyncResult> {
    const c = this.connections.get(input.connectionId)!;
    if (this.conflictOnce) {
      this.conflictOnce = false;
      c.cursor = "someone-else";
    }
    if (c.cursor !== input.cursorBefore) throw new CursorConflictError();
    for (const a of input.accounts) this.accounts.set(a.provider_account_id, { connectionId: c.id, row: a });
    this.balances.push(...input.balances);
    for (const t of [...input.added, ...input.modified]) {
      this.transactions.set(t.external_id, { ...t, removed: false, supersededBy: null });
      if (t.pending_external_id) {
        const pending = this.transactions.get(t.pending_external_id);
        if (pending) pending.supersededBy = t.external_id;
      }
    }
    for (const id of input.removed) {
      const t = this.transactions.get(id);
      if (t) t.removed = true;
    }
    c.cursor = input.cursorAfter;
    if (c.status !== "pending_expiration") {
      c.status = "active";
      c.errorCode = null;
    }
    return { accounts: input.accounts.length, added: input.added.length, modified: input.modified.length, removed: input.removed.length };
  }
  async recordWebhook(input: { bodySha256: string }) {
    const existing = this.webhooks.get(input.bodySha256);
    if (existing && existing !== "failed") return "duplicate" as const;
    this.webhooks.set(input.bodySha256, "received");
    return "new" as const;
  }
  async markWebhook(hash: string, status: string) {
    this.webhooks.set(hash, status);
  }
  async markDisconnected(id: string) {
    const c = this.connections.get(id)!;
    c.status = "disconnected";
    c.ciphertext = null;
    c.cursor = null;
  }
  async audit(userId: string, action: string, entityId: string | null, metadata?: Record<string, unknown>) {
    this.audits.push({ userId, action, entityId, metadata });
  }
}

export function makeDeps(over: Partial<PlaidDeps> = {}) {
  const gateway = new FakeGateway();
  const store = new MemoryStore();
  const keyring = parseKeyring(`k1:${randomBytes(32).toString("base64")}`, "k1");
  const deps: PlaidDeps = { gateway, store, keyring, now: () => NOW, webhookUrl: "https://example.test/api/plaid/webhook", ...over };
  return { deps, gateway, store };
}

/** Signs a webhook body the way Plaid does, registering the key on the fake gateway. */
export function signWebhook(gateway: FakeGateway, body: string, iat = Math.floor(NOW.getTime() / 1000)) {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwk = publicKey.export({ format: "jwk" }) as { x: string; y: string };
  const kid = `kid-${gateway.webhookKeys.size + 1}`;
  gateway.webhookKeys.set(kid, { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y, expired_at: null });
  const enc = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");
  const h = enc({ alg: "ES256", kid, typ: "JWT" });
  const c = enc({ iat, request_body_sha256: sha256Hex(body) });
  const s = sign("sha256", Buffer.from(`${h}.${c}`), { key: privateKey, dsaEncoding: "ieee-p1363" }).toString("base64url");
  return `${h}.${c}.${s}`;
}
