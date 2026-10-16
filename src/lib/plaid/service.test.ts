import { describe, expect, it } from "vitest";
import { PlaidError } from "./ports";
import { collectTransactionsSync } from "./sync";
import {
  completeReconnect,
  createLinkToken,
  disconnectConnection,
  exchangePublicToken,
  handleWebhook,
  PlaidActionError,
  syncConnection,
} from "./service";
import { makeDeps, NOW, page, plaidTx, signWebhook } from "./fakes.test-util";

const USER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const PUBLIC_TOKEN = "public-sandbox-0a1b2c3d-4e5f-6789-abcd-ef0123456789";

async function linked() {
  const ctx = makeDeps();
  ctx.gateway.pages = [page({ added: [plaidTx("t1"), plaidTx("t2")], nextCursor: "c1" })];
  const result = await exchangePublicToken(ctx.deps, USER, PUBLIC_TOKEN);
  return { ...ctx, result, connectionId: result.connectionId };
}

describe("collectTransactionsSync", () => {
  it("pages until has_more is false and returns the final cursor", async () => {
    const { gateway } = makeDeps();
    gateway.pages = [
      page({ added: [plaidTx("a")], nextCursor: "p1", hasMore: true }),
      page({ added: [plaidTx("b")], nextCursor: "p2", hasMore: false }),
    ];
    const r = await collectTransactionsSync({ gateway, accessToken: "t", cursor: null, now: NOW });
    expect(r.added.map((t) => t.external_id)).toEqual(["a", "b"]);
    expect(r.cursorAfter).toBe("p2");
    expect(gateway.syncCalls).toEqual([null, "p1"]);
  });

  it("restarts from the original cursor after a mutation during pagination", async () => {
    const { gateway } = makeDeps();
    gateway.pages = [
      page({ added: [plaidTx("a")], nextCursor: "p1", hasMore: true }),
      page({ added: [plaidTx("b")], nextCursor: "p2" }),
    ];
    gateway.syncErrors = [undefined, new PlaidError("TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION")];
    const r = await collectTransactionsSync({ gateway, accessToken: "t", cursor: "c0", now: NOW });
    expect(gateway.syncCalls).toEqual(["c0", "p1", "c0", "p1"]);
    expect(r.restarts).toBe(1);
    expect(r.added.map((t) => t.external_id)).toEqual(["a", "b"]);
  });

  it("gives up after repeated mutations instead of looping forever", async () => {
    const { gateway } = makeDeps();
    gateway.pages = [page()];
    gateway.syncErrors = Array.from({ length: 5 }, () => new PlaidError("TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION"));
    await expect(collectTransactionsSync({ gateway, accessToken: "t", cursor: null, now: NOW, maxRestarts: 2 })).rejects.toMatchObject({
      code: "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION",
    });
  });

  it("keeps only the latest operation per transaction across pages", async () => {
    const { gateway } = makeDeps();
    gateway.pages = [
      page({ added: [plaidTx("a"), plaidTx("b")], nextCursor: "p1", hasMore: true }),
      page({ modified: [plaidTx("a", { amount: 20 })], removed: [{ transaction_id: "b" }], nextCursor: "p2" }),
    ];
    const r = await collectTransactionsSync({ gateway, accessToken: "t", cursor: null, now: NOW });
    expect(r.added).toEqual([]);
    expect(r.modified.map((t) => [t.external_id, t.amount_minor])).toEqual([["a", -2000]]);
    expect(r.removed).toEqual(["b"]);
  });

  it("caps the number of pages", async () => {
    const { gateway } = makeDeps();
    gateway.pages = [page({ hasMore: true }), page({ hasMore: true }), page({ hasMore: true })];
    await expect(collectTransactionsSync({ gateway, accessToken: "t", cursor: null, now: NOW, maxPages: 2 })).rejects.toMatchObject({
      code: "SYNC_PAGE_LIMIT",
    });
  });
});

describe("linking", () => {
  it("exchanges a sandbox public token, stores only ciphertext and runs the first sync", async () => {
    const { store, result, gateway } = await linked();
    expect(result).toMatchObject({ institutionName: "First Platypus Bank", syncError: null, sync: { status: "synced" } });
    const conn = store.connections.get(result.connectionId)!;
    expect(conn.userId).toBe(USER);
    expect(conn.ciphertext).toMatch(/^v1\.k1\./);
    expect(JSON.stringify([...store.connections.values()])).not.toContain(gateway.accessToken);
    expect(JSON.stringify(result)).not.toContain("access-sandbox");
    expect(store.transactions.size).toBe(2);
    expect(store.accounts.size).toBe(2);
    expect(conn.cursor).toBe("c1");
    expect(store.audits.map((a) => a.action)).toEqual(["plaid.connection.created", "plaid.sync.succeeded"]);
  });

  it("refuses non-sandbox public tokens before calling Plaid", async () => {
    const { deps, store } = makeDeps();
    await expect(exchangePublicToken(deps, USER, "public-production-0a1b2c3d-4e5f")).rejects.toMatchObject({ code: "NOT_SANDBOX" });
    expect(store.connections.size).toBe(0);
  });

  it("removes and refuses a non-sandbox access token", async () => {
    const { deps, store, gateway } = makeDeps();
    gateway.accessToken = "access-production-11111111-2222";
    await expect(exchangePublicToken(deps, USER, PUBLIC_TOKEN)).rejects.toMatchObject({ code: "NOT_SANDBOX" });
    expect(gateway.removed).toEqual(["access-production-11111111-2222"]);
    expect(store.connections.size).toBe(0);
  });

  it("keeps the connection when the first sync fails, with a retryable message", async () => {
    const { deps, store, gateway } = makeDeps();
    gateway.syncErrors = [new PlaidError("PRODUCT_NOT_READY")];
    gateway.pages = [page()];
    const r = await exchangePublicToken(deps, USER, PUBLIC_TOKEN);
    expect(r.syncError).toMatch(/still loading/);
    expect(store.connections.get(r.connectionId)?.status).toBe("active");
  });

  it("creates update-mode link tokens only for the owner's connection", async () => {
    const { deps, gateway, connectionId } = await linked();
    const update = await createLinkToken(deps, USER, { connectionId });
    expect(update.mode).toBe("update");
    expect(gateway.linkTokenRequests.at(-1)).toMatchObject({ userId: USER, accessToken: gateway.accessToken });
    await expect(createLinkToken(deps, OTHER, { connectionId })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(createLinkToken(deps, USER, { connectionId: "not-a-uuid" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    const fresh = await createLinkToken(deps, USER);
    expect(fresh.mode).toBe("create");
    expect(gateway.linkTokenRequests.at(-1)?.accessToken).toBeUndefined();
  });
});

describe("syncing", () => {
  it("applies incremental updates from the stored cursor, including pending → posted", async () => {
    const { deps, store, gateway, connectionId } = await linked();
    gateway.pages = [
      page({ added: [plaidTx("p1", { pending: true })], nextCursor: "c2" }),
    ];
    await syncConnection(deps, { connectionId, trigger: "manual", userId: USER });
    gateway.pages = [page({ added: [plaidTx("posted1", { pending_transaction_id: "p1" })], removed: [{ transaction_id: "t1" }], nextCursor: "c3" })];
    const r = await syncConnection(deps, { connectionId, trigger: "webhook" });
    expect(gateway.syncCalls.slice(-2)).toEqual(["c1", "c2"]);
    expect(r.counts).toMatchObject({ added: 1, removed: 1 });
    expect(store.transactions.get("p1")?.supersededBy).toBe("posted1");
    expect(store.transactions.get("t1")?.removed).toBe(true);
    expect(store.connections.get(connectionId)?.cursor).toBe("c3");
  });

  it("runs post-sync housekeeping for the owner only when something changed", async () => {
    const { deps, gateway, connectionId } = await linked();
    const calls: string[] = [];
    const withHook = { ...deps, afterSync: async (userId: string) => void calls.push(userId) };
    gateway.pages = [page({ nextCursor: "c2" })];
    await syncConnection(withHook, { connectionId, trigger: "manual", userId: USER });
    expect(calls).toEqual([]);
    gateway.pages = [page({ added: [plaidTx("x")], nextCursor: "c3" })];
    await syncConnection({ ...withHook, afterSync: async () => { throw new Error("boom"); } }, { connectionId, trigger: "manual" });
    gateway.pages = [page({ added: [plaidTx("y")], nextCursor: "c4" })];
    await syncConnection(withHook, { connectionId, trigger: "manual" });
    expect(calls).toEqual([USER]);
  });

  it("never syncs another user's connection", async () => {
    const { deps, connectionId } = await linked();
    await expect(syncConnection(deps, { connectionId, trigger: "manual", userId: OTHER })).rejects.toBeInstanceOf(PlaidActionError);
  });

  it("marks the connection for reconnection on ITEM_LOGIN_REQUIRED and keeps the cursor", async () => {
    const { deps, store, gateway, connectionId } = await linked();
    gateway.syncErrors = [new PlaidError("ITEM_LOGIN_REQUIRED", "ITEM_ERROR")];
    await expect(syncConnection(deps, { connectionId, trigger: "manual", userId: USER })).rejects.toThrow("sign in again");
    const conn = store.connections.get(connectionId)!;
    expect(conn).toMatchObject({ status: "login_required", errorCode: "ITEM_LOGIN_REQUIRED", cursor: "c1" });
    expect([...store.runs.values()].at(-1)).toMatchObject({ status: "failed", errorCode: "ITEM_LOGIN_REQUIRED" });
  });

  it("leaves status alone on transient errors", async () => {
    const { deps, store, gateway, connectionId } = await linked();
    gateway.syncErrors = [new PlaidError("INSTITUTION_NOT_RESPONDING")];
    await expect(syncConnection(deps, { connectionId, trigger: "manual", userId: USER })).rejects.toThrow("isn't responding");
    expect(store.connections.get(connectionId)?.status).toBe("active");
  });

  it("treats a concurrent sync as superseded rather than an error", async () => {
    const { deps, store, gateway, connectionId } = await linked();
    gateway.pages = [page({ nextCursor: "c2" })];
    store.conflictOnce = true;
    const r = await syncConnection(deps, { connectionId, trigger: "webhook" });
    expect(r.status).toBe("superseded");
    expect([...store.runs.values()].at(-1)).toMatchObject({ status: "failed", errorCode: "CURSOR_CONFLICT" });
  });

  it("refuses to sync revoked or disconnected connections", async () => {
    const { deps, store, connectionId } = await linked();
    await store.setStatus(connectionId, "revoked", "USER_PERMISSION_REVOKED");
    await expect(syncConnection(deps, { connectionId, trigger: "manual", userId: USER })).rejects.toThrow("revoked");
    await store.markDisconnected(connectionId);
    await expect(syncConnection(deps, { connectionId, trigger: "manual", userId: USER })).rejects.toMatchObject({ code: "DISCONNECTED" });
  });
});

describe("reconnect and disconnect", () => {
  it("reactivates after Link update mode only when Plaid reports the item healthy", async () => {
    const { deps, store, gateway, connectionId } = await linked();
    await store.setStatus(connectionId, "login_required", "ITEM_LOGIN_REQUIRED");
    gateway.item = { ...gateway.item, errorCode: "ITEM_LOGIN_REQUIRED" };
    await expect(completeReconnect(deps, USER, connectionId)).rejects.toThrow("sign in again");
    expect(store.connections.get(connectionId)?.status).toBe("login_required");

    gateway.item = { ...gateway.item, errorCode: null };
    gateway.pages = [page({ nextCursor: "c2" })];
    await completeReconnect(deps, USER, connectionId);
    expect(store.connections.get(connectionId)).toMatchObject({ status: "active", errorCode: null, cursor: "c2" });
  });

  it("removes the Item at Plaid, deletes the token and keeps history", async () => {
    const { deps, store, gateway, connectionId } = await linked();
    await expect(disconnectConnection(deps, OTHER, connectionId)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await disconnectConnection(deps, USER, connectionId);
    expect(gateway.removed).toEqual([gateway.accessToken]);
    expect(store.connections.get(connectionId)).toMatchObject({ status: "disconnected", ciphertext: null, cursor: null });
    expect(store.transactions.size).toBe(2);
  });

  it("changes nothing locally when Plaid can't remove the Item", async () => {
    const { deps, store, gateway, connectionId } = await linked();
    gateway.removeError = new PlaidError("INTERNAL_SERVER_ERROR");
    await expect(disconnectConnection(deps, USER, connectionId)).rejects.toMatchObject({ code: "REMOVE_FAILED" });
    expect(store.connections.get(connectionId)?.status).toBe("active");
    gateway.removeError = new PlaidError("ITEM_NOT_FOUND");
    await disconnectConnection(deps, USER, connectionId);
    expect(store.connections.get(connectionId)?.status).toBe("disconnected");
  });
});

describe("webhooks", () => {
  const body = (over: Record<string, unknown> = {}) =>
    JSON.stringify({ webhook_type: "TRANSACTIONS", webhook_code: "SYNC_UPDATES_AVAILABLE", item_id: "item-1", environment: "sandbox", ...over });

  it("verifies, then syncs after responding", async () => {
    const { deps, store, gateway, connectionId } = await linked();
    gateway.pages = [page({ added: [plaidTx("w1")], nextCursor: "c2" })];
    const raw = body();
    const outcome = await handleWebhook(deps, { rawBody: raw, verificationHeader: signWebhook(gateway, raw) });
    expect(outcome.result).toBe("accepted");
    expect(store.transactions.has("w1")).toBe(false);
    if (outcome.result === "accepted") await outcome.followUp?.();
    expect(store.transactions.has("w1")).toBe(true);
    expect(store.connections.get(connectionId)?.cursor).toBe("c2");
    expect([...store.webhooks.values()]).toEqual(["processed"]);
  });

  it("is idempotent: a replayed body is not processed twice", async () => {
    const { deps, gateway } = await linked();
    gateway.pages = [page({ nextCursor: "c2" })];
    const raw = body();
    const header = signWebhook(gateway, raw);
    expect((await handleWebhook(deps, { rawBody: raw, verificationHeader: header })).result).toBe("accepted");
    expect(await handleWebhook(deps, { rawBody: raw, verificationHeader: header })).toEqual({ result: "duplicate" });
  });

  it("lets Plaid retry a webhook whose processing failed", async () => {
    const { deps, store, gateway, connectionId } = await linked();
    const raw = body({ webhook_type: "ITEM", webhook_code: "PENDING_EXPIRATION" });
    const header = signWebhook(gateway, raw);
    store.failNextSetStatus = true;
    await expect(handleWebhook(deps, { rawBody: raw, verificationHeader: header })).rejects.toThrow();
    expect([...store.webhooks.values()]).toEqual(["failed"]);
    expect((await handleWebhook(deps, { rawBody: raw, verificationHeader: header })).result).toBe("accepted");
    expect(store.connections.get(connectionId)?.status).toBe("pending_expiration");
    expect(await handleWebhook(deps, { rawBody: raw, verificationHeader: header })).toEqual({ result: "duplicate" });
  });

  it("rejects unsigned, forged and non-sandbox webhooks without touching the store", async () => {
    const { deps, store, gateway } = await linked();
    const raw = body();
    expect((await handleWebhook(deps, { rawBody: raw, verificationHeader: null })).result).toBe("rejected");
    const header = signWebhook(gateway, raw);
    expect((await handleWebhook(deps, { rawBody: body({ item_id: "item-2" }), verificationHeader: header })).result).toBe("rejected");
    const prod = body({ environment: "production" });
    expect((await handleWebhook(deps, { rawBody: prod, verificationHeader: signWebhook(gateway, prod) })).result).toBe("rejected");
    expect(store.webhooks.size).toBe(0);
  });

  it("updates connection health from ITEM webhooks", async () => {
    const { deps, store, gateway, connectionId } = await linked();
    const send = async (over: Record<string, unknown>) => {
      const raw = body({ webhook_type: "ITEM", ...over });
      return handleWebhook(deps, { rawBody: raw, verificationHeader: signWebhook(gateway, raw) });
    };
    await send({ webhook_code: "ERROR", error: { error_code: "ITEM_LOGIN_REQUIRED" } });
    expect(store.connections.get(connectionId)?.status).toBe("login_required");
    await send({ webhook_code: "PENDING_EXPIRATION" });
    expect(store.connections.get(connectionId)?.status).toBe("pending_expiration");
    await send({ webhook_code: "USER_PERMISSION_REVOKED" });
    expect(store.connections.get(connectionId)?.status).toBe("revoked");
    gateway.pages = [page({ nextCursor: "c2" })];
    const repaired = await send({ webhook_code: "LOGIN_REPAIRED" });
    expect(store.connections.get(connectionId)?.status).toBe("active");
    if (repaired.result === "accepted") await repaired.followUp?.();
    expect(store.connections.get(connectionId)?.cursor).toBe("c2");
  });

  it("ignores webhooks for unknown or disconnected items", async () => {
    const { deps, gateway } = await linked();
    const raw = body({ item_id: "someone-elses-item" });
    expect((await handleWebhook(deps, { rawBody: raw, verificationHeader: signWebhook(gateway, raw) })).result).toBe("ignored");
  });
});
