import Link from "next/link";
import { loadPageData } from "@/lib/data/load";
import { buildBriefing, type BriefingPeriod } from "@/lib/finance/briefing";
import { formatDate } from "@/lib/finance/dates";
import { formatMoney } from "@/lib/finance/money";
import { relativeTime, percentFromBps } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DataStatus } from "@/components/ui/data-status";
import { Money } from "@/components/ui/money";
import { Progress } from "@/components/ui/progress";
import { InsightList } from "@/components/dashboard/insight-list";

export const metadata = { title: "Briefing" };

const LABELS: Record<BriefingPeriod, { title: string; current: string; previous: string }> = {
  week: { title: "Weekly briefing", current: "This week", previous: "Same days last week" },
  month: { title: "Monthly briefing", current: "This month", previous: "Same days last month" },
};

function range(start: string, end: string) {
  return start === end ? formatDate(start) : `${formatDate(start)} – ${formatDate(end)}`;
}

export default async function BriefingPage({ searchParams }: PageProps<"/cfo/briefing">) {
  const { data, transactions, now, asOf, currency, isDemo } = await loadPageData();
  const params = await searchParams;
  const period: BriefingPeriod = params.period === "month" ? "month" : "week";
  const b = buildBriefing({ data, transactions, now, asOf, period });
  const label = LABELS[period];

  const stats = [
    { name: "Income", current: b.income.currentMinor, previous: b.income.previousMinor },
    { name: "Spending", current: b.spending.currentMinor, previous: b.spending.previousMinor },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title={label.title}
        description={`${label.current}: ${range(b.range.start, b.range.end)}${b.isPartial ? " (so far)" : ""}`}
        actions={isDemo ? <Badge variant="blush">Demo data</Badge> : undefined}
      />

      <nav aria-label="Briefing period" className="inline-flex rounded-full border border-border bg-surface p-1">
        {(["week", "month"] as const).map((p) => (
          <Link
            key={p}
            href={p === "week" ? "/cfo/briefing" : "/cfo/briefing?period=month"}
            aria-current={p === period ? "page" : undefined}
            className={cn(
              "flex min-h-10 items-center rounded-full px-4 text-sm font-medium transition-colors",
              p === period ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-surface-muted",
            )}
          >
            {p === "week" ? "Week" : "Month"}
          </Link>
        ))}
      </nav>

      <div className="grid gap-4 sm:grid-cols-3">
        {stats.map((s) => (
          <Card key={s.name} className="p-5">
            <p className="text-sm text-muted-foreground">{s.name}</p>
            <p className="mt-1 font-display text-2xl">
              <Money minor={s.current} currency={currency} />
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {label.previous}: <Money minor={s.previous} currency={currency} />
            </p>
          </Card>
        ))}
        <Card className="p-5">
          <p className="text-sm text-muted-foreground">Net</p>
          <p className="mt-1 font-display text-2xl" aria-label={`Net ${formatMoney(b.netMinor, currency, { signDisplay: "exceptZero" })}, income minus spending`}>
            <Money minor={b.netMinor} currency={currency} options={{ signDisplay: "exceptZero" }} colorize />
          </p>
          {b.spending.pendingMinor > 0 && (
            <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
              <DataStatus kind="pending" /> <Money minor={b.spending.pendingMinor} currency={currency} /> of spending is pending
            </p>
          )}
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card aria-labelledby="b-cats">
          <CardHeader>
            <div>
              <CardTitle id="b-cats">Where it went</CardTitle>
              <CardDescription>Top categories, compared with {label.previous.toLowerCase()}</CardDescription>
            </div>
          </CardHeader>
          {b.topCategories.length === 0 ? (
            <p className="text-sm text-muted-foreground">No spending in this period yet.</p>
          ) : (
            <ul className="divide-y divide-border">
              {b.topCategories.map((c) => (
                <li key={c.categoryId ?? "uncategorized"} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                  <span className="min-w-0 truncate">{c.name}</span>
                  <span className="shrink-0 text-right">
                    <Money minor={c.currentMinor} currency={currency} className="font-medium" />
                    <span className="block text-xs text-muted-foreground">
                      was <Money minor={c.previousMinor} currency={currency} />
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card aria-labelledby="b-largest">
          <CardHeader>
            <div>
              <CardTitle id="b-largest">Largest purchases</CardTitle>
              <CardDescription>{b.transactionCount} transactions in this period</CardDescription>
            </div>
          </CardHeader>
          {b.largestPurchases.length === 0 ? (
            <p className="text-sm text-muted-foreground">No purchases in this period yet.</p>
          ) : (
            <ul className="divide-y divide-border">
              {b.largestPurchases.map((t) => (
                <li key={t.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                  <span className="min-w-0">
                    <span className="block truncate">{t.merchant}</span>
                    <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                      {formatDate(t.date)} · {t.category}
                      {t.pending && <DataStatus kind="pending" />}
                    </span>
                  </span>
                  <Money minor={t.amountMinor} currency={currency} className="shrink-0 font-medium" />
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card aria-labelledby="b-budget">
          <CardHeader>
            <div>
              <CardTitle id="b-budget">Budget this month</CardTitle>
              <CardDescription>Spending categories, month to date</CardDescription>
            </div>
            <Link href="/budget" className="text-sm font-medium text-accent-ink">
              Open
            </Link>
          </CardHeader>
          {b.budget ? (
            <div className="space-y-3 text-sm">
              <p>
                <Money minor={b.budget.actualMinor} currency={currency} className="font-medium" /> spent of{" "}
                <Money minor={b.budget.plannedMinor} currency={currency} /> planned
              </p>
              <p className="text-muted-foreground">
                {b.budget.remainingMinor >= 0 ? (
                  <>
                    <Money minor={b.budget.remainingMinor} currency={currency} /> left
                  </>
                ) : (
                  <>
                    <Money minor={-b.budget.remainingMinor} currency={currency} /> over plan
                  </>
                )}
              </p>
              {b.budget.overCategories.length > 0 && (
                <p className="text-attention">Over in: {b.budget.overCategories.join(", ")}</p>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No budget set for this month.</p>
          )}
        </Card>

        <Card aria-labelledby="b-bills">
          <CardHeader>
            <div>
              <CardTitle id="b-bills">Coming up</CardTitle>
              <CardDescription>Bills due in the next {period === "week" ? "7" : "30"} days</CardDescription>
            </div>
          </CardHeader>
          {b.upcomingBills.length === 0 ? (
            <p className="text-sm text-muted-foreground">No bills due.</p>
          ) : (
            <ul className="divide-y divide-border">
              {b.upcomingBills.map((bill) => (
                <li key={`${bill.billId}-${bill.dueDate}`} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                  <span className="min-w-0">
                    <span className="block truncate">{bill.name}</span>
                    <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                      {formatDate(bill.dueDate)}
                      {bill.autopay && " · Autopay"}
                      {bill.amountIsEstimate && <DataStatus kind="estimated" />}
                    </span>
                  </span>
                  <Money minor={bill.amountMinor} currency={bill.currency} className="shrink-0 font-medium" />
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card aria-labelledby="b-balances">
          <CardHeader>
            <div>
              <CardTitle id="b-balances">Balances</CardTitle>
              <CardDescription>
                {b.balances.oldestBalanceAt ? `Oldest balance updated ${relativeTime(b.balances.oldestBalanceAt, now)}` : "Latest balances"}
              </CardDescription>
            </div>
          </CardHeader>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Cash</dt>
              <dd><Money minor={b.balances.cashMinor} currency={currency} /></dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Credit card balances owed</dt>
              <dd><Money minor={b.balances.cardDebtMinor} currency={currency} /></dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Net worth</dt>
              <dd><Money minor={b.balances.netWorthMinor} currency={currency} /></dd>
            </div>
          </dl>
        </Card>

        <Card aria-labelledby="b-savings">
          <CardHeader>
            <div>
              <CardTitle id="b-savings">Savings goals</CardTitle>
              <CardDescription>Progress toward each target</CardDescription>
            </div>
          </CardHeader>
          {b.savings.length === 0 ? (
            <p className="text-sm text-muted-foreground">No savings goals yet.</p>
          ) : (
            <ul className="space-y-4">
              {b.savings.map((g) => (
                <li key={g.goalId} className="space-y-1.5 text-sm">
                  <div className="flex justify-between gap-3">
                    <span className="min-w-0 truncate">{g.name}</span>
                    <span className="shrink-0 text-muted-foreground">{percentFromBps(g.progressBps)}</span>
                  </div>
                  <Progress valueBps={g.progressBps} label={`${g.name}: ${percentFromBps(g.progressBps)} saved`} />
                  <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                    <Money minor={g.savedMinor} currency={currency} /> of <Money minor={g.targetMinor} currency={currency} />
                    {g.projectedDate && (
                      <>
                        {" "}· on pace for {formatDate(g.projectedDate, { month: "short", year: "numeric" })}
                        <DataStatus kind="estimated" label="Projection" />
                      </>
                    )}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card aria-labelledby="b-insights" className="bg-blush/40">
        <CardHeader>
          <div>
            <CardTitle id="b-insights">What stands out</CardTitle>
            <CardDescription>Calculated from your numbers. Projections are labeled.</CardDescription>
          </div>
          <Link href="/cfo" className="text-sm font-medium text-accent-ink">
            Ask the CFO
          </Link>
        </CardHeader>
        <InsightList insights={b.insights} />
      </Card>

      {b.dataNotes.length > 0 && (
        <ul className="space-y-1 text-xs text-muted-foreground" aria-label="About this data">
          {b.dataNotes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
