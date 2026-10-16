import { z } from "zod";
import { MoneyError, parseDecimalToMinor } from "./finance/money";
import { isISODate } from "./finance/dates";

/**
 * Zod helpers for form input. Server actions validate every field with these;
 * client-side attributes (required, pattern) are only a convenience.
 */

/** "$1,234.50" → 123450. Rejects extra precision; never rounds. */
export function parseMoneyInput(raw: string, currency = "USD"): number {
  const cleaned = raw.trim().replace(/[$,\s]/g, "");
  if (cleaned === "") throw new MoneyError("Enter an amount.");
  return parseDecimalToMinor(cleaned, currency);
}

const MAX_MINOR = 100_000_000_000; // $1B: generous upper bound for a personal app

export function money(options: { allowNegative?: boolean; allowZero?: boolean; currency?: string } = {}) {
  return z.string().transform((raw, ctx) => {
    try {
      const value = parseMoneyInput(raw, options.currency);
      if (!options.allowNegative && value < 0) {
        ctx.addIssue({ code: "custom", message: "Amount can't be negative." });
        return z.NEVER;
      }
      if (!options.allowZero && value === 0) {
        ctx.addIssue({ code: "custom", message: "Amount can't be zero." });
        return z.NEVER;
      }
      if (Math.abs(value) > MAX_MINOR) {
        ctx.addIssue({ code: "custom", message: "Amount is too large." });
        return z.NEVER;
      }
      return value;
    } catch {
      ctx.addIssue({ code: "custom", message: "Enter a valid amount, like 125.50." });
      return z.NEVER;
    }
  });
}

/**
 * Makes a string field optional: empty, or missing from the form entirely (e.g. a
 * field only shown for some account types), becomes null.
 */
function optional<T extends z.ZodTypeAny>(schema: T) {
  return z.preprocess(
    (v) => (v === undefined || v === null ? "" : v),
    z.union([z.literal("").transform(() => null), schema]),
  );
}

/** Optional money: empty or absent → null. */
export function optionalMoney(options: Parameters<typeof money>[0] = {}) {
  return optional(money({ allowZero: true, ...options }));
}

export const isoDateField = z.string().refine(isISODate, "Enter a valid date.");
export const optionalIsoDate = optional(isoDateField);

export const text = (max: number, label = "This field") =>
  z
    .string()
    .trim()
    .min(1, `${label} is required.`)
    .max(max, `${label} must be ${max} characters or fewer.`)
    .refine((s) => !/[\u0000-\u001f]/.test(s), `${label} contains invalid characters.`);

export const optionalText = (max: number, label = "This field") =>
  z.preprocess(
    (v) => v ?? "",
    z
      .string()
      .trim()
      .max(max, `${label} must be ${max} characters or fewer.`)
      .refine((s) => !/[\u0000-\u0008\u000b-\u001f]/.test(s), `${label} contains invalid characters.`)
      .transform((s) => (s === "" ? null : s)),
  );

export const checkbox = z
  .union([z.literal("on"), z.literal("true"), z.literal(""), z.null(), z.undefined()])
  .transform((v) => v === "on" || v === "true");

/** Ids are UUIDs in Supabase and prefixed strings in demo mode. */
export const idField = z.string().regex(/^[A-Za-z0-9_-]{1,80}$/, "Invalid id.");
export const optionalId = optional(idField);

/** Converts FormData into a plain object for zod (checkbox fields absent → null). */
export function formObject(formData: FormData, checkboxes: string[] = []): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === "string") obj[key] = value;
  }
  for (const key of checkboxes) if (!(key in obj)) obj[key] = null;
  return obj;
}

export function firstError(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return "Some values were not valid.";
  // Zod's generic union message isn't helpful to a person; name the field instead.
  if (issue.code === "invalid_union" || issue.message === "Invalid input") {
    const field = String(issue.path[0] ?? "a field").replace(/([A-Z])/g, " $1").toLowerCase();
    return `Check ${field}.`;
  }
  return issue.message;
}
