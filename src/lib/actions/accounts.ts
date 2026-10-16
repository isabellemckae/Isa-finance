"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { checkbox, formObject, idField, money, optionalMoney, optionalText, text } from "@/lib/forms";
import { firstError } from "@/lib/forms";
import { MANUAL_ACCOUNT_KINDS } from "@/lib/account-kinds";
import { failure, runAction, type ActionState } from "./run";

const accountPaths = (id?: string) => ["/accounts", ...(id ? [`/accounts/${id}`] : []), "/transactions", "/budget"];

const updateSchema = z.object({
  id: idField,
  nickname: optionalText(60, "Nickname"),
  isHidden: checkbox,
});

export async function updateAccountAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = updateSchema.safeParse(formObject(formData, ["isHidden"]));
  if (!parsed.success) return failure(firstError(parsed.error));
  const { id, nickname, isHidden } = parsed.data;
  return runAction(async ({ repo }) => {
    await repo.updateAccount(id, { nickname, isHidden });
    await repo.audit("account.updated", "account", id);
    return "Account updated.";
  }, accountPaths(id));
}

const createSchema = z.object({
  name: text(80, "Account name"),
  nickname: optionalText(60, "Nickname"),
  kind: z.enum(MANUAL_ACCOUNT_KINDS.map((k) => k.value) as [string, ...string[]], { message: "Choose an account type." }),
  currentBalance: money({ allowZero: true, allowNegative: true }),
  creditLimit: optionalMoney(),
});

export async function createManualAccountAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = createSchema.safeParse(formObject(formData));
  if (!parsed.success) return failure(firstError(parsed.error));
  const v = parsed.data;
  const kind = MANUAL_ACCOUNT_KINDS.find((k) => k.value === v.kind)!;
  let id = "";
  const result = await runAction(async ({ repo }) => {
    id = await repo.createManualAccount({
      name: v.name,
      nickname: v.nickname,
      type: kind.type,
      subtype: kind.subtype,
      currency: "USD",
      currentMinor: v.currentBalance,
      creditLimitMinor: kind.type === "credit" ? v.creditLimit : null,
    });
    await repo.audit("account.created_manual", "account", id);
    return "Account added.";
  }, accountPaths());
  if (result.ok) redirect(`/accounts/${id}`);
  return result;
}

const balanceSchema = z.object({
  id: idField,
  currentBalance: money({ allowZero: true, allowNegative: true }),
  creditLimit: optionalMoney(),
});

export async function recordBalanceAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = balanceSchema.safeParse(formObject(formData));
  if (!parsed.success) return failure(firstError(parsed.error));
  const v = parsed.data;
  return runAction(async ({ repo, now }) => {
    await repo.recordManualBalance(v.id, { currentMinor: v.currentBalance, creditLimitMinor: v.creditLimit }, now);
    await repo.audit("account.balance_recorded", "account", v.id);
    return "Balance updated.";
  }, accountPaths(v.id));
}

const deleteSchema = z.object({ id: idField, confirm: z.literal("delete", { message: 'Type "delete" to confirm.' }) });

export async function deleteManualAccountAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = deleteSchema.safeParse(formObject(formData));
  if (!parsed.success) return failure(firstError(parsed.error));
  const result = await runAction(async ({ repo }) => {
    await repo.deleteManualAccount(parsed.data.id);
    await repo.audit("account.deleted_manual", "account", parsed.data.id);
    return "Account deleted.";
  }, accountPaths());
  if (result.ok) redirect("/accounts");
  return result;
}
