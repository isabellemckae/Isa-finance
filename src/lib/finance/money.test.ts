import { describe, expect, it } from "vitest";
import {
  MoneyError,
  addMinor,
  divRoundHalfUp,
  formatMoney,
  fromPlaidAmount,
  minorToDecimalString,
  parseDecimalToMinor,
  ratioBps,
  sumAmounts,
} from "./money";

describe("parseDecimalToMinor", () => {
  it.each([
    ["12.34", 1234],
    ["0.1", 10],
    ["-0.01", -1],
    ["+5", 500],
    ["1000000.00", 100_000_000],
    ["7.10", 710],
    ["3.000", 300],
  ])("parses %s", (input, expected) => {
    expect(parseDecimalToMinor(input, "USD")).toBe(expected);
  });

  it("parses numbers through their string form, avoiding float error", () => {
    // With float math, 4.35 * 100 === 434.99999999999994.
    expect(parseDecimalToMinor(19.99, "USD")).toBe(1999);
    expect(parseDecimalToMinor(4.35, "USD")).toBe(435);
    expect(parseDecimalToMinor(1.15, "USD")).toBe(115);
  });

  it("rejects extra precision instead of rounding silently", () => {
    expect(() => parseDecimalToMinor("1.005", "USD")).toThrow(MoneyError);
    expect(() => parseDecimalToMinor(0.1 + 0.2, "USD")).toThrow(MoneyError);
  });

  it("respects zero-decimal currencies", () => {
    expect(parseDecimalToMinor("1500", "JPY")).toBe(1500);
    expect(() => parseDecimalToMinor("1500.5", "JPY")).toThrow(MoneyError);
  });

  it.each(["", "abc", "1,000.00", "$5", "1e5", "NaN"])("rejects malformed input %j", (input) => {
    expect(() => parseDecimalToMinor(input, "USD")).toThrow(MoneyError);
  });

  it("rejects non-finite and out-of-range numbers", () => {
    expect(() => parseDecimalToMinor(Number.POSITIVE_INFINITY)).toThrow(MoneyError);
    expect(() => parseDecimalToMinor(1e21)).toThrow(MoneyError);
    expect(() => parseDecimalToMinor("99999999999999999999")).toThrow(MoneyError);
  });

  it("never returns negative zero", () => {
    expect(Object.is(parseDecimalToMinor("-0.00"), 0)).toBe(true);
  });
});

describe("fromPlaidAmount", () => {
  it("flips Plaid's sign convention (positive = money out)", () => {
    expect(fromPlaidAmount(12.5, "USD")).toBe(-1250);
    expect(fromPlaidAmount(-2500, "USD")).toBe(250_000);
    expect(Object.is(fromPlaidAmount(0, "USD"), 0)).toBe(true);
  });
});

describe("arithmetic", () => {
  it("adds safely and rejects non-integers", () => {
    expect(addMinor(1, 2, -3)).toBe(0);
    expect(() => addMinor(1.5)).toThrow(MoneyError);
    expect(() => addMinor(Number.MAX_SAFE_INTEGER, 1)).toThrow(MoneyError);
  });

  it("refuses to mix currencies", () => {
    expect(sumAmounts([{ amountMinor: 100, currency: "USD" }, { amountMinor: 50, currency: "USD" }], "USD")).toBe(150);
    expect(() => sumAmounts([{ amountMinor: 100, currency: "EUR" }], "USD")).toThrow(MoneyError);
  });

  it("rounds half away from zero", () => {
    expect(divRoundHalfUp(5n, 2n)).toBe(3n);
    expect(divRoundHalfUp(-5n, 2n)).toBe(-3n);
    expect(divRoundHalfUp(4n, 3n)).toBe(1n);
    expect(divRoundHalfUp(7n, -2n)).toBe(-4n);
    expect(() => divRoundHalfUp(1n, 0n)).toThrow(MoneyError);
  });

  it("computes ratios in basis points", () => {
    expect(ratioBps(1, 3)).toBe(3333);
    expect(ratioBps(2, 3)).toBe(6667);
    expect(ratioBps(5, 0)).toBe(0);
  });
});

describe("formatting", () => {
  it("converts to exact decimal strings", () => {
    expect(minorToDecimalString(-123450, "USD")).toBe("-1234.50");
    expect(minorToDecimalString(5, "USD")).toBe("0.05");
    expect(minorToDecimalString(1500, "JPY")).toBe("1500");
  });

  it("formats currency", () => {
    expect(formatMoney(123456, "USD")).toBe("$1,234.56");
    expect(formatMoney(-500, "USD")).toBe("-$5.00");
    expect(formatMoney(2500, "USD", { signDisplay: "always" })).toBe("+$25.00");
    expect(formatMoney(123456, "USD", { wholeUnits: true })).toBe("$1,235");
    // Exact even beyond float precision of cents.
    expect(formatMoney(900719925474099, "USD")).toBe("$9,007,199,254,740.99");
  });
});
