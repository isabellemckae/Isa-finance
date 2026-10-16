import { randomUUID } from "node:crypto";
import { todayInTimeZone } from "@/lib/finance/dates";
import type { BalanceSnapshot, FinancialData, Transaction } from "@/lib/finance/types";
import { RepositoryError, type FinanceRepository } from "../repository";
import { buildDemoData, DEMO_TIMEZONE } from "./dataset";

/**
 * In-memory repository for demo mode. FICTIONAL DATA ONLY: it never touches a
 * database. Edits live in server memory so the interface can be previewed end to
 * end; they reset when the server restarts or the day changes (the dataset is
 * regenerated relative to today).
 */

interface DemoState {
  day: string;
  data: FinancialData;
  history: BalanceSnapshot[];
}

let shared: DemoState | null = null;

function freshState(now: Date): DemoState {
  const data = buildDemoData(now);
  return { day: todayInTimeZone(DEMO_TIMEZONE, now), data, history: [...data.balances] };
}

/** Test hook: start from a clean dataset. */
export function resetDemoStore(now: Date = new Date()): void {
  shared = freshState(now);
}

export class DemoRepository implements FinanceRepository {
  readonly kind = "demo" as const;

  /** `state` is injectable for tests; production uses the process-wide store. */
  constructor(private readonly injected?: DemoState) {}

  private state(now: Date = new Date()): DemoState {
    if (this.injected) return this.injected;
    if (!shared || shared.day !== todayInTimeZone(DEMO_TIMEZONE, now)) shared = freshState(now);
    return shared;
  }

  static withFreshState(now: Date): DemoRepository {
    return new DemoRepository(freshState(now));
  }

  async getFinancialData(now: Date): Promise<FinancialData> {
    return structuredClone(this.state(now).data);
  }

  async getBalanceHistory(accountId: string): Promise<BalanceSnapshot[]> {
    this.account(accountId);
    return structuredClone(
      this.state()
        .history.filter((b) => b.accountId === accountId)
        .sort((a, b) => b.asOf.localeCompare(a.asOf)),
    );
  }

  // ---------------------------------------------------------------------------
  // Accounts
  // ---------------------------------------------------------------------------

  private account(id: string) {
    const account = this.state().data.accounts.find((a) => a.id === id);
    if (!account) throw new RepositoryError("not_found", "Account not found.");
    return account;
  }

  private manualAccount(id: string) {
    const account = this.account(id);
    if (account.source !== "manual") {
      throw new RepositoryError("not_allowed", "Only manual accounts can be changed this way.");
    }
    return account;
  }

  async updateAccount(accountId: string, patch: { nickname?: string | null; isHidden?: boolean }) {
    const account = this.account(accountId);
    if (patch.nickname !== undefined) account.nickname = patch.nickname;
    if (patch.isHidden !== undefined) account.isHidden = patch.isHidden;
  }

  async createManualAccount(input: Parameters<FinanceRepository["createManualAccount"]>[0]) {
    const s = this.state();
    const id = `demo-manual-${randomUUID()}`;
    s.data.accounts.push({
      id,
      name: input.name,
      nickname: input.nickname,
      institutionName: "Manual account",
      type: input.type,
      subtype: input.subtype,
      mask: null,
      currency: input.currency,
      source: "manual",
      connectionStatus: "active",
      lastSuccessfulSyncAt: null,
      isHidden: false,
      isDemo: true,
    });
    this.pushBalance({
      accountId: id,
      currentMinor: input.currentMinor,
      availableMinor: availableFor(input.type, input.currentMinor, input.creditLimitMinor),
      creditLimitMinor: input.creditLimitMinor,
      currency: input.currency,
      asOf: new Date().toISOString(),
    });
    return id;
  }

  async recordManualBalance(accountId: string, input: { currentMinor: number; creditLimitMinor: number | null }, now: Date) {
    const account = this.manualAccount(accountId);
    this.pushBalance({
      accountId,
      currentMinor: input.currentMinor,
      availableMinor: availableFor(account.type, input.currentMinor, input.creditLimitMinor),
      creditLimitMinor: input.creditLimitMinor,
      currency: account.currency,
      asOf: now.toISOString(),
    });
  }

  private pushBalance(snapshot: BalanceSnapshot) {
    const s = this.state();
    s.history.push(snapshot);
    s.data.balances = s.data.balances.filter((b) => b.accountId !== snapshot.accountId);
    s.data.balances.push(snapshot);
  }

  async deleteManualAccount(accountId: string) {
    this.manualAccount(accountId);
    const s = this.state();
    const txIds = new Set(s.data.transactions.filter((t) => t.accountId === accountId).map((t) => t.id));
    s.data.accounts = s.data.accounts.filter((a) => a.id !== accountId);
    s.data.balances = s.data.balances.filter((b) => b.accountId !== accountId);
    s.history = s.history.filter((b) => b.accountId !== accountId);
    s.data.transactions = s.data.transactions.filter((t) => !txIds.has(t.id));
    s.data.overrides = s.data.overrides.filter((o) => !txIds.has(o.transactionId));
    s.data.transferLinks = s.data.transferLinks.filter(
      (l) => !txIds.has(l.outflowTransactionId) && !txIds.has(l.inflowTransactionId),
    );
  }

  // ---------------------------------------------------------------------------
  // Transactions
  // ---------------------------------------------------------------------------

  private transaction(id: string): Transaction {
    const tx = this.state().data.transactions.find((t) => t.id === id);
    if (!tx) throw new RepositoryError("not_found", "Transaction not found.");
    return tx;
  }

  private assertCategory(id: string | null) {
    if (id && !this.state().data.categories.some((c) => c.id === id)) {
      throw new RepositoryError("invalid", "Unknown category.");
    }
  }

  async saveOverride(override: Parameters<FinanceRepository["saveOverride"]>[0]) {
    this.transaction(override.transactionId);
    this.assertCategory(override.categoryId);
    const s = this.state();
    s.data.overrides = s.data.overrides.filter((o) => o.transactionId !== override.transactionId);
    if (!isEmptyOverride(override)) s.data.overrides.push({ ...override });
  }

  async addManualTransaction(input: Parameters<FinanceRepository["addManualTransaction"]>[0]) {
    this.manualAccount(input.accountId);
    this.assertCategory(input.categoryId);
    const account = this.account(input.accountId);
    const id = `demo-manual-tx-${randomUUID()}`;
    this.state().data.transactions.push({
      id,
      accountId: input.accountId,
      source: "manual",
      externalId: id,
      pendingExternalId: null,
      status: "posted",
      amountMinor: input.amountMinor,
      currency: account.currency,
      date: input.date,
      description: input.description,
      merchantName: input.description,
      defaultCategoryId: input.categoryId,
      dedupeHash: null,
      isRemoved: false,
      supersededBy: null,
    });
    return id;
  }

  async importTransactions(accountId: string, rows: Parameters<FinanceRepository["importTransactions"]>[1]) {
    const account = this.account(accountId);
    const s = this.state();
    const existing = new Set(
      s.data.transactions.filter((t) => t.accountId === accountId && t.dedupeHash).map((t) => t.dedupeHash),
    );
    let inserted = 0;
    for (const row of rows) {
      this.assertCategory(row.categoryId);
      if (existing.has(row.dedupeHash)) continue;
      existing.add(row.dedupeHash);
      const id = `demo-csv-${randomUUID()}`;
      s.data.transactions.push({
        id,
        accountId,
        source: "csv",
        externalId: id,
        pendingExternalId: null,
        status: "posted",
        amountMinor: row.amountMinor,
        currency: account.currency,
        date: row.date,
        description: row.description,
        merchantName: null,
        defaultCategoryId: row.categoryId,
        dedupeHash: row.dedupeHash,
        isRemoved: false,
        supersededBy: null,
      });
      inserted += 1;
    }
    return inserted;
  }

  async linkTransfer(input: Parameters<FinanceRepository["linkTransfer"]>[0]) {
    this.transaction(input.outflowTransactionId);
    this.transaction(input.inflowTransactionId);
    const s = this.state();
    const linked = new Set(s.data.transferLinks.flatMap((l) => [l.outflowTransactionId, l.inflowTransactionId]));
    if (linked.has(input.outflowTransactionId) || linked.has(input.inflowTransactionId)) {
      throw new RepositoryError("conflict", "One of these transactions is already linked.");
    }
    s.data.transferLinks.push({ ...input, detectedBy: "user" });
  }

  async unlinkTransfer(transactionId: string) {
    const s = this.state();
    s.data.transferLinks = s.data.transferLinks.filter(
      (l) => l.outflowTransactionId !== transactionId && l.inflowTransactionId !== transactionId,
    );
  }

  async createCategory(input: Parameters<FinanceRepository["createCategory"]>[0]) {
    const s = this.state();
    if (s.data.categories.some((c) => c.name.toLowerCase() === input.name.toLowerCase())) {
      throw new RepositoryError("conflict", "A category with that name already exists.");
    }
    const id = `demo-cat-custom-${randomUUID()}`;
    s.data.categories.push({ id, name: input.name, kind: input.kind, isEssential: input.isEssential, color: null });
    return id;
  }

  // ---------------------------------------------------------------------------
  // Budget & planning
  // ---------------------------------------------------------------------------

  private budget(month: string) {
    const s = this.state();
    let budget = s.data.budgets.find((b) => b.month === month);
    if (!budget) {
      budget = { month, currency: s.data.profile.baseCurrency, allocations: [] };
      s.data.budgets.push(budget);
    }
    return budget;
  }

  async setAllocation(month: string, categoryId: string, kind: Parameters<FinanceRepository["setAllocation"]>[2], plannedMinor: number) {
    this.assertCategory(categoryId);
    const budget = this.budget(month);
    budget.allocations = budget.allocations.filter((a) => a.categoryId !== categoryId);
    budget.allocations.push({ categoryId, kind, plannedMinor });
  }

  async removeAllocation(month: string, categoryId: string) {
    const budget = this.state().data.budgets.find((b) => b.month === month);
    if (budget) budget.allocations = budget.allocations.filter((a) => a.categoryId !== categoryId);
  }

  async copyBudget(fromMonth: string, toMonth: string) {
    const from = this.state().data.budgets.find((b) => b.month === fromMonth);
    const to = this.budget(toMonth);
    let copied = 0;
    for (const a of from?.allocations ?? []) {
      if (to.allocations.some((x) => x.categoryId === a.categoryId)) continue;
      to.allocations.push({ ...a });
      copied += 1;
    }
    return copied;
  }

  private upsert<T extends { id: string }>(list: T[], item: Omit<T, "id"> & { id?: string }, prefix: string): string {
    if (item.id) {
      const index = list.findIndex((x) => x.id === item.id);
      if (index === -1) throw new RepositoryError("not_found", "Item not found.");
      list[index] = { ...(item as T) };
      return item.id;
    }
    const id = `${prefix}-${randomUUID()}`;
    list.push({ ...(item as T), id });
    return id;
  }

  private remove<T extends { id: string }>(list: T[], id: string): T[] {
    if (!list.some((x) => x.id === id)) throw new RepositoryError("not_found", "Item not found.");
    return list.filter((x) => x.id !== id);
  }

  async saveBill(bill: Parameters<FinanceRepository["saveBill"]>[0]) {
    this.assertCategory(bill.categoryId);
    if (bill.payFromAccountId) this.account(bill.payFromAccountId);
    return this.upsert(this.state().data.bills, bill, "demo-bill");
  }
  async deleteBill(id: string) {
    const d = this.state().data;
    d.bills = this.remove(d.bills, id);
  }
  async saveIncomeSource(source: Parameters<FinanceRepository["saveIncomeSource"]>[0]) {
    return this.upsert(this.state().data.incomeSources, source, "demo-income");
  }
  async deleteIncomeSource(id: string) {
    const d = this.state().data;
    d.incomeSources = this.remove(d.incomeSources, id);
  }
  async saveSavingsGoal(goal: Parameters<FinanceRepository["saveSavingsGoal"]>[0]) {
    return this.upsert(this.state().data.savingsGoals, goal, "demo-goal");
  }
  async deleteSavingsGoal(id: string) {
    const d = this.state().data;
    d.savingsGoals = this.remove(d.savingsGoals, id);
  }
  async saveDebtGoal(goal: Parameters<FinanceRepository["saveDebtGoal"]>[0]) {
    if (goal.accountId) this.account(goal.accountId);
    return this.upsert(this.state().data.debtGoals, goal, "demo-debt");
  }
  async deleteDebtGoal(id: string) {
    const d = this.state().data;
    d.debtGoals = this.remove(d.debtGoals, id);
  }
  async updateProfile(patch: Parameters<FinanceRepository["updateProfile"]>[0]) {
    const profile = this.state().data.profile;
    if (patch.displayName !== undefined) profile.displayName = patch.displayName;
    if (patch.timezone !== undefined) profile.timezone = patch.timezone;
    if (patch.safetyBufferMinor !== undefined) profile.safetyBufferMinor = patch.safetyBufferMinor;
    if (patch.includeExpectedIncome !== undefined) profile.includeExpectedIncome = patch.includeExpectedIncome;
  }

  /** Demo mode keeps no audit trail: nothing real happens. */
  async audit(): Promise<void> {}
}

export function availableFor(type: string, currentMinor: number, creditLimitMinor: number | null): number | null {
  if (type === "depository") return currentMinor;
  if (type === "credit" && creditLimitMinor !== null) return creditLimitMinor - currentMinor;
  return null;
}

export function isEmptyOverride(o: Parameters<FinanceRepository["saveOverride"]>[0]): boolean {
  return !o.categoryId && !o.merchantName && !o.note && !o.excludeFromBudget && !o.transferOverride;
}
