import { addMinor, divRoundHalfUp, formatMoney } from "./money";
import { addDays, addMonths, diffDays, endOfMonth, formatDate, isWithin, startOfMonth } from "./dates";
import { countsTowardSpending, summarizePeriod, type EnrichedTransaction } from "./classification";
import { computeBudgetPerformance } from "./budget";
import { summarizeBalances } from "./balances";
import { upcomingBills } from "./schedule";
import { projectCashFlow } from "./forecast";
import type { FinancialData, ISODate } from "./types";

/**
 * Proactive insights. Every insight is computed deterministically from the user's
 * data; wording is templated, never generated. Projections are marked `isEstimate`.
 */

export type InsightKind =
  | "data_quality"
  | "low_cash"
  | "budget_over"
  | "budget_near"
  | "unusual_transaction"
  | "possible_duplicate_charge"
  | "category_spike"
  | "upcoming_bills"
  | "savings_opportunity";

export type InsightSeverity = "warning" | "attention" | "info" | "positive";

export interface ProactiveInsight {
  id: string;
  kind: InsightKind;
  severity: InsightSeverity;
  title: string;
  body: string;
  isEstimate: boolean;
  href?: string;
}

const SEVERITY_ORDER: Record<InsightSeverity, number> = { warning: 0, attention: 1, info: 2, positive: 3 };

/** Median of integers (lower median for even counts, so results stay integers). */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)];
}

export const UNUSUAL_MULTIPLE = 3;
export const UNUSUAL_MIN_MINOR = 5_000;
export const SPIKE_MIN_INCREASE_MINOR = 5_000;

export function findUnusualTransactions(transactions: readonly EnrichedTransaction[], asOf: ISODate) {
  const recentStart = addDays(asOf, -13);
  const historyStart = addDays(asOf, -104);
  const historyEnd = addDays(asOf, -14);
  const history = new Map<string, number[]>();
  for (const tx of transactions) {
    if (tx.flow !== "expense" || !tx.category || !isWithin(tx.date, historyStart, historyEnd)) continue;
    const list = history.get(tx.category.id) ?? [];
    list.push(-tx.amountMinor);
    history.set(tx.category.id, list);
  }
  return transactions
    .filter((tx) => tx.flow === "expense" && tx.category && isWithin(tx.date, recentStart, asOf))
    .filter((tx) => {
      const samples = history.get(tx.category!.id) ?? [];
      if (samples.length < 5) return false;
      const amount = -tx.amountMinor;
      return amount >= UNUSUAL_MIN_MINOR && amount >= median(samples) * UNUSUAL_MULTIPLE;
    })
    .map((tx) => ({ tx, typicalMinor: median(history.get(tx.category!.id) ?? [0]) }));
}

export function findPossibleDuplicateCharges(transactions: readonly EnrichedTransaction[], asOf: ISODate) {
  const recent = transactions
    .filter((t) => t.flow === "expense" && isWithin(t.date, addDays(asOf, -30), asOf))
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  const pairs: Array<[EnrichedTransaction, EnrichedTransaction]> = [];
  const used = new Set<string>();
  for (let i = 0; i < recent.length; i += 1) {
    for (let j = i + 1; j < recent.length; j += 1) {
      const a = recent[i];
      const b = recent[j];
      if (used.has(a.id) || used.has(b.id)) continue;
      if (a.accountId !== b.accountId || a.amountMinor !== b.amountMinor) continue;
      if (a.displayMerchant.toLowerCase() !== b.displayMerchant.toLowerCase()) continue;
      if (Math.abs(diffDays(a.date, b.date)) > 2) continue;
      // Same-day identical small purchases (two coffees) are common; flag only larger ones.
      if (-a.amountMinor < 2_000) continue;
      pairs.push([a, b]);
      used.add(a.id);
      used.add(b.id);
    }
  }
  return pairs;
}

/** Month-to-date category spending vs the average of the same days in the previous 3 months. */
export function findCategorySpikes(transactions: readonly EnrichedTransaction[], asOf: ISODate) {
  const day = Number(asOf.slice(8, 10));
  const current = summarizePeriod(transactions, startOfMonth(asOf), asOf).byCategory;
  const previous = [1, 2, 3].map((k) => {
    const start = addMonths(startOfMonth(asOf), -k);
    return summarizePeriod(transactions, start, addMonths(start, 0, day)).byCategory;
  });
  return current
    .map((c) => {
      const prior = previous.map((p) => p.find((x) => x.categoryId === c.categoryId)?.spentMinor ?? 0);
      const average = Number(divRoundHalfUp(BigInt(prior.reduce((s, v) => s + v, 0)), 3n));
      return { ...c, averageMinor: average };
    })
    .filter(
      (c) =>
        c.categoryId !== null &&
        c.averageMinor > 0 &&
        c.spentMinor - c.averageMinor >= SPIKE_MIN_INCREASE_MINOR &&
        c.spentMinor * 2 >= c.averageMinor * 3,
    )
    .sort((a, b) => b.spentMinor - b.averageMinor - (a.spentMinor - a.averageMinor));
}

export function buildProactiveInsights(input: {
  data: FinancialData;
  transactions: readonly EnrichedTransaction[];
  now: Date;
  asOf: ISODate;
  limit?: number;
}): ProactiveInsight[] {
  const { data, transactions, asOf, now } = input;
  const currency = data.profile.baseCurrency;
  const fmt = (m: number) => formatMoney(m, currency, { wholeUnits: Math.abs(m) >= 100_000 });
  const insights: ProactiveInsight[] = [];

  // Data quality first: everything else depends on it.
  const balances = summarizeBalances(data.accounts, data.balances, { now, currency });
  const unhealthy = balances.unhealthyAccountIds.length;
  const stale = balances.staleAccountIds.length;
  if (unhealthy || stale) {
    insights.push({
      id: "data-quality",
      kind: "data_quality",
      severity: "attention",
      title: "Some balances need attention",
      body: [
        unhealthy ? `${unhealthy} account${unhealthy === 1 ? " needs" : "s need"} reconnecting.` : "",
        stale ? `${stale} balance${stale === 1 ? " is" : "s are"} out of date.` : "",
        "Figures that rely on them are estimates.",
      ]
        .filter(Boolean)
        .join(" "),
      isEstimate: false,
      href: "/accounts",
    });
  }

  // Projected low cash in the next 30 days.
  const forecast = projectCashFlow({ data, transactions, now, asOf, days: 30 });
  if (forecast.lowest.balanceMinor < data.profile.safetyBufferMinor) {
    insights.push({
      id: "low-cash",
      kind: "low_cash",
      severity: "warning",
      title: forecast.lowest.balanceMinor < 0 ? "Cash may run short" : "Cash may dip below your buffer",
      body: `Projected low point: ${fmt(forecast.lowest.balanceMinor)} around ${formatDate(forecast.lowest.date)}, based on scheduled bills, paychecks and your usual spending. This is a projection, not a certainty.`,
      isEstimate: true,
      href: "/cfo/briefing",
    });
  }

  // Budget overruns and near-limits for the current month.
  const budget = data.budgets.find((b) => b.month === startOfMonth(asOf) && b.currency === currency);
  if (budget) {
    const perf = computeBudgetPerformance(budget, transactions, data.categories);
    const over = perf.lines.filter((l) => l.status === "over" && (l.kind === "fixed" || l.kind === "variable"));
    for (const l of over.slice(0, 2)) {
      insights.push({
        id: `budget-over-${l.categoryId}`,
        kind: "budget_over",
        severity: "attention",
        title: `${l.name} is over budget`,
        body: `${fmt(l.actualMinor)} spent of ${fmt(l.plannedMinor)} planned: ${fmt(-l.remainingMinor)} over for ${formatDate(asOf, { month: "long" })}.`,
        isEstimate: false,
        href: "/budget",
      });
    }
    const near = perf.lines.filter((l) => l.status === "near_limit" && l.kind === "variable");
    if (near.length && over.length === 0) {
      const l = near[0];
      insights.push({
        id: `budget-near-${l.categoryId}`,
        kind: "budget_near",
        severity: "info",
        title: `${l.name} is close to its limit`,
        body: `${fmt(l.remainingMinor)} left of ${fmt(l.plannedMinor)} for the rest of the month.`,
        isEstimate: false,
        href: "/budget",
      });
    }
  }

  for (const { tx, typicalMinor } of findUnusualTransactions(transactions, asOf).slice(0, 2)) {
    insights.push({
      id: `unusual-${tx.id}`,
      kind: "unusual_transaction",
      severity: "attention",
      title: `Unusual ${tx.category?.name.toLowerCase()} charge`,
      body: `${tx.displayMerchant}: ${fmt(-tx.amountMinor)} on ${formatDate(tx.date)}. Your typical ${tx.category?.name.toLowerCase()} purchase is about ${fmt(typicalMinor)}.`,
      isEstimate: false,
      href: `/transactions/${tx.id}`,
    });
  }

  for (const [a, b] of findPossibleDuplicateCharges(transactions, asOf).slice(0, 1)) {
    insights.push({
      id: `duplicate-${a.id}`,
      kind: "possible_duplicate_charge",
      severity: "attention",
      title: "Possible double charge",
      body: `${a.displayMerchant} charged ${fmt(-a.amountMinor)} twice (${formatDate(a.date)} and ${formatDate(b.date)}). Check whether both are expected.`,
      isEstimate: false,
      href: `/transactions/${b.id}`,
    });
  }

  const spike = findCategorySpikes(transactions, asOf)[0];
  if (spike) {
    insights.push({
      id: `spike-${spike.categoryId}`,
      kind: "category_spike",
      severity: "info",
      title: `${spike.name} spending is up`,
      body: `${fmt(spike.spentMinor)} so far this month vs a ${fmt(spike.averageMinor)} average by this day over the last three months.`,
      isEstimate: false,
      href: `/transactions?category=${spike.categoryId}`,
    });
  }

  const bills = upcomingBills(data.bills, asOf, addDays(asOf, 7));
  if (bills.length) {
    const total = bills.reduce((s, b) => addMinor(s, b.amountMinor), 0);
    insights.push({
      id: "bills-7",
      kind: "upcoming_bills",
      severity: "info",
      title: `${bills.length} bill${bills.length === 1 ? "" : "s"} due this week`,
      body: `${fmt(total)} in total. Next: ${bills[0].name} on ${formatDate(bills[0].dueDate)}.`,
      isEstimate: bills.some((b) => b.amountIsEstimate),
      href: "/budget/bills",
    });
  }

  // Savings opportunity: what was left over last month.
  const lastMonth = addMonths(startOfMonth(asOf), -1);
  const last = summarizePeriod(transactions, lastMonth, endOfMonth(lastMonth));
  const leftover = last.incomeMinor - last.spendingMinor;
  if (last.incomeMinor > 0 && leftover >= 10_000) {
    const goal = data.savingsGoals.find((g) => g.savedMinor < g.targetMinor);
    insights.push({
      id: "savings-opportunity",
      kind: "savings_opportunity",
      severity: "positive",
      title: `${fmt(leftover)} left over in ${formatDate(lastMonth, { month: "long" })}`,
      body: goal
        ? `Income exceeded spending (transfers excluded). Consider moving part of it toward ${goal.name}.`
        : "Income exceeded spending (transfers excluded). Consider setting a savings goal for it.",
      isEstimate: false,
      href: "/budget/goals",
    });
  }

  return insights
    .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])
    .slice(0, input.limit ?? 6);
}

/** True when a transaction is spending (used by tools that list spending). */
export const isSpending = (tx: EnrichedTransaction) => countsTowardSpending(tx.flow);
