import { describe, expect, it } from "vitest";
import { savingsProgress, simulateDebtPayoff } from "./goals";

describe("simulateDebtPayoff", () => {
  it("matches a hand-computed schedule", () => {
    // $1,000 at 12% APR (1%/month), $500/month.
    const r = simulateDebtPayoff({ balanceMinor: 100_000, aprBps: 1200, monthlyPaymentMinor: 50_000 });
    expect(r.schedule).toEqual([
      { month: 1, interestMinor: 1_000, paymentMinor: 50_000, balanceMinor: 51_000 },
      { month: 2, interestMinor: 510, paymentMinor: 50_000, balanceMinor: 1_510 },
      { month: 3, interestMinor: 15, paymentMinor: 1_525, balanceMinor: 0 },
    ]);
    expect(r).toMatchObject({ paysOff: true, months: 3, totalInterestMinor: 1_525, totalPaidMinor: 101_525 });
  });

  it("detects payments that never cover interest", () => {
    const r = simulateDebtPayoff({ balanceMinor: 500_000, aprBps: 2400, monthlyPaymentMinor: 10_000 });
    expect(r.paymentTooLow).toBe(true);
    expect(r.paysOff).toBe(false);
  });

  it("handles zero APR and zero balance", () => {
    expect(simulateDebtPayoff({ balanceMinor: 30_000, aprBps: 0, monthlyPaymentMinor: 10_000 })).toMatchObject({
      months: 3,
      totalInterestMinor: 0,
    });
    expect(simulateDebtPayoff({ balanceMinor: 0, aprBps: 2000, monthlyPaymentMinor: 0 })).toMatchObject({
      paysOff: true,
      months: 0,
    });
  });

  it("stops at the month cap", () => {
    const r = simulateDebtPayoff({ balanceMinor: 10_000_000, aprBps: 2000, monthlyPaymentMinor: 170_000, maxMonths: 12 });
    expect(r.months).toBe(12);
    expect(r.paysOff).toBe(false);
  });
});

describe("savingsProgress", () => {
  const goal = {
    id: "g",
    name: "Emergency fund",
    targetMinor: 1_000_000,
    savedMinor: 400_000,
    monthlyContributionMinor: 50_000,
    currency: "USD",
    targetDate: "2027-12-01",
  };

  it("computes progress and projection", () => {
    expect(savingsProgress(goal, "2026-10-16")).toEqual({
      goalId: "g",
      name: "Emergency fund",
      targetMinor: 1_000_000,
      savedMinor: 400_000,
      remainingMinor: 600_000,
      progressBps: 4_000,
      monthsToGoal: 12,
      projectedDate: "2027-10-16",
      onTrack: true,
    });
  });

  it("handles no contribution and completed goals", () => {
    expect(savingsProgress({ ...goal, monthlyContributionMinor: 0 }, "2026-10-16")).toMatchObject({
      monthsToGoal: null,
      onTrack: null,
    });
    expect(savingsProgress({ ...goal, savedMinor: 1_200_000 }, "2026-10-16")).toMatchObject({
      remainingMinor: 0,
      progressBps: 10_000,
      monthsToGoal: 0,
      onTrack: true,
    });
  });
});
