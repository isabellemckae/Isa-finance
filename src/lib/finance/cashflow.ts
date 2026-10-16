import { addMinor } from "./money";
import { addMonths, endOfMonth, startOfMonth } from "./dates";
import { summarizePeriod, type EnrichedTransaction } from "./classification";
import type { ISODate } from "./types";

/** Monthly income vs spending series for charts and comparisons. */

export interface CashFlowPoint {
  month: ISODate;
  incomeMinor: number;
  spendingMinor: number;
  netMinor: number;
  /** True for the month containing `asOf` (incomplete). */
  isPartial: boolean;
}

export function monthlyCashFlow(
  transactions: readonly EnrichedTransaction[],
  asOf: ISODate,
  months: number,
): CashFlowPoint[] {
  const current = startOfMonth(asOf);
  const points: CashFlowPoint[] = [];
  for (let i = months - 1; i >= 0; i -= 1) {
    const month = addMonths(current, -i);
    const summary = summarizePeriod(transactions, month, endOfMonth(month));
    points.push({
      month,
      incomeMinor: summary.incomeMinor,
      spendingMinor: summary.spendingMinor,
      netMinor: addMinor(summary.incomeMinor, -summary.spendingMinor),
      isPartial: month === current,
    });
  }
  return points;
}

export interface CategoryChange {
  categoryId: string | null;
  name: string;
  currentMinor: number;
  previousMinor: number;
  changeMinor: number;
}

/**
 * Category spending in the current month to date vs the same days of the previous
 * month, so a partial month is not compared with a full one.
 */
export function categoryChangesMonthToDate(
  transactions: readonly EnrichedTransaction[],
  asOf: ISODate,
): CategoryChange[] {
  const currentStart = startOfMonth(asOf);
  const previousStart = addMonths(currentStart, -1);
  const day = Number(asOf.slice(8, 10));
  const previousEnd = addMonths(previousStart, 0, day);
  const current = summarizePeriod(transactions, currentStart, asOf).byCategory;
  const previous = summarizePeriod(transactions, previousStart, previousEnd).byCategory;

  const keys = new Map<string | null, string>();
  for (const c of [...current, ...previous]) keys.set(c.categoryId, c.name);
  return [...keys.entries()]
    .map(([categoryId, name]) => {
      const cur = current.find((c) => c.categoryId === categoryId)?.spentMinor ?? 0;
      const prev = previous.find((c) => c.categoryId === categoryId)?.spentMinor ?? 0;
      return { categoryId, name, currentMinor: cur, previousMinor: prev, changeMinor: cur - prev };
    })
    .sort((a, b) => b.changeMinor - a.changeMinor || a.name.localeCompare(b.name));
}
