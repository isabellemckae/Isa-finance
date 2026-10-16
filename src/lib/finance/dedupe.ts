import { createHash } from "node:crypto";
import { diffDays } from "./dates";
import type { ISODate, Transaction, TransactionOverride } from "./types";

/**
 * Duplicate prevention (ARCHITECTURE.md §6.5).
 *
 * 1. Provider identity: (source, external_id) is unique in the database.
 * 2. Pending → posted: a posted transaction that names a pending one supersedes it.
 * 3. CSV imports: deterministic hash including an ordinal, so re-importing a file
 *    is a no-op but genuine identical rows in one file are kept.
 * 4. Cross-source candidates are reported for review and never deleted automatically.
 */

// ---------------------------------------------------------------------------
// Pending → posted
// ---------------------------------------------------------------------------

export interface PendingReconciliation {
  /** Pending transactions to mark superseded by the posted transaction. */
  supersede: Array<{ pendingId: string; postedId: string }>;
  /** Overrides to move from the pending row to the posted row (user edits survive). */
  migratedOverrides: TransactionOverride[];
}

export function reconcilePendingToPosted(
  transactions: readonly Transaction[],
  overrides: readonly TransactionOverride[],
): PendingReconciliation {
  const pendingByExternal = new Map<string, Transaction>();
  for (const t of transactions) {
    if (t.status === "pending" && !t.isRemoved && !t.supersededBy) {
      pendingByExternal.set(`${t.accountId}|${t.externalId}`, t);
    }
  }
  const overrideByTx = new Map(overrides.map((o) => [o.transactionId, o]));

  const supersede: PendingReconciliation["supersede"] = [];
  const migratedOverrides: TransactionOverride[] = [];
  for (const posted of transactions) {
    if (posted.status !== "posted" || posted.isRemoved || !posted.pendingExternalId) continue;
    const pending = pendingByExternal.get(`${posted.accountId}|${posted.pendingExternalId}`);
    if (!pending) continue;
    pendingByExternal.delete(`${posted.accountId}|${posted.pendingExternalId}`);
    supersede.push({ pendingId: pending.id, postedId: posted.id });

    const pendingOverride = overrideByTx.get(pending.id);
    if (pendingOverride && !overrideByTx.has(posted.id)) {
      migratedOverrides.push({ ...pendingOverride, transactionId: posted.id });
    }
  }
  return { supersede, migratedOverrides };
}

// ---------------------------------------------------------------------------
// Import hashing
// ---------------------------------------------------------------------------

/** Normalizes a bank description for comparison: case, punctuation, long digit runs. */
export function normalizeDescription(description: string): string {
  return description
    .toLowerCase()
    .replace(/\d{4,}/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export interface ImportRow {
  accountId: string;
  date: ISODate;
  amountMinor: number;
  description: string;
}

export function importHash(row: ImportRow, ordinal: number): string {
  return createHash("sha256")
    .update(
      [row.accountId, row.date, String(row.amountMinor), normalizeDescription(row.description), String(ordinal)].join("|"),
    )
    .digest("hex");
}

/**
 * Assigns dedupe hashes to the rows of one import file. Identical rows get ordinals
 * 0, 1, 2… in file order, so two identical coffees on the same day both survive,
 * while importing the same file twice produces the same hashes.
 */
export function assignImportHashes<T extends ImportRow>(rows: readonly T[]): Array<T & { dedupeHash: string }> {
  const seen = new Map<string, number>();
  return rows.map((row) => {
    const key = [row.accountId, row.date, row.amountMinor, normalizeDescription(row.description)].join("|");
    const ordinal = seen.get(key) ?? 0;
    seen.set(key, ordinal + 1);
    return { ...row, dedupeHash: importHash(row, ordinal) };
  });
}

// ---------------------------------------------------------------------------
// Possible duplicates across sources
// ---------------------------------------------------------------------------

function tokenSimilarity(a: string, b: string): number {
  const ta = new Set(normalizeDescription(a).split(" ").filter(Boolean));
  const tb = new Set(normalizeDescription(b).split(" ").filter(Boolean));
  if (ta.size === 0 || tb.size === 0) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared += 1;
  return shared / Math.min(ta.size, tb.size);
}

export interface PossibleDuplicate {
  candidate: ImportRow & { index: number };
  existingTransactionId: string;
  dayDifference: number;
}

/**
 * Finds import rows that probably duplicate an existing transaction (same account,
 * same amount, close dates, similar description). These go to the user for review.
 */
export function findPossibleDuplicates(
  candidates: readonly ImportRow[],
  existing: readonly Transaction[],
  options: { windowDays?: number; minSimilarity?: number } = {},
): PossibleDuplicate[] {
  const windowDays = options.windowDays ?? 3;
  const minSimilarity = options.minSimilarity ?? 0.5;
  const result: PossibleDuplicate[] = [];
  candidates.forEach((row, index) => {
    for (const tx of existing) {
      if (tx.isRemoved || tx.supersededBy) continue;
      if (tx.accountId !== row.accountId || tx.amountMinor !== row.amountMinor) continue;
      const days = Math.abs(diffDays(tx.date, row.date));
      if (days > windowDays) continue;
      const similarity = tokenSimilarity(row.description, `${tx.merchantName ?? ""} ${tx.description}`);
      if (similarity < minSimilarity) continue;
      result.push({ candidate: { ...row, index }, existingTransactionId: tx.id, dayDifference: days });
    }
  });
  return result;
}
