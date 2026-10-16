import { addMinor, divRoundHalfUp } from "./money";
import { addDays, addMonths, compareDates, daysInMonth, endOfMonth, isWithin, startOfMonth } from "./dates";
import { summarizePeriod, type EnrichedTransaction } from "./classification";
import { expectedIncome, upcomingBills, type BillOccurrence } from "./schedule";
import type { BudgetPerformance } from "./budget";
import type { DebtGoal, IncomeSource, ISODate, RecurringBill, SavingsGoal } from "./types";

/**
 * Budget planning services: month-over-month comparison, planned income, and
 * paycheck allocation. Pure and deterministic.
 */

// ---------------------------------------------------------------------------
// Month-over-month comparison
// ---------------------------------------------------------------------------

export interface MonthComparisonRow {
  categoryId: string | null;
  name: string;
  currentMinor: number;
  previousMinor: number;
  changeMinor: number;
}

export interface MonthComparison {
  month: ISODate;
  previousMonth: ISODate;
  /** True when the current month is in progress and compared day-for-day. */
  toDate: boolean;
  throughDay: number;
  current: { incomeMinor: number; spendingMinor: number };
  previous: { incomeMinor: number; spendingMinor: number };
  rows: MonthComparisonRow[];
}

/**
 * Compares a month's spending with the previous month. For the current month, it
 * compares the same number of days so a partial month isn't judged against a full one.
 */
export function compareMonths(
  transactions: readonly EnrichedTransaction[],
  month: ISODate,
  asOf: ISODate,
): MonthComparison {
  const start = startOfMonth(month);
  const prevStart = addMonths(start, -1);
  const inProgress = compareDates(asOf, start) >= 0 && compareDates(asOf, endOfMonth(start)) <= 0;
  const end = inProgress ? asOf : endOfMonth(start);
  const day = Number(end.slice(8, 10));
  const prevEnd = inProgress ? addMonths(prevStart, 0, day) : endOfMonth(prevStart);

  const cur = summarizePeriod(transactions, start, end);
  const prev = summarizePeriod(transactions, prevStart, prevEnd);
  const names = new Map<string | null, string>();
  for (const c of [...cur.byCategory, ...prev.byCategory]) names.set(c.categoryId, c.name);

  const rows = [...names.entries()]
    .map(([categoryId, name]) => {
      const currentMinor = cur.byCategory.find((c) => c.categoryId === categoryId)?.spentMinor ?? 0;
      const previousMinor = prev.byCategory.find((c) => c.categoryId === categoryId)?.spentMinor ?? 0;
      return { categoryId, name, currentMinor, previousMinor, changeMinor: currentMinor - previousMinor };
    })
    .sort((a, b) => Math.abs(b.changeMinor) - Math.abs(a.changeMinor) || a.name.localeCompare(b.name));

  return {
    month: start,
    previousMonth: prevStart,
    toDate: inProgress,
    throughDay: day,
    current: { incomeMinor: cur.incomeMinor, spendingMinor: cur.spendingMinor },
    previous: { incomeMinor: prev.incomeMinor, spendingMinor: prev.spendingMinor },
    rows,
  };
}

// ---------------------------------------------------------------------------
// Planned income
// ---------------------------------------------------------------------------

export interface IncomePlan {
  month: ISODate;
  /** Σ expected deposits with a known amount. */
  expectedMinor: number;
  deposits: Array<{ sourceId: string; name: string; date: ISODate; amountMinor: number | null }>;
  /** Sources with unknown amounts or irregular timing: not included in the total. */
  unplannedSources: string[];
  /** Income actually received so far this month (from transactions). */
  receivedMinor: number;
}

export function planIncomeForMonth(
  sources: readonly IncomeSource[],
  transactions: readonly EnrichedTransaction[],
  month: ISODate,
): IncomePlan {
  const start = startOfMonth(month);
  const end = endOfMonth(start);
  // Expand from far enough back that schedules anchored in the past still land in this month.
  const deposits = expectedIncome(
    sources.map((s) => ({ ...s, nextExpectedDate: s.nextExpectedDate ? rewindToMonth(s, start) : null })),
    start,
    end,
  );
  const unplanned = sources
    .filter((s) => s.cadence === "irregular" || s.expectedAmountMinor === null || !s.nextExpectedDate)
    .map((s) => s.name);
  return {
    month: start,
    expectedMinor: deposits.reduce((sum, d) => (d.amountMinor === null ? sum : addMinor(sum, d.amountMinor)), 0),
    deposits,
    unplannedSources: [...new Set(unplanned)],
    receivedMinor: summarizePeriod(transactions, start, end).incomeMinor,
  };
}

/** Moves a schedule's anchor date back so its occurrences cover `monthStart`. */
function rewindToMonth(source: IncomeSource, monthStart: ISODate): ISODate {
  let date = source.nextExpectedDate as ISODate;
  const step = (d: ISODate, n: number): ISODate => {
    switch (source.cadence) {
      case "weekly":
        return addDays(d, -7 * n);
      case "biweekly":
        return addDays(d, -14 * n);
      default:
        return addMonths(d, -n, Number((source.nextExpectedDate as string).slice(8, 10)));
    }
  };
  let guard = 0;
  while (compareDates(date, monthStart) > 0 && guard < 120) {
    date = step(date, 1);
    guard += 1;
  }
  return date;
}

// ---------------------------------------------------------------------------
// Paycheck allocation
// ---------------------------------------------------------------------------

export type AllocationBucketKey = "bills" | "essentials" | "debt" | "savings" | "flexible";

export interface AllocationBucket {
  key: AllocationBucketKey;
  label: string;
  amountMinor: number;
  items: Array<{ label: string; amountMinor: number; detail?: string }>;
}

export interface PaycheckAllocation {
  paycheckDate: ISODate;
  paycheckMinor: number;
  /** Bills, debt payments, etc. are counted until the day before this date. */
  coversUntil: ISODate;
  /** Number of paychecks in the month, used to split monthly amounts evenly. */
  paychecksThisMonth: number;
  buckets: AllocationBucket[];
  /** paycheck − Σ buckets. Negative means the plan needs more than this paycheck. */
  unallocatedMinor: number;
  assumptions: string[];
}

/**
 * Splits one paycheck across: bills due before the next paycheck, a share of the
 * essential and flexible monthly budget, savings contributions, and debt payments
 * due in the window. Monthly amounts are divided evenly across the month's paychecks.
 */
export function planPaycheckAllocation(input: {
  paycheckDate: ISODate;
  paycheckMinor: number;
  nextPaycheckDate: ISODate;
  paychecksThisMonth: number;
  bills: readonly RecurringBill[];
  budget: BudgetPerformance | null;
  savingsGoals: readonly SavingsGoal[];
  debtGoals: readonly DebtGoal[];
}): PaycheckAllocation {
  const n = BigInt(Math.max(input.paychecksThisMonth, 1));
  const share = (monthly: number) => Number(divRoundHalfUp(BigInt(monthly), n));
  const windowEnd = addDays(input.nextPaycheckDate, -1);
  const assumptions: string[] = [];

  const bills: BillOccurrence[] = upcomingBills(input.bills, input.paycheckDate, windowEnd);
  const billCategories = new Set(bills.map((b) => b.categoryId).filter(Boolean));
  const billBucket: AllocationBucket = {
    key: "bills",
    label: "Bills due before next paycheck",
    amountMinor: bills.reduce((s, b) => addMinor(s, b.amountMinor), 0),
    items: bills.map((b) => ({ label: b.name, amountMinor: b.amountMinor, detail: b.dueDate })),
  };

  const spendingLines = (input.budget?.lines ?? []).filter((l) => l.kind === "fixed" || l.kind === "variable");
  const essentials = spendingLines.filter((l) => l.isEssential && l.kind === "variable" && !billCategories.has(l.categoryId));
  const flexible = spendingLines.filter((l) => !l.isEssential && l.kind === "variable");
  const essentialBucket: AllocationBucket = {
    key: "essentials",
    label: "Everyday essentials",
    amountMinor: 0,
    items: essentials.map((l) => ({ label: l.name, amountMinor: share(l.plannedMinor) })),
  };
  const flexibleBucket: AllocationBucket = {
    key: "flexible",
    label: "Flexible spending",
    amountMinor: 0,
    items: flexible.map((l) => ({ label: l.name, amountMinor: share(l.plannedMinor) })),
  };
  if (!input.budget) assumptions.push("No budget exists for this month, so everyday spending is not reserved.");

  const savingsBucket: AllocationBucket = {
    key: "savings",
    label: "Savings goals",
    amountMinor: 0,
    items: input.savingsGoals
      .filter((g) => g.monthlyContributionMinor > 0 && g.savedMinor < g.targetMinor)
      .map((g) => ({ label: g.name, amountMinor: share(g.monthlyContributionMinor) })),
  };

  const debtBucket: AllocationBucket = { key: "debt", label: "Debt payments", amountMinor: 0, items: [] };
  for (const goal of input.debtGoals) {
    if (goal.paymentDueDay === null) continue;
    const due = dueDateInWindow(goal.paymentDueDay, input.paycheckDate, windowEnd);
    if (!due) continue;
    const amount = Math.max(goal.plannedPaymentMinor, goal.minimumPaymentMinor);
    debtBucket.items.push({ label: goal.name, amountMinor: amount, detail: due });
  }

  for (const b of [essentialBucket, flexibleBucket, savingsBucket, debtBucket]) {
    b.amountMinor = b.items.reduce((s, i) => addMinor(s, i.amountMinor), 0);
  }
  const buckets = [billBucket, debtBucket, essentialBucket, savingsBucket, flexibleBucket];
  const allocated = buckets.reduce((s, b) => addMinor(s, b.amountMinor), 0);

  assumptions.push(
    `Monthly budget and savings amounts are split evenly across ${input.paychecksThisMonth} paycheck${input.paychecksThisMonth === 1 ? "" : "s"} this month.`,
    "Bills and debt payments are assigned to the paycheck that arrives before they are due.",
  );

  return {
    paycheckDate: input.paycheckDate,
    paycheckMinor: input.paycheckMinor,
    coversUntil: windowEnd,
    paychecksThisMonth: input.paychecksThisMonth,
    buckets,
    unallocatedMinor: input.paycheckMinor - allocated,
    assumptions,
  };
}

function dueDateInWindow(dueDay: number, start: ISODate, end: ISODate): ISODate | null {
  for (let month = startOfMonth(start); compareDates(month, end) <= 0; month = addMonths(month, 1)) {
    const [y, m] = month.split("-").map(Number);
    const date = `${month.slice(0, 8)}${String(Math.min(dueDay, daysInMonth(y, m))).padStart(2, "0")}`;
    if (isWithin(date, start, end)) return date;
  }
  return null;
}

/** Next salary-style paycheck on or after `asOf`, with the one after it. */
export function nextPaychecks(sources: readonly IncomeSource[], asOf: ISODate) {
  const salary = sources.find((s) => s.kind === "salary" && s.cadence !== "irregular" && s.nextExpectedDate);
  if (!salary) return null;
  const occ = expectedIncome([salary], asOf, addDays(asOf, 70));
  if (occ.length < 2) return null;
  const month = startOfMonth(occ[0].date);
  const inMonth = expectedIncome([{ ...salary, nextExpectedDate: rewindToMonth(salary, month) }], month, endOfMonth(month));
  return {
    source: salary,
    date: occ[0].date,
    amountMinor: occ[0].amountMinor,
    nextDate: occ[1].date,
    paychecksThisMonth: Math.max(inMonth.length, 1),
  };
}
