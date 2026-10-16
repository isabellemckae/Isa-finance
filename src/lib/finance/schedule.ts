import { addDays, addMonths, compareDates } from "./dates";
import { divRoundHalfUp } from "./money";
import type { BillCadence, IncomeCadence, IncomeSource, ISODate, RecurringBill } from "./types";

/** Expansion of recurring bills and income into dated occurrences. */

const MAX_OCCURRENCES = 400;

function nextDate(date: ISODate, cadence: BillCadence | IncomeCadence, anchorDay: number): ISODate | null {
  switch (cadence) {
    case "weekly":
      return addDays(date, 7);
    case "biweekly":
      return addDays(date, 14);
    case "semimonthly":
      // Expanded as two monthly schedules in occurrences().
      return addMonths(date, 1, anchorDay);
    case "monthly":
      return addMonths(date, 1, anchorDay);
    case "quarterly":
      return addMonths(date, 3, anchorDay);
    case "annual":
      return addMonths(date, 12, anchorDay);
    case "irregular":
      return null;
  }
}

/** All dates in [start, end] for a schedule starting at `first`. */
export function occurrences(
  first: ISODate,
  cadence: BillCadence | IncomeCadence,
  start: ISODate,
  end: ISODate,
): ISODate[] {
  const anchorDay = Number(first.slice(8, 10));
  if (cadence === "semimonthly") {
    // Twice a month, 15 days apart (e.g. 1st & 16th, or 15th & 30th/end of month).
    const second =
      anchorDay <= 15 ? addMonths(first, 0, anchorDay + 15) : addMonths(first, 1, anchorDay - 15);
    return [...occurrences(first, "monthly", start, end), ...occurrences(second, "monthly", start, end)].sort();
  }
  const dates: ISODate[] = [];
  let current: ISODate | null = first;
  let guard = 0;
  while (current && compareDates(current, end) <= 0 && guard < MAX_OCCURRENCES) {
    if (compareDates(current, start) >= 0) dates.push(current);
    current = nextDate(current, cadence, anchorDay);
    guard += 1;
  }
  return dates;
}

export interface BillOccurrence {
  billId: string;
  name: string;
  dueDate: ISODate;
  amountMinor: number;
  amountIsEstimate: boolean;
  currency: string;
  autopay: boolean;
  categoryId: string | null;
  payFromAccountId: string | null;
}

export function upcomingBills(bills: readonly RecurringBill[], start: ISODate, end: ISODate): BillOccurrence[] {
  return bills
    .flatMap((bill) =>
      occurrences(bill.nextDueDate, bill.cadence, start, end).map((dueDate) => ({
        billId: bill.id,
        name: bill.name,
        dueDate,
        amountMinor: bill.amountMinor,
        amountIsEstimate: bill.amountIsEstimate,
        currency: bill.currency,
        autopay: bill.autopay,
        categoryId: bill.categoryId,
        payFromAccountId: bill.payFromAccountId,
      })),
    )
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.name.localeCompare(b.name));
}

export interface IncomeOccurrence {
  sourceId: string;
  name: string;
  date: ISODate;
  /** Null when the amount is unknown. */
  amountMinor: number | null;
  currency: string;
}

export function expectedIncome(sources: readonly IncomeSource[], start: ISODate, end: ISODate): IncomeOccurrence[] {
  return sources
    .filter((s) => s.nextExpectedDate && s.cadence !== "irregular")
    .flatMap((s) =>
      occurrences(s.nextExpectedDate as ISODate, s.cadence, start, end).map((date) => ({
        sourceId: s.id,
        name: s.name,
        date,
        amountMinor: s.expectedAmountMinor,
        currency: s.currency,
      })),
    )
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** Monthly cost of a recurring bill (weekly × 52 / 12, etc.), rounded half up to the cent. */
export function monthlyEquivalentMinor(bill: Pick<RecurringBill, "amountMinor" | "cadence">): number {
  const perYear: Record<RecurringBill["cadence"], bigint> = {
    weekly: 52n,
    biweekly: 26n,
    monthly: 12n,
    quarterly: 4n,
    annual: 1n,
  };
  return Number(divRoundHalfUp(BigInt(bill.amountMinor) * perYear[bill.cadence], 12n));
}
