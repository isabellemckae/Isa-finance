import { z } from "zod";
import { isISODate } from "./dates";
import { minorToDecimalString } from "./money";
import type { EnrichedTransaction } from "./classification";
import type { ISODate } from "./types";

/**
 * Transaction search and filtering. Filters come from URL search params, so they
 * are validated with Zod; invalid values are dropped rather than trusted.
 */

export const TRANSACTION_TYPES = ["all", "income", "expense", "transfer", "review"] as const;
export type TransactionTypeFilter = (typeof TRANSACTION_TYPES)[number];

export const UNCATEGORIZED = "uncategorized";
export const PAGE_SIZE = 50;

export interface TransactionFilters {
  q: string;
  from: ISODate | null;
  to: ISODate | null;
  accountId: string | null;
  /** A category id, or `UNCATEGORIZED`. */
  categoryId: string | null;
  type: TransactionTypeFilter;
  status: "pending" | "posted" | null;
  page: number;
}

const dateParam = z
  .string()
  .refine(isISODate)
  .nullable()
  .catch(null);
const idParam = z
  .string()
  .regex(/^[A-Za-z0-9_-]{1,64}$/)
  .nullable()
  .catch(null);

const filtersSchema = z.object({
  q: z.string().trim().max(100).catch(""),
  from: dateParam,
  to: dateParam,
  account: idParam,
  category: idParam,
  type: z.enum(TRANSACTION_TYPES).catch("all"),
  status: z.enum(["pending", "posted"]).nullable().catch(null),
  page: z.coerce.number().int().min(1).max(1000).catch(1),
});

type RawParams = Record<string, string | string[] | undefined>;

export function parseTransactionFilters(params: RawParams): TransactionFilters {
  const pick = (key: string) => {
    const v = params[key];
    const s = Array.isArray(v) ? v[0] : v;
    return s === undefined || s === "" ? null : s;
  };
  const parsed = filtersSchema.parse({
    q: pick("q") ?? "",
    from: pick("from"),
    to: pick("to"),
    account: pick("account"),
    category: pick("category"),
    type: pick("type") ?? "all",
    status: pick("status"),
    page: pick("page") ?? 1,
  });
  let { from, to } = parsed;
  if (from && to && from > to) [from, to] = [to, from];
  return {
    q: parsed.q,
    from,
    to,
    accountId: parsed.account,
    categoryId: parsed.category,
    type: parsed.type,
    status: parsed.status,
    page: parsed.page,
  };
}

/** Serializes filters back to a query string (omitting defaults). */
export function filtersToQuery(filters: Partial<TransactionFilters>): string {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  if (filters.accountId) params.set("account", filters.accountId);
  if (filters.categoryId) params.set("category", filters.categoryId);
  if (filters.type && filters.type !== "all") params.set("type", filters.type);
  if (filters.status) params.set("status", filters.status);
  if (filters.page && filters.page > 1) params.set("page", String(filters.page));
  const s = params.toString();
  return s ? `?${s}` : "";
}

export function hasActiveFilters(f: TransactionFilters): boolean {
  return Boolean(f.q || f.from || f.to || f.accountId || f.categoryId || f.status || f.type !== "all");
}

/** Transactions that need the user's attention. */
export function needsReview(tx: EnrichedTransaction, ambiguousIds: ReadonlySet<string>): boolean {
  return (
    tx.flow === "unmatched_transfer" ||
    tx.flow === "unclassified_inflow" ||
    ambiguousIds.has(tx.id) ||
    (tx.flow === "expense" && (tx.category === null || tx.category.name === "Uncategorized"))
  );
}

function matchesType(tx: EnrichedTransaction, type: TransactionTypeFilter, ambiguous: ReadonlySet<string>): boolean {
  switch (type) {
    case "all":
      return true;
    case "income":
      return tx.flow === "income";
    case "expense":
      return tx.flow === "expense" || tx.flow === "refund";
    case "transfer":
      return tx.flow === "transfer" || tx.flow === "credit_card_payment" || tx.flow === "unmatched_transfer";
    case "review":
      return needsReview(tx, ambiguous);
  }
}

function matchesQuery(tx: EnrichedTransaction, q: string): boolean {
  if (!q) return true;
  const needle = q.toLowerCase();
  const haystack = [
    tx.displayMerchant,
    tx.description,
    tx.merchantName ?? "",
    tx.note ?? "",
    tx.category?.name ?? "uncategorized",
    minorToDecimalString(Math.abs(tx.amountMinor), tx.currency),
  ]
    .join("\n")
    .toLowerCase();
  return haystack.includes(needle);
}

export function filterTransactions(
  transactions: readonly EnrichedTransaction[],
  filters: TransactionFilters,
  ambiguousIds: ReadonlySet<string> = new Set(),
): EnrichedTransaction[] {
  return transactions
    .filter(
      (tx) =>
        (!filters.from || tx.date >= filters.from) &&
        (!filters.to || tx.date <= filters.to) &&
        (!filters.accountId || tx.accountId === filters.accountId) &&
        (!filters.categoryId ||
          (filters.categoryId === UNCATEGORIZED ? tx.category === null : tx.category?.id === filters.categoryId)) &&
        (!filters.status || tx.status === filters.status) &&
        matchesType(tx, filters.type, ambiguousIds) &&
        matchesQuery(tx, filters.q),
    )
    .sort((a, b) => b.date.localeCompare(a.date) || (a.status === b.status ? a.id.localeCompare(b.id) : a.status === "pending" ? -1 : 1));
}

export interface DayGroup {
  date: ISODate;
  transactions: EnrichedTransaction[];
  /** Net of all transactions shown that day (signed). */
  netMinor: number;
}

export function groupByDay(transactions: readonly EnrichedTransaction[]): DayGroup[] {
  const groups: DayGroup[] = [];
  for (const tx of transactions) {
    const last = groups.at(-1);
    if (last && last.date === tx.date) {
      last.transactions.push(tx);
      last.netMinor += tx.amountMinor;
    } else {
      groups.push({ date: tx.date, transactions: [tx], netMinor: tx.amountMinor });
    }
  }
  return groups;
}

export function paginate<T>(items: readonly T[], page: number, pageSize = PAGE_SIZE) {
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const current = Math.min(Math.max(page, 1), pageCount);
  return {
    items: items.slice(0, current * pageSize),
    page: current,
    pageCount,
    total: items.length,
    hasMore: current < pageCount,
  };
}
