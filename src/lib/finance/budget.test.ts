import { describe, expect, it } from "vitest";
import { computeBudgetPerformance } from "./budget";
import { enrichTransactions, summarizePeriod } from "./classification";
import { account, category, override, tx } from "@/test/factories";

const checking = account();
const groceries = category({ name: "Groceries", isEssential: true });
const dining = category({ name: "Dining", isEssential: false });
const shopping = category({ name: "Shopping", isEssential: false });
const savingsCat = category({ name: "Savings", kind: "transfer", isEssential: false });
const categories = [groceries, dining, shopping, savingsCat];

function enrich(transactions: ReturnType<typeof tx>[], overrides: ReturnType<typeof override>[] = []) {
  return enrichTransactions({ transactions, overrides, categories, transferLinks: [] });
}

describe("classification", () => {
  it("nets refunds against spending and separates pending", () => {
    const enriched = enrich([
      tx(checking.id, { amountMinor: -10_000, defaultCategoryId: shopping.id }),
      tx(checking.id, { amountMinor: 2_500, defaultCategoryId: shopping.id }),
      tx(checking.id, { amountMinor: -1_200, defaultCategoryId: dining.id, status: "pending" }),
    ]);
    const summary = summarizePeriod(enriched, "2026-10-01", "2026-10-31");
    expect(summary.spendingMinor).toBe(8_700);
    expect(summary.spendingPostedMinor).toBe(7_500);
    expect(summary.spendingPendingMinor).toBe(1_200);
    expect(summary.byCategory.map((c) => [c.name, c.spentMinor])).toEqual([
      ["Shopping", 7_500],
      ["Dining", 1_200],
    ]);
  });

  it("applies user overrides without touching the original data", () => {
    const original = tx(checking.id, { amountMinor: -3_000, defaultCategoryId: shopping.id, merchantName: "AMZN MKTP" });
    const enriched = enrich([original], [override(original.id, { categoryId: groceries.id, merchantName: "Amazon Fresh" })]);
    expect(enriched[0].category?.id).toBe(groceries.id);
    expect(enriched[0].displayMerchant).toBe("Amazon Fresh");
    expect(original.defaultCategoryId).toBe(shopping.id);
    expect(original.merchantName).toBe("AMZN MKTP");
  });

  it("excludes transactions the user excluded from budgets", () => {
    const t = tx(checking.id, { amountMinor: -50_000, defaultCategoryId: shopping.id });
    const summary = summarizePeriod(enrich([t], [override(t.id, { excludeFromBudget: true })]), "2026-10-01", "2026-10-31");
    expect(summary.spendingMinor).toBe(0);
    expect(summary.excludedCount).toBe(1);
  });

  it("does not treat uncategorized inflows as income", () => {
    const summary = summarizePeriod(enrich([tx(checking.id, { amountMinor: 20_000 })]), "2026-10-01", "2026-10-31");
    expect(summary.incomeMinor).toBe(0);
    expect(summary.unclassifiedInflowMinor).toBe(20_000);
  });
});

describe("computeBudgetPerformance", () => {
  const budget = {
    month: "2026-10-01",
    currency: "USD",
    allocations: [
      { categoryId: groceries.id, kind: "variable" as const, plannedMinor: 60_000 },
      { categoryId: dining.id, kind: "variable" as const, plannedMinor: 20_000 },
      { categoryId: savingsCat.id, kind: "savings" as const, plannedMinor: 50_000 },
    ],
  };

  it("computes planned vs actual with honest over-budget values", () => {
    const enriched = enrich([
      tx(checking.id, { amountMinor: -55_000, defaultCategoryId: groceries.id, date: "2026-10-05" }),
      tx(checking.id, { amountMinor: -26_000, defaultCategoryId: dining.id, date: "2026-10-06" }),
      tx(checking.id, { amountMinor: -9_900, defaultCategoryId: shopping.id, date: "2026-10-07" }),
      tx(checking.id, { amountMinor: -30_000, defaultCategoryId: savingsCat.id, date: "2026-10-08" }),
      // Outside the month: ignored.
      tx(checking.id, { amountMinor: -99_999, defaultCategoryId: groceries.id, date: "2026-09-30" }),
    ]);
    const perf = computeBudgetPerformance(budget, enriched, categories);
    const byName = Object.fromEntries(perf.lines.map((l) => [l.name, l]));

    expect(byName.Groceries).toMatchObject({ actualMinor: 55_000, remainingMinor: 5_000, status: "near_limit", usedBps: 9167 });
    expect(byName.Dining).toMatchObject({ actualMinor: 26_000, remainingMinor: -6_000, status: "over" });
    expect(byName.Savings).toMatchObject({ actualMinor: 30_000, remainingMinor: 20_000, status: "on_track" });
    expect(perf.spending).toEqual({ plannedMinor: 80_000, actualMinor: 81_000, remainingMinor: -1_000 });
    expect(perf.unbudgeted).toEqual([{ categoryId: shopping.id, name: "Shopping", actualMinor: 9_900 }]);
  });
});
