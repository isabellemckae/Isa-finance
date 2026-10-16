import { addDays, endOfMonth, formatDate, startOfMonth, todayInTimeZone } from "./dates";
import { addMinor, formatMoney } from "./money";
import { accountBalanceViews, summarizeBalances, type AccountBalanceView, type BalanceSummary } from "./balances";
import { enrichTransactions, summarizePeriod, type EnrichedTransaction, type PeriodSummary } from "./classification";
import { computeBudgetPerformance, type BudgetPerformance } from "./budget";
import { computeSafeToSpend, type SafeToSpendResult } from "./safe-to-spend";
import { expectedIncome, upcomingBills, type BillOccurrence } from "./schedule";
import { categoryChangesMonthToDate, monthlyCashFlow, type CashFlowPoint } from "./cashflow";
import { savingsProgress, type SavingsProgress } from "./goals";
import type { CurrencyCode, FinancialData, ISODate, ISOTimestamp } from "./types";

/**
 * Assembles every dashboard figure from deterministic services. The UI only formats
 * what this returns, and the Personal CFO (Phase 3) will reuse the same building blocks.
 */

export interface Insight {
  id: string;
  tone: "positive" | "neutral" | "attention";
  title: string;
  body: string;
}

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
  model.insights = buildInsights(model, transactions);
  return model;
}

/** Rule-based insights computed from the model. Not AI-generated. */
export function buildInsights(model: DashboardModel, transactions: readonly EnrichedTransaction[]): Insight[] {
  const fmt = (m: number) => formatMoney(m, model.currency, { wholeUnits: true });
  const insights: Insight[] = [];

  const unhealthy = model.balances.unhealthyAccountIds.length;
  const stale = model.balances.staleAccountIds.length;
  if (unhealthy > 0 || stale > 0) {
    insights.push({
      id: "data-quality",
      tone: "attention",
      title: "Some balances need attention",
      body: [
        unhealthy ? `${unhealthy} account${unhealthy === 1 ? "" : "s"} need${unhealthy === 1 ? "s" : ""} reconnecting.` : "",
        stale ? `${stale} balance${stale === 1 ? " is" : "s are"} more than a day old.` : "",
        "Figures that rely on them are estimates.",
      ]
        .filter(Boolean)
        .join(" "),
    });
  }

  if (model.budget) {
    const over = model.budget.lines.filter((l) => l.status === "over");
    const near = model.budget.lines.filter((l) => l.status === "near_limit");
    if (over.length > 0) {
      const worst = [...over].sort((a, b) => a.remainingMinor - b.remainingMinor)[0];
      insights.push({
        id: "budget-over",
        tone: "attention",
        title: `${worst.name} is over budget`,
        body: `You've spent ${fmt(worst.actualMinor)} of ${fmt(worst.plannedMinor)} planned, ${fmt(-worst.remainingMinor)} over.${
          over.length > 1 ? ` ${over.length - 1} other categor${over.length === 2 ? "y is" : "ies are"} also over.` : ""
        }`,
      });
    } else if (near.length > 0) {
      insights.push({
        id: "budget-near",
        tone: "neutral",
        title: `${near[0].name} is close to its limit`,
        body: `${fmt(near[0].remainingMinor)} left of ${fmt(near[0].plannedMinor)} for the rest of the month.`,
      });
    }
  }

  const changes = categoryChangesMonthToDate(transactions, model.asOf);
  const biggest = changes[0];
  if (biggest && biggest.changeMinor > 0 && biggest.previousMinor > 0) {
    insights.push({
      id: "category-increase",
      tone: "neutral",
      title: `${biggest.name} spending is up`,
      body: `${fmt(biggest.currentMinor)} so far this month vs ${fmt(biggest.previousMinor)} by the same day last month.`,
    });
  }

  if (model.upcomingBills.length > 0) {
    const next = model.upcomingBills[0];
    insights.push({
      id: "bills",
      tone: "neutral",
      title: `${model.upcomingBills.length} bill${model.upcomingBills.length === 1 ? "" : "s"} in the next ${UPCOMING_BILLS_DAYS} days`,
      body: `${fmt(model.upcomingBillsTotalMinor)} in total. Next: ${next.name} on ${formatDate(next.dueDate)}.`,
    });
  }

  const goal = [...model.savings].sort((a, b) => b.progressBps - a.progressBps)[0];
  if (goal && goal.progressBps > 0) {
    insights.push({
      id: "savings",
      tone: "positive",
      title: `${goal.name} is ${Math.floor(goal.progressBps / 100)}% funded`,
      body:
        goal.projectedDate && goal.remainingMinor > 0
          ? `At your planned pace you'll reach ${fmt(goal.targetMinor)} around ${formatDate(goal.projectedDate, { month: "long", year: "numeric" })}.`
          : `${fmt(goal.remainingMinor)} to go.`,
    });
  }

  return insights.slice(0, 4);
}
