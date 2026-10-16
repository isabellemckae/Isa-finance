import { describe, expect, it } from "vitest";
import { everydaySpendingBaseline, projectCashFlow } from "./forecast";
import { findCategorySpikes, findPossibleDuplicateCharges, findUnusualTransactions, buildProactiveInsights } from "./insights";
import { buildBriefing, startOfWeek } from "./briefing";
import { enrichTransactions } from "./classification";
import { buildDemoData } from "@/lib/data/demo/dataset";
import { addDays } from "./dates";
import { account, balance, bill, category, tx } from "@/test/factories";
import type { FinancialData } from "./types";

const now = new Date("2026-10-16T15:00:00Z");
const asOf = "2026-10-16";

function dataset(overrides: Partial<FinancialData> = {}): FinancialData {
  const checking = account({ id: "chk", name: "Checking" });
  return {
    isDemo: false,
    generatedAt: now.toISOString(),
    profile: { displayName: null, baseCurrency: "USD", timezone: "UTC", safetyBufferMinor: 20_000, includeExpectedIncome: false },
    accounts: [checking],
    balances: [balance("chk", { currentMinor: 300_000, availableMinor: 300_000, asOf: "2026-10-16T12:00:00Z" })],
    categories: [],
    transactions: [],
    overrides: [],
    transferLinks: [],
    budgets: [],
    bills: [],
    incomeSources: [],
    savingsGoals: [],
    debtGoals: [],
    ...overrides,
  };
}

const groceries = category({ id: "groc", name: "Groceries" });
const rent = category({ id: "rent", name: "Housing" });
const enrich = (d: FinancialData) => enrichTransactions(d);

describe("everydaySpendingBaseline", () => {
  it("averages daily spending and excludes bill categories", () => {
    const rows = [
      // 90 days ago through yesterday: groceries 90 × $10, plus rent which is a bill category.
      ...Array.from({ length: 90 }, (_, i) => tx("chk", { date: addDays(asOf, -90 + i), amountMinor: -1_000, defaultCategoryId: "groc" })),
      tx("chk", { date: "2026-10-01", amountMinor: -150_000, defaultCategoryId: "rent" }),
    ];
    const d = dataset({ categories: [groceries, rent], transactions: rows });
    expect(everydaySpendingBaseline(enrich(d), new Set(["rent"]), asOf)).toEqual({ dailyMinor: 1_000, historyDays: 90 });
  });

  it("returns zero without history", () => {
    expect(everydaySpendingBaseline([], new Set(), asOf)).toEqual({ dailyMinor: 0, historyDays: 0 });
  });
});

describe("projectCashFlow", () => {
  it("applies paychecks, bills, debt payments and baseline spending day by day", () => {
    const d = dataset({
      categories: [groceries, rent],
      transactions: Array.from({ length: 30 }, (_, i) =>
        tx("chk", { date: addDays(asOf, -30 + i), amountMinor: -2_000, defaultCategoryId: "groc" }),
      ),
      incomeSources: [
        { id: "s", name: "Salary", kind: "salary", expectedAmountMinor: 200_000, currency: "USD", cadence: "biweekly", nextExpectedDate: "2026-10-23" },
      ],
      bills: [bill({ name: "Rent", amountMinor: 150_000, nextDueDate: "2026-11-01", categoryId: "rent" })],
      debtGoals: [{ id: "d", accountId: null, name: "Visa", aprBps: 2000, minimumPaymentMinor: 3_000, plannedPaymentMinor: 25_000, paymentDueDay: 25 }],
    });
    const f = projectCashFlow({ data: d, transactions: enrich(d), now, asOf, days: 20 });
    expect(f.isProjection).toBe(true);
    expect(f.startingCashMinor).toBe(300_000);
    expect(f.baselineDailySpendMinor).toBe(2_000);
    expect(f.events.map((e) => [e.date, e.kind, e.amountMinor])).toEqual([
      ["2026-10-23", "income", 200_000],
      ["2026-10-25", "debt_payment", -25_000],
      ["2026-11-01", "bill", -150_000],
    ]);
    expect(f.totals).toEqual({ incomeMinor: 200_000, billsMinor: 150_000, debtPaymentsMinor: 25_000, everydaySpendingMinor: 40_000 });
    expect(f.endingMinor).toBe(300_000 + 200_000 - 25_000 - 150_000 - 40_000);
    expect(f.points).toHaveLength(21);
    expect(f.lowest.balanceMinor).toBe(Math.min(...f.points.map((p) => p.balanceMinor)));
    expect(f.assumptions.join(" ")).toMatch(/30-day average/);
  });

  it("clamps the horizon and can exclude income", () => {
    const d = dataset({
      incomeSources: [{ id: "s", name: "Salary", kind: "salary", expectedAmountMinor: 1, currency: "USD", cadence: "weekly", nextExpectedDate: "2026-10-20" }],
    });
    const f = projectCashFlow({ data: d, transactions: [], now, asOf, days: 500, includeExpectedIncome: false });
    expect(f.points).toHaveLength(91);
    expect(f.totals.incomeMinor).toBe(0);
    expect(f.warnings.join(" ")).toMatch(/Less than 30 days/);
  });
});

describe("insight detectors", () => {
  const history = Array.from({ length: 10 }, (_, i) =>
    tx("chk", { id: `h${i}`, date: addDays(asOf, -60 + i), amountMinor: -4_000, defaultCategoryId: "groc", merchantName: "Market" }),
  );

  it("flags purchases far above the category's typical amount", () => {
    const big = tx("chk", { id: "big", date: addDays(asOf, -2), amountMinor: -25_000, defaultCategoryId: "groc", merchantName: "Market" });
    const normal = tx("chk", { id: "ok", date: addDays(asOf, -1), amountMinor: -5_000, defaultCategoryId: "groc" });
    const d = dataset({ categories: [groceries], transactions: [...history, big, normal] });
    const found = findUnusualTransactions(enrich(d), asOf);
    expect(found.map((f) => f.tx.id)).toEqual(["big"]);
    expect(found[0].typicalMinor).toBe(4_000);
  });

  it("needs enough history before calling anything unusual", () => {
    const d = dataset({ categories: [groceries], transactions: [history[0], tx("chk", { date: asOf, amountMinor: -90_000, defaultCategoryId: "groc" })] });
    expect(findUnusualTransactions(enrich(d), asOf)).toEqual([]);
  });

  it("detects possible double charges but not small repeat purchases", () => {
    const a = tx("chk", { id: "a", date: "2026-10-10", amountMinor: -8_999, merchantName: "Gym" });
    const b = tx("chk", { id: "b", date: "2026-10-11", amountMinor: -8_999, merchantName: "gym" });
    const c1 = tx("chk", { id: "c1", date: "2026-10-12", amountMinor: -450, merchantName: "Coffee" });
    const c2 = tx("chk", { id: "c2", date: "2026-10-12", amountMinor: -450, merchantName: "Coffee" });
    const pairs = findPossibleDuplicateCharges(enrich(dataset({ transactions: [a, b, c1, c2] })), asOf);
    expect(pairs.map(([x, y]) => [x.id, y.id])).toEqual([["a", "b"]]);
  });

  it("detects month-to-date category spikes against a 3-month average", () => {
    const rows = [
      ...[1, 2, 3].map((k) => tx("chk", { date: `2026-${String(10 - k).padStart(2, "0")}-05`, amountMinor: -10_000, defaultCategoryId: "groc" })),
      tx("chk", { date: "2026-10-05", amountMinor: -30_000, defaultCategoryId: "groc" }),
    ];
    const spikes = findCategorySpikes(enrich(dataset({ categories: [groceries], transactions: rows })), asOf);
    expect(spikes).toMatchObject([{ name: "Groceries", spentMinor: 30_000, averageMinor: 10_000 }]);
  });
});

describe("proactive insights on demo data", () => {
  const demo = buildDemoData(now);
  const insights = buildProactiveInsights({ data: demo, transactions: enrichTransactions(demo), now, asOf: "2026-10-16" });

  it("are ordered by severity, deduplicated and capped", () => {
    expect(insights.length).toBeGreaterThan(0);
    expect(insights.length).toBeLessThanOrEqual(6);
    expect(new Set(insights.map((i) => i.id)).size).toBe(insights.length);
    const order = { warning: 0, attention: 1, info: 2, positive: 3 };
    const ranks = insights.map((i) => order[i.severity]);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
  });

  it("marks projections as estimates", () => {
    for (const i of insights.filter((x) => x.kind === "low_cash")) expect(i.isEstimate).toBe(true);
    expect(insights.find((i) => i.kind === "data_quality")).toBeDefined();
  });
});

describe("buildBriefing", () => {
  it("computes week boundaries from Monday", () => {
    expect(startOfWeek("2026-10-16")).toBe("2026-10-12"); // Friday → Monday
    expect(startOfWeek("2026-10-12")).toBe("2026-10-12");
    expect(startOfWeek("2026-10-18")).toBe("2026-10-12"); // Sunday
  });

  it("summarizes a partial month day for day with consistent totals", () => {
    const demo = buildDemoData(now);
    const transactions = enrichTransactions(demo);
    const b = buildBriefing({ data: demo, transactions, now, asOf: "2026-10-16", period: "month" });
    expect(b.range).toEqual({ start: "2026-10-01", end: "2026-10-16" });
    expect(b.previousRange).toEqual({ start: "2026-09-01", end: "2026-09-16" });
    expect(b.isPartial).toBe(true);
    expect(b.spending.currentMinor).toBe(b.spending.postedMinor + b.spending.pendingMinor);
    expect(b.netMinor).toBe(b.income.currentMinor - b.spending.currentMinor);
    expect(b.largestPurchases.every((p, i, arr) => i === 0 || arr[i - 1].amountMinor >= p.amountMinor)).toBe(true);
    expect(b.dataNotes).toContain("Fictional demo data.");
  });

  it("builds weekly briefings with the previous week's same days", () => {
    const demo = buildDemoData(now);
    const b = buildBriefing({ data: demo, transactions: enrichTransactions(demo), now, asOf: "2026-10-16", period: "week" });
    expect(b.range).toEqual({ start: "2026-10-12", end: "2026-10-16" });
    expect(b.previousRange).toEqual({ start: "2026-10-05", end: "2026-10-09" });
  });
});
