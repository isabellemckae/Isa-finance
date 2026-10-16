import { loadPageData } from "@/lib/data/load";
import { PageHeader } from "@/components/layout/page-header";
import { DemoEditsNote } from "@/components/layout/demo-edits-note";
import { ImportFlow } from "@/components/transactions/import-flow";

export const metadata = { title: "Import CSV" };

export default async function ImportPage({ searchParams }: PageProps<"/transactions/import">) {
  const { data, isDemo } = await loadPageData();
  const params = await searchParams;
  const requested = typeof params.account === "string" ? params.account : null;
  const accounts = data.accounts.map((a) => ({
    id: a.id,
    label: `${a.nickname ?? a.name}${a.mask ? ` ••${a.mask}` : ""} · ${a.institutionName}`,
    currency: a.currency,
  }));
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        back={{ href: "/transactions", label: "Activity" }}
        title="Import transactions"
        description="For accounts your bank can't connect. Re-importing the same file never creates duplicates."
      />
      <DemoEditsNote show={isDemo} />
      {accounts.length === 0 ? (
        <p className="text-sm text-muted-foreground">Add an account first.</p>
      ) : (
        <ImportFlow
          accounts={accounts}
          categories={data.categories.filter((c) => c.kind !== "transfer").map((c) => ({ id: c.id, name: c.name }))}
          defaultAccountId={accounts.some((a) => a.id === requested) ? requested : null}
        />
      )}
    </div>
  );
}
