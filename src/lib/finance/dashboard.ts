import { addDays, endOfMonth, startOfMonth, todayInTimeZone } from "./dates";
import { addMinor } from "./money";
import { accountBalanceViews, summarizeBalances, type AccountBalanceView, type BalanceSummary } from "./balances";
import { enrichTransactions, summarizePeriod, type EnrichedTransaction, type PeriodSummary } from "./classification";
import { computeBudgetPerformance, type BudgetPerformance } from "./budget";
import { computeSafeToSpend, type SafeToSpendResult } from "./safe-to-spend";
import { expectedIncome, upcomingBills, type BillOccurrence } from "./schedule";
import { monthlyCashFlow, type CashFlowPoint } from "./cashflow";
import { buildProactiveInsights, type ProactiveInsight } from "./insights";
import { savingsProgress, type SavingsProgress } from "./goals";
import type { CurrencyCode, FinancialData, ISODate, ISOTimestamp } from "./types";

/**
 * Assembles every dashboard figure from deterministic services. The UI only formats
 * what this returns, and the Personal CFO (Phase 3) will reuse the same building blocks.
 */

export type Insight = ProactiveInsight;

export interface DashboardModel {
  isDemo: boolean;
  asOf: ISODate;
  currency: CurrencyCode;
  balances: BalanceSummary;
  accounts: AccountBalanceView[];
  monthToDate: PeriodSummary;
  budget: BudgetPerformance | null;
  safeToSpend: SafeToSpendResult;
  safeToSpendHorizonReason: "next_paycheck" | "end_of_month";
  upcomingBills: BillOccurrence[];
  upcomingBillsTotalMinor: number;
  savings: SavingsProgress[];
  recentTransactions: EnrichedTransaction[];
  cashFlow: CashFlowPoint[];
  sync: { latestSuccessAt: ISOTimestamp | null; oldestSuccessAt: ISOTimestamp | null };
  insights: Insight[];
}

export const UPCOMING_BILLS_DAYS = 14;

export function buildDashboard(data: FinancialData, now: Date): DashboardModel {
  const currency = data.profile.baseCurrency;
  const asOf = todayInTimeZone(data.profile.timezone, now);
  const monthStart = startOfMonth(asOf);

  const transactions = enrichTransactions({
    transactions: data.transactions,
    overrides: data.overrides,
    categories: data.categories,
    transferLinks: data.transferLinks,
  });

  const balances = summarizeBalances(data.accounts, data.balances, { now, currency });
  const monthToDate = summarizePeriod(transactions, monthStart, asOf);
  const budgetRecord = data.budgets.find((b) => b.month === monthStart && b.currency === currency);
  const budget = budgetRecord ? computeBudgetPerformance(budgetRecord, transactions, data.categories) : null;

  // Horizon: until the day before the next expected paycheck, or end of month.
  const nextIncome = expectedIncome(data.incomeSources, addDays(asOf, 1), endOfMonth(asOf))[0];
  const horizonEnd = nextIncome ? addDays(nextIncome.date, -1) : endOfMonth(asOf);

  const safeToSpend = computeSafeToSpend({
    asOf,
    horizonEnd,
    now,
    currency,
    accounts: data.accounts,
    balances: data.balances,
    transactions,
    bills: data.bills,
    incomeSources: data.incomeSources,
    debtGoals: data.debtGoals,
    budget,
    safetyBufferMinor: data.profile.safetyBufferMinor,
    includeExpectedIncome: data.profile.includeExpectedIncome,
  });

  const bills = upcomingBills(data.bills, asOf, addDays(asOf, UPCOMING_BILLS_DAYS));
  const syncTimes = data.accounts
    .filter((a) => a.source === "plaid")
    .map((a) => a.lastSuccessfulSyncAt)
    .filter((t): t is string => t !== null)
    .sort();

  const model: DashboardModel = {
    isDemo: data.isDemo,
    asOf,
    currency,
    balances,
    accounts: accountBalanceViews(
      data.accounts.filter((a) => !a.isHidden),
      data.balances,
      now,
    ),
    monthToDate,
    budget,
    safeToSpend,
    safeToSpendHorizonReason: nextIncome ? "next_paycheck" : "end_of_month",
    upcomingBills: bills,
    upcomingBillsTotalMinor: bills.reduce((s, b) => addMinor(s, b.amountMinor), 0),
    savings: data.savingsGoals.map((g) => savingsProgress(g, asOf)),
    recentTransactions: [...transactions]
      .sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id))
      .slice(0, 8),
    cashFlow: monthlyCashFlow(transactions, asOf, 6),
    sync: { latestSuccessAt: syncTimes.at(-1) ?? null, oldestSuccessAt: syncTimes[0] ?? null },
    insights: [],
  };
  model.insights = buildProactiveInsights({ data, transactions, now, asOf, limit: 4 });
  return model;
}
