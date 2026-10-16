import { loadPageData } from "@/lib/data/load";
import { MANUAL_ACCOUNT_KINDS } from "@/lib/account-kinds";
import { createManualAccountAction } from "@/lib/actions/accounts";
import { PageHeader } from "@/components/layout/page-header";
import { DemoEditsNote } from "@/components/layout/demo-edits-note";
import { Card } from "@/components/ui/card";
import { Field, MoneyInput, Select, TextInput } from "@/components/ui/field";
import { ActionForm, SubmitButton } from "@/components/forms/action-form";

export const metadata = { title: "Add manual account" };

export default async function NewAccountPage() {
  const { isDemo } = await loadPageData();
  return (
    <div className="mx-auto max-w-xl space-y-6">
      <PageHeader
        back={{ href: "/accounts", label: "Accounts" }}
        title="Add a manual account"
        description="For cash, accounts your bank can't link, or anything you'd like to track by hand."
      />
      <Card>
        <ActionForm action={createManualAccountAction} className="space-y-5">
          <Field label="Account name" htmlFor="name">
            <TextInput id="name" name="name" required maxLength={80} placeholder="e.g. Credit union savings" />
          </Field>
          <Field label="Nickname" htmlFor="nickname" hint="Optional">
            <TextInput id="nickname" name="nickname" maxLength={60} />
          </Field>
          <Field label="Type" htmlFor="kind">
            <Select id="kind" name="kind" required defaultValue="depository:checking">
              {MANUAL_ACCOUNT_KINDS.map((k) => (
                <option key={k.value} value={k.value}>
                  {k.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="Current balance"
            htmlFor="currentBalance"
            hint="For credit cards and loans, enter the amount you owe."
          >
            <MoneyInput id="currentBalance" name="currentBalance" required placeholder="0.00" />
          </Field>
          <Field label="Credit limit" htmlFor="creditLimit" hint="Credit cards only. Optional.">
            <MoneyInput id="creditLimit" name="creditLimit" placeholder="0.00" />
          </Field>
          <SubmitButton className="w-full sm:w-auto">Add account</SubmitButton>
          <DemoEditsNote show={isDemo} />
        </ActionForm>
      </Card>
    </div>
  );
}
