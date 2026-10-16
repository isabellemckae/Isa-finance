import type { SupabaseClient } from "@supabase/supabase-js";
import type { z } from "zod";
import { addMonths, startOfMonth, todayInTimeZone } from "@/lib/finance/dates";
import type { BalanceSnapshot, FinancialData, TransactionOverride } from "@/lib/finance/types";
import { RepositoryError, type FinanceRepository } from "../repository";
import * as rows from "./rows";

/**
 * Supabase-backed repository. Every query runs with the signed-in user's JWT, so
 * Row Level Security is enforced by Postgres; each query is ALSO filtered by
 * `user_id` explicitly (defense in depth). The service-role key is never used here.
 */

/** Transactions older than this many months are not loaded for the dashboard/pages. */
export const TRANSACTION_HISTORY_MONTHS = 13;
const PAGE = 1000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface PgError {
  code?: string;
  message?: string;
}

/** Maps Postgres/PostgREST errors to user-safe repository errors (no data in messages). */
export function toRepositoryError(error: PgError, fallback = "The request could not be completed."): RepositoryError {
  switch (error.code) {
    case "42501":
      return new RepositoryError("not_allowed", "You don't have permission to do that.");
    case "23505":
      return new RepositoryError("conflict", "That already exists.");
    case "23503":
      return new RepositoryError("invalid", "That refers to something that doesn't exist.");
    case "23514":
    case "22P02":
    case "22023":
    case "22007":
      return new RepositoryError("invalid", "Some values were not valid.");
    case "PGRST116":
      return new RepositoryError("not_found", "Not found.");
    default:
      return new RepositoryError("unavailable", fallback);
  }
}

function parseAll<S extends z.ZodTypeAny>(schema: S, data: unknown[] | null): z.infer<S>[] {
  return (data ?? []).map((row) => {
    const parsed = schema.safeParse(row);
    if (!parsed.success) {
      // Never log row contents: they are financial data.
      throw new RepositoryError("unavailable", "Unexpected data format from the database.");
    }
    return parsed.data;
  });
}

export class SupabaseRepository implements FinanceRepository {
  readonly kind = "supabase" as const;

  constructor(
    private readonly db: SupabaseClient,
    private readonly userId: string,
  ) {}

  /** Reads every page of a query (PostgREST caps responses at 1000 rows). */
  private async selectAll<S extends z.ZodTypeAny>(
    schema: S,
    build: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: PgError | null }>,
  ): Promise<z.infer<S>[]> {
    const out: z.infer<S>[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await build(from, from + PAGE - 1);
      if (error) throw toRepositoryError(error);
      out.push(...parseAll(schema, data));
      if (!data || data.length < PAGE) return out;
    }
  }

  private table(name: string) {
    return this.db.from(name);
  }

  private async check(promise: PromiseLike<{ error: PgError | null }>) {
    const { error } = await promise;
    if (error) throw toRepositoryError(error);
  }

  async getFinancialData(now: Date): Promise<FinancialData> {
    const uid = this.userId;
    const { data: profileData, error: profileError } = await this.table("profiles")
      .select(rows.SELECT.profile)
      .eq("id", uid)
      .single();
    if (profileError) throw toRepositoryError(profileError, "Your profile could not be loaded.");
    const profile = rows.toProfile(parseAll(rows.profileRow, [profileData])[0]);

    const since = addMonths(startOfMonth(todayInTimeZone(profile.timezone, now)), -TRANSACTION_HISTORY_MONTHS);
    const byUser = (t: string, select: string) => this.table(t).select(select).eq("user_id", uid);

    const [accounts, balances, categories, transactions, overrides, links, budgets, bills, income, goals, debts] =
      await Promise.all([
        this.selectAll(rows.accountRow, (f, t) => byUser("accounts", rows.SELECT.account).order("created_at").range(f, t)),
        this.selectAll(rows.balanceRow, (f, t) => byUser("account_latest_balances", rows.SELECT.balance).range(f, t)),
        this.selectAll(rows.categoryRow, (f, t) => byUser("transaction_categories", rows.SELECT.category).order("name").range(f, t)),
        this.selectAll(rows.transactionRow, (f, t) =>
          byUser("transactions", rows.SELECT.transaction)
            .gte("transaction_date", since)
            .order("transaction_date", { ascending: false })
            .order("id")
            .range(f, t),
        ),
        this.selectAll(rows.overrideRow, (f, t) => byUser("transaction_overrides", rows.SELECT.override).range(f, t)),
        this.selectAll(rows.transferLinkRow, (f, t) => byUser("transfer_links", rows.SELECT.transferLink).range(f, t)),
        this.selectAll(rows.budgetRow, (f, t) => byUser("budgets", rows.SELECT.budget).order("month").range(f, t)),
        this.selectAll(rows.billRow, (f, t) => byUser("recurring_bills", rows.SELECT.bill).eq("is_active", true).range(f, t)),
        this.selectAll(rows.incomeRow, (f, t) => byUser("income_sources", rows.SELECT.income).eq("is_active", true).range(f, t)),
        this.selectAll(rows.savingsGoalRow, (f, t) => byUser("savings_goals", rows.SELECT.savingsGoal).order("priority").range(f, t)),
        this.selectAll(rows.debtGoalRow, (f, t) => byUser("debt_goals", rows.SELECT.debtGoal).range(f, t)),
      ]);

    return {
      isDemo: false,
      generatedAt: now.toISOString(),
      profile,
      accounts: accounts.map(rows.toAccount),
      balances: balances.map(rows.toBalance),
      categories: categories.map(rows.toCategory),
      transactions: transactions.map(rows.toTransaction),
      overrides: overrides.map(rows.toOverride),
      transferLinks: links.map(rows.toTransferLink),
      budgets: budgets.map(rows.toBudget),
      bills: bills.map(rows.toBill),
      incomeSources: income.map(rows.toIncome),
      savingsGoals: goals.map(rows.toSavingsGoal),
      debtGoals: debts.map(rows.toDebtGoal),
    };
  }

  async getBalanceHistory(accountId: string): Promise<BalanceSnapshot[]> {
    const list = await this.selectAll(rows.balanceRow, (f, t) =>
      this.table("balance_snapshots")
        .select(rows.SELECT.balance)
        .eq("user_id", this.userId)
        .eq("account_id", accountId)
        .order("as_of", { ascending: false })
        .range(f, t),
    );
    return list.map(rows.toBalance);
  }

  // ---------------------------------------------------------------------------
  // Accounts
  // ---------------------------------------------------------------------------

  private async requireRow(table: string, id: string, extra: Record<string, string> = {}) {
    let q = this.table(table).select("id").eq("user_id", this.userId).eq("id", id);
    for (const [k, v] of Object.entries(extra)) q = q.eq(k, v);
    const { data, error } = await q.maybeSingle();
    if (error) throw toRepositoryError(error);
    if (!data) throw new RepositoryError("not_found", "Not found.");
  }

  async updateAccount(accountId: string, patch: { nickname?: string | null; isHidden?: boolean }) {
    await this.requireRow("accounts", accountId);
    const update: Record<string, unknown> = {};
    if (patch.nickname !== undefined) update.nickname = patch.nickname;
    if (patch.isHidden !== undefined) update.is_hidden = patch.isHidden;
    await this.check(this.table("accounts").update(update).eq("user_id", this.userId).eq("id", accountId));
  }

  async createManualAccount(input: Parameters<FinanceRepository["createManualAccount"]>[0]) {
    const { data, error } = await this.db.rpc("create_manual_account", {
      p_name: input.name,
      p_type: input.type,
      p_subtype: input.subtype,
      p_currency: input.currency,
      p_nickname: input.nickname,
      p_current_minor: input.currentMinor,
      p_credit_limit_minor: input.creditLimitMinor,
    });
    if (error) throw toRepositoryError(error);
    return String(data);
  }

  async recordManualBalance(accountId: string, input: { currentMinor: number; creditLimitMinor: number | null }, now: Date) {
    const { data, error } = await this.table("accounts")
      .select("type, currency, source")
      .eq("user_id", this.userId)
      .eq("id", accountId)
      .maybeSingle();
    if (error) throw toRepositoryError(error);
    if (!data) throw new RepositoryError("not_found", "Account not found.");
    if (data.source !== "manual") throw new RepositoryError("not_allowed", "Only manual accounts can be updated by hand.");
    const available =
      data.type === "depository"
        ? input.currentMinor
        : data.type === "credit" && input.creditLimitMinor !== null
          ? input.creditLimitMinor - input.currentMinor
          : null;
    await this.check(
      this.table("balance_snapshots").insert({
        user_id: this.userId,
        account_id: accountId,
        current_minor: input.currentMinor,
        available_minor: available,
        credit_limit_minor: input.creditLimitMinor,
        currency: data.currency,
        as_of: now.toISOString(),
        source: "manual",
      }),
    );
  }

  async deleteManualAccount(accountId: string) {
    await this.requireRow("accounts", accountId, { source: "manual" });
    await this.check(this.table("accounts").delete().eq("user_id", this.userId).eq("id", accountId).eq("source", "manual"));
  }

  // ---------------------------------------------------------------------------
  // Transactions
  // ---------------------------------------------------------------------------

  async saveOverride(o: TransactionOverride) {
    await this.requireRow("transactions", o.transactionId);
    const empty = !o.categoryId && !o.merchantName && !o.note && !o.excludeFromBudget && !o.transferOverride;
    if (empty) {
      await this.check(
        this.table("transaction_overrides").delete().eq("user_id", this.userId).eq("transaction_id", o.transactionId),
      );
      return;
    }
    await this.check(
      this.table("transaction_overrides").upsert(
        {
          transaction_id: o.transactionId,
          user_id: this.userId,
          category_id: o.categoryId,
          merchant_name: o.merchantName,
          note: o.note,
          exclude_from_budget: o.excludeFromBudget,
          transfer_override: o.transferOverride,
        },
        { onConflict: "transaction_id" },
      ),
    );
  }

  async addManualTransaction(input: Parameters<FinanceRepository["addManualTransaction"]>[0]) {
    const { data: account, error } = await this.table("accounts")
      .select("currency, source")
      .eq("user_id", this.userId)
      .eq("id", input.accountId)
      .maybeSingle();
    if (error) throw toRepositoryError(error);
    if (!account) throw new RepositoryError("not_found", "Account not found.");
    if (account.source !== "manual") throw new RepositoryError("not_allowed", "Add transactions to manual accounts only.");
    const { data, error: insertError } = await this.table("transactions")
      .insert({
        user_id: this.userId,
        account_id: input.accountId,
        source: "manual",
        status: "posted",
        amount_minor: input.amountMinor,
        currency: account.currency,
        transaction_date: input.date,
        description: input.description,
        merchant_name: input.description,
        default_category_id: input.categoryId,
      })
      .select("id")
      .single();
    if (insertError) throw toRepositoryError(insertError);
    return String(data.id);
  }

  async importTransactions(accountId: string, list: Parameters<FinanceRepository["importTransactions"]>[1]) {
    const { data, error } = await this.db.rpc("import_transactions", {
      p_account_id: accountId,
      p_batch_id: crypto.randomUUID(),
      p_rows: list.map((r) => ({
        date: r.date,
        amount_minor: r.amountMinor,
        description: r.description,
        dedupe_hash: r.dedupeHash,
        category_id: r.categoryId ?? "",
      })),
    });
    if (error) throw toRepositoryError(error);
    return Number(data);
  }

  async linkTransfer(input: Parameters<FinanceRepository["linkTransfer"]>[0]) {
    await this.check(
      this.table("transfer_links").insert({
        user_id: this.userId,
        outflow_transaction_id: input.outflowTransactionId,
        inflow_transaction_id: input.inflowTransactionId,
        kind: input.kind,
        detected_by: "user",
      }),
    );
  }

  async unlinkTransfer(transactionId: string) {
    // The id is interpolated into a PostgREST filter, so it must be a plain UUID.
    if (!UUID_RE.test(transactionId)) throw new RepositoryError("invalid", "Invalid transaction.");
    await this.check(
      this.table("transfer_links")
        .delete()
        .eq("user_id", this.userId)
        .or(`outflow_transaction_id.eq.${transactionId},inflow_transaction_id.eq.${transactionId}`),
    );
  }

  async createCategory(input: Parameters<FinanceRepository["createCategory"]>[0]) {
    const { data, error } = await this.table("transaction_categories")
      .insert({ user_id: this.userId, name: input.name, kind: input.kind, is_essential: input.isEssential })
      .select("id")
      .single();
    if (error) throw toRepositoryError(error);
    return String(data.id);
  }

  // ---------------------------------------------------------------------------
  // Budget & planning
  // ---------------------------------------------------------------------------

  async setAllocation(month: string, categoryId: string, kind: Parameters<FinanceRepository["setAllocation"]>[2], plannedMinor: number) {
    const { error } = await this.db.rpc("upsert_budget_allocation", {
      p_month: month,
      p_category_id: categoryId,
      p_kind: kind,
      p_planned_minor: plannedMinor,
    });
    if (error) throw toRepositoryError(error);
  }

  async removeAllocation(month: string, categoryId: string) {
    const { data, error } = await this.table("budgets").select("id").eq("user_id", this.userId).eq("month", month).maybeSingle();
    if (error) throw toRepositoryError(error);
    if (!data) return;
    await this.check(
      this.table("budget_allocations").delete().eq("user_id", this.userId).eq("budget_id", data.id).eq("category_id", categoryId),
    );
  }

  async copyBudget(fromMonth: string, toMonth: string) {
    const { data, error } = await this.db.rpc("copy_budget", { p_from: fromMonth, p_to: toMonth });
    if (error) throw toRepositoryError(error);
    return Number(data);
  }

  private async save(table: string, id: string | undefined, values: Record<string, unknown>): Promise<string> {
    if (id) {
      const { data, error } = await this.table(table).update(values).eq("user_id", this.userId).eq("id", id).select("id");
      if (error) throw toRepositoryError(error);
      if (!data?.length) throw new RepositoryError("not_found", "Not found.");
      return id;
    }
    const { data, error } = await this.table(table)
      .insert({ ...values, user_id: this.userId })
      .select("id")
      .single();
    if (error) throw toRepositoryError(error);
    return String(data.id);
  }

  private async del(table: string, id: string) {
    const { data, error } = await this.table(table).delete().eq("user_id", this.userId).eq("id", id).select("id");
    if (error) throw toRepositoryError(error);
    if (!data?.length) throw new RepositoryError("not_found", "Not found.");
  }

  async saveBill(b: Parameters<FinanceRepository["saveBill"]>[0]) {
    return this.save("recurring_bills", b.id, {
      name: b.name,
      amount_minor: b.amountMinor,
      amount_is_estimate: b.amountIsEstimate,
      currency: b.currency,
      cadence: b.cadence,
      next_due_date: b.nextDueDate,
      pay_from_account_id: b.payFromAccountId,
      category_id: b.categoryId,
      autopay: b.autopay,
    });
  }
  async deleteBill(id: string) {
    await this.del("recurring_bills", id);
  }

  async saveIncomeSource(s: Parameters<FinanceRepository["saveIncomeSource"]>[0]) {
    return this.save("income_sources", s.id, {
      name: s.name,
      kind: s.kind,
      expected_amount_minor: s.expectedAmountMinor,
      currency: s.currency,
      cadence: s.cadence,
      next_expected_date: s.nextExpectedDate,
    });
  }
  async deleteIncomeSource(id: string) {
    await this.del("income_sources", id);
  }

  async saveSavingsGoal(g: Parameters<FinanceRepository["saveSavingsGoal"]>[0]) {
    return this.save("savings_goals", g.id, {
      name: g.name,
      target_minor: g.targetMinor,
      saved_minor: g.savedMinor,
      monthly_contribution_minor: g.monthlyContributionMinor,
      currency: g.currency,
      target_date: g.targetDate,
    });
  }
  async deleteSavingsGoal(id: string) {
    await this.del("savings_goals", id);
  }

  async saveDebtGoal(g: Parameters<FinanceRepository["saveDebtGoal"]>[0]) {
    return this.save("debt_goals", g.id, {
      account_id: g.accountId,
      name: g.name,
      apr_bps: g.aprBps,
      minimum_payment_minor: g.minimumPaymentMinor,
      planned_payment_minor: g.plannedPaymentMinor,
      payment_due_day: g.paymentDueDay,
    });
  }
  async deleteDebtGoal(id: string) {
    await this.del("debt_goals", id);
  }

  async updateProfile(patch: Parameters<FinanceRepository["updateProfile"]>[0]) {
    const update: Record<string, unknown> = {};
    if (patch.displayName !== undefined) update.display_name = patch.displayName;
    if (patch.timezone !== undefined) update.timezone = patch.timezone;
    if (patch.safetyBufferMinor !== undefined) update.safety_buffer_minor = patch.safetyBufferMinor;
    if (patch.includeExpectedIncome !== undefined) update.include_expected_income = patch.includeExpectedIncome;
    await this.check(this.table("profiles").update(update).eq("id", this.userId));
  }

  async audit(action: string, entityType: string, entityId: string | null) {
    // Best effort: an audit failure must not undo the user's change, but is reported.
    const { error } = await this.db.rpc("log_audit_event", {
      p_action: action,
      p_entity_type: entityType,
      p_entity_id: entityId,
    });
    if (error) console.error("audit_event_failed", { action, code: error.code });
  }
}
