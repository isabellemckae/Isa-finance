import { addMinor } from "./money";
import { isWithin } from "./dates";
import type {
  Category,
  ISODate,
  Transaction,
  TransactionOverride,
  TransferKind,
  TransferLink,
} from "./types";

/**
 * Transaction classification (ARCHITECTURE.md §6.3).
 *
 * Original data is never modified. Each transaction is combined with the user's
 * override (if any) and transfer links into an `EnrichedTransaction` that says
 * how it counts towards income and spending.
 */

export type TransactionFlow =
  /** Outflow in an expense category: counts as spending. */
  | "expense"
  /** Inflow in an expense category (e.g. a return): reduces spending. */
  | "refund"
  /** Income category: counts as income (an outflow here is an income reversal). */
  | "income"
  /** Linked or user-marked movement between own accounts. */
  | "transfer"
  /** Linked payment from a cash account to a credit card. */
  | "credit_card_payment"
  /** Transfer category with no matching leg: excluded, flagged for review. */
  | "unmatched_transfer"
  /** User excluded it from budget calculations. */
  | "excluded"
  /** Uncategorized inflow: not counted as income until the user classifies it. */
  | "unclassified_inflow";

export interface EnrichedTransaction extends Transaction {
  category: Category | null;
  displayMerchant: string;
  note: string | null;
  flow: TransactionFlow;
  transferKind: TransferKind | null;
}

export function countsTowardSpending(flow: TransactionFlow): boolean {
  return flow === "expense" || flow === "refund";
}

export function countsTowardIncome(flow: TransactionFlow): boolean {
  return flow === "income";
}

export function enrichTransactions(input: {
  transactions: readonly Transaction[];
  overrides: readonly TransactionOverride[];
  categories: readonly Category[];
  transferLinks: readonly TransferLink[];
}): EnrichedTransaction[] {
  const categories = new Map(input.categories.map((c) => [c.id, c]));
  const overrides = new Map(input.overrides.map((o) => [o.transactionId, o]));
  const linkKind = new Map<string, TransferKind>();
  for (const link of input.transferLinks) {
    linkKind.set(link.outflowTransactionId, link.kind);
    linkKind.set(link.inflowTransactionId, link.kind);
  }

  const result: EnrichedTransaction[] = [];
  for (const tx of input.transactions) {
    if (tx.isRemoved || tx.supersededBy) continue;
    const override = overrides.get(tx.id);
    const categoryId = override?.categoryId ?? tx.defaultCategoryId;
    const category = categoryId ? (categories.get(categoryId) ?? null) : null;
    const linked = linkKind.get(tx.id) ?? null;

    result.push({
      ...tx,
      category,
      displayMerchant: override?.merchantName ?? tx.merchantName ?? tx.description,
      note: override?.note ?? null,
      transferKind: linked,
      flow: resolveFlow(tx, category, override, linked),
    });
  }
  return result;
}

function resolveFlow(
  tx: Transaction,
  category: Category | null,
  override: TransactionOverride | undefined,
  linked: TransferKind | null,
): TransactionFlow {
  if (override?.transferOverride !== "not_transfer") {
    if (linked) return linked;
    if (override?.transferOverride === "is_transfer") return "transfer";
  }
  if (override?.excludeFromBudget) return "excluded";

  const kind = category?.kind ?? null;
  if (kind === "transfer" && override?.transferOverride !== "not_transfer") return "unmatched_transfer";
  if (kind === "income") return "income";
  if (kind === "expense") return tx.amountMinor < 0 ? "expense" : "refund";
  // No category (or a transfer category the user says is not a transfer).
  return tx.amountMinor < 0 ? "expense" : "unclassified_inflow";
}

export interface CategoryTotal {
  categoryId: string | null;
  name: string;
  /** Net spending in the category (outflows minus refunds), positive = spent. */
  spentMinor: number;
}

export interface PeriodSummary {
  start: ISODate;
  end: ISODate;
  incomeMinor: number;
  /** Net spending (positive = money spent), posted + pending. */
  spendingMinor: number;
  spendingPostedMinor: number;
  spendingPendingMinor: number;
  byCategory: CategoryTotal[];
  unclassifiedInflowMinor: number;
  unmatchedTransferCount: number;
  excludedCount: number;
  pendingCount: number;
  transactionCount: number;
}

export function summarizePeriod(
  transactions: readonly EnrichedTransaction[],
  start: ISODate,
  end: ISODate,
): PeriodSummary {
  let income = 0;
  let spendingPosted = 0;
  let spendingPending = 0;
  let unclassified = 0;
  let unmatched = 0;
  let excluded = 0;
  let pending = 0;
  let count = 0;
  const byCategory = new Map<string | null, CategoryTotal>();

  for (const tx of transactions) {
    if (!isWithin(tx.date, start, end)) continue;
    count += 1;
    if (tx.status === "pending") pending += 1;

    if (countsTowardIncome(tx.flow)) {
      income = addMinor(income, tx.amountMinor);
    } else if (countsTowardSpending(tx.flow)) {
      const spent = -tx.amountMinor;
      if (tx.status === "pending") spendingPending = addMinor(spendingPending, spent);
      else spendingPosted = addMinor(spendingPosted, spent);
      const key = tx.category?.id ?? null;
      const entry = byCategory.get(key) ?? {
        categoryId: key,
        name: tx.category?.name ?? "Uncategorized",
        spentMinor: 0,
      };
      entry.spentMinor = addMinor(entry.spentMinor, spent);
      byCategory.set(key, entry);
    } else if (tx.flow === "unclassified_inflow") {
      unclassified = addMinor(unclassified, tx.amountMinor);
    } else if (tx.flow === "unmatched_transfer") {
      unmatched += 1;
    } else if (tx.flow === "excluded") {
      excluded += 1;
    }
  }

  return {
    start,
    end,
    incomeMinor: income,
    spendingMinor: addMinor(spendingPosted, spendingPending),
    spendingPostedMinor: spendingPosted,
    spendingPendingMinor: spendingPending,
    byCategory: [...byCategory.values()].sort(
      (a, b) => b.spentMinor - a.spentMinor || a.name.localeCompare(b.name),
    ),
    unclassifiedInflowMinor: unclassified,
    unmatchedTransferCount: unmatched,
    excludedCount: excluded,
    pendingCount: pending,
    transactionCount: count,
  };
}
