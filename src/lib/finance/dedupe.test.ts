import { describe, expect, it } from "vitest";
import {
  assignImportHashes,
  findPossibleDuplicates,
  normalizeDescription,
  reconcilePendingToPosted,
} from "./dedupe";
import { enrichTransactions, summarizePeriod } from "./classification";
import { account, category, override, tx } from "@/test/factories";

const checking = account();

describe("pending → posted reconciliation", () => {
  it("supersedes the pending transaction and migrates user edits", () => {
    const pending = tx(checking.id, { id: "p1", externalId: "plaid-pending-1", status: "pending", amountMinor: -2_345 });
    const posted = tx(checking.id, {
      id: "s1",
      externalId: "plaid-posted-1",
      pendingExternalId: "plaid-pending-1",
      amountMinor: -2_400, // tip added at settlement
    });
    const note = override("p1", { note: "Team lunch", excludeFromBudget: true });
    const result = reconcilePendingToPosted([pending, posted], [note]);
    expect(result.supersede).toEqual([{ pendingId: "p1", postedId: "s1" }]);
    expect(result.migratedOverrides).toEqual([{ ...note, transactionId: "s1" }]);
  });

  it("does not overwrite an override that already exists on the posted row", () => {
    const pending = tx(checking.id, { id: "p2", externalId: "pend-2", status: "pending" });
    const posted = tx(checking.id, { id: "s2", pendingExternalId: "pend-2" });
    const result = reconcilePendingToPosted([pending, posted], [override("p2"), override("s2", { note: "mine" })]);
    expect(result.supersede).toHaveLength(1);
    expect(result.migratedOverrides).toEqual([]);
  });

  it("ignores pending ids from other accounts", () => {
    const other = account();
    const pending = tx(other.id, { externalId: "pend-3", status: "pending" });
    const posted = tx(checking.id, { pendingExternalId: "pend-3" });
    expect(reconcilePendingToPosted([pending, posted], []).supersede).toEqual([]);
  });

  it("superseded pending rows are never counted twice", () => {
    const groceries = category();
    const pending = tx(checking.id, {
      id: "p4",
      externalId: "pend-4",
      status: "pending",
      amountMinor: -5_000,
      defaultCategoryId: groceries.id,
      supersededBy: "s4",
    });
    const posted = tx(checking.id, { id: "s4", pendingExternalId: "pend-4", amountMinor: -5_000, defaultCategoryId: groceries.id });
    const enriched = enrichTransactions({ transactions: [pending, posted], overrides: [], categories: [groceries], transferLinks: [] });
    expect(enriched.map((t) => t.id)).toEqual(["s4"]);
    expect(summarizePeriod(enriched, "2026-10-01", "2026-10-31").spendingMinor).toBe(5_000);
  });
});

describe("CSV import hashing", () => {
  const rows = [
    { accountId: "a", date: "2026-10-01", amountMinor: -450, description: "COFFEE SHOP #1234" },
    { accountId: "a", date: "2026-10-01", amountMinor: -450, description: "Coffee shop  #1234" },
    { accountId: "a", date: "2026-10-02", amountMinor: -450, description: "COFFEE SHOP #1234" },
  ];

  it("keeps genuine same-day duplicates distinct", () => {
    const hashed = assignImportHashes(rows);
    expect(new Set(hashed.map((r) => r.dedupeHash)).size).toBe(3);
    hashed.forEach((r) => expect(r.dedupeHash).toMatch(/^[0-9a-f]{64}$/));
  });

  it("produces identical hashes when the same file is imported again", () => {
    expect(assignImportHashes(rows).map((r) => r.dedupeHash)).toEqual(assignImportHashes(rows).map((r) => r.dedupeHash));
  });

  it("normalizes descriptions", () => {
    expect(normalizeDescription("  POS DEBIT 12345678 Trader-Joe's #552 ")).toBe("pos debit trader joe s 552");
  });
});

describe("possible duplicates across sources", () => {
  it("flags close matches for review", () => {
    const existing = tx(checking.id, { id: "e1", date: "2026-10-03", amountMinor: -6_789, description: "TARGET STORE 0042" });
    const found = findPossibleDuplicates(
      [
        { accountId: checking.id, date: "2026-10-04", amountMinor: -6_789, description: "Target store" },
        { accountId: checking.id, date: "2026-10-04", amountMinor: -6_789, description: "Gas station" },
        { accountId: checking.id, date: "2026-10-20", amountMinor: -6_789, description: "Target store" },
      ],
      [existing],
    );
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ existingTransactionId: "e1", dayDifference: 1, candidate: { index: 0 } });
  });
});
