import { describe, expect, it } from "vitest";
import { summarizeBalances } from "./balances";
import { account, balance } from "@/test/factories";

const now = new Date("2026-10-16T13:00:00Z");

describe("summarizeBalances", () => {
  it("never counts credit availability or limits as cash", () => {
    const checking = account({ type: "depository" });
    const card = account({ type: "credit", subtype: "credit card" });
    const result = summarizeBalances(
      [checking, card],
      [
        balance(checking.id, { currentMinor: 250_000, availableMinor: 240_000 }),
        balance(card.id, { currentMinor: 80_000, availableMinor: 420_000, creditLimitMinor: 500_000 }),
      ],
      { now, currency: "USD" },
    );
    expect(result.totalCashMinor).toBe(250_000);
    expect(result.availableCash.amountMinor).toBe(240_000);
    expect(result.creditCardDebtMinor).toBe(80_000);
    expect(result.availableCreditMinor).toBe(420_000);
    expect(result.creditLimitMinor).toBe(500_000);
    expect(result.netWorthMinor).toBe(170_000);
  });

  it("flags partial available cash instead of guessing", () => {
    const a = account();
    const b = account();
    const result = summarizeBalances(
      [a, b],
      [balance(a.id, { currentMinor: 1000, availableMinor: 900 }), balance(b.id, { currentMinor: 500 })],
      { now, currency: "USD" },
    );
    expect(result.totalCashMinor).toBe(1500);
    expect(result.availableCash).toEqual({ amountMinor: 900, isPartial: true, accountsWithoutAvailable: [b.id] });
  });

  it("uses the latest snapshot and reports stale, missing and unhealthy accounts", () => {
    const fresh = account();
    const stale = account({ connectionStatus: "login_required" });
    const missing = account();
    const result = summarizeBalances(
      [fresh, stale, missing],
      [
        balance(fresh.id, { currentMinor: 100, asOf: "2026-10-15T00:00:00Z" }),
        balance(fresh.id, { currentMinor: 200, asOf: "2026-10-16T12:00:00Z" }),
        balance(stale.id, { currentMinor: 300, asOf: "2026-10-13T12:00:00Z" }),
      ],
      { now, currency: "USD" },
    );
    expect(result.totalCashMinor).toBe(500);
    expect(result.staleAccountIds).toEqual([stale.id]);
    expect(result.unavailableAccountIds).toEqual([missing.id]);
    expect(result.unhealthyAccountIds).toEqual([stale.id]);
    expect(result.oldestBalanceAt).toBe("2026-10-13T12:00:00Z");
  });

  it("computes net worth with loans and investments, and skips other currencies", () => {
    const savings = account({ subtype: "savings" });
    const brokerage = account({ type: "investment" });
    const loan = account({ type: "loan" });
    const euro = account({ currency: "EUR" });
    const result = summarizeBalances(
      [savings, brokerage, loan, euro],
      [
        balance(savings.id, { currentMinor: 1_000_000 }),
        balance(brokerage.id, { currentMinor: 500_000 }),
        balance(loan.id, { currentMinor: 1_200_000 }),
        balance(euro.id, { currentMinor: 99_999, currency: "EUR" }),
      ],
      { now, currency: "USD" },
    );
    expect(result.assetsMinor).toBe(1_500_000);
    expect(result.liabilitiesMinor).toBe(1_200_000);
    expect(result.netWorthMinor).toBe(300_000);
    expect(result.otherCurrencyAccountIds).toEqual([euro.id]);
  });
});
