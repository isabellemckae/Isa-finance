import { z } from "zod";
import { fromPlaidAmount, MoneyError, parseDecimalToMinor } from "@/lib/finance/money";
import type { AccountType } from "@/lib/finance/types";

/**
 * Plaid responses → rows the database accepts. Pure and tested.
 *
 * - Every Plaid object is validated with Zod first; anything unexpected is skipped and
 *   counted, never guessed.
 * - Amounts: Plaid's positive = money out. `fromPlaidAmount` flips the sign once.
 * - Balances keep Plaid's meaning, which already matches ours: for credit accounts
 *   `current` is the amount owed and `available` is available credit (never cash).
 * - Free text is stripped of control characters and truncated to the column limits.
 */

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const money = z.number().finite().nullable().optional();

export const plaidAccountSchema = z.object({
  account_id: z.string().min(1).max(200),
  name: z.string().nullable().optional(),
  official_name: z.string().nullable().optional(),
  mask: z.string().nullable().optional(),
  type: z.string(),
  subtype: z.string().nullable().optional(),
  balances: z.object({
    available: money,
    current: money,
    limit: money,
    iso_currency_code: z.string().nullable().optional(),
    last_updated_datetime: z.string().nullable().optional(),
  }),
});
export type PlaidAccount = z.infer<typeof plaidAccountSchema>;

export const plaidTransactionSchema = z.object({
  transaction_id: z.string().min(1).max(200),
  account_id: z.string().min(1).max(200),
  amount: z.number().finite(),
  iso_currency_code: z.string().nullable().optional(),
  date: isoDate,
  authorized_date: isoDate.nullable().optional(),
  name: z.string().nullable().optional(),
  merchant_name: z.string().nullable().optional(),
  pending: z.boolean(),
  pending_transaction_id: z.string().max(200).nullable().optional(),
  payment_channel: z.string().nullable().optional(),
  personal_finance_category: z
    .object({ primary: z.string(), detailed: z.string().nullable().optional() })
    .nullable()
    .optional(),
});
export type PlaidTransaction = z.infer<typeof plaidTransactionSchema>;

export const plaidRemovedSchema = z.object({ transaction_id: z.string().min(1).max(200) });

export interface AccountRow {
  provider_account_id: string;
  type: AccountType;
  subtype: string | null;
  name: string;
  official_name: string | null;
  mask: string | null;
  currency: string;
}

export interface BalanceRow {
  provider_account_id: string;
  current_minor: number | null;
  available_minor: number | null;
  credit_limit_minor: number | null;
  currency: string;
  as_of: string;
}

export interface TransactionRow {
  external_id: string;
  provider_account_id: string;
  pending_external_id: string | null;
  status: "pending" | "posted";
  amount_minor: number;
  currency: string;
  transaction_date: string;
  authorized_date: string | null;
  description: string;
  merchant_name: string | null;
  provider_category_primary: string | null;
  provider_category_detailed: string | null;
  payment_channel: string | null;
  /** Name of one of the user's default categories, matched in the database. */
  category_name: string | null;
}

const CONTROL = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069\ufeff]/g;

export function cleanProviderText(value: string | null | undefined, max: number): string | null {
  if (value == null) return null;
  const text = value.replace(CONTROL, " ").replace(/\s+/g, " ").trim();
  return text ? text.slice(0, max) : null;
}

const CURRENCY = /^[A-Z]{3}$/;

function accountType(type: string): AccountType {
  if (type === "depository" || type === "credit" || type === "loan" || type === "investment") return type;
  if (type === "brokerage") return "investment";
  return "other";
}

function cleanMask(mask: string | null | undefined): string | null {
  const alnum = (mask ?? "").replace(/[^0-9A-Za-z]/g, "").slice(-4);
  return alnum.length >= 2 ? alnum : null;
}

export function mapAccount(raw: unknown): AccountRow | null {
  const parsed = plaidAccountSchema.safeParse(raw);
  if (!parsed.success) return null;
  const a = parsed.data;
  const currency = a.balances.iso_currency_code ?? "USD";
  return {
    provider_account_id: a.account_id,
    type: accountType(a.type),
    subtype: cleanProviderText(a.subtype, 40),
    name: cleanProviderText(a.name, 120) ?? cleanProviderText(a.official_name, 120) ?? "Account",
    official_name: cleanProviderText(a.official_name, 200),
    mask: cleanMask(a.mask),
    currency: CURRENCY.test(currency) ? currency : "USD",
  };
}

function balanceMinor(value: number | null | undefined, currency: string): number | null {
  if (value == null) return null;
  try {
    return parseDecimalToMinor(value, currency);
  } catch (error) {
    if (error instanceof MoneyError) return null;
    throw error;
  }
}

export function mapBalance(raw: unknown, now: Date): BalanceRow | null {
  const parsed = plaidAccountSchema.safeParse(raw);
  if (!parsed.success) return null;
  const { account_id, balances: b } = parsed.data;
  // Balances in unofficial currencies (e.g. crypto) are not representable; skip them.
  if (!b.iso_currency_code || !CURRENCY.test(b.iso_currency_code)) return null;
  const asOf = b.last_updated_datetime && !Number.isNaN(Date.parse(b.last_updated_datetime)) ? new Date(b.last_updated_datetime) : now;
  const limit = balanceMinor(b.limit, b.iso_currency_code);
  return {
    provider_account_id: account_id,
    current_minor: balanceMinor(b.current, b.iso_currency_code),
    available_minor: balanceMinor(b.available, b.iso_currency_code),
    credit_limit_minor: limit != null && limit >= 0 ? limit : null,
    currency: b.iso_currency_code,
    as_of: asOf.toISOString(),
  };
}

/**
 * Plaid personal-finance categories → the default category names created for every
 * user. Unmapped categories stay uncategorized rather than being guessed.
 */
export function categoryNameFor(primary: string | null | undefined, detailed: string | null | undefined): string | null {
  const d = detailed ?? "";
  switch (primary) {
    case "INCOME":
      if (d === "INCOME_WAGES") return "Paycheck";
      if (d === "INCOME_INTEREST_EARNED") return "Interest";
      return "Other income";
    case "TRANSFER_IN":
    case "TRANSFER_OUT":
      return "Transfer";
    case "LOAN_PAYMENTS":
      if (d === "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT") return "Credit card payment";
      if (d === "LOAN_PAYMENTS_MORTGAGE_PAYMENT") return "Housing";
      if (d === "LOAN_PAYMENTS_CAR_PAYMENT") return "Transportation";
      return null;
    case "BANK_FEES":
      return "Fees";
    case "ENTERTAINMENT":
      return "Entertainment";
    case "FOOD_AND_DRINK":
      return d === "FOOD_AND_DRINK_GROCERIES" ? "Groceries" : "Dining";
    case "GENERAL_MERCHANDISE":
      return "Shopping";
    case "HOME_IMPROVEMENT":
      return "Housing";
    case "MEDICAL":
      return "Health";
    case "PERSONAL_CARE":
      return "Personal care";
    case "GENERAL_SERVICES":
      if (d === "GENERAL_SERVICES_INSURANCE") return "Insurance";
      if (d === "GENERAL_SERVICES_EDUCATION") return "Education";
      return null;
    case "GOVERNMENT_AND_NON_PROFIT":
      return d === "GOVERNMENT_AND_NON_PROFIT_DONATIONS" ? "Gifts & donations" : null;
    case "TRANSPORTATION":
      return "Transportation";
    case "TRAVEL":
      return "Travel";
    case "RENT_AND_UTILITIES":
      return d === "RENT_AND_UTILITIES_RENT" ? "Housing" : "Utilities";
    default:
      return null;
  }
}

export function mapTransaction(raw: unknown): TransactionRow | null {
  const parsed = plaidTransactionSchema.safeParse(raw);
  if (!parsed.success) return null;
  const t = parsed.data;
  if (!t.iso_currency_code || !CURRENCY.test(t.iso_currency_code)) return null;
  let amountMinor: number;
  try {
    amountMinor = fromPlaidAmount(t.amount, t.iso_currency_code);
  } catch (error) {
    if (error instanceof MoneyError) return null;
    throw error;
  }
  const pfc = t.personal_finance_category;
  return {
    external_id: t.transaction_id,
    provider_account_id: t.account_id,
    pending_external_id: t.pending_transaction_id ?? null,
    status: t.pending ? "pending" : "posted",
    amount_minor: amountMinor,
    currency: t.iso_currency_code,
    transaction_date: t.date,
    authorized_date: t.authorized_date ?? null,
    description: cleanProviderText(t.name, 500) ?? cleanProviderText(t.merchant_name, 500) ?? "Transaction",
    merchant_name: cleanProviderText(t.merchant_name, 200),
    provider_category_primary: cleanProviderText(pfc?.primary, 100),
    provider_category_detailed: cleanProviderText(pfc?.detailed, 100),
    payment_channel: cleanProviderText(t.payment_channel, 20),
    category_name: categoryNameFor(pfc?.primary, pfc?.detailed),
  };
}

/** Maps a list, returning the rows plus how many were skipped as invalid. */
export function mapAll<T>(items: readonly unknown[], fn: (raw: unknown) => T | null): { rows: T[]; skipped: number } {
  const rows: T[] = [];
  let skipped = 0;
  for (const item of items) {
    const row = fn(item);
    if (row) rows.push(row);
    else skipped += 1;
  }
  return { rows, skipped };
}
