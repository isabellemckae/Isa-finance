import { describe, expect, it } from "vitest";
import { DemoRepository } from "./store";
import { RepositoryError } from "../repository";
import { linkDetectedTransfers, rejectTransfer } from "../operations";
import { assignImportHashes } from "@/lib/finance/dedupe";
import { buildDashboard } from "@/lib/finance/dashboard";
import { validateTransferLink, transferCandidates } from "@/lib/finance/transfers";

const now = new Date("2026-10-16T18:00:00Z");
const fresh = () => DemoRepository.withFreshState(now);

async function code(promise: Promise<unknown>) {
  return promise.then(
    () => null,
    (e: unknown) => (e instanceof RepositoryError ? e.code : "other"),
  );
}

describe("DemoRepository", () => {
  it("returns copies, so callers cannot mutate stored data", async () => {
    const repo = fresh();
    const data = await repo.getFinancialData(now);
    data.accounts[0].nickname = "tampered";
    expect((await repo.getFinancialData(now)).accounts[0].nickname).not.toBe("tampered");
  });

  it("creates manual accounts and records balance history", async () => {
    const repo = fresh();
    const id = await repo.createManualAccount({
      name: "Store card", nickname: null, type: "credit", subtype: "credit card",
      currency: "USD", currentMinor: 2_000, creditLimitMinor: 50_000,
    });
    await repo.recordManualBalance(id, { currentMinor: 3_500, creditLimitMinor: 50_000 }, new Date(now.getTime() + 60_000));
    const data = await repo.getFinancialData(now);
    expect(data.accounts.find((a) => a.id === id)).toMatchObject({ source: "manual", isDemo: true });
    expect(data.balances.find((b) => b.accountId === id)).toMatchObject({ currentMinor: 3_500, availableMinor: 46_500 });
    expect((await repo.getBalanceHistory(id)).map((b) => b.currentMinor)).toEqual([3_500, 2_000]);
    await repo.deleteManualAccount(id);
    expect((await repo.getFinancialData(now)).accounts.some((a) => a.id === id)).toBe(false);
  });

  it("enforces the same rules as the database for bank-linked data", async () => {
    const repo = fresh();
    expect(await code(repo.recordManualBalance("demo-acct-juniper-checking", { currentMinor: 1, creditLimitMinor: null }, now))).toBe("not_allowed");
    expect(await code(repo.deleteManualAccount("demo-acct-juniper-checking"))).toBe("not_allowed");
    expect(await code(repo.updateAccount("nope", { nickname: "x" }))).toBe("not_found");
    expect(await code(repo.saveOverride({ transactionId: "nope", categoryId: null, merchantName: null, note: "x", excludeFromBudget: false, transferOverride: null }))).toBe("not_found");
  });

  it("keeps overrides separate from original data and removes empty overrides", async () => {
    const repo = fresh();
    const before = await repo.getFinancialData(now);
    const tx = before.transactions.find((t) => t.defaultCategoryId === "demo-cat-dining")!;
    await repo.saveOverride({ transactionId: tx.id, categoryId: "demo-cat-groceries", merchantName: "Renamed", note: "n", excludeFromBudget: true, transferOverride: null });
    const after = await repo.getFinancialData(now);
    expect(after.transactions.find((t) => t.id === tx.id)).toEqual(tx);
    expect(after.overrides.find((o) => o.transactionId === tx.id)).toMatchObject({ categoryId: "demo-cat-groceries", excludeFromBudget: true });
    await repo.saveOverride({ transactionId: tx.id, categoryId: null, merchantName: null, note: null, excludeFromBudget: false, transferOverride: null });
    expect((await repo.getFinancialData(now)).overrides.some((o) => o.transactionId === tx.id)).toBe(false);
  });

  it("imports idempotently and links detected transfers afterwards", async () => {
    const repo = fresh();
    const cash = await repo.createManualAccount({ name: "Wallet", nickname: null, type: "depository", subtype: "cash", currency: "USD", currentMinor: 0, creditLimitMinor: null });
    const rows = assignImportHashes([
      { accountId: cash, date: "2026-10-14", amountMinor: 7_777, description: "Transfer from checking" },
      { accountId: cash, date: "2026-10-14", amountMinor: -450, description: "Coffee" },
    ]).map((r) => ({ ...r, categoryId: null }));
    expect(await repo.importTransactions(cash, rows)).toBe(2);
    expect(await repo.importTransactions(cash, rows)).toBe(0);

    // A matching outflow in checking: the post-import detector should link it.
    const checkingRows = assignImportHashes([
      { accountId: "demo-acct-juniper-checking", date: "2026-10-14", amountMinor: -7_777, description: "Transfer to wallet" },
    ]).map((r) => ({ ...r, categoryId: null }));
    await repo.importTransactions("demo-acct-juniper-checking", checkingRows);
    const before = (await repo.getFinancialData(now)).transferLinks.length;
    expect(await linkDetectedTransfers(repo, now)).toBe(1);
    expect(await linkDetectedTransfers(repo, now)).toBe(0);
    expect((await repo.getFinancialData(now)).transferLinks).toHaveLength(before + 1);
  });

  it("rejecting a transfer unlinks it and prevents re-detection", async () => {
    const repo = fresh();
    const link = (await repo.getFinancialData(now)).transferLinks[0];
    await rejectTransfer(repo, link.inflowTransactionId, now);
    const data = await repo.getFinancialData(now);
    expect(data.transferLinks.some((l) => l.inflowTransactionId === link.inflowTransactionId)).toBe(false);
    expect(data.overrides.filter((o) => o.transferOverride === "not_transfer").map((o) => o.transactionId).sort()).toEqual(
      [link.outflowTransactionId, link.inflowTransactionId].sort(),
    );
    expect(await linkDetectedTransfers(repo, now)).toBe(0);
  });

  it("manages budget allocations and copies plans between months", async () => {
    const repo = fresh();
    await repo.setAllocation("2026-12-01", "demo-cat-groceries", "variable", 70_000);
    await repo.setAllocation("2026-12-01", "demo-cat-groceries", "variable", 72_500);
    expect(await repo.copyBudget("2026-12-01", "2027-01-01")).toBe(1);
    expect(await repo.copyBudget("2026-12-01", "2027-01-01")).toBe(0);
    const data = await repo.getFinancialData(now);
    expect(data.budgets.find((b) => b.month === "2027-01-01")?.allocations).toEqual([
      { categoryId: "demo-cat-groceries", kind: "variable", plannedMinor: 72_500 },
    ]);
    expect(await code(repo.setAllocation("2026-12-01", "not-a-category", "variable", 1))).toBe("invalid");
  });

  it("budget edits flow through to the dashboard figures", async () => {
    const repo = fresh();
    const before = buildDashboard(await repo.getFinancialData(now), now);
    await repo.setAllocation("2026-10-01", "demo-cat-dining", "variable", 100_000);
    const after = buildDashboard(await repo.getFinancialData(now), now);
    expect(after.budget!.spending.plannedMinor - before.budget!.spending.plannedMinor).toBe(100_000 - 30_000);
  });
});

describe("transfer link validation", () => {
  it("accepts matching legs and rejects invalid pairs", async () => {
    const data = await fresh().getFinancialData(now);
    const out = data.transactions.find((t) => t.description.startsWith("Online transfer to savings"))!;
    const inn = data.transactions.find((t) => t.date === out.date && t.description.startsWith("Transfer from checking"))!;
    expect(validateTransferLink({ outflowTransactionId: out.id, inflowTransactionId: inn.id }, data.transactions, data.accounts, [])).toEqual({
      ok: true,
      link: { outflowTransactionId: out.id, inflowTransactionId: inn.id, kind: "transfer" },
    });
    expect(validateTransferLink({ outflowTransactionId: inn.id, inflowTransactionId: out.id }, data.transactions, data.accounts, [])).toMatchObject({ ok: false });
    expect(validateTransferLink({ outflowTransactionId: out.id, inflowTransactionId: inn.id }, data.transactions, data.accounts, data.transferLinks)).toEqual({
      ok: false,
      reason: "One of these is already linked.",
    });
    expect(transferCandidates(out, data.transactions, []).map((t) => t.id)).toContain(inn.id);
  });
});

describe("DemoRepository CFO persistence", () => {
  it("stores conversations, lists newest first, and deletes", async () => {
    const repo = fresh();
    const a = await repo.createConversation("First");
    const b = await repo.createConversation("Second");
    await new Promise((r) => setTimeout(r, 5));
    await repo.appendMessages(a, [{ role: "user", content: "hi" }, { role: "assistant", content: "hello", metadata: { mode: "offline" } }]);
    expect((await repo.listConversations(10)).map((c) => c.id)).toEqual([a, b]);
    expect((await repo.getConversation(a))?.messages.map((m) => m.content)).toEqual(["hi", "hello"]);
    await repo.deleteConversation(b);
    expect(await repo.getConversation(b)).toBeNull();
    expect(await code(repo.appendMessages(b, [{ role: "user", content: "x" }]))).toBe("not_found");
  });

  it("returns copies of conversations", async () => {
    const repo = fresh();
    const id = await repo.createConversation("Copy");
    const c = await repo.getConversation(id);
    c!.messages.push({ id: "x", role: "user", content: "tamper", metadata: {}, createdAt: "" });
    expect((await repo.getConversation(id))?.messages).toHaveLength(0);
  });

  it("accumulates usage for the day", async () => {
    const repo = fresh();
    await repo.recordAiUsage(100, 20);
    await repo.recordAiUsage(50, 10);
    expect(await repo.getAiUsageToday(new Date())).toEqual({ requests: 2, inputTokens: 150, outputTokens: 30 });
  });
});

describe("DemoRepository bank connections", () => {
  it("lists fictional connections with their health, labeled as demo", async () => {
    const connections = await fresh().listConnections();
    expect(connections.length).toBeGreaterThan(0);
    expect(connections.every((c) => c.isDemo && c.institutionName.includes("(fictional)"))).toBe(true);
    expect(connections.find((c) => c.status === "login_required")).toMatchObject({ lastErrorCode: "ITEM_LOGIN_REQUIRED" });
    expect(connections.reduce((n, c) => n + c.accountCount, 0)).toBe(
      (await fresh().getFinancialData(new Date())).accounts.filter((a) => a.source === "plaid").length,
    );
  });
});
