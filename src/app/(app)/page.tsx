import { ArrowDownLeft, ArrowUpRight, CalendarClock, CreditCard, Landmark, Scale, Target, Wallet } from "lucide-react";
import { requireUser } from "@/lib/auth/dal";
import { getRepository } from "@/lib/data";
import { buildDashboard } from "@/lib/finance/dashboard";
import { formatDate } from "@/lib/finance/dates";
import { greeting, relativeTime } from "@/lib/format";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DataStatus } from "@/components/ui/data-status";
import { Money } from "@/components/ui/money";
import { StatTile } from "@/components/dashboard/stat-tile";
import { SafeToSpendCard } from "@/components/dashboard/safe-to-spend-card";
import { CashFlowChart } from "@/components/charts/cash-flow-chart";
import {
  AccountCards,
  BudgetProgress,
  CategorySpending,
  InsightsPanel,
  RecentTransactions,
  SavingsGoals,
  UpcomingBills,
} from "@/components/dashboard/sections";

export const metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const user = await requireUser();
  const now = new Date();
  const data = await getRepository(user).getFinancialData(user, now);
  const model = buildDashboard(data, now);
  const { balances, monthToDate, currency } = model;
  const whole = { wholeUnits: true } as const;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground">{formatDate(model.asOf, { weekday: "long", month: "long", day: "numeric" })}</p>
          <h1 className="font-display text-3xl font-medium tracking-tight sm:text-4xl">
            {greeting(now, data.profile.timezone)}
            {data.profile.displayName ? `, ${data.profile.displayName}` : ""}
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          {model.isDemo && <DataStatus kind="demo" label="Fictional data" />}
          {model.sync.latestSuccessAt && <span>Last sync {relativeTime(model.sync.latestSuccessAt, now)}</span>}
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <SafeToSpendCard result={model.safeToSpend} horizonReason={model.safeToSpendHorizonReason} />
        </div>
        <div className="lg:col-span-2">
          <InsightsPanel insights={model.insights} />
        </div>
      </div>

      <section aria-label="Key figures" className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <StatTile
          label="Total cash"
          icon={<Landmark className="size-3.5" aria-hidden />}
          value={<Money minor={balances.totalCashMinor} currency={currency} options={whole} />}
          helper="Checking, savings & cash. Ledger balances."
          status={balances.staleAccountIds.length > 0 ? <DataStatus kind="stale" label="Partly stale" /> : undefined}
        />
        <StatTile
          label="Available cash"
          icon={<Wallet className="size-3.5" aria-hidden />}
          value={<Money minor={balances.availableCash.amountMinor} currency={currency} options={whole} />}
          helper={
            balances.availableCash.isPartial
              ? `${balances.availableCash.accountsWithoutAvailable.length === 1 ? "1 account doesn't" : `${balances.availableCash.accountsWithoutAvailable.length} accounts don't`} report an available balance, so ${balances.availableCash.accountsWithoutAvailable.length === 1 ? "it isn't" : "they aren't"} included.`
              : "As reported by your banks, after pending items."
          }
          status={balances.availableCash.isPartial ? <DataStatus kind="unavailable" label="Partial" /> : undefined}
        />
        <StatTile
          label="Card debt"
          icon={<CreditCard className="size-3.5" aria-hidden />}
          value={<Money minor={balances.creditCardDebtMinor} currency={currency} options={whole} />}
          helper={
            <>
              Owed on credit cards. Available credit (
              <Money minor={balances.availableCreditMinor} currency={currency} options={whole} />) is not cash.
            </>
          }
        />
        <StatTile
          label="Net worth"
          icon={<Scale className="size-3.5" aria-hidden />}
          value={<Money minor={balances.netWorthMinor} currency={currency} options={whole} />}
          helper="Cash and investments minus cards and loans."
        />
        <StatTile
          label="Income"
          icon={<ArrowDownLeft className="size-3.5" aria-hidden />}
          value={<Money minor={monthToDate.incomeMinor} currency={currency} options={whole} />}
          helper="This month to date. Excludes transfers between your accounts."
        />
        <StatTile
          label="Spending"
          icon={<ArrowUpRight className="size-3.5" aria-hidden />}
          value={<Money minor={monthToDate.spendingMinor} currency={currency} options={whole} />}
          helper={
            <>
              <Money minor={monthToDate.spendingPostedMinor} currency={currency} options={whole} /> posted ·{" "}
              <Money minor={monthToDate.spendingPendingMinor} currency={currency} options={whole} /> pending
            </>
          }
          status={monthToDate.pendingCount > 0 ? <DataStatus kind="pending" label={`${monthToDate.pendingCount} pending`} /> : undefined}
        />
        <StatTile
          label="Budget left"
          icon={<Target className="size-3.5" aria-hidden />}
          value={
            model.budget ? (
              <Money minor={model.budget.spending.remainingMinor} currency={currency} options={whole} />
            ) : (
              <span className="text-muted-foreground">No budget</span>
            )
          }
          helper={
            model.budget ? (
              <>
                Of <Money minor={model.budget.spending.plannedMinor} currency={currency} options={whole} /> planned for
                spending this month.
              </>
            ) : undefined
          }
        />
        <StatTile
          label="Bills · 14 days"
          icon={<CalendarClock className="size-3.5" aria-hidden />}
          value={<Money minor={model.upcomingBillsTotalMinor} currency={currency} options={whole} />}
          helper={`${model.upcomingBills.length} bill${model.upcomingBills.length === 1 ? "" : "s"} due.`}
          status={model.upcomingBills.some((b) => b.amountIsEstimate) ? <DataStatus kind="estimated" /> : undefined}
        />
      </section>

      <div className="grid gap-6 lg:grid-cols-5">
        <Card aria-labelledby="cashflow-title" className="lg:col-span-3">
          <CardHeader>
            <div>
              <CardTitle id="cashflow-title">Cash flow</CardTitle>
              <CardDescription>Income vs spending, last 6 months</CardDescription>
            </div>
          </CardHeader>
          <CashFlowChart data={model.cashFlow} currency={currency} />
        </Card>
        <div className="lg:col-span-2">
          <CategorySpending model={model} />
        </div>
      </div>

      <AccountCards model={model} now={now} />

      <div className="grid gap-6 lg:grid-cols-2">
        <BudgetProgress model={model} />
        <div className="space-y-6">
          <UpcomingBills model={model} />
          <SavingsGoals model={model} />
        </div>
      </div>

      <RecentTransactions model={model} />
    </div>
  );
}
