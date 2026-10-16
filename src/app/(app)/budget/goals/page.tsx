import { CreditCard, PiggyBank } from "lucide-react";
import { loadPageData } from "@/lib/data/load";
import { latestSnapshots } from "@/lib/finance/balances";
import { addMonths, formatDate } from "@/lib/finance/dates";
import { savingsProgress, simulateDebtPayoff } from "@/lib/finance/goals";
import { percentFromBps } from "@/lib/format";
import { formatMoney } from "@/lib/finance/money";
import { PageHeader } from "@/components/layout/page-header";
import { DemoEditsNote } from "@/components/layout/demo-edits-note";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Money } from "@/components/ui/money";
import { Progress } from "@/components/ui/progress";
import { EmptyState } from "@/components/ui/empty-state";
import { DebtForm, DeleteItemForm, EditPanel, GoalForm } from "@/components/budget/plan-forms";

export const metadata = { title: "Goals & debt" };

export default async function GoalsPage() {
  const { data, asOf, currency, isDemo } = await loadPageData();
  const balances = latestSnapshots(data.balances);

  return (
    <div className="space-y-6">
      <PageHeader title="Goals & debt" description="Savings progress and payoff plans, computed month by month." />

      <section aria-labelledby="savings-title" className="space-y-3">
        <h2 id="savings-title" className="flex items-center gap-2 px-1 font-display text-xl">
          <PiggyBank className="size-5 text-accent-ink" aria-hidden /> Savings goals
        </h2>
        {data.savingsGoals.length === 0 && <EmptyState icon={PiggyBank} title="No savings goals yet" />}
        <div className="grid gap-4 lg:grid-cols-2">
          {data.savingsGoals.map((g) => {
            const p = savingsProgress(g, asOf);
            return (
              <Card key={g.id}>
                <CardHeader className="mb-2">
                  <div>
                    <CardTitle>{g.name}</CardTitle>
                    <CardDescription>
                      <Money minor={g.monthlyContributionMinor} currency={g.currency} /> per month
                      {g.targetDate && ` · target ${formatDate(g.targetDate, { month: "short", year: "numeric" })}`}
                    </CardDescription>
                  </div>
                  {p.onTrack === true && p.remainingMinor > 0 && <Badge variant="positive">On track</Badge>}
                  {p.onTrack === false && <Badge variant="attention">Behind</Badge>}
                  {p.remainingMinor === 0 && <Badge variant="positive">Funded</Badge>}
                </CardHeader>
                <p className="font-display text-2xl">
                  <Money minor={g.savedMinor} currency={g.currency} options={{ wholeUnits: true }} />
                  <span className="ml-2 text-sm text-muted-foreground">
                    of <Money minor={g.targetMinor} currency={g.currency} options={{ wholeUnits: true }} />
                  </span>
                </p>
                <Progress className="mt-2" valueBps={p.progressBps} label={`${g.name}: ${percentFromBps(p.progressBps)} saved`} />
                <p className="mt-2 text-xs text-muted-foreground">
                  {p.remainingMinor === 0
                    ? "Goal reached."
                    : p.projectedDate
                      ? `${percentFromBps(p.progressBps)} saved · on pace for ${formatDate(p.projectedDate, { month: "long", year: "numeric" })} (${p.monthsToGoal} months)`
                      : "Add a monthly contribution to see a projected date."}
                </p>
                <EditPanel label={g.name}>
                  <GoalForm goal={g} idPrefix={`goal-${g.id}`} />
                  <DeleteItemForm id={g.id} kind="goal" label="goal" />
                </EditPanel>
              </Card>
            );
          })}
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Add a savings goal</CardTitle>
          </CardHeader>
          <GoalForm idPrefix="new-goal" />
        </Card>
      </section>

      <section aria-labelledby="debt-title" className="space-y-3">
        <h2 id="debt-title" className="flex items-center gap-2 px-1 font-display text-xl">
          <CreditCard className="size-5 text-accent-ink" aria-hidden /> Debt payoff
        </h2>
        {data.debtGoals.length === 0 && <EmptyState icon={CreditCard} title="No debt plans" />}
        <div className="grid gap-4 lg:grid-cols-2">
          {data.debtGoals.map((d) => {
            const snapshot = d.accountId ? balances.get(d.accountId) : undefined;
            const balance = snapshot?.currentMinor ?? null;
            const planned = balance !== null ? simulateDebtPayoff({ balanceMinor: balance, aprBps: d.aprBps, monthlyPaymentMinor: d.plannedPaymentMinor }) : null;
            const minimum = balance !== null ? simulateDebtPayoff({ balanceMinor: balance, aprBps: d.aprBps, monthlyPaymentMinor: d.minimumPaymentMinor }) : null;
            return (
              <Card key={d.id}>
                <CardHeader className="mb-2">
                  <div>
                    <CardTitle>{d.name}</CardTitle>
                    <CardDescription>
                      {formatApr(d.aprBps)} APR
                      {d.paymentDueDay && ` · due on day ${d.paymentDueDay}`}
                    </CardDescription>
                  </div>
                </CardHeader>
                {balance === null ? (
                  <p className="text-sm text-muted-foreground">Link this plan to a card or loan account to simulate payoff.</p>
                ) : (
                  <>
                    <p className="font-display text-2xl">
                      <Money minor={balance} currency={currency} />
                      <span className="ml-2 text-sm text-muted-foreground">owed</span>
                    </p>
                    <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
                      <PayoffStat label={`Planned · ${fmt(d.plannedPaymentMinor, currency)}/mo`} result={planned} asOf={asOf} currency={currency} />
                      <PayoffStat label={`Minimum · ${fmt(d.minimumPaymentMinor, currency)}/mo`} result={minimum} asOf={asOf} currency={currency} />
                    </dl>
                    {planned?.paysOff && minimum?.paysOff && minimum.totalInterestMinor > planned.totalInterestMinor && (
                      <p className="mt-3 rounded-2xl bg-positive-soft px-3 py-2 text-xs text-positive">
                        Your planned payment saves <Money minor={minimum.totalInterestMinor - planned.totalInterestMinor} currency={currency} /> in
                        interest and {minimum.months - planned.months} months versus paying the minimum.
                      </p>
                    )}
                    {minimum && !minimum.paysOff && (
                      <p className="mt-3 rounded-2xl bg-attention-soft px-3 py-2 text-xs text-attention">
                        The minimum payment {minimum.paymentTooLow ? "doesn't cover the monthly interest" : "takes more than 50 years"}, so the balance never clears.
                      </p>
                    )}
                    <p className="mt-2 text-xs text-muted-foreground">Assumes no new charges, a fixed APR, and interest compounded monthly.</p>
                  </>
                )}
                <EditPanel label={d.name}>
                  <DebtForm debt={d} accounts={data.accounts} idPrefix={`debt-${d.id}`} />
                  <DeleteItemForm id={d.id} kind="debt" label="debt plan" />
                </EditPanel>
              </Card>
            );
          })}
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Add a debt plan</CardTitle>
          </CardHeader>
          <DebtForm accounts={data.accounts} idPrefix="new-debt" />
          <div className="mt-3"><DemoEditsNote show={isDemo} /></div>
        </Card>
      </section>
    </div>
  );
}

const fmt = (minor: number, currency: string) => formatMoney(minor, currency, { wholeUnits: true });
const formatApr = (bps: number) => `${Math.floor(bps / 100)}.${String(bps % 100).padStart(2, "0")}%`;

function PayoffStat({
  label,
  result,
  asOf,
  currency,
}: {
  label: string;
  result: ReturnType<typeof simulateDebtPayoff> | null;
  asOf: string;
  currency: string;
}) {
  return (
    <div className="rounded-2xl bg-surface-muted px-3 py-2">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd>
        {!result || !result.paysOff ? (
          <span className="text-attention">Doesn&apos;t pay off</span>
        ) : (
          <>
            <span className="font-medium">{formatDate(addMonths(asOf, result.months), { month: "short", year: "numeric" })}</span>
            <span className="block text-xs text-muted-foreground">
              {result.months} mo · <Money minor={result.totalInterestMinor} currency={currency} /> interest
            </span>
          </>
        )}
      </dd>
    </div>
  );
}
