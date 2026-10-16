import { CalendarClock, Repeat } from "lucide-react";
import { loadPageData } from "@/lib/data/load";
import { addDays, formatDate } from "@/lib/finance/dates";
import { addMinor } from "@/lib/finance/money";
import { monthlyEquivalentMinor, upcomingBills } from "@/lib/finance/schedule";
import { PageHeader } from "@/components/layout/page-header";
import { DemoEditsNote } from "@/components/layout/demo-edits-note";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DataStatus } from "@/components/ui/data-status";
import { Money } from "@/components/ui/money";
import { EmptyState } from "@/components/ui/empty-state";
import { BillForm, DeleteItemForm, EditPanel } from "@/components/budget/plan-forms";

export const metadata = { title: "Bills" };

const CADENCE: Record<string, string> = {
  weekly: "Weekly",
  biweekly: "Every 2 weeks",
  monthly: "Monthly",
  quarterly: "Quarterly",
  annual: "Yearly",
};

export default async function BillsPage() {
  const { data, asOf, currency, isDemo } = await loadPageData();
  const next30 = upcomingBills(data.bills, asOf, addDays(asOf, 30));
  const total30 = next30.reduce((s, b) => addMinor(s, b.amountMinor), 0);
  const monthly = data.bills.reduce((s, b) => addMinor(s, monthlyEquivalentMinor(b)), 0);
  const accountName = new Map(data.accounts.map((a) => [a.id, a.nickname ?? a.name]));
  const categoryName = new Map(data.categories.map((c) => [c.id, c.name]));

  return (
    <div className="space-y-6">
      <PageHeader title="Recurring bills" description="Bills are reserved in safe-to-spend until their due date." />

      <section className="grid grid-cols-2 gap-3 sm:gap-4">
        <div className="rounded-[var(--radius-card)] border border-border bg-surface p-4 shadow-card">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Next 30 days</p>
          <p className="mt-1 font-display text-2xl"><Money minor={total30} currency={currency} options={{ wholeUnits: true }} /></p>
          <p className="text-xs text-muted-foreground">{next30.length} payment{next30.length === 1 ? "" : "s"}</p>
        </div>
        <div className="rounded-[var(--radius-card)] border border-border bg-surface p-4 shadow-card">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Per month</p>
          <p className="mt-1 font-display text-2xl"><Money minor={monthly} currency={currency} options={{ wholeUnits: true }} /></p>
          <p className="text-xs text-muted-foreground">All bills, monthly equivalent</p>
        </div>
      </section>

      <Card aria-labelledby="upcoming-title">
        <CardHeader>
          <div>
            <CardTitle id="upcoming-title">Coming up</CardTitle>
            <CardDescription>Through {formatDate(addDays(asOf, 30), { month: "long", day: "numeric" })}</CardDescription>
          </div>
          <CalendarClock className="size-5 text-accent-ink" aria-hidden />
        </CardHeader>
        {next30.length === 0 ? (
          <p className="text-sm text-muted-foreground">No bills due in the next 30 days.</p>
        ) : (
          <ul className="divide-y divide-border">
            {next30.map((b) => (
              <li key={`${b.billId}-${b.dueDate}`} className="flex items-center justify-between gap-3 py-3">
                <div className="flex items-center gap-3">
                  <span className="flex size-11 shrink-0 flex-col items-center justify-center rounded-xl bg-surface-muted leading-none">
                    <span className="text-[10px] uppercase text-muted-foreground">{formatDate(b.dueDate, { month: "short" })}</span>
                    <span className="font-display text-base">{Number(b.dueDate.slice(8, 10))}</span>
                  </span>
                  <div>
                    <p className="text-sm font-medium">{b.name}</p>
                    <p className="text-xs text-muted-foreground">{b.autopay ? "Autopay" : "Pay manually"}</p>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <Money minor={b.amountMinor} currency={b.currency} className="text-sm font-medium" />
                  {b.amountIsEstimate && <DataStatus kind="estimated" />}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card aria-labelledby="all-bills-title">
        <CardHeader>
          <CardTitle id="all-bills-title">All bills</CardTitle>
          <Repeat className="size-5 text-accent-ink" aria-hidden />
        </CardHeader>
        {data.bills.length === 0 ? (
          <EmptyState icon={Repeat} title="No recurring bills yet">Add rent, utilities and subscriptions below.</EmptyState>
        ) : (
          <ul className="divide-y divide-border">
            {[...data.bills].sort((a, b) => a.nextDueDate.localeCompare(b.nextDueDate)).map((b) => (
              <li key={b.id} className="py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{b.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {CADENCE[b.cadence]} · next {formatDate(b.nextDueDate)}
                      {b.categoryId && ` · ${categoryName.get(b.categoryId)}`}
                      {b.payFromAccountId && ` · from ${accountName.get(b.payFromAccountId)}`}
                    </p>
                    <div className="mt-1 flex gap-1.5">
                      {b.autopay && <Badge variant="positive">Autopay</Badge>}
                      {b.amountIsEstimate && <DataStatus kind="estimated" />}
                    </div>
                  </div>
                  <Money minor={b.amountMinor} currency={b.currency} className="shrink-0 text-sm font-medium" />
                </div>
                <EditPanel label={b.name}>
                  <BillForm bill={b} accounts={data.accounts} categories={data.categories} idPrefix={`bill-${b.id}`} />
                  <DeleteItemForm id={b.id} kind="bill" label="bill" />
                </EditPanel>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card aria-labelledby="add-bill-title">
        <CardHeader>
          <CardTitle id="add-bill-title">Add a bill</CardTitle>
        </CardHeader>
        <BillForm accounts={data.accounts} categories={data.categories} idPrefix="new-bill" />
        <div className="mt-3"><DemoEditsNote show={isDemo} /></div>
      </Card>
    </div>
  );
}
