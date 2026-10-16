"use server";

import { z } from "zod";
import { addMonths, startOfMonth } from "@/lib/finance/dates";
import {
  checkbox,
  formObject,
  idField,
  isoDateField,
  money,
  optionalId,
  optionalIsoDate,
  optionalMoney,
  text,
} from "@/lib/forms";
import { firstError } from "@/lib/forms";
import { failure, runAction, type ActionState } from "./run";

const budgetPaths = ["/budget", "/budget/bills", "/budget/income", "/budget/goals", "/budget/paycheck"];

const monthField = isoDateField.refine((d) => d.endsWith("-01"), "Invalid month.");

// ---------------------------------------------------------------------------
// Allocations
// ---------------------------------------------------------------------------

const allocationSchema = z.object({
  month: monthField,
  categoryId: idField,
  kind: z.enum(["fixed", "variable", "savings", "debt"]),
  planned: money({ allowZero: true }),
});

export async function setAllocationAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = allocationSchema.safeParse(formObject(formData));
  if (!parsed.success) return failure(firstError(parsed.error));
  const v = parsed.data;
  return runAction(async ({ repo }) => {
    await repo.setAllocation(v.month, v.categoryId, v.kind, v.planned);
    await repo.audit("budget.allocation_set", "category", v.categoryId);
    return "Plan updated.";
  }, budgetPaths);
}

const removeSchema = z.object({ month: monthField, categoryId: idField });

export async function removeAllocationAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = removeSchema.safeParse(formObject(formData));
  if (!parsed.success) return failure("Invalid request.");
  return runAction(async ({ repo }) => {
    await repo.removeAllocation(parsed.data.month, parsed.data.categoryId);
    return "Removed from this month's plan.";
  }, budgetPaths);
}

export async function copyPreviousBudgetAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const month = monthField.safeParse(formData.get("month"));
  if (!month.success) return failure("Invalid month.");
  return runAction(async ({ repo }) => {
    const copied = await repo.copyBudget(addMonths(startOfMonth(month.data), -1), month.data);
    await repo.audit("budget.copied", "budget", month.data);
    return copied ? `Copied ${copied} categor${copied === 1 ? "y" : "ies"} from last month.` : "Last month had no plan to copy.";
  }, budgetPaths);
}

// ---------------------------------------------------------------------------
// Bills
// ---------------------------------------------------------------------------

const billSchema = z.object({
  id: optionalId,
  name: text(80, "Bill name"),
  amount: money(),
  amountIsEstimate: checkbox,
  cadence: z.enum(["weekly", "biweekly", "monthly", "quarterly", "annual"]),
  nextDueDate: isoDateField,
  payFromAccountId: optionalId,
  categoryId: optionalId,
  autopay: checkbox,
});

export async function saveBillAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = billSchema.safeParse(formObject(formData, ["amountIsEstimate", "autopay"]));
  if (!parsed.success) return failure(firstError(parsed.error));
  const v = parsed.data;
  return runAction(async ({ repo }) => {
    const id = await repo.saveBill({
      id: v.id ?? undefined,
      name: v.name,
      amountMinor: v.amount,
      amountIsEstimate: v.amountIsEstimate,
      currency: "USD",
      cadence: v.cadence,
      nextDueDate: v.nextDueDate,
      payFromAccountId: v.payFromAccountId,
      categoryId: v.categoryId,
      autopay: v.autopay,
    });
    await repo.audit(v.id ? "bill.updated" : "bill.created", "bill", id);
    return v.id ? "Bill updated." : "Bill added.";
  }, budgetPaths);
}

// ---------------------------------------------------------------------------
// Income
// ---------------------------------------------------------------------------

const incomeSchema = z
  .object({
    id: optionalId,
    name: text(80, "Income name"),
    kind: z.enum(["salary", "freelance", "benefits", "other"]),
    expectedAmount: optionalMoney(),
    cadence: z.enum(["weekly", "biweekly", "semimonthly", "monthly", "irregular"]),
    nextExpectedDate: optionalIsoDate,
  })
  .refine((v) => v.cadence === "irregular" || v.nextExpectedDate, {
    message: "Add the next expected date, or choose Irregular.",
    path: ["nextExpectedDate"],
  });

export async function saveIncomeAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = incomeSchema.safeParse(formObject(formData));
  if (!parsed.success) return failure(firstError(parsed.error));
  const v = parsed.data;
  return runAction(async ({ repo }) => {
    const id = await repo.saveIncomeSource({
      id: v.id ?? undefined,
      name: v.name,
      kind: v.kind,
      expectedAmountMinor: v.expectedAmount,
      currency: "USD",
      cadence: v.cadence,
      nextExpectedDate: v.cadence === "irregular" ? null : v.nextExpectedDate,
    });
    await repo.audit(v.id ? "income.updated" : "income.created", "income_source", id);
    return v.id ? "Income updated." : "Income added.";
  }, budgetPaths);
}

// ---------------------------------------------------------------------------
// Savings goals & debt plans
// ---------------------------------------------------------------------------

const goalSchema = z.object({
  id: optionalId,
  name: text(80, "Goal name"),
  target: money(),
  saved: money({ allowZero: true }),
  monthlyContribution: money({ allowZero: true }),
  targetDate: optionalIsoDate,
});

export async function saveGoalAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = goalSchema.safeParse(formObject(formData));
  if (!parsed.success) return failure(firstError(parsed.error));
  const v = parsed.data;
  return runAction(async ({ repo }) => {
    const id = await repo.saveSavingsGoal({
      id: v.id ?? undefined,
      name: v.name,
      targetMinor: v.target,
      savedMinor: v.saved,
      monthlyContributionMinor: v.monthlyContribution,
      currency: "USD",
      targetDate: v.targetDate,
    });
    await repo.audit(v.id ? "goal.updated" : "goal.created", "savings_goal", id);
    return v.id ? "Goal updated." : "Goal added.";
  }, budgetPaths);
}

const aprField = z
  .string()
  .trim()
  .regex(/^\d{1,3}(\.\d{1,2})?$/, "Enter the APR as a percentage, like 23.99.")
  .transform((s) => {
    const [whole, frac = ""] = s.split(".");
    return Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  })
  .refine((bps) => bps <= 10_000, "APR can't exceed 100%.");

const debtSchema = z.object({
  id: optionalId,
  name: text(80, "Name"),
  accountId: optionalId,
  apr: aprField,
  minimumPayment: money({ allowZero: true }),
  plannedPayment: money({ allowZero: true }),
  paymentDueDay: z.union([z.literal("").transform(() => null), z.coerce.number().int().min(1).max(31)]),
});

export async function saveDebtAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = debtSchema.safeParse(formObject(formData));
  if (!parsed.success) return failure(firstError(parsed.error));
  const v = parsed.data;
  return runAction(async ({ repo }) => {
    const id = await repo.saveDebtGoal({
      id: v.id ?? undefined,
      name: v.name,
      accountId: v.accountId,
      aprBps: v.apr,
      minimumPaymentMinor: v.minimumPayment,
      plannedPaymentMinor: v.plannedPayment,
      paymentDueDay: v.paymentDueDay,
    });
    await repo.audit(v.id ? "debt.updated" : "debt.created", "debt_goal", id);
    return v.id ? "Debt plan updated." : "Debt plan added.";
  }, budgetPaths);
}

// ---------------------------------------------------------------------------
// Deletes (one action, explicit allowlist of kinds)
// ---------------------------------------------------------------------------

const deleteSchema = z.object({ id: idField, kind: z.enum(["bill", "income", "goal", "debt"]) });

export async function deletePlanItemAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = deleteSchema.safeParse(formObject(formData));
  if (!parsed.success) return failure("Invalid request.");
  const { id, kind } = parsed.data;
  return runAction(async ({ repo }) => {
    if (kind === "bill") await repo.deleteBill(id);
    if (kind === "income") await repo.deleteIncomeSource(id);
    if (kind === "goal") await repo.deleteSavingsGoal(id);
    if (kind === "debt") await repo.deleteDebtGoal(id);
    await repo.audit(`${kind}.deleted`, kind, id);
    return "Deleted.";
  }, budgetPaths);
}

// ---------------------------------------------------------------------------
// Profile settings that affect calculations
// ---------------------------------------------------------------------------

const profileSchema = z.object({
  displayName: z.string().trim().max(80).transform((s) => s || null),
  safetyBuffer: money({ allowZero: true }),
  includeExpectedIncome: checkbox,
  timezone: z.string().refine((tz) => {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  }, "Unknown time zone."),
});

export async function updateProfileAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = profileSchema.safeParse(formObject(formData, ["includeExpectedIncome"]));
  if (!parsed.success) return failure(firstError(parsed.error));
  const v = parsed.data;
  return runAction(async ({ repo }) => {
    await repo.updateProfile({
      displayName: v.displayName,
      safetyBufferMinor: v.safetyBuffer,
      includeExpectedIncome: v.includeExpectedIncome,
      timezone: v.timezone,
    });
    await repo.audit("profile.updated", "profile", null);
    return "Preferences saved.";
  }, ["/settings", ...budgetPaths]);
}
