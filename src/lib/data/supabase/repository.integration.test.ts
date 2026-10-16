import { createHmac } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { SupabaseRepository } from "./repository";
import { RepositoryError } from "../repository";
import { buildDashboard } from "@/lib/finance/dashboard";
import { assignImportHashes } from "@/lib/finance/dedupe";

/**
 * Runs against a real PostgREST + Postgres with every migration and RLS policy
 * applied (scripts/test-integration.sh). Users and data are fictional.
 */

const URL = process.env.ISA_IT_POSTGREST_URL;
const SECRET = process.env.ISA_IT_JWT_SECRET;
const USER_A = "aaaaaaaa-1111-4000-8000-000000000001";
const USER_B = "bbbbbbbb-2222-4000-8000-000000000002";
const LINKED_ACCOUNT = "dddddddd-0000-4000-8000-000000000001";
const LINKED_TX = "eeeeeeee-0000-4000-8000-000000000001";
const now = new Date();

const b64url = (input: string | Buffer) => Buffer.from(input).toString("base64url");

function jwt(sub: string, secret = SECRET as string): string {
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = b64url(
    JSON.stringify({ sub, role: "authenticated", aud: "authenticated", exp: Math.floor(Date.now() / 1000) + 600 }),
  );
  const signature = createHmac("sha256", secret).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${signature}`;
}

/** supabase-js client talking to bare PostgREST (which has no /rest/v1 prefix). */
function client(token: string) {
  return createClient(URL as string, "integration-test-key", {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: {
      headers: { Authorization: `Bearer ${token}` },
      fetch: (input, init) => fetch(String(input).replace("/rest/v1", ""), init),
    },
  });
}

const repoFor = (user: string, tokenUser = user) => new SupabaseRepository(client(jwt(tokenUser)), user);

async function rejects(promise: Promise<unknown>, code: RepositoryError["code"]) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(RepositoryError);
  expect((error as RepositoryError).code).toBe(code);
}

describe.skipIf(!URL || !SECRET)("SupabaseRepository against PostgREST + RLS", () => {
  const a = () => repoFor(USER_A);
  const b = () => repoFor(USER_B);
  let manualId = "";

  beforeAll(async () => {
    manualId = await a().createManualAccount({
      name: "Cash envelope",
      nickname: "Envelope",
      type: "depository",
      subtype: "cash",
      currency: "USD",
      currentMinor: 20_000,
      creditLimitMinor: null,
    });
  });

  it("loads the full dataset with institution, connection health and latest balances", async () => {
    const data = await a().getFinancialData(now);
    expect(data.isDemo).toBe(false);
    expect(data.profile.baseCurrency).toBe("USD");
    expect(data.categories).toHaveLength(23);

    const linked = data.accounts.find((x) => x.id === LINKED_ACCOUNT)!;
    expect(linked).toMatchObject({ institutionName: "Fictional Test Bank", connectionStatus: "login_required", mask: "4321" });
    expect(linked.lastSuccessfulSyncAt).not.toBeNull();
    // Latest snapshot wins.
    expect(data.balances.find((x) => x.accountId === LINKED_ACCOUNT)).toMatchObject({ currentMinor: 250_000, availableMinor: 240_000 });

    const manual = data.accounts.find((x) => x.id === manualId)!;
    expect(manual).toMatchObject({ source: "manual", institutionName: "Manual account", connectionStatus: "active" });
    expect(data.balances.find((x) => x.accountId === manualId)).toMatchObject({ currentMinor: 20_000, availableMinor: 20_000 });
  });

  it("updates nicknames and visibility, and records manual balances with history", async () => {
    await a().updateAccount(LINKED_ACCOUNT, { nickname: "Everyday", isHidden: true });
    await a().recordManualBalance(manualId, { currentMinor: 15_500, creditLimitMinor: null }, new Date(Date.now() + 1000));
    const data = await a().getFinancialData(now);
    expect(data.accounts.find((x) => x.id === LINKED_ACCOUNT)).toMatchObject({ nickname: "Everyday", isHidden: true });
    expect(data.balances.find((x) => x.accountId === manualId)?.currentMinor).toBe(15_500);
    expect((await a().getBalanceHistory(manualId)).map((h) => h.currentMinor)).toEqual([15_500, 20_000]);
    await a().updateAccount(LINKED_ACCOUNT, { isHidden: false });
  });

  it("refuses manual-only operations on bank-linked accounts", async () => {
    await rejects(a().recordManualBalance(LINKED_ACCOUNT, { currentMinor: 1, creditLimitMinor: null }, now), "not_allowed");
    await rejects(a().deleteManualAccount(LINKED_ACCOUNT), "not_found");
    await rejects(
      a().addManualTransaction({ accountId: LINKED_ACCOUNT, date: "2026-10-01", amountMinor: -1, description: "x", categoryId: null }),
      "not_allowed",
    );
  });

  it("imports CSV rows idempotently and pages through large result sets", async () => {
    const rows = assignImportHashes(
      Array.from({ length: 1_200 }, (_, i) => ({
        accountId: manualId,
        date: `2026-0${(i % 9) + 1}-1${i % 10}`,
        amountMinor: -(100 + i),
        description: `Coffee ${i}`,
      })),
    ).map((r) => ({ ...r, categoryId: null }));
    expect(await a().importTransactions(manualId, rows)).toBe(1_200);
    expect(await a().importTransactions(manualId, rows)).toBe(0);
    const history = await a().getFinancialData(new Date("2026-10-16T12:00:00Z"));
    const imported = history.transactions.filter((t) => t.source === "csv");
    // More than PostgREST's 1000-row page: proves pagination.
    expect(imported).toHaveLength(1_200);
    expect(imported.every((t) => t.dedupeHash && t.accountId === manualId)).toBe(true);
  });

  it("stores user edits as overrides and never alters bank data", async () => {
    const data = await a().getFinancialData(now);
    const dining = data.categories.find((c) => c.name === "Dining")!;
    await a().saveOverride({
      transactionId: LINKED_TX,
      categoryId: dining.id,
      merchantName: "Fern & Fig",
      note: "Dinner party supplies",
      excludeFromBudget: false,
      transferOverride: null,
    });
    const after = await a().getFinancialData(now);
    expect(after.overrides).toEqual([
      expect.objectContaining({ transactionId: LINKED_TX, categoryId: dining.id, note: "Dinner party supplies" }),
    ]);
    const original = after.transactions.find((t) => t.id === LINKED_TX)!;
    expect(original).toMatchObject({ description: "FERN & FIG MARKET", amountMinor: -4512, merchantName: null });

    // Clearing every field removes the override row.
    await a().saveOverride({ transactionId: LINKED_TX, categoryId: null, merchantName: null, note: null, excludeFromBudget: false, transferOverride: null });
    expect((await a().getFinancialData(now)).overrides).toEqual([]);
  });

  it("links and unlinks transfers", async () => {
    const out = await a().addManualTransaction({ accountId: manualId, date: "2026-10-10", amountMinor: -5_000, description: "To checking", categoryId: null });
    await a().linkTransfer({ outflowTransactionId: out, inflowTransactionId: LINKED_TX, kind: "transfer" });
    expect((await a().getFinancialData(now)).transferLinks).toEqual([
      { outflowTransactionId: out, inflowTransactionId: LINKED_TX, kind: "transfer", detectedBy: "user" },
    ]);
    await rejects(a().linkTransfer({ outflowTransactionId: out, inflowTransactionId: LINKED_TX, kind: "transfer" }), "conflict");
    await a().unlinkTransfer(LINKED_TX);
    expect((await a().getFinancialData(now)).transferLinks).toEqual([]);
    await rejects(a().unlinkTransfer("x,id.not.is.null"), "invalid");
  });

  it("manages budgets, bills, income, goals, debts and profile", async () => {
    const data = await a().getFinancialData(now);
    const groceries = data.categories.find((c) => c.name === "Groceries")!;
    await a().setAllocation("2026-10-01", groceries.id, "variable", 55_000);
    await a().setAllocation("2026-10-01", groceries.id, "variable", 60_000);
    expect(await a().copyBudget("2026-10-01", "2026-11-01")).toBe(1);
    await a().removeAllocation("2026-11-01", groceries.id);

    const billId = await a().saveBill({
      name: "Rent", amountMinor: 165_000, amountIsEstimate: false, currency: "USD", cadence: "monthly",
      nextDueDate: "2026-11-01", payFromAccountId: LINKED_ACCOUNT, categoryId: null, autopay: false,
    });
    await a().saveBill({
      id: billId, name: "Rent", amountMinor: 170_000, amountIsEstimate: false, currency: "USD", cadence: "monthly",
      nextDueDate: "2026-11-01", payFromAccountId: LINKED_ACCOUNT, categoryId: null, autopay: true,
    });
    const incomeId = await a().saveIncomeSource({ name: "Salary", kind: "salary", expectedAmountMinor: 245_000, currency: "USD", cadence: "biweekly", nextExpectedDate: "2026-10-23" });
    const goalId = await a().saveSavingsGoal({ name: "Paris", targetMinor: 400_000, savedMinor: 50_000, monthlyContributionMinor: 25_000, currency: "USD", targetDate: null });
    const debtId = await a().saveDebtGoal({ accountId: null, name: "Visa", aprBps: 2399, minimumPaymentMinor: 4_000, plannedPaymentMinor: 50_000, paymentDueDay: 25 });
    await a().updateProfile({ displayName: "Isa", safetyBufferMinor: 25_000, includeExpectedIncome: true });

    const after = await a().getFinancialData(now);
    expect(after.budgets.find((x) => x.month === "2026-10-01")?.allocations).toEqual([
      { categoryId: groceries.id, kind: "variable", plannedMinor: 60_000 },
    ]);
    expect(after.budgets.find((x) => x.month === "2026-11-01")?.allocations).toEqual([]);
    expect(after.bills).toEqual([expect.objectContaining({ id: billId, amountMinor: 170_000, autopay: true })]);
    expect(after.incomeSources.map((s) => s.id)).toEqual([incomeId]);
    expect(after.savingsGoals.map((s) => s.id)).toEqual([goalId]);
    expect(after.debtGoals.map((s) => s.id)).toEqual([debtId]);
    expect(after.profile).toMatchObject({ displayName: "Isa", safetyBufferMinor: 25_000, includeExpectedIncome: true });

    // Deterministic services run unchanged on Supabase data.
    const model = buildDashboard(after, now);
    expect(model.isDemo).toBe(false);
    expect(model.balances.unhealthyAccountIds).toEqual([LINKED_ACCOUNT]);

    await a().deleteBill(billId);
    await rejects(a().deleteBill(billId), "not_found");
  });

  describe("account isolation", () => {
    it("another user sees none of the owner's data", async () => {
      const data = await b().getFinancialData(now);
      expect(data.accounts).toEqual([]);
      expect(data.transactions).toEqual([]);
      expect(data.overrides).toEqual([]);
      expect(data.budgets).toEqual([]);
      expect(data.incomeSources).toEqual([]);
      expect(data.categories.every((c) => !data.transactions.some((t) => t.defaultCategoryId === c.id))).toBe(true);
    });

    it("another user cannot modify the owner's rows", async () => {
      await rejects(b().updateAccount(LINKED_ACCOUNT, { nickname: "pwned" }), "not_found");
      await rejects(b().recordManualBalance(manualId, { currentMinor: 1, creditLimitMinor: null }, now), "not_found");
      await rejects(b().deleteManualAccount(manualId), "not_found");
      await rejects(
        b().saveOverride({ transactionId: LINKED_TX, categoryId: null, merchantName: null, note: "pwned", excludeFromBudget: false, transferOverride: null }),
        "not_found",
      );
      await rejects(b().importTransactions(manualId, [{ date: "2026-10-01", amountMinor: -1, description: "x", dedupeHash: "f".repeat(64), categoryId: null }]), "not_allowed");
      const ownerAccount = (await a().getFinancialData(now)).accounts.find((x) => x.id === LINKED_ACCOUNT);
      expect(ownerAccount?.nickname).toBe("Everyday");
    });

    it("RLS still protects data if the app binds the wrong user id (defense in depth)", async () => {
      // Repository believes it is user A, but the JWT belongs to user B.
      const confused = repoFor(USER_A, USER_B);
      await rejects(confused.getFinancialData(now), "not_found"); // A's profile is invisible to B
      await rejects(confused.updateAccount(LINKED_ACCOUNT, { nickname: "pwned" }), "not_found");
      await rejects(
        confused.saveSavingsGoal({ name: "x", targetMinor: 1, savedMinor: 0, monthlyContributionMinor: 0, currency: "USD", targetDate: null }),
        "not_allowed",
      );
    });

    it("rejects forged tokens", async () => {
      const forged = new SupabaseRepository(client(jwt(USER_A, "not-the-real-secret-not-the-real-secret")), USER_A);
      await rejects(forged.getFinancialData(now), "unavailable");
    });
  });
});

describe.skipIf(!URL || !SECRET)("Personal CFO persistence against PostgREST + RLS", () => {
  const a = () => repoFor(USER_A);
  const b = () => repoFor(USER_B);

  it("stores conversations with metadata, newest first", async () => {
    const first = await a().createConversation("Groceries");
    const second = await a().createConversation("Bills");
    await a().appendMessages(first, [
      { role: "user", content: "How much on groceries?" },
      { role: "assistant", content: "You spent $412.50.", metadata: { mode: "offline", toolCalls: [{ name: "get_spending_summary", ok: true }] } },
    ]);
    const list = await a().listConversations(10);
    expect(list.map((c) => c.id).slice(0, 2)).toEqual([first, second]);
    const convo = await a().getConversation(first);
    expect(convo?.messages.map((m) => [m.role, m.content])).toEqual([
      ["user", "How much on groceries?"],
      ["assistant", "You spent $412.50."],
    ]);
    expect(convo?.messages[1].metadata).toMatchObject({ mode: "offline" });
    await a().deleteConversation(second);
    expect((await a().listConversations(10)).some((c) => c.id === second)).toBe(false);
  });

  it("keeps conversations private to their owner", async () => {
    const id = await a().createConversation("Private");
    await a().appendMessages(id, [{ role: "user", content: "secret question" }]);
    expect(await b().getConversation(id)).toBeNull();
    expect((await b().listConversations(50)).some((c) => c.id === id)).toBe(false);
    await rejects(b().appendMessages(id, [{ role: "user", content: "intrusion" }]), "not_found");
    await rejects(b().deleteConversation(id), "not_found");
    expect((await a().getConversation(id))?.messages).toHaveLength(1);
    expect(await a().getConversation("not-a-uuid")).toBeNull();
  });

  it("counts usage per user and per day", async () => {
    const before = await a().getAiUsageToday(new Date());
    await a().recordAiUsage(1_000, 200);
    await a().recordAiUsage(500, 100);
    const after = await a().getAiUsageToday(new Date());
    expect(after.requests - before.requests).toBe(2);
    expect(after.inputTokens - before.inputTokens).toBe(1_500);
    expect(after.outputTokens - before.outputTokens).toBe(300);
    expect((await b().getAiUsageToday(new Date())).requests).toBe(0);
    await rejects(a().recordAiUsage(-1, 0), "invalid");
  });
});
