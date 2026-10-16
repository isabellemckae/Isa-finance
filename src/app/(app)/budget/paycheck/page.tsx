import Link from "next/link";
import { Wallet } from "lucide-react";
import { loadPageData } from "@/lib/data/load";
import { computeBudgetPerformance } from "@/lib/finance/budget";
import { formatDate, startOfMonth } from "@/lib/finance/dates";
import { ratioBps } from "@/lib/finance/money";
import { nextPaychecks, planPaycheckAllocation } from "@/lib/finance/planning";
import { percentFromBps } from "@/lib/format";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Money } from "@/components/ui/money";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";

export const metadata = { title: "Paycheck plan" };

export default async function PaycheckPage() {
  const { data, transactions, asOf, currency } = await loadPageData();
  const next = nextPaychecks(data.incomeSources, asOf);

  if (!next || next.amountMinor === null) {
    return (
      <div className="space-y-6">
        <PageHeader title="Paycheck plan" />
        <EmptyState icon={Wallet} title="Add a regular paycheck first">
          Paycheck planning needs a salary source with an amount and schedule.{" "}
          <Link href="/budget/income" className="font-medium text-accent-ink">Add income</Link>
        </EmptyState>
      </div>
    );
  }

  const month = startOfMonth(next.date);
  const budget = data.budgets.find((b) => b.month === month && b.currency === currency);
  const perf = budget ? computeBudgetPerformance(budget, transactions, data.categories) : null;
  const plan = planPaycheckAllocation({
    paycheckDate: next.date,
    paycheckMinor: next.amountMinor,
    nextPaycheckDate: next.nextDate,
    paychecksThisMonth: next.paychecksThisMonth,
    bills: data.bills,
    budget: perf,
    savingsGoals: data.savingsGoals,
    debtGoals: data.debtGoals,
  });
  const shortfall = plan.unallocatedMinor < 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Paycheck plan"
        description={`Where your ${formatDate(plan.paycheckDate, { weekday: "long", month: "long", day: "numeric" })} paycheck goes, until the next one on ${formatDate(next.nextDate, { month: "long", day: "numeric" })}.`}
      />

      <Card className="bg-primary text-primary-foreground">
        <p className="text-xs font-medium uppercase tracking-[0.18em] opacity-80">{next.source.name}</p>
        <p className="mt-2 font-display text-5xl tracking-tight">
          <Money minor={plan.paycheckMinor} currency={currency} options={{ wholeUnits: true }} />
        </p>
        <p className="mt-2 text-sm opacity-80">
          {shortfall ? (
            <>
              This plan needs <Money minor={-plan.unallocatedMinor} currency={currency} /> more than this paycheck. Consider
              trimming flexible spending or moving a savings contribution.
            </>
          ) : (
            <>
              <Money minor={plan.unallocatedMinor} currency={currency} /> is left unassigned after bills, essentials, savings and debt.
            </>
          )}
        </p>
      </Card>

      <Card aria-labelledby="buckets-title">
        <CardHeader>
          <div>
            <CardTitle id="buckets-title">Allocation</CardTitle>
            <CardDescription>Bars show each share of this paycheck.</CardDescription>
          </div>
        </CardHeader>
        <ul className="space-y-5">
          {plan.buckets.map((b) => {
            const share = plan.paycheckMinor > 0 ? ratioBps(b.amountMinor, plan.paycheckMinor) : 0;
            return (
              <li key={b.key}>
                <div className="mb-1.5 flex items-baseline justify-between gap-3">
                  <span className="text-sm font-medium">{b.label}</span>
                  <span className="text-sm">
                    <Money minor={b.amountMinor} currency={currency} className="font-medium" />
                    <span className="ml-1 text-xs text-muted-foreground">{percentFromBps(share)}</span>
                  </span>
                </div>
                <div className="h-2.5 rounded-full bg-surface-muted" aria-hidden>
                  <div className="h-full rounded-full bg-chart-income" style={{ width: `${Math.min(share / 100, 100)}%` }} />
                </div>
                {b.items.length > 0 ? (
                  <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                    {b.items.map((i) => (
                      <li key={`${i.label}-${i.detail ?? ""}`} className="flex justify-between gap-3">
                        <span>
                          {i.label}
                          {i.detail && ` · due ${formatDate(i.detail)}`}
                        </span>
                        <Money minor={i.amountMinor} currency={currency} />
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-xs text-muted-foreground">Nothing due from this paycheck.</p>
                )}
              </li>
            );
          })}
          <li className={cn("flex items-baseline justify-between gap-3 border-t border-border pt-4", shortfall && "text-attention")}>
            <span className="text-sm font-medium">{shortfall ? "Shortfall" : "Unassigned"}</span>
            <Money minor={plan.unallocatedMinor} currency={currency} className="font-display text-xl" />
          </li>
        </ul>
      </Card>

      <Card className="text-xs text-muted-foreground">
        <p className="mb-1 font-medium text-foreground">Assumptions</p>
        <ul className="list-disc space-y-1 pl-5">
          {plan.assumptions.map((a) => (
            <li key={a}>{a}</li>
          ))}
          <li>Amounts come from your budget, bills, savings goals and debt plans. Edit those to change this plan.</li>
        </ul>
      </Card>
    </div>
  );
}
