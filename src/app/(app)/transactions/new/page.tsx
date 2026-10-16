import Link from "next/link";
import { loadPageData } from "@/lib/data/load";
import { addManualTransactionAction } from "@/lib/actions/transactions";
import { PageHeader } from "@/components/layout/page-header";
import { DemoEditsNote } from "@/components/layout/demo-edits-note";
import { Card } from "@/components/ui/card";
import { Field, MoneyInput, Select, TextInput } from "@/components/ui/field";
import { ActionForm, SubmitButton } from "@/components/forms/action-form";

export const metadata = { title: "Add transaction" };

export default async function NewTransactionPage({ searchParams }: PageProps<"/transactions/new">) {
  const { data, asOf, isDemo } = await loadPageData();
  const params = await searchParams;
  const manual = data.accounts.filter((a) => a.source === "manual");
  const requested = typeof params.account === "string" && manual.some((a) => a.id === params.account) ? params.account : manual[0]?.id;

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <PageHeader
        back={{ href: "/transactions", label: "Activity" }}
        title="Add a transaction"
        description="For manual accounts like cash. Bank-connected accounts sync their own transactions."
      />
      {manual.length === 0 ? (
        <Card>
          <p className="text-sm text-muted-foreground">
            You don&apos;t have a manual account yet. <Link href="/accounts/new" className="font-medium text-accent-ink">Add one</Link> first.
          </p>
        </Card>
      ) : (
        <Card>
          <ActionForm action={addManualTransactionAction} className="space-y-5">
            <Field label="Account" htmlFor="accountId">
              <Select id="accountId" name="accountId" defaultValue={requested}>
                {manual.map((a) => (
                  <option key={a.id} value={a.id}>{a.nickname ?? a.name}</option>
                ))}
              </Select>
            </Field>
            <Field label="Description" htmlFor="description">
              <TextInput id="description" name="description" required maxLength={200} placeholder="e.g. Farmers market" />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Amount" htmlFor="amount">
                <MoneyInput id="amount" name="amount" required placeholder="0.00" />
              </Field>
              <Field label="Direction" htmlFor="direction">
                <Select id="direction" name="direction" defaultValue="out">
                  <option value="out">Money out</option>
                  <option value="in">Money in</option>
                </Select>
              </Field>
            </div>
            <Field label="Date" htmlFor="date">
              <TextInput id="date" name="date" type="date" required defaultValue={asOf} max={asOf} />
            </Field>
            <Field label="Category" htmlFor="categoryId">
              <Select id="categoryId" name="categoryId" defaultValue="">
                <option value="">Uncategorized</option>
                {data.categories.filter((c) => c.kind !== "transfer").map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </Select>
            </Field>
            <SubmitButton>Add transaction</SubmitButton>
            <DemoEditsNote show={isDemo} />
          </ActionForm>
        </Card>
      )}
    </div>
  );
}
