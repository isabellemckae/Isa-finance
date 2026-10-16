import { Banknote, Shuffle } from "lucide-react";
import { loadPageData } from "@/lib/data/load";
import { formatDate, formatMonth, startOfMonth } from "@/lib/finance/dates";
import { planIncomeForMonth } from "@/lib/finance/planning";
import { PageHeader } from "@/components/layout/page-header";
import { DemoEditsNote } from "@/components/layout/demo-edits-note";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Money } from "@/components/ui/money";
import { Progress } from "@/components/ui/progress";
import { EmptyState } from "@/components/ui/empty-state";
import { DeleteItemForm, EditPanel, IncomeForm } from "@/components/budget/plan-forms";
import { ratioBps } from "@/lib/finance/money";

export const metadata = { title: "Income" };

const CADENCE: Record<string, string> = {
  weekly: "Weekly",
  biweekly: "Every 2 weeks",
  semimonthly: "Twice a month",
  monthly: "Monthly",
  irregular: "Irregular",
};

export default async function IncomePage() {
  const { data, transactions, asOf, currency, isDemo } = await loadPageData();
  const plan = planIncomeForMonth(data.incomeSources, transactions, startOfMonth(asOf));
  const received = Math.min(ratioBps(plan.receivedMinor, plan.expectedMinor || 1), 10_000);

  return (
    <div className="space-y-6">
      <PageHeader title="Income" description="Multiple and irregular income sources. Only income that has arrived counts in safe-to-spend, unless you opt in under Settings." />

      <Card aria-labelledby="month-income-title">
        <CardHeader>
          <div>
            <CardTitle id="month-income-title">{formatMonth(asOf)}</CardTitle>
            <CardDescription>Expected from regular sources vs. received so far (all income categories).</CardDescription>
          </div>
          <Banknote className="size-5 text-accent-ink" aria-hidden />
        </CardHeader>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <p className="font-display text-3xl tracking-tight">
            <Money minor={plan.receivedMinor} currency={currency} />
            <span className="ml-2 text-base text-muted-foreground">
              of <Money minor={plan.expectedMinor} currency={currency} /> expected
            </span>
          </p>
        </div>
        <Progress className="mt-3" valueBps={received} label="Share of expected income received" />
        {plan.deposits.length > 0 && (
          <ul className="mt-4 divide-y divide-border text-sm">
            {plan.deposits.map((d) => (
              <li key={`${d.sourceId}-${d.date}`} className="flex justify-between gap-3 py-2.5">
                <span>
                  {d.name} <span className="text-muted-foreground">· {formatDate(d.date)}</span>
                  {d.date <= asOf ? <Badge variant="neutral" className="ml-2">Date passed</Badge> : null}
                </span>
                {d.amountMinor !== null ? <Money minor={d.amountMinor} currency={currency} /> : <span className="text-muted-foreground">Varies</span>}
              </li>
            ))}
          </ul>
        )}
        {plan.unplannedSources.length > 0 && (
          <p className="mt-3 flex items-start gap-2 text-xs text-muted-foreground">
            <Shuffle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            Not included in the expected total because the amount or timing varies: {plan.unplannedSources.join(", ")}.
          </p>
        )}
      </Card>

      <Card aria-labelledby="sources-title">
        <CardHeader>
          <CardTitle id="sources-title">Sources</CardTitle>
        </CardHeader>
        {data.incomeSources.length === 0 ? (
          <EmptyState icon={Banknote} title="No income sources yet">Add your paycheck to plan paycheck allocations.</EmptyState>
        ) : (
          <ul className="divide-y divide-border">
            {data.incomeSources.map((s) => (
              <li key={s.id} className="py-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium">{s.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {CADENCE[s.cadence]}
                      {s.nextExpectedDate && ` · next ${formatDate(s.nextExpectedDate)}`}
                    </p>
                  </div>
                  {s.expectedAmountMinor !== null ? (
                    <Money minor={s.expectedAmountMinor} currency={s.currency} className="text-sm font-medium" />
                  ) : (
                    <Badge variant="info">Varies</Badge>
                  )}
                </div>
                <EditPanel label={s.name}>
                  <IncomeForm source={s} idPrefix={`income-${s.id}`} />
                  <DeleteItemForm id={s.id} kind="income" label="income source" />
                </EditPanel>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card aria-labelledby="add-income-title">
        <CardHeader>
          <CardTitle id="add-income-title">Add income</CardTitle>
        </CardHeader>
        <IncomeForm idPrefix="new-income" />
        <div className="mt-3"><DemoEditsNote show={isDemo} /></div>
      </Card>
    </div>
  );
}
