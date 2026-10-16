import { addMinor } from "./money";
import { addDays, addMonths, endOfMonth, startOfMonth } from "./dates";
import { countsTowardSpending, summarizePeriod, type EnrichedTransaction } from "./classification";
import { computeBudgetPerformance } from "./budget";
import { summarizeBalances } from "./balances";
import { upcomingBills, type BillOccurrence } from "./schedule";
import { savingsProgress, type SavingsProgress } from "./goals";
import { buildProactiveInsights, type ProactiveInsight } from "./insights";
import type { FinancialData, ISODate } from "./types";

/**
 * Weekly and monthly briefings: deterministic summaries of a period compared with the
 * same span of the previous period. Partial periods are compared day for day.
 */

export type BriefingPeriod = "week" | "month";

export interface Briefing {
  period: BriefingPeriod;
  isDemo: boolean;
  currency: string;
  range: { start: ISODate; end: ISODate };
  previousRange: { start: ISODate; end: ISODate };
  isPartial: boolean;
  income: { currentMinor: number; previousMinor: number };
  spending: { currentMinor: number; previousMinor: number; postedMinor: number; pendingMinor: number };
  netMinor: number;
  topCategories: Array<{ categoryId: string | null; name: string; currentMinor: number; previousMinor: number }>;
  largestPurchases: Array<{ id: string; date: ISODate; merchant: string; amountMinor: number; category: string; pending: boolean }>;
  budget: { plannedMinor: number; actualMinor: number; remainingMinor: number; overCategories: string[] } | null;
  upcomingBills: BillOccurrence[];
  balances: { cashMinor: number; cardDebtMinor: number; netWorthMinor: number; oldestBalanceAt: string | null };
  savings: SavingsProgress[];
  insights: ProactiveInsight[];
  transactionCount: number;
  dataNotes: string[];
}

/** Monday of the week containing `date`. */
export function startOfWeek(date: ISODate): ISODate {
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay(); // 0 = Sunday
  return addDays(date, -((weekday + 6) % 7));
}

export function buildBriefing(input: {
  data: FinancialData;
  transactions: readonly EnrichedTransaction[];
  now: Date;
  asOf: ISODate;
  period: BriefingPeriod;
}): Briefing {
  const { data, transactions, now, asOf, period } = input;
  const currency = data.profile.baseCurrency;

  let start: ISODate;
  let prevStart: ISODate;
  let prevEnd: ISODate;
  if (period === "week") {
    start = startOfWeek(asOf);
    prevStart = addDays(start, -7);
    prevEnd = addDays(asOf, -7);
  } else {
    start = startOfMonth(asOf);
    prevStart = addMonths(start, -1);
    prevEnd = addMonths(prevStart, 0, Number(asOf.slice(8, 10)));
  }
  const end = asOf;
  const fullEnd = period === "week" ? addDays(start, 6) : endOfMonth(start);

  const cur = summarizePeriod(transactions, start, end);
  const prev = summarizePeriod(transactions, prevStart, prevEnd);
  const topCategories = cur.byCategory.slice(0, 5).map((c) => ({
    categoryId: c.categoryId,
    name: c.name,
    currentMinor: c.spentMinor,
    previousMinor: prev.byCategory.find((p) => p.categoryId === c.categoryId)?.spentMinor ?? 0,
  }));

  const largestPurchases = transactions
    .filter((t) => t.date >= start && t.date <= end && countsTowardSpending(t.flow) && t.amountMinor < 0)
    .sort((a, b) => a.amountMinor - b.amountMinor || a.id.localeCompare(b.id))
    .slice(0, 5)
    .map((t) => ({
      id: t.id,
      date: t.date,
      merchant: t.displayMerchant,
      amountMinor: -t.amountMinor,
      category: t.category?.name ?? "Uncategorized",
      pending: t.status === "pending",
    }));

  const budgetRecord = data.budgets.find((b) => b.month === startOfMonth(asOf) && b.currency === currency);
  const perf = budgetRecord ? computeBudgetPerformance(budgetRecord, transactions, data.categories) : null;
  const balances = summarizeBalances(data.accounts, data.balances, { now, currency });

  const dataNotes: string[] = [];
  if (cur.pendingCount) dataNotes.push(`${cur.pendingCount} pending transaction${cur.pendingCount === 1 ? "" : "s"} included; amounts may change.`);
  if (balances.staleAccountIds.length) dataNotes.push("Some balances are out of date.");
  if (balances.unhealthyAccountIds.length) dataNotes.push("Some accounts need reconnecting; their newest activity may be missing.");
  if (cur.unclassifiedInflowMinor) dataNotes.push("Some money in is uncategorized and not counted as income.");
  if (data.isDemo) dataNotes.push("Fictional demo data.");

  return {
    period,
    isDemo: data.isDemo,
    currency,
    range: { start, end },
    previousRange: { start: prevStart, end: prevEnd },
    isPartial: end < fullEnd,
    income: { currentMinor: cur.incomeMinor, previousMinor: prev.incomeMinor },
    spending: {
      currentMinor: cur.spendingMinor,
      previousMinor: prev.spendingMinor,
      postedMinor: cur.spendingPostedMinor,
      pendingMinor: cur.spendingPendingMinor,
    },
    netMinor: addMinor(cur.incomeMinor, -cur.spendingMinor),
    topCategories,
    largestPurchases,
    budget: perf
      ? {
          plannedMinor: perf.spending.plannedMinor,
          actualMinor: perf.spending.actualMinor,
          remainingMinor: perf.spending.remainingMinor,
          overCategories: perf.lines.filter((l) => l.status === "over").map((l) => l.name),
        }
      : null,
    upcomingBills: upcomingBills(data.bills, addDays(asOf, 1), addDays(asOf, period === "week" ? 7 : 30)),
    balances: {
      cashMinor: balances.totalCashMinor,
      cardDebtMinor: balances.creditCardDebtMinor,
      netWorthMinor: balances.netWorthMinor,
      oldestBalanceAt: balances.oldestBalanceAt,
    },
    savings: data.savingsGoals.map((g) => savingsProgress(g, asOf)),
    insights: buildProactiveInsights({ data, transactions, now, asOf }),
    transactionCount: cur.transactionCount,
    dataNotes,
  };
}
