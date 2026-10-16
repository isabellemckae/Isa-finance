import { divRoundHalfUp, ratioBps } from "./money";
import { addMonths, compareDates } from "./dates";
import type { ISODate, SavingsGoal } from "./types";

/** Savings progress and debt payoff simulation (ARCHITECTURE.md §6.8). */

export interface SavingsProgress {
  goalId: string;
  name: string;
  targetMinor: number;
  savedMinor: number;
  remainingMinor: number;
  /** saved / target in basis points, capped at 10000. */
  progressBps: number;
  /** Months to reach the target at the planned contribution; null if no contribution. */
  monthsToGoal: number | null;
  projectedDate: ISODate | null;
  /** null when there is no target date or no contribution plan. */
  onTrack: boolean | null;
}

export function savingsProgress(goal: SavingsGoal, asOf: ISODate): SavingsProgress {
  const remaining = Math.max(goal.targetMinor - goal.savedMinor, 0);
  const months =
    remaining === 0 ? 0 : goal.monthlyContributionMinor > 0 ? Math.ceil(remaining / goal.monthlyContributionMinor) : null;
  const projectedDate = months === null ? null : addMonths(asOf, months);
  return {
    goalId: goal.id,
    name: goal.name,
    targetMinor: goal.targetMinor,
    savedMinor: goal.savedMinor,
    remainingMinor: remaining,
    progressBps: Math.min(ratioBps(goal.savedMinor, goal.targetMinor), 10_000),
    monthsToGoal: months,
    projectedDate,
    onTrack:
      goal.targetDate && projectedDate ? compareDates(projectedDate, goal.targetDate) <= 0 : remaining === 0 ? true : null,
  };
}

export interface DebtPayoffInput {
  balanceMinor: number;
  aprBps: number;
  monthlyPaymentMinor: number;
  maxMonths?: number;
}

export interface DebtPayoffResult {
  paysOff: boolean;
  months: number;
  totalInterestMinor: number;
  totalPaidMinor: number;
  /** Set when the payment does not cover the first month's interest. */
  paymentTooLow: boolean;
  schedule: Array<{ month: number; interestMinor: number; paymentMinor: number; balanceMinor: number }>;
}

/**
 * Month-by-month simulation. Interest = balance × APR / 12, rounded half up to the
 * minor unit each month, and the payment is applied after interest. Uses BigInt for
 * the interest product to avoid floating point.
 */
export function simulateDebtPayoff(input: DebtPayoffInput): DebtPayoffResult {
  const maxMonths = input.maxMonths ?? 600;
  let balance = BigInt(Math.max(input.balanceMinor, 0));
  const payment = BigInt(Math.max(input.monthlyPaymentMinor, 0));
  const apr = BigInt(input.aprBps);
  let totalInterest = 0n;
  let totalPaid = 0n;
  const schedule: DebtPayoffResult["schedule"] = [];

  const firstInterest = divRoundHalfUp(balance * apr, 120_000n);
  if (balance > 0n && payment <= firstInterest) {
    return { paysOff: false, months: 0, totalInterestMinor: 0, totalPaidMinor: 0, paymentTooLow: true, schedule };
  }

  let month = 0;
  while (balance > 0n && month < maxMonths) {
    month += 1;
    const interest = divRoundHalfUp(balance * apr, 120_000n);
    balance += interest;
    const paid = payment < balance ? payment : balance;
    balance -= paid;
    totalInterest += interest;
    totalPaid += paid;
    schedule.push({
      month,
      interestMinor: Number(interest),
      paymentMinor: Number(paid),
      balanceMinor: Number(balance),
    });
  }

  return {
    paysOff: balance === 0n,
    months: month,
    totalInterestMinor: Number(totalInterest),
    totalPaidMinor: Number(totalPaid),
    paymentTooLow: false,
    schedule,
  };
}
