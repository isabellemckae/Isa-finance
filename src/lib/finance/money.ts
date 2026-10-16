import type { CurrencyCode } from "./types";

/**
 * Money helpers. Amounts are integers in the currency's minor unit (cents for USD).
 * Floats are never used for arithmetic; decimals are parsed from their string form.
 */

export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MoneyError";
  }
}

const CURRENCY_RE = /^[A-Z]{3}$/;

export function assertCurrency(currency: string): CurrencyCode {
  if (!CURRENCY_RE.test(currency)) {
    throw new MoneyError(`Invalid currency code: ${JSON.stringify(currency)}`);
  }
  return currency;
}

/** Number of minor-unit digits for a currency (USD → 2, JPY → 0). */
export function minorUnitDigits(currency: CurrencyCode): number {
  assertCurrency(currency);
  const digits = new Intl.NumberFormat("en-US", { style: "currency", currency })
    .resolvedOptions().maximumFractionDigits;
  return digits ?? 2;
}

export function assertMinor(value: number, label = "amount"): number {
  if (!Number.isSafeInteger(value)) {
    throw new MoneyError(`${label} must be a safe integer of minor units, got ${value}`);
  }
  return value;
}

const DECIMAL_RE = /^([+-])?(\d+)(?:\.(\d+))?$/;

/**
 * Parses a decimal amount ("12.34", 12.34, "-0.5") into minor units without
 * floating-point arithmetic. Extra precision is rejected unless the extra digits
 * are zeros. It is never silently rounded.
 */
export function parseDecimalToMinor(input: string | number, currency: CurrencyCode = "USD"): number {
  const digits = minorUnitDigits(currency);
  let text: string;
  if (typeof input === "number") {
    if (!Number.isFinite(input)) throw new MoneyError(`Non-finite amount: ${input}`);
    text = String(input);
    if (/e/i.test(text)) throw new MoneyError(`Amount out of supported range: ${input}`);
  } else {
    text = input.trim();
  }
  const match = DECIMAL_RE.exec(text);
  if (!match) throw new MoneyError(`Not a decimal amount: ${JSON.stringify(input)}`);
  const [, sign, whole, rawFraction = ""] = match;
  const significant = rawFraction.replace(/0+$/, "");
  if (significant.length > digits) {
    throw new MoneyError(
      `Amount ${JSON.stringify(input)} has more precision than ${currency} allows (${digits} decimals)`,
    );
  }
  const fraction = rawFraction.slice(0, digits).padEnd(digits, "0");
  const minor = BigInt(whole + fraction) * (sign === "-" ? -1n : 1n);
  if (minor > BigInt(Number.MAX_SAFE_INTEGER) || minor < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new MoneyError(`Amount out of safe range: ${JSON.stringify(input)}`);
  }
  // Avoid returning -0.
  return Number(minor) || 0;
}

/**
 * Plaid reports positive amounts for money leaving the account. The app uses the
 * opposite convention, so the sign is flipped exactly once, here.
 */
export function fromPlaidAmount(amount: number, currency: CurrencyCode): number {
  return -parseDecimalToMinor(amount, currency) || 0;
}

export function addMinor(...values: number[]): number {
  let total = 0;
  for (const v of values) {
    assertMinor(v);
    total += v;
    assertMinor(total, "sum");
  }
  return total;
}

/** Sums amounts, refusing to mix currencies. */
export function sumAmounts(
  items: ReadonlyArray<{ amountMinor: number; currency: CurrencyCode }>,
  currency: CurrencyCode,
): number {
  let total = 0;
  for (const item of items) {
    if (item.currency !== currency) {
      throw new MoneyError(`Cannot sum ${item.currency} into ${currency}`);
    }
    total = addMinor(total, item.amountMinor);
  }
  return total;
}

/** Integer division rounding half away from zero, using BigInt (no float error). */
export function divRoundHalfUp(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) throw new MoneyError("Division by zero");
  const negative = numerator < 0n !== denominator < 0n;
  const n = numerator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;
  const q = (n * 2n + d) / (d * 2n);
  return negative ? -q : q;
}

/** Ratio in basis points (1/100 of a percent), rounded half up. 0 when denominator is 0. */
export function ratioBps(part: number, whole: number): number {
  if (whole === 0) return 0;
  return Number(divRoundHalfUp(BigInt(part) * 10_000n, BigInt(whole)));
}

/** Converts minor units into an exact decimal string ("-1234.50"). */
export function minorToDecimalString(minor: number, currency: CurrencyCode): string {
  assertMinor(minor);
  const digits = minorUnitDigits(currency);
  const negative = minor < 0;
  const abs = String(Math.abs(minor)).padStart(digits + 1, "0");
  const whole = digits === 0 ? abs : abs.slice(0, -digits);
  const fraction = digits === 0 ? "" : `.${abs.slice(-digits)}`;
  return `${negative ? "-" : ""}${whole}${fraction}`;
}

export interface FormatMoneyOptions {
  /** "auto" shows "-" for negatives; "always" shows "+" for positives; "never" hides sign. */
  signDisplay?: "auto" | "always" | "never" | "exceptZero";
  /** Drop the minor unit (e.g. "$1,235"); rounds half up for display only. */
  wholeUnits?: boolean;
  compact?: boolean;
  locale?: string;
}

export function formatMoney(
  minor: number,
  currency: CurrencyCode,
  options: FormatMoneyOptions = {},
): string {
  const digits = minorUnitDigits(currency);
  const formatter = new Intl.NumberFormat(options.locale ?? "en-US", {
    style: "currency",
    currency,
    signDisplay: options.signDisplay ?? "auto",
    notation: options.compact ? "compact" : "standard",
    minimumFractionDigits: options.wholeUnits || options.compact ? 0 : digits,
    maximumFractionDigits: options.wholeUnits ? 0 : options.compact ? 1 : digits,
  });
  // Intl accepts exact decimal strings, which avoids float conversion.
  return formatter.format(minorToDecimalString(minor, currency) as unknown as number);
}
