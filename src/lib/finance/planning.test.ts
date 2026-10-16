import { describe, expect, it } from "vitest";
import { compareMonths, nextPaychecks, planIncomeForMonth, planPaycheckAllocation } from "./planning";
import { enrichTransactions } from "./classification";
import type { BudgetPerformance } from "./budget";
import type { IncomeSource } from "./types";
import { account, bill, category, tx } from "@/test/factories";

const checking = account();
const dining = category({ name: "Dining", isEssential: false });
const groceries = category({ name: "Groceries", isEssential: true });
const pay = category({ name: "Paycheck", kind: "income" });
const categories = [dining, groceries, pay];

const enrich = (rows: ReturnType<typeof tx>[]) =>
  enrichTransactions({ transactions: rows, overrides: [], categories, transferLinks: [] });

describe("compareMonths", () => {
  const data = enrich([
    tx(checking.id, { date: "2026-09-05", amountMinor: -10_000, defaultCategoryId: dining.id }),
    tx(checking.id, { date: "2026-09-25", amountMinor: -50_000, defaultCategoryId: dining.id }),
    tx(checking.id, { date: "2026-10-04", amountMinor: -18_000, defaultCategoryId: dining.id }),
    tx(checking.id, { date: "2026-10-05", amountMinor: -7_000, defaultCategoryId: groceries.id }),
  ]);

  it("compares an in-progress month day-for-day", () => {
    const c = compareMonths(data, "2026-10-01", "2026-10-10");
    expect(c).toMatchObject({ toDate: true, throughDay: 10 });
    // Sept 25 is excluded from the comparison window.
    expect(c.rows.find((r) => r.name === "Dining")).toMatchObject({ currentMinor: 18_000, previousMinor: 10_000, changeMinor: 8_000 });
    expect(c.rows.find((r) => r.name === "Groceries")).toMatchObject({ previousMinor: 0, changeMinor: 7_000 });
  });

  it("compares complete past months in full", () => {
    const c = compareMonths(data, "2026-09-01", "2026-10-10");
    expect(c.toDate).toBe(false);
    expect(c.current.spendingMinor).toBe(60_000);
  });
});

const salary: IncomeSource = {
  id: "s",
  name: "Salary",
  kind: "salary",
  expectedAmountMinor: 245_000,
  currency: "USD",
  cadence: "biweekly",
  nextExpectedDate: "2026-10-23",
};
const freelance: IncomeSource = { ...salary, id: "f", name: "Freelance", kind: "freelance", cadence: "irregular", expectedAmountMinor: null, nextExpectedDate: null };

describe("planIncomeForMonth", () => {
  it("expands schedules anchored later in the month and lists irregular sources", () => {
    const received = enrich([tx(checking.id, { date: "2026-10-09", amountMinor: 245_000, defaultCategoryId: pay.id })]);
    const plan = planIncomeForMonth([salary, freelance], received, "2026-10-01");
    expect(plan.deposits.map((d) => d.date)).toEqual(["2026-10-09", "2026-10-23"]);
    expect(plan.expectedMinor).toBe(490_000);
    expect(plan.unplannedSources).toEqual(["Freelance"]);
    expect(plan.receivedMinor).toBe(245_000);
  });

  it("handles a three-paycheck month", () => {
    expect(planIncomeForMonth([{ ...salary, nextExpectedDate: "2027-01-01" }], [], "2027-01-01").deposits).toHaveLength(3);
  });
});

describe("planPaycheckAllocation", () => {
  const budget: BudgetPerformance = {
    month: "2026-10-01",
    currency: "USD",
    spending: { plannedMinor: 0, actualMinor: 0, remainingMinor: 0 },
    unbudgeted: [],
    lines: [
      { categoryId: groceries.id, name: "Groceries", kind: "variable", isEssential: true, plannedMinor: 55_001, actualMinor: 0, pendingMinor: 0, remainingMinor: 55_001, usedBps: 0, status: "not_started" },
      { categoryId: dining.id, name: "Dining", kind: "variable", isEssential: false, plannedMinor: 30_000, actualMinor: 0, pendingMinor: 0, remainingMinor: 30_000, usedBps: 0, status: "not_started" },
      { categoryId: "rent", name: "Housing", kind: "fixed", isEssential: true, plannedMinor: 165_000, actualMinor: 0, pendingMinor: 0, remainingMinor: 165_000, usedBps: 0, status: "not_started" },
    ],
  };

  it("allocates bills, debt, essentials, savings and flexible spending", () => {
    const plan = planPaycheckAllocation({
      paycheckDate: "2026-10-23",
      paycheckMinor: 245_000,
      nextPaycheckDate: "2026-11-06",
      paychecksThisMonth: 2,
      bills: [
        bill({ name: "Rent", amountMinor: 165_000, nextDueDate: "2026-11-01", categoryId: "rent" }),
        bill({ name: "Phone", amountMinor: 6_500, nextDueDate: "2026-11-18" }), // after window
      ],
      budget,
      savingsGoals: [{ id: "g", name: "Emergency", targetMinor: 1_000_000, savedMinor: 0, monthlyContributionMinor: 60_000, currency: "USD", targetDate: null }],
      debtGoals: [{ id: "d", accountId: null, name: "Visa", aprBps: 2399, minimumPaymentMinor: 4_000, plannedPaymentMinor: 60_000, paymentDueDay: 25 }],
    });
    const amount = (key: string) => plan.buckets.find((b) => b.key === key)!.amountMinor;
    expect(plan.coversUntil).toBe("2026-11-05");
    expect(amount("bills")).toBe(165_000);
    expect(amount("debt")).toBe(60_000);
    // 55,001 / 2 rounds half up to 27,501 (cents never invented or lost silently).
    expect(amount("essentials")).toBe(27_501);
    expect(amount("savings")).toBe(30_000);
    expect(amount("flexible")).toBe(15_000);
    expect(plan.unallocatedMinor).toBe(245_000 - 165_000 - 60_000 - 27_501 - 30_000 - 15_000);
    expect(plan.unallocatedMinor).toBeLessThan(0);
  });

  it("states its assumptions and handles a missing budget", () => {
    const plan = planPaycheckAllocation({
      paycheckDate: "2026-10-09",
      paycheckMinor: 100_000,
      nextPaycheckDate: "2026-10-23",
      paychecksThisMonth: 2,
      bills: [],
      budget: null,
      savingsGoals: [],
      debtGoals: [],
    });
    expect(plan.unallocatedMinor).toBe(100_000);
    expect(plan.assumptions.join(" ")).toMatch(/No budget exists/);
  });
});

describe("nextPaychecks", () => {
  it("finds the next salary paycheck and counts paychecks in its month", () => {
    expect(nextPaychecks([freelance, salary], "2026-10-16")).toMatchObject({
      date: "2026-10-23",
      nextDate: "2026-11-06",
      amountMinor: 245_000,
      paychecksThisMonth: 2,
    });
    expect(nextPaychecks([freelance], "2026-10-16")).toBeNull();
  });
});
