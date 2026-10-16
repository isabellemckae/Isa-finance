import { enrichTransactions, type EnrichedTransaction } from "@/lib/finance/classification";
import { todayInTimeZone } from "@/lib/finance/dates";
import type { FinancialData, ISODate } from "@/lib/finance/types";

/**
 * The only data the Personal CFO can see: a frozen snapshot of ONE user's financial
 * data, loaded by the server for the signed-in user. Tools receive this object and
 * nothing else: no repository, no database client, no user id to choose.
 */
export interface CfoContext {
  readonly data: Readonly<FinancialData>;
  readonly transactions: readonly EnrichedTransaction[];
  readonly now: Date;
  readonly asOf: ISODate;
  readonly currency: string;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value as Record<string, unknown>)) deepFreeze(v);
  }
  return value;
}

export function createCfoContext(data: FinancialData, now: Date): CfoContext {
  const copy = structuredClone(data);
  const transactions = enrichTransactions(copy);
  return deepFreeze({
    data: copy,
    transactions,
    now,
    asOf: todayInTimeZone(copy.profile.timezone, now),
    currency: copy.profile.baseCurrency,
  });
}
