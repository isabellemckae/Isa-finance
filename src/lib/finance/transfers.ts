import { diffDays } from "./dates";
import type { Account, Category, Transaction, TransactionOverride, TransferLink } from "./types";

/**
 * Transfer and credit-card-payment detection (ARCHITECTURE.md §6.4).
 *
 * A pair (outflow on account A, inflow on account B) is linked when:
 *   - A ≠ B, both owned by the user, same currency, equal absolute amount
 *   - dates within `windowDays`
 *   - neither leg is removed, superseded, already linked, or marked "not a transfer"
 *   - there is a transfer signal: a transfer-kind category or transfer/payment
 *     wording on either leg, or a user "is_transfer" override. This keeps a purchase
 *     and an unrelated refund of the same amount from being linked.
 *   - the match is unique in both directions. Ambiguous candidates are reported, not guessed.
 */

export const DEFAULT_TRANSFER_WINDOW_DAYS = 3;

const TRANSFER_WORDS =
  /\b(transfer|xfer|trnsfr|payment|pymt|pmt|autopay|auto pay|thank you|online banking|to savings|from savings|to checking|from checking|zelle to self)\b/i;

export interface TransferDetectionResult {
  links: TransferLink[];
  /** Outflows with more than one plausible inflow (or vice versa); left for review. */
  ambiguous: Array<{ transactionId: string; candidateIds: string[] }>;
}

export function detectTransfers(input: {
  transactions: readonly Transaction[];
  accounts: readonly Account[];
  categories: readonly Category[];
  overrides: readonly TransactionOverride[];
  existingLinks: readonly TransferLink[];
  windowDays?: number;
}): TransferDetectionResult {
  const windowDays = input.windowDays ?? DEFAULT_TRANSFER_WINDOW_DAYS;
  const accounts = new Map(input.accounts.map((a) => [a.id, a]));
  const categories = new Map(input.categories.map((c) => [c.id, c]));
  const overrides = new Map(input.overrides.map((o) => [o.transactionId, o]));
  const linked = new Set<string>();
  for (const l of input.existingLinks) {
    linked.add(l.outflowTransactionId);
    linked.add(l.inflowTransactionId);
  }

  const eligible = input.transactions.filter(
    (t) =>
      !t.isRemoved &&
      !t.supersededBy &&
      t.amountMinor !== 0 &&
      !linked.has(t.id) &&
      accounts.has(t.accountId) &&
      overrides.get(t.id)?.transferOverride !== "not_transfer",
  );

  const hasSignal = (t: Transaction): boolean => {
    const override = overrides.get(t.id);
    if (override?.transferOverride === "is_transfer") return true;
    const categoryId = override?.categoryId ?? t.defaultCategoryId;
    if (categoryId && categories.get(categoryId)?.kind === "transfer") return true;
    return TRANSFER_WORDS.test(`${t.description} ${t.merchantName ?? ""}`);
  };

  const outflows = eligible.filter((t) => t.amountMinor < 0);
  const inflows = eligible.filter((t) => t.amountMinor > 0);

  const matches = (out: Transaction, inn: Transaction) =>
    out.accountId !== inn.accountId &&
    out.currency === inn.currency &&
    -out.amountMinor === inn.amountMinor &&
    Math.abs(diffDays(out.date, inn.date)) <= windowDays &&
    (hasSignal(out) || hasSignal(inn));

  const candidatesForOut = new Map<string, Transaction[]>();
  const candidatesForIn = new Map<string, Transaction[]>();
  for (const out of outflows) {
    for (const inn of inflows) {
      if (!matches(out, inn)) continue;
      candidatesForOut.set(out.id, [...(candidatesForOut.get(out.id) ?? []), inn]);
      candidatesForIn.set(inn.id, [...(candidatesForIn.get(inn.id) ?? []), out]);
    }
  }

  const links: TransferLink[] = [];
  const ambiguous: TransferDetectionResult["ambiguous"] = [];
  const byDateThenId = (a: Transaction, b: Transaction) =>
    a.date.localeCompare(b.date) || a.id.localeCompare(b.id);

  for (const out of [...outflows].sort(byDateThenId)) {
    const candidates = candidatesForOut.get(out.id);
    if (!candidates) continue;
    if (candidates.length > 1) {
      ambiguous.push({ transactionId: out.id, candidateIds: candidates.map((c) => c.id).sort() });
      continue;
    }
    const inn = candidates[0];
    const reverse = candidatesForIn.get(inn.id) ?? [];
    if (reverse.length > 1) {
      ambiguous.push({ transactionId: inn.id, candidateIds: reverse.map((c) => c.id).sort() });
      continue;
    }
    const destination = accounts.get(inn.accountId);
    links.push({
      outflowTransactionId: out.id,
      inflowTransactionId: inn.id,
      kind: destination?.type === "credit" ? "credit_card_payment" : "transfer",
      detectedBy: "rule",
    });
  }

  // The same inflow can be reported once per competing outflow; keep one entry.
  const seen = new Set<string>();
  return {
    links,
    ambiguous: ambiguous.filter((a) => (seen.has(a.transactionId) ? false : seen.add(a.transactionId))),
  };
}

/**
 * Validates a user-requested transfer link. Returns the link (with the right kind)
 * or a human-readable reason it is not allowed.
 */
export function validateTransferLink(
  input: { outflowTransactionId: string; inflowTransactionId: string },
  transactions: readonly Transaction[],
  accounts: readonly Account[],
  existingLinks: readonly TransferLink[],
): { ok: true; link: Omit<TransferLink, "detectedBy"> } | { ok: false; reason: string } {
  const out = transactions.find((t) => t.id === input.outflowTransactionId);
  const inn = transactions.find((t) => t.id === input.inflowTransactionId);
  if (!out || !inn) return { ok: false, reason: "Transaction not found." };
  if (out.amountMinor >= 0 || inn.amountMinor <= 0) return { ok: false, reason: "Pick one outflow and one inflow." };
  if (out.accountId === inn.accountId) return { ok: false, reason: "Both sides are in the same account." };
  if (out.currency !== inn.currency || -out.amountMinor !== inn.amountMinor) {
    return { ok: false, reason: "The amounts don't match." };
  }
  const linked = new Set(existingLinks.flatMap((l) => [l.outflowTransactionId, l.inflowTransactionId]));
  if (linked.has(out.id) || linked.has(inn.id)) return { ok: false, reason: "One of these is already linked." };
  const destination = accounts.find((a) => a.id === inn.accountId);
  return {
    ok: true,
    link: {
      outflowTransactionId: out.id,
      inflowTransactionId: inn.id,
      kind: destination?.type === "credit" ? "credit_card_payment" : "transfer",
    },
  };
}

/** Candidate partners for a transaction: opposite sign, same amount, other account, within the window. */
export function transferCandidates(
  tx: Transaction,
  transactions: readonly Transaction[],
  existingLinks: readonly TransferLink[],
  windowDays = 7,
): Transaction[] {
  const linked = new Set(existingLinks.flatMap((l) => [l.outflowTransactionId, l.inflowTransactionId]));
  return transactions
    .filter(
      (t) =>
        t.id !== tx.id &&
        !t.isRemoved &&
        !t.supersededBy &&
        !linked.has(t.id) &&
        t.accountId !== tx.accountId &&
        t.currency === tx.currency &&
        t.amountMinor === -tx.amountMinor &&
        Math.abs(diffDays(t.date, tx.date)) <= windowDays,
    )
    .sort((a, b) => Math.abs(diffDays(a.date, tx.date)) - Math.abs(diffDays(b.date, tx.date)) || a.id.localeCompare(b.id));
}
