import { describe, expect, it } from "vitest";
import { computeSafeToSpend, type SafeToSpendInput } from "./safe-to-spend";
import type { BudgetPerformance } from "./budget";
import { account, balance, bill, tx } from "@/test/factories";
import { enrichTransactions } from "./classification";

const now = new Date("2026-10-16T15:00:00Z");
const checking = account({ name: "Checking" });
const card = account({ name: "Card", type: "credit" });

function base(overrides: Partial<SafeToSpendInput> = {}): SafeToSpendInput {
  return {
    asOf: "2026-10-16",
    horizonEnd: "2026-10-31",
    now,
    currency: "USD",
    accounts: [checking, card],
    balances: [
      balance(checking.id, { currentMinor: 300_000, availableMinor: 280_000 }),
      balance(card.id, { currentMinor: 50_000, availableMinor: 950_000, creditLimitMinor: 1_000_000 }),
    ],
    transactions: [],
    bills: [],
    incomeSources: [],
    debtGoals: [],
    budget: null,
    safetyBufferMinor: 20_000,
    includeExpectedIncome: false,
    ...overrides,
  };
}

const component = (r: ReturnType<typeof computeSafeToSpend>, key: string) =>
  r.components.find((c) => c.key === key)?.amountMinor;

describe("computeSafeToSpend", () => {
  it("starts from available cash and never counts credit availability", () => {
    const r = computeSafeToSpend(base());
    expect(component(r, "spendable_cash")).toBe(280_000);
    expect(r.amountMinor).toBe(260_000);
    expect(r.assumptions).toContain("Credit card available credit is never counted as spendable cash.");
  });

  it("does not treat savings accounts as spendable", () => {
    const savings = account({ name: "Emergency fund", subtype: "savings" });
    const r = computeSafeToSpend(
      base({
        accounts: [checking, card, savings],
        balances: [...base().balances, balance(savings.id, { currentMinor: 900_000, availableMinor: 900_000 })],
      }),
    );
    expect(component(r, "spendable_cash")).toBe(280_000);
    expect(r.assumptions.join(" ")).toMatch(/Savings accounts are set aside.*Emergency fund/);
  });

  it("subtracts bills, essentials (without double counting bills), savings, debt and buffer", () => {
    const budget: BudgetPerformance = {
      month: "2026-10-01",
      currency: "USD",
      spending: { plannedMinor: 0, actualMinor: 0, remainingMinor: 0 },
      unbudgeted: [],
      lines: [
        line("cat-groceries", "variable", true, 40_000),
        line("cat-utilities", "fixed", true, 15_000),
        line("cat-dining", "variable", false, 30_000),
        line("cat-savings", "savings", false, 25_000),
        line("cat-over", "variable", true, -5_000),
      ],
    };
    const r = computeSafeToSpend(
      base({
        budget,
        bills: [
          bill({ name: "Power", amountMinor: 12_000, nextDueDate: "2026-10-20", categoryId: "cat-utilities" }),
          bill({ name: "Phone", amountMinor: 8_000, nextDueDate: "2026-11-05" }), // outside horizon
        ],
        debtGoals: [
          { id: "d", accountId: card.id, name: "Card", aprBps: 2299, minimumPaymentMinor: 3_500, plannedPaymentMinor: 10_000, paymentDueDay: 25 },
        ],
      }),
    );
    expect(component(r, "bills")).toBe(-12_000);
    // Groceries 40,000 + utilities (15,000 − 12,000 bill) = 43,000; over-budget lines reserve 0; dining is not essential.
    expect(component(r, "essential_budget")).toBe(-43_000);
    expect(component(r, "savings")).toBe(-25_000);
    expect(component(r, "debt_payments")).toBe(-10_000);
    expect(r.amountMinor).toBe(280_000 - 12_000 - 43_000 - 25_000 - 10_000 - 20_000);
    expect(r.isShortfall).toBe(false);
  });

  it("reports a shortfall rather than clamping to zero", () => {
    const r = computeSafeToSpend(base({ bills: [bill({ amountMinor: 400_000, nextDueDate: "2026-10-20" })] }));
    expect(r.amountMinor).toBe(280_000 - 400_000 - 20_000);
    expect(r.isShortfall).toBe(true);
  });

  it("only counts expected income when opted in", () => {
    const incomeSources = [
      { id: "i", name: "Salary", kind: "salary" as const, expectedAmountMinor: 200_000, currency: "USD", cadence: "monthly" as const, nextExpectedDate: "2026-10-30" },
    ];
    expect(component(computeSafeToSpend(base({ incomeSources })), "expected_income")).toBeUndefined();
    const r = computeSafeToSpend(base({ incomeSources, includeExpectedIncome: true }));
    expect(component(r, "expected_income")).toBe(200_000);
    expect(r.assumptions.join(" ")).toMatch(/not guaranteed/);
  });

  it("falls back to current balance with pending outflows and marks the result estimated", () => {
    const noAvailable = account({ name: "Credit union checking" });
    const transactions = enrichTransactions({
      transactions: [
        tx(noAvailable.id, { status: "pending", amountMinor: -4_200 }),
        tx(noAvailable.id, { status: "posted", amountMinor: -1_000 }),
      ],
      overrides: [],
      categories: [],
      transferLinks: [],
    });
    const r = computeSafeToSpend(
      base({
        accounts: [noAvailable],
        balances: [balance(noAvailable.id, { currentMinor: 100_000, availableMinor: null })],
        transactions,
        safetyBufferMinor: 0,
      }),
    );
    expect(component(r, "spendable_cash")).toBe(100_000);
    expect(component(r, "pending_outflows")).toBe(-4_200);
    expect(r.confidence).toBe("estimated");
  });

  it("excludes disconnected and stale-flagged accounts with warnings", () => {
    const broken = account({ name: "Broken", connectionStatus: "login_required" });
    const old = account({ name: "Old" });
    const r = computeSafeToSpend(
      base({
        accounts: [broken, old],
        balances: [
          balance(broken.id, { currentMinor: 999_999, availableMinor: 999_999 }),
          balance(old.id, { currentMinor: 50_000, availableMinor: 50_000, asOf: "2026-10-10T00:00:00Z" }),
        ],
      }),
    );
    expect(component(r, "spendable_cash")).toBe(50_000);
    expect(r.warnings.join(" ")).toMatch(/Broken needs to be reconnected/);
    expect(r.warnings.join(" ")).toMatch(/Old balance is out of date/);
    expect(r.warnings.join(" ")).toMatch(/No budget exists/);
    expect(r.confidence).toBe("estimated");
  });
});

function line(categoryId: string, kind: "fixed" | "variable" | "savings" | "debt", isEssential: boolean, remainingMinor: number) {
  return {
    categoryId,
    name: categoryId,
    kind,
    isEssential,
    plannedMinor: Math.max(remainingMinor, 0),
    actualMinor: 0,
    pendingMinor: 0,
    remainingMinor,
    usedBps: 0,
    status: "not_started" as const,
  };
}
