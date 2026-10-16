import { minorToDecimalString } from "@/lib/finance/money";
import type { Account, Category, DebtGoal, IncomeSource, RecurringBill, SavingsGoal } from "@/lib/finance/types";
import { deletePlanItemAction, saveBillAction, saveDebtAction, saveGoalAction, saveIncomeAction } from "@/lib/actions/budget";
import { Checkbox, Field, MoneyInput, Select, TextInput } from "@/components/ui/field";
import { ActionForm, SubmitButton } from "@/components/forms/action-form";

/** Add/edit forms for planning items. One component per item type, used for both. */

const dec = (minor: number | null | undefined) => (minor == null ? "" : minorToDecimalString(minor, "USD"));

export function BillForm({
  bill,
  accounts,
  categories,
  idPrefix,
}: {
  bill?: RecurringBill;
  accounts: readonly Account[];
  categories: readonly Category[];
  idPrefix: string;
}) {
  const id = (f: string) => `${idPrefix}-${f}`;
  return (
    <ActionForm action={saveBillAction} className="space-y-4" resetOnSuccess={!bill}>
      {bill && <input type="hidden" name="id" value={bill.id} />}
      <Field label="Name" htmlFor={id("name")}>
        <TextInput id={id("name")} name="name" required maxLength={80} defaultValue={bill?.name} placeholder="e.g. Rent" />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Amount" htmlFor={id("amount")}>
          <MoneyInput id={id("amount")} name="amount" required defaultValue={dec(bill?.amountMinor)} />
        </Field>
        <Field label="Repeats" htmlFor={id("cadence")}>
          <Select id={id("cadence")} name="cadence" defaultValue={bill?.cadence ?? "monthly"}>
            <option value="weekly">Weekly</option>
            <option value="biweekly">Every 2 weeks</option>
            <option value="monthly">Monthly</option>
            <option value="quarterly">Quarterly</option>
            <option value="annual">Yearly</option>
          </Select>
        </Field>
      </div>
      <Field label="Next due date" htmlFor={id("nextDueDate")}>
        <TextInput id={id("nextDueDate")} name="nextDueDate" type="date" required defaultValue={bill?.nextDueDate} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Category" htmlFor={id("categoryId")} hint="Avoids double counting with your budget.">
          <Select id={id("categoryId")} name="categoryId" defaultValue={bill?.categoryId ?? ""}>
            <option value="">None</option>
            {categories.filter((c) => c.kind === "expense").map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </Select>
        </Field>
        <Field label="Paid from" htmlFor={id("payFromAccountId")}>
          <Select id={id("payFromAccountId")} name="payFromAccountId" defaultValue={bill?.payFromAccountId ?? ""}>
            <option value="">Not specified</option>
            {accounts.filter((a) => a.type === "depository" || a.type === "credit").map((a) => (
              <option key={a.id} value={a.id}>{a.nickname ?? a.name}</option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="grid sm:grid-cols-2">
        <Checkbox name="autopay" defaultChecked={bill?.autopay} label="Autopay" />
        <Checkbox name="amountIsEstimate" defaultChecked={bill?.amountIsEstimate} label="Amount varies (estimate)" />
      </div>
      <SubmitButton size="sm">{bill ? "Save bill" : "Add bill"}</SubmitButton>
    </ActionForm>
  );
}

export function IncomeForm({ source, idPrefix }: { source?: IncomeSource; idPrefix: string }) {
  const id = (f: string) => `${idPrefix}-${f}`;
  return (
    <ActionForm action={saveIncomeAction} className="space-y-4" resetOnSuccess={!source}>
      {source && <input type="hidden" name="id" value={source.id} />}
      <Field label="Name" htmlFor={id("name")}>
        <TextInput id={id("name")} name="name" required maxLength={80} defaultValue={source?.name} placeholder="e.g. Salary" />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Type" htmlFor={id("kind")}>
          <Select id={id("kind")} name="kind" defaultValue={source?.kind ?? "salary"}>
            <option value="salary">Salary</option>
            <option value="freelance">Freelance</option>
            <option value="benefits">Benefits</option>
            <option value="other">Other</option>
          </Select>
        </Field>
        <Field label="Frequency" htmlFor={id("cadence")}>
          <Select id={id("cadence")} name="cadence" defaultValue={source?.cadence ?? "biweekly"}>
            <option value="weekly">Weekly</option>
            <option value="biweekly">Every 2 weeks</option>
            <option value="semimonthly">Twice a month</option>
            <option value="monthly">Monthly</option>
            <option value="irregular">Irregular</option>
          </Select>
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Typical amount" htmlFor={id("expectedAmount")} hint="Leave blank if it varies.">
          <MoneyInput id={id("expectedAmount")} name="expectedAmount" defaultValue={dec(source?.expectedAmountMinor)} />
        </Field>
        <Field label="Next expected" htmlFor={id("nextExpectedDate")} hint="Not needed if irregular.">
          <TextInput id={id("nextExpectedDate")} name="nextExpectedDate" type="date" defaultValue={source?.nextExpectedDate ?? ""} />
        </Field>
      </div>
      <SubmitButton size="sm">{source ? "Save income" : "Add income"}</SubmitButton>
    </ActionForm>
  );
}

export function GoalForm({ goal, idPrefix }: { goal?: SavingsGoal; idPrefix: string }) {
  const id = (f: string) => `${idPrefix}-${f}`;
  return (
    <ActionForm action={saveGoalAction} className="space-y-4" resetOnSuccess={!goal}>
      {goal && <input type="hidden" name="id" value={goal.id} />}
      <Field label="Goal" htmlFor={id("name")}>
        <TextInput id={id("name")} name="name" required maxLength={80} defaultValue={goal?.name} placeholder="e.g. Emergency fund" />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Target" htmlFor={id("target")}>
          <MoneyInput id={id("target")} name="target" required defaultValue={dec(goal?.targetMinor)} />
        </Field>
        <Field label="Saved so far" htmlFor={id("saved")}>
          <MoneyInput id={id("saved")} name="saved" required defaultValue={dec(goal?.savedMinor ?? 0)} />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Monthly contribution" htmlFor={id("monthlyContribution")}>
          <MoneyInput id={id("monthlyContribution")} name="monthlyContribution" required defaultValue={dec(goal?.monthlyContributionMinor ?? 0)} />
        </Field>
        <Field label="Target date" htmlFor={id("targetDate")} hint="Optional">
          <TextInput id={id("targetDate")} name="targetDate" type="date" defaultValue={goal?.targetDate ?? ""} />
        </Field>
      </div>
      <SubmitButton size="sm">{goal ? "Save goal" : "Add goal"}</SubmitButton>
    </ActionForm>
  );
}

export function DebtForm({ debt, accounts, idPrefix }: { debt?: DebtGoal; accounts: readonly Account[]; idPrefix: string }) {
  const id = (f: string) => `${idPrefix}-${f}`;
  const apr = debt ? `${Math.floor(debt.aprBps / 100)}.${String(debt.aprBps % 100).padStart(2, "0")}` : "";
  return (
    <ActionForm action={saveDebtAction} className="space-y-4" resetOnSuccess={!debt}>
      {debt && <input type="hidden" name="id" value={debt.id} />}
      <Field label="Name" htmlFor={id("name")}>
        <TextInput id={id("name")} name="name" required maxLength={80} defaultValue={debt?.name} placeholder="e.g. Rewards Visa" />
      </Field>
      <Field label="Linked account" htmlFor={id("accountId")} hint="The balance owed comes from this account.">
        <Select id={id("accountId")} name="accountId" defaultValue={debt?.accountId ?? ""}>
          <option value="">None</option>
          {accounts.filter((a) => a.type === "credit" || a.type === "loan").map((a) => (
            <option key={a.id} value={a.id}>{a.nickname ?? a.name}</option>
          ))}
        </Select>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="APR (%)" htmlFor={id("apr")}>
          <TextInput id={id("apr")} name="apr" inputMode="decimal" required defaultValue={apr} placeholder="23.99" />
        </Field>
        <Field label="Due day" htmlFor={id("paymentDueDay")} hint="Day of month">
          <TextInput id={id("paymentDueDay")} name="paymentDueDay" type="number" min={1} max={31} defaultValue={debt?.paymentDueDay ?? ""} />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Minimum payment" htmlFor={id("minimumPayment")}>
          <MoneyInput id={id("minimumPayment")} name="minimumPayment" required defaultValue={dec(debt?.minimumPaymentMinor ?? 0)} />
        </Field>
        <Field label="Planned payment" htmlFor={id("plannedPayment")}>
          <MoneyInput id={id("plannedPayment")} name="plannedPayment" required defaultValue={dec(debt?.plannedPaymentMinor ?? 0)} />
        </Field>
      </div>
      <SubmitButton size="sm">{debt ? "Save plan" : "Add debt plan"}</SubmitButton>
    </ActionForm>
  );
}

export function DeleteItemForm({ id, kind, label }: { id: string; kind: "bill" | "income" | "goal" | "debt"; label: string }) {
  return (
    <ActionForm action={deletePlanItemAction}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="kind" value={kind} />
      <SubmitButton size="sm" variant="ghost" pendingLabel="Deleting…">
        Delete {label}
      </SubmitButton>
    </ActionForm>
  );
}

/** Collapsible "Edit" panel used inside list items. */
export function EditPanel({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <details className="group mt-2">
      <summary className="inline-flex min-h-9 cursor-pointer list-none items-center rounded-full px-1 text-sm font-medium text-accent-ink">
        Edit<span className="sr-only"> {label}</span>
      </summary>
      <div className="mt-2 space-y-2 rounded-2xl border border-border bg-surface-muted/50 p-4">{children}</div>
    </details>
  );
}
