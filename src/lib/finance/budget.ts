import { addMinor, ratioBps } from "./money";
import { endOfMonth, isWithin } from "./dates";
import { countsTowardSpending, type EnrichedTransaction } from "./classification";
import type { AllocationKind, Budget, Category } from "./types";

/**
 * Planned vs actual (ARCHITECTURE.md §6.6).
 *
 * - fixed / variable allocations: actual = net spending in the category for the month.
 * - savings / debt allocations: actual = money moved out of cash accounts in that
 *   category (e.g. "Savings" transfers, "Credit card payment").
 * Over-budget amounts are reported as negative remaining, never clamped.
 */

export type BudgetStatus = "on_track" | "near_limit" | "at_plan" | "over" | "not_started";

export interface BudgetLine {
  categoryId: string;
  name: string;
  kind: AllocationKind;
  isEssential: boolean;
  plannedMinor: number;
  actualMinor: number;
  pendingMinor: number;
  remainingMinor: number;
  /** actual / planned in basis points (10000 = 100%). */
  usedBps: number;
  status: BudgetStatus;
}

export interface BudgetPerformance {
  month: string;
  currency: string;
  lines: BudgetLine[];
  /** Totals for spending allocations (fixed + variable). */
  spending: { plannedMinor: number; actualMinor: number; remainingMinor: number };
  /** Spending in categories that have no allocation this month. */
  unbudgeted: Array<{ categoryId: string | null; name: string; actualMinor: number }>;
}

export const NEAR_LIMIT_BPS = 9_000;

function statusFor(planned: number, actual: number): BudgetStatus {
  if (actual === 0) return "not_started";
  if (actual > planned) return "over";
  if (actual === planned) return "at_plan";
  if (ratioBps(actual, planned) >= NEAR_LIMIT_BPS) return "near_limit";
  return "on_track";
}

export function computeBudgetPerformance(
  budget: Budget,
  transactions: readonly EnrichedTransaction[],
  categories: readonly Category[],
): BudgetPerformance {
  const start = budget.month;
  const end = endOfMonth(budget.month);
  const categoryById = new Map(categories.map((c) => [c.id, c]));

  const spent = new Map<string | null, { posted: number; pending: number }>();
  const moved = new Map<string, number>();
  for (const tx of transactions) {
    if (!isWithin(tx.date, start, end) || tx.currency !== budget.currency) continue;
    const key = tx.category?.id ?? null;
    if (countsTowardSpending(tx.flow)) {
      const entry = spent.get(key) ?? { posted: 0, pending: 0 };
      if (tx.status === "pending") entry.pending = addMinor(entry.pending, -tx.amountMinor);
      else entry.posted = addMinor(entry.posted, -tx.amountMinor);
      spent.set(key, entry);
    } else if (
      key &&
      tx.amountMinor < 0 &&
      (tx.flow === "transfer" || tx.flow === "credit_card_payment" || tx.flow === "unmatched_transfer")
    ) {
      moved.set(key, addMinor(moved.get(key) ?? 0, -tx.amountMinor));
    }
  }

  const lines: BudgetLine[] = budget.allocations.map((allocation) => {
    const category = categoryById.get(allocation.categoryId);
    const isMovement = allocation.kind === "savings" || allocation.kind === "debt";
    const s = spent.get(allocation.categoryId) ?? { posted: 0, pending: 0 };
    const actual = isMovement ? (moved.get(allocation.categoryId) ?? 0) : addMinor(s.posted, s.pending);
    return {
      categoryId: allocation.categoryId,
      name: category?.name ?? "Unknown category",
      kind: allocation.kind,
      isEssential: category?.isEssential ?? false,
      plannedMinor: allocation.plannedMinor,
      actualMinor: actual,
      pendingMinor: isMovement ? 0 : s.pending,
      remainingMinor: allocation.plannedMinor - actual,
      usedBps: ratioBps(actual, allocation.plannedMinor),
      status: statusFor(allocation.plannedMinor, actual),
    };
  });

  const spendingLines = lines.filter((l) => l.kind === "fixed" || l.kind === "variable");
  const planned = spendingLines.reduce((sum, l) => addMinor(sum, l.plannedMinor), 0);
  const actual = spendingLines.reduce((sum, l) => addMinor(sum, l.actualMinor), 0);

  const allocated = new Set(budget.allocations.map((a) => a.categoryId));
  const unbudgeted = [...spent.entries()]
    .filter(([id]) => id === null || !allocated.has(id))
    .map(([id, v]) => ({
      categoryId: id,
      name: id ? (categoryById.get(id)?.name ?? "Unknown category") : "Uncategorized",
      actualMinor: addMinor(v.posted, v.pending),
    }))
    .filter((u) => u.actualMinor !== 0)
    .sort((a, b) => b.actualMinor - a.actualMinor);

  return {
    month: budget.month,
    currency: budget.currency,
    lines,
    spending: { plannedMinor: planned, actualMinor: actual, remainingMinor: planned - actual },
    unbudgeted,
  };
}
