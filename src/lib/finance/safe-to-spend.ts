import { addMinor, formatMoney } from "./money";
import { addMonths, compareDates, daysInMonth, formatDate, isWithin } from "./dates";
import { accountBalanceViews, isConnectionHealthy } from "./balances";
import { expectedIncome, upcomingBills } from "./schedule";
import type { BudgetPerformance } from "./budget";
import type { EnrichedTransaction } from "./classification";
import type {
  Account,
  BalanceSnapshot,
  CurrencyCode,
  DebtGoal,
  IncomeSource,
  ISODate,
  RecurringBill,
} from "./types";

/**
 * Safe-to-spend (ARCHITECTURE.md §6.7). A conservative estimate of discretionary money
 * available until `horizonEnd`. Every component, assumption and data gap is returned
 * so the UI and the Personal CFO can disclose them.
 */

/** Depository subtypes held for saving, not everyday spending. */
export const NON_SPENDABLE_SUBTYPES = new Set(["savings", "money market", "cd", "hsa"]);

export interface SafeToSpendInput {
  /** First day of the horizon (usually today). */
  asOf: ISODate;
  /** Last day of the horizon, inclusive (e.g. next payday − 1 or end of month). */
  horizonEnd: ISODate;
  now: Date;
  currency: CurrencyCode;
  accounts: readonly Account[];
  balances: readonly BalanceSnapshot[];
  transactions: readonly EnrichedTransaction[];
  bills: readonly RecurringBill[];
  incomeSources: readonly IncomeSource[];
  debtGoals: readonly DebtGoal[];
  /** Budget for the month containing `asOf`, if one exists. */
  budget: BudgetPerformance | null;
  safetyBufferMinor: number;
  includeExpectedIncome: boolean;
}

export interface SafeToSpendComponent {
  key:
    | "spendable_cash"
    | "pending_outflows"
    | "bills"
    | "essential_budget"
    | "savings"
    | "debt_payments"
    | "safety_buffer"
    | "expected_income";
  label: string;
  /** Signed contribution to the result (negative = reserved). */
  amountMinor: number;
  detail: string;
}

export interface SafeToSpendResult {
  currency: CurrencyCode;
  horizon: { start: ISODate; end: ISODate };
  /** May be negative: a shortfall. */
  amountMinor: number;
  isShortfall: boolean;
  components: SafeToSpendComponent[];
  assumptions: string[];
  warnings: string[];
  /** Overall data quality: "estimated" whenever a warning applies. */
  confidence: "calculated" | "estimated";
}

export function computeSafeToSpend(input: SafeToSpendInput): SafeToSpendResult {
  const { asOf, horizonEnd, currency } = input;
  const fmt = (m: number) => formatMoney(m, currency);
  const assumptions: string[] = [];
  const warnings: string[] = [];
  const components: SafeToSpendComponent[] = [];

  // 1. Spendable cash from depository accounts in a healthy state.
  let spendable = 0;
  let usedCurrentFallback = false;
  const fallbackAccountIds = new Set<string>();
  const savingsExcluded: string[] = [];
  for (const view of accountBalanceViews(input.accounts, input.balances, input.now)) {
    const { account, snapshot, freshness } = view;
    if (account.type !== "depository" || account.currency !== currency) continue;
    const label = account.nickname ?? account.name;
    if (account.subtype && NON_SPENDABLE_SUBTYPES.has(account.subtype.toLowerCase())) {
      savingsExcluded.push(label);
      continue;
    }
    if (!isConnectionHealthy(account)) {
      warnings.push(`${label} needs to be reconnected; its balance was not used.`);
      continue;
    }
    if (freshness === "unavailable" || !snapshot) {
      warnings.push(`No balance is available for ${label}.`);
      continue;
    }
    if (freshness === "stale") {
      warnings.push(`${label} balance is out of date (as of ${new Date(snapshot.asOf).toUTCString()}).`);
    }
    if (snapshot.availableMinor !== null) {
      spendable = addMinor(spendable, snapshot.availableMinor);
    } else {
      spendable = addMinor(spendable, snapshot.currentMinor ?? 0);
      usedCurrentFallback = true;
      fallbackAccountIds.add(account.id);
    }
  }
  components.push({
    key: "spendable_cash",
    label: "Spendable cash",
    amountMinor: spendable,
    detail: usedCurrentFallback
      ? "Available balances, using the current balance where the bank does not report one."
      : "Available balances reported by your banks.",
  });
  if (usedCurrentFallback) {
    assumptions.push("Some banks do not report an available balance; the current (ledger) balance was used.");
  }
  if (savingsExcluded.length > 0) {
    assumptions.push(`Savings accounts are set aside and not counted as spendable (${savingsExcluded.join(", ")}).`);
  }
  assumptions.push("Credit card available credit is never counted as spendable cash.");

  // 2. Pending outflows not yet reflected (only relevant where current balance was used).
  if (fallbackAccountIds.size > 0) {
    const pendingOut = input.transactions
      .filter((t) => t.status === "pending" && t.amountMinor < 0 && fallbackAccountIds.has(t.accountId))
      .reduce((s, t) => addMinor(s, t.amountMinor), 0);
    if (pendingOut !== 0) {
      components.push({
        key: "pending_outflows",
        label: "Pending purchases",
        amountMinor: pendingOut,
        detail: "Pending outflows on accounts where only the current balance is known.",
      });
    }
  }

  // 3. Bills due within the horizon.
  const bills = upcomingBills(
    input.bills.filter((b) => b.currency === currency),
    asOf,
    horizonEnd,
  );
  const billTotal = bills.reduce((s, b) => addMinor(s, b.amountMinor), 0);
  components.push({
    key: "bills",
    label: "Upcoming bills",
    amountMinor: -billTotal,
    detail: bills.length
      ? `${bills.length} bill${bills.length === 1 ? "" : "s"} due by ${formatDate(horizonEnd)}.`
      : `No bills due by ${formatDate(horizonEnd)}.`,
  });
  if (bills.some((b) => b.amountIsEstimate)) {
    assumptions.push("Some bill amounts are estimates.");
  }
  assumptions.push("Bills are assumed unpaid until their due date.");

  // 4. Remaining essential budget (minus amounts already reserved as bills).
  if (input.budget) {
    const billsByCategory = new Map<string, number>();
    for (const b of bills) {
      if (b.categoryId) billsByCategory.set(b.categoryId, addMinor(billsByCategory.get(b.categoryId) ?? 0, b.amountMinor));
    }
    const essential = input.budget.lines
      .filter((l) => (l.kind === "fixed" || l.kind === "variable") && l.isEssential)
      .reduce((s, l) => {
        const reserve = Math.max(l.remainingMinor - (billsByCategory.get(l.categoryId) ?? 0), 0);
        return addMinor(s, reserve);
      }, 0);
    components.push({
      key: "essential_budget",
      label: "Essentials still to spend",
      amountMinor: -essential,
      detail: "Remaining budget for essential categories this month, excluding bills already counted.",
    });

    const savings = input.budget.lines
      .filter((l) => l.kind === "savings")
      .reduce((s, l) => addMinor(s, Math.max(l.remainingMinor, 0)), 0);
    components.push({
      key: "savings",
      label: "Planned savings",
      amountMinor: -savings,
      detail: "Savings contributions planned this month that have not happened yet.",
    });
  } else {
    warnings.push("No budget exists for this month, so essentials and savings were not reserved.");
  }

  // 5. Debt payments due in the horizon.
  let debtTotal = 0;
  for (const goal of input.debtGoals) {
    if (goal.paymentDueDay === null) continue;
    if (dueDatesInHorizon(goal.paymentDueDay, asOf, horizonEnd).length === 0) continue;
    debtTotal = addMinor(debtTotal, Math.max(goal.plannedPaymentMinor, goal.minimumPaymentMinor));
  }
  components.push({
    key: "debt_payments",
    label: "Debt payments",
    amountMinor: -debtTotal,
    detail: "Planned (or at least minimum) payments due before the horizon ends.",
  });

  // 6. Safety buffer.
  components.push({
    key: "safety_buffer",
    label: "Safety buffer",
    amountMinor: -input.safetyBufferMinor,
    detail: `A cushion of ${fmt(input.safetyBufferMinor)} you chose to keep untouched.`,
  });

  // 7. Expected income (opt-in only).
  const income = expectedIncome(
    input.incomeSources.filter((s) => s.currency === currency),
    asOf,
    horizonEnd,
  );
  if (input.includeExpectedIncome) {
    const known = income.filter((i) => i.amountMinor !== null);
    const total = known.reduce((s, i) => addMinor(s, i.amountMinor as number), 0);
    components.push({
      key: "expected_income",
      label: "Expected income",
      amountMinor: total,
      detail: `${known.length} expected deposit${known.length === 1 ? "" : "s"} before the horizon ends.`,
    });
    assumptions.push("Expected income is included because you opted in; it is not guaranteed.");
    if (known.length < income.length) warnings.push("Some expected income has no known amount and was excluded.");
  } else {
    assumptions.push("Expected income is not counted until it arrives.");
  }

  const amount = components.reduce((s, c) => addMinor(s, c.amountMinor), 0);
  return {
    currency,
    horizon: { start: asOf, end: horizonEnd },
    amountMinor: amount,
    isShortfall: amount < 0,
    components,
    assumptions,
    warnings,
    confidence: warnings.length > 0 || usedCurrentFallback ? "estimated" : "calculated",
  };
}

function dueDatesInHorizon(dueDay: number, start: ISODate, end: ISODate): ISODate[] {
  const dates: ISODate[] = [];
  let month = `${start.slice(0, 7)}-01`;
  while (compareDates(month, end) <= 0) {
    const [y, m] = month.split("-").map(Number);
    const day = Math.min(dueDay, daysInMonth(y, m));
    const date = `${month.slice(0, 8)}${String(day).padStart(2, "0")}`;
    if (isWithin(date, start, end)) dates.push(date);
    month = addMonths(month, 1);
  }
  return dates;
}
