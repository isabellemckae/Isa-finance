import { addMinor, divRoundHalfUp } from "./money";
import { addDays, compareDates, daysInMonth, diffDays, isWithin, startOfMonth, addMonths } from "./dates";
import { countsTowardSpending, type EnrichedTransaction } from "./classification";
import { expectedIncome, upcomingBills } from "./schedule";
import { spendableCash } from "./safe-to-spend";
import type { FinancialData, ISODate } from "./types";

/**
 * Deterministic cash-flow PROJECTION (not actual data). Starts from today's spendable
 * cash, then applies scheduled income, bills, planned debt payments and an everyday
 * spending baseline, day by day. Every assumption is returned with the result.
 */

export const MAX_FORECAST_DAYS = 90;
export const BASELINE_WINDOW_DAYS = 90;

export interface ForecastEvent {
  date: ISODate;
  kind: "income" | "bill" | "debt_payment";
  label: string;
  /** Signed: income positive, outflows negative. */
  amountMinor: number;
}

export interface CashFlowForecast {
  isProjection: true;
  currency: string;
  start: ISODate;
  end: ISODate;
  startingCashMinor: number;
  baselineDailySpendMinor: number;
  events: ForecastEvent[];
  points: Array<{ date: ISODate; balanceMinor: number }>;
  lowest: { date: ISODate; balanceMinor: number };
  endingMinor: number;
  totals: { incomeMinor: number; billsMinor: number; debtPaymentsMinor: number; everydaySpendingMinor: number };
  assumptions: string[];
  warnings: string[];
}

/**
 * Average daily everyday spending over the last `windowDays` days, excluding
 * categories that are already scheduled as bills (to avoid counting them twice).
 */
export function everydaySpendingBaseline(
  transactions: readonly EnrichedTransaction[],
  billCategoryIds: ReadonlySet<string>,
  asOf: ISODate,
  windowDays = BASELINE_WINDOW_DAYS,
): { dailyMinor: number; historyDays: number } {
  const start = addDays(asOf, -windowDays);
  const end = addDays(asOf, -1);
  let total = 0;
  let earliest: ISODate | null = null;
  for (const tx of transactions) {
    if (!isWithin(tx.date, start, end) || !countsTowardSpending(tx.flow)) continue;
    if (tx.category && billCategoryIds.has(tx.category.id)) continue;
    total = addMinor(total, -tx.amountMinor);
    if (!earliest || tx.date < earliest) earliest = tx.date;
  }
  const historyDays = earliest ? Math.min(diffDays(earliest, asOf), windowDays) : 0;
  if (historyDays <= 0) return { dailyMinor: 0, historyDays: 0 };
  return { dailyMinor: Math.max(Number(divRoundHalfUp(BigInt(total), BigInt(historyDays))), 0), historyDays };
}

export function projectCashFlow(input: {
  data: FinancialData;
  transactions: readonly EnrichedTransaction[];
  now: Date;
  asOf: ISODate;
  days: number;
  includeExpectedIncome?: boolean;
}): CashFlowForecast {
  const { data, asOf } = input;
  const days = Math.min(Math.max(Math.trunc(input.days), 1), MAX_FORECAST_DAYS);
  const currency = data.profile.baseCurrency;
  const end = addDays(asOf, days);
  const assumptions: string[] = [];
  const warnings: string[] = [];

  const cash = spendableCash(data.accounts, data.balances, input.now, currency);
  warnings.push(...cash.warnings);
  if (cash.savingsExcluded.length) assumptions.push("Starts from checking and cash only; savings accounts are not included.");
  if (cash.usedCurrentFallback) assumptions.push("Some starting balances are ledger balances because no available balance was reported.");

  const events: ForecastEvent[] = [];
  const includeIncome = input.includeExpectedIncome ?? true;
  if (includeIncome) {
    for (const inc of expectedIncome(data.incomeSources.filter((s) => s.currency === currency), addDays(asOf, 1), end)) {
      if (inc.amountMinor === null) continue;
      events.push({ date: inc.date, kind: "income", label: inc.name, amountMinor: inc.amountMinor });
    }
    assumptions.push("Expected paychecks arrive on schedule at their usual amount; irregular income is not included.");
  } else {
    assumptions.push("Future income is not included.");
  }

  const bills = upcomingBills(data.bills.filter((b) => b.currency === currency), addDays(asOf, 1), end);
  for (const b of bills) events.push({ date: b.dueDate, kind: "bill", label: b.name, amountMinor: -b.amountMinor });
  if (bills.some((b) => b.amountIsEstimate)) assumptions.push("Some bill amounts are estimates.");

  for (const goal of data.debtGoals) {
    if (goal.paymentDueDay === null) continue;
    const payment = Math.max(goal.plannedPaymentMinor, goal.minimumPaymentMinor);
    if (payment <= 0) continue;
    for (let month = startOfMonth(addDays(asOf, 1)); compareDates(month, end) <= 0; month = addMonths(month, 1)) {
      const [y, m] = month.split("-").map(Number);
      const date = `${month.slice(0, 8)}${String(Math.min(goal.paymentDueDay, daysInMonth(y, m))).padStart(2, "0")}`;
      if (isWithin(date, addDays(asOf, 1), end)) {
        events.push({ date, kind: "debt_payment", label: goal.name, amountMinor: -payment });
      }
    }
  }
  events.sort((a, b) => a.date.localeCompare(b.date) || a.label.localeCompare(b.label));

  const billCategories = new Set(data.bills.map((b) => b.categoryId).filter((x): x is string => Boolean(x)));
  const baseline = everydaySpendingBaseline(input.transactions, billCategories, asOf);
  assumptions.push(
    `Everyday spending continues at the ${baseline.historyDays}-day average, excluding categories already scheduled as bills.`,
  );
  if (baseline.historyDays < 30) warnings.push("Less than 30 days of history: the everyday spending baseline is rough.");

  let balance = cash.amountMinor;
  let lowest = { date: asOf, balanceMinor: balance };
  const points = [{ date: asOf, balanceMinor: balance }];
  const totals = { incomeMinor: 0, billsMinor: 0, debtPaymentsMinor: 0, everydaySpendingMinor: 0 };
  for (let d = 1; d <= days; d += 1) {
    const date = addDays(asOf, d);
    for (const e of events.filter((x) => x.date === date)) {
      balance = addMinor(balance, e.amountMinor);
      if (e.kind === "income") totals.incomeMinor = addMinor(totals.incomeMinor, e.amountMinor);
      if (e.kind === "bill") totals.billsMinor = addMinor(totals.billsMinor, -e.amountMinor);
      if (e.kind === "debt_payment") totals.debtPaymentsMinor = addMinor(totals.debtPaymentsMinor, -e.amountMinor);
    }
    balance = addMinor(balance, -baseline.dailyMinor);
    totals.everydaySpendingMinor = addMinor(totals.everydaySpendingMinor, baseline.dailyMinor);
    points.push({ date, balanceMinor: balance });
    if (balance < lowest.balanceMinor) lowest = { date, balanceMinor: balance };
  }

  return {
    isProjection: true,
    currency,
    start: asOf,
    end,
    startingCashMinor: cash.amountMinor,
    baselineDailySpendMinor: baseline.dailyMinor,
    events,
    points,
    lowest,
    endingMinor: balance,
    totals,
    assumptions,
    warnings,
  };
}
