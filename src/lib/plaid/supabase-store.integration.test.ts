import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { SupabaseRepository } from "@/lib/data/supabase/repository";
import { parseKeyring } from "@/lib/security/token-crypto";
import { CursorConflictError, PlaidError } from "./ports";
import { disconnectConnection, exchangePublicToken, syncConnection, type PlaidDeps } from "./service";
import { SupabasePlaidStore } from "./supabase-store";
import { FakeGateway, page, plaidTx } from "./fakes.test-util";

/**
 * The Plaid store and SQL functions against a real PostgREST + Postgres with all
 * migrations (scripts/test-integration.sh). Plaid itself is faked: no network calls,
 * no credentials. Users and data are fictional.
 */

const URL = process.env.ISA_IT_POSTGREST_URL;
const SECRET = process.env.ISA_IT_JWT_SECRET;
const USER_A = "cccccccc-3333-4000-8000-000000000003";
const USER_B = "bbbbbbbb-2222-4000-8000-000000000002";

function jwt(claims: Record<string, unknown>): string {
  const enc = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");
  const h = enc({ alg: "HS256", typ: "JWT" });
  const p = enc({ exp: Math.floor(Date.now() / 1000) + 600, ...claims });
  return `${h}.${p}.${createHmac("sha256", SECRET as string).update(`${h}.${p}`).digest("base64url")}`;
}

function client(token: string) {
  return createClient(URL as string, "integration-test-key", {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: {
      headers: { Authorization: `Bearer ${token}` },
      fetch: (input, init) => fetch(String(input).replace("/rest/v1", ""), init),
    },
  });
}

const serviceClient = () => client(jwt({ role: "service_role" }));
const userClient = (sub: string) => client(jwt({ sub, role: "authenticated", aud: "authenticated" }));

function deps(gateway: FakeGateway): PlaidDeps {
  return {
    gateway,
    store: new SupabasePlaidStore(serviceClient()),
    keyring: parseKeyring(`k1:${randomBytes(32).toString("base64")}`, "k1"),
    now: () => new Date(),
  };
}

function freshGateway() {
  const gateway = new FakeGateway();
  const suffix = randomUUID();
  gateway.item = { ...gateway.item, itemId: `item-${suffix}` };
  gateway.accessToken = `access-sandbox-${suffix}`;
  return { gateway, suffix };
}

describe.skipIf(!URL || !SECRET)("Plaid store against PostgREST", () => {
  it("links, syncs and exposes data only to the owner", async () => {
    const { gateway, suffix } = freshGateway();
    gateway.pages = [
      page({
        added: [
          plaidTx(`it-${suffix}-1`, { amount: 42.5, personal_finance_category: { primary: "FOOD_AND_DRINK", detailed: "FOOD_AND_DRINK_GROCERIES" } }),
          plaidTx(`it-${suffix}-2`, { account_id: "acc-card", amount: 19.99 }),
        ],
        nextCursor: `cursor-${suffix}-1`,
      }),
    ];
    const d = deps(gateway);
    const link = await exchangePublicToken(d, USER_A, "public-sandbox-0a1b2c3d-4e5f-6789");
    expect(link.syncError).toBeNull();
    expect(link.sync?.counts).toMatchObject({ accounts: 2, added: 2 });

    // The owner sees the new accounts, balances and categorized transactions through RLS.
    const data = await new SupabaseRepository(userClient(USER_A), USER_A).getFinancialData(new Date());
    const tx = data.transactions.find((t) => t.externalId === `it-${suffix}-1`)!;
    expect(tx.amountMinor).toBe(-4250);
    expect(data.categories.find((c) => c.id === tx.defaultCategoryId)?.name).toBe("Groceries");
    const card = data.accounts.find((a) => a.mask === "3333" && a.institutionName === "First Platypus Bank")!;
    expect(card).toMatchObject({ type: "credit", source: "plaid", connectionStatus: "active" });
    expect(data.balances.find((b) => b.accountId === card.id)).toMatchObject({ currentMinor: 41_000, creditLimitMinor: 700_000 });

    // The other user sees none of it.
    const other = await new SupabaseRepository(userClient(USER_B), USER_B).getFinancialData(new Date());
    expect(other.transactions.some((t) => t.externalId.startsWith(`it-${suffix}`))).toBe(false);

    // Ciphertext only, never readable by the user.
    const stored = await d.store.getConnection(link.connectionId, USER_A);
    expect(stored?.ciphertext).toMatch(/^v1\.k1\./);
    expect(stored?.ciphertext).not.toContain(gateway.accessToken);
    const { error } = await userClient(USER_A).from("bank_connection_secrets").select("*");
    expect(error?.code).toBe("42501");
    expect(await d.store.getConnection(link.connectionId, USER_B)).toBeNull();

    // Incremental sync from the committed cursor, with removal.
    gateway.pages = [page({ removed: [{ transaction_id: `it-${suffix}-2` }], nextCursor: `cursor-${suffix}-2` })];
    const second = await syncConnection(d, { connectionId: link.connectionId, trigger: "webhook" });
    expect(second.counts.removed).toBe(1);
    expect(gateway.syncCalls.at(-1)).toBe(`cursor-${suffix}-1`);

    // Sync runs are recorded and visible to the owner.
    const { data: runs } = await userClient(USER_A).from("sync_runs").select("status, trigger").eq("connection_id", link.connectionId);
    expect(runs).toEqual(expect.arrayContaining([{ status: "succeeded", trigger: "initial" }, { status: "succeeded", trigger: "webhook" }]));
  });

  it("rejects a stale cursor as a conflict and records failures with their code", async () => {
    const { gateway } = freshGateway();
    gateway.pages = [page({ nextCursor: "c1" })];
    const d = deps(gateway);
    const { connectionId } = await exchangePublicToken(d, USER_A, "public-sandbox-0a1b2c3d-4e5f-6789");
    await expect(
      d.store.applySync({ connectionId, cursorBefore: "not-the-cursor", cursorAfter: "c9", accounts: [], balances: [], added: [], modified: [], removed: [] }),
    ).rejects.toBeInstanceOf(CursorConflictError);

    gateway.syncErrors = [new PlaidError("ITEM_LOGIN_REQUIRED", "ITEM_ERROR")];
    await expect(syncConnection(d, { connectionId, trigger: "manual", userId: USER_A })).rejects.toThrow("sign in again");
    const conn = await d.store.getConnection(connectionId);
    expect(conn).toMatchObject({ status: "login_required", cursor: "c1" });
  });

  it("records webhooks idempotently", async () => {
    const store = new SupabasePlaidStore(serviceClient());
    const hash = randomBytes(32).toString("hex");
    const input = { bodySha256: hash, type: "TRANSACTIONS", code: "SYNC_UPDATES_AVAILABLE", itemId: "item-x" };
    expect(await store.recordWebhook(input)).toBe("new");
    expect(await store.recordWebhook(input)).toBe("duplicate");
    await store.markWebhook(hash, "failed");
    expect(await store.recordWebhook(input)).toBe("new");
    await store.markWebhook(hash, "processed");
    expect(await store.recordWebhook(input)).toBe("duplicate");
    const { error } = await userClient(USER_A).from("webhook_events").select("*");
    expect(error?.code).toBe("42501");
  });

  it("disconnects: token deleted, history kept", async () => {
    const { gateway, suffix } = freshGateway();
    gateway.pages = [page({ added: [plaidTx(`dc-${suffix}`)], nextCursor: "c1" })];
    const d = deps(gateway);
    const { connectionId } = await exchangePublicToken(d, USER_A, "public-sandbox-0a1b2c3d-4e5f-6789");
    await disconnectConnection(d, USER_A, connectionId);
    expect(await d.store.getConnection(connectionId)).toMatchObject({ status: "disconnected", ciphertext: null, cursor: null });
    const data = await new SupabaseRepository(userClient(USER_A), USER_A).getFinancialData(new Date());
    expect(data.transactions.some((t) => t.externalId === `dc-${suffix}`)).toBe(true);
  });

  it("does not let signed-in users call the privileged functions", async () => {
    const db = userClient(USER_A);
    const calls = [
      db.rpc("apply_plaid_sync", { p_connection_id: randomUUID(), p_cursor_before: null, p_cursor_after: "x", p_payload: {} }),
      db.rpc("disconnect_plaid_connection", { p_connection_id: randomUUID() }),
      db.rpc("create_plaid_connection", {
        p_connection_id: randomUUID(),
        p_user_id: USER_A,
        p_item_id: "i",
        p_institution_plaid_id: null,
        p_institution_name: null,
        p_key_id: "k1",
        p_ciphertext: "v1.k1.AAAA.BBBB",
        p_consent_expires_at: null,
      }),
    ];
    for (const { error } of await Promise.all(calls)) expect(error?.code).toBe("42501");
  });
});
