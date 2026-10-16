import Link from "next/link";
import { AlertTriangle, CalendarClock, CheckCircle2, CreditCard, Landmark, Lightbulb, PiggyBank, Wallet } from "lucide-react";
import type { DashboardModel, Insight } from "@/lib/finance/dashboard";
import { formatDate } from "@/lib/finance/dates";
import { relativeTime, percentFromBps } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DataStatus } from "@/components/ui/data-status";
import { Money } from "@/components/ui/money";
import { Progress } from "@/components/ui/progress";

type Model = DashboardModel;

// ---------------------------------------------------------------------------
// Personal CFO insights (rule-based in Phase 1)
// ---------------------------------------------------------------------------

const insightIcon: Record<Insight["tone"], typeof Lightbulb> = {
  positive: CheckCircle2,
  neutral: Lightbulb,
  attention: AlertTriangle,
};

export function InsightsPanel({ insights }: { insights: Insight[] }) {
  return (
    <Card aria-labelledby="insights-title" className="bg-blush/40">
      <CardHeader>
        <div>
          <CardTitle id="insights-title">Personal CFO</CardTitle>
          <CardDescription>Rule-based insights from your numbers. The AI CFO arrives in Phase 3.</CardDescription>
        </div>
      </CardHeader>
      {insights.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing needs your attention right now.</p>
      ) : (
        <ul className="space-y-3">
          {insights.map((i) => {
            const Icon = insightIcon[i.tone];
            return (
              <li key={i.id} className="flex gap-3 rounded-2xl bg-surface p-4">
                <Icon
                  className={cn(
                    "mt-0.5 size-5 shrink-0",
                    i.tone === "attention" ? "text-attention" : i.tone === "positive" ? "text-positive" : "text-accent-ink",
                  )}
                  aria-hidden
                />
                <div>
                  <p className="text-sm font-medium">{i.title}</p>
                  <p className="mt-0.5 text-sm text-muted-foreground">{i.body}</p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Spending by category (ranked bars, single hue)
// ---------------------------------------------------------------------------

export function CategorySpending({ model }: { model: Model }) {
  const rows = model.monthToDate.byCategory.filter((c) => c.spentMinor > 0).slice(0, 7);
  const max = rows[0]?.spentMinor ?? 0;
  return (
    <Card aria-labelledby="cat-title">
      <CardHeader>
        <div>
          <CardTitle id="cat-title">Spending by category</CardTitle>
          <CardDescription>This month to date, refunds netted</CardDescription>
        </div>
      </CardHeader>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No spending yet this month.</p>
      ) : (
        <ul className="space-y-3">
          {rows.map((c) => (
            <li key={c.categoryId ?? "uncategorized"}>
              <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
                <span>{c.name}</span>
                <Money minor={c.spentMinor} currency={model.currency} className="font-medium" />
              </div>
              <div className="h-2 rounded-full bg-surface-muted" aria-hidden>
                <div
                  className="h-full rounded-full bg-chart-spending"
                  style={{ width: `${max ? Math.max((c.spentMinor / max) * 100, 2) : 0}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Budget
// ---------------------------------------------------------------------------

export function BudgetProgress({ model }: { model: Model }) {
  const budget = model.budget;
  return (
    <Card aria-labelledby="budget-title">
      <CardHeader>
        <div>
          <CardTitle id="budget-title">Budget</CardTitle>
          <CardDescription>{formatDate(model.asOf, { month: "long", year: "numeric" })}</CardDescription>
        </div>
        <Link href="/budget" className="text-sm font-medium text-accent-ink">
          Details
        </Link>
      </CardHeader>
      {!budget ? (
        <p className="text-sm text-muted-foreground">No budget for this month yet.</p>
      ) : (
        <ul className="space-y-4">
          {budget.lines
            .filter((l) => l.kind === "variable")
            .map((l) => (
              <li key={l.categoryId}>
                <div className="mb-1.5 flex items-baseline justify-between gap-3 text-sm">
                  <span className="flex items-center gap-2">
                    {l.name}
                    {l.status === "over" && <Badge variant="attention">Over</Badge>}
                  </span>
                  <span className="tabular text-muted-foreground">
                    <Money minor={l.actualMinor} currency={model.currency} options={{ wholeUnits: true }} className="text-foreground" />
                    {" of "}
                    <Money minor={l.plannedMinor} currency={model.currency} options={{ wholeUnits: true }} />
                  </span>
                </div>
                <Progress
                  valueBps={l.usedBps}
                  label={`${l.name}: ${percentFromBps(l.usedBps)} of budget used`}
                  tone={l.status === "over" ? "over" : l.status === "near_limit" ? "near" : "default"}
                />
                {l.pendingMinor > 0 && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Includes <Money minor={l.pendingMinor} currency={model.currency} /> pending
                  </p>
                )}
              </li>
            ))}
        </ul>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Savings goals
// ---------------------------------------------------------------------------

export function SavingsGoals({ model }: { model: Model }) {
  return (
    <Card aria-labelledby="savings-title">
      <CardHeader>
        <CardTitle id="savings-title">Savings goals</CardTitle>
        <PiggyBank className="size-5 text-accent-ink" aria-hidden />
      </CardHeader>
      <ul className="space-y-5">
        {model.savings.map((g) => (
          <li key={g.goalId}>
            <div className="mb-1.5 flex items-baseline justify-between gap-3">
              <span className="text-sm font-medium">{g.name}</span>
              <span className="text-sm text-muted-foreground">{percentFromBps(g.progressBps)}</span>
            </div>
            <Progress valueBps={g.progressBps} label={`${g.name}: ${percentFromBps(g.progressBps)} saved`} />
            <p className="mt-1.5 text-xs text-muted-foreground">
              <Money minor={g.savedMinor} currency={model.currency} options={{ wholeUnits: true }} /> of{" "}
              <Money minor={g.targetMinor} currency={model.currency} options={{ wholeUnits: true }} />
              {g.projectedDate && g.remainingMinor > 0 && <> · on pace for {formatDate(g.projectedDate, { month: "short", year: "numeric" })}</>}
              {g.onTrack === false && " · behind target date"}
            </p>
          </li>
        ))}
      </ul>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Upcoming bills
// ---------------------------------------------------------------------------

export function UpcomingBills({ model }: { model: Model }) {
  return (
    <Card aria-labelledby="bills-title">
      <CardHeader>
        <div>
          <CardTitle id="bills-title">Upcoming bills</CardTitle>
          <CardDescription>Next 14 days</CardDescription>
        </div>
        <CalendarClock className="size-5 text-accent-ink" aria-hidden />
      </CardHeader>
      {model.upcomingBills.length === 0 ? (
        <p className="text-sm text-muted-foreground">No bills due in the next two weeks.</p>
      ) : (
        <ul className="divide-y divide-border">
          {model.upcomingBills.map((b) => (
            <li key={`${b.billId}-${b.dueDate}`} className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
              <div className="flex items-center gap-3">
                <span className="flex size-11 shrink-0 flex-col items-center justify-center rounded-xl bg-surface-muted text-center leading-none">
                  <span className="text-[10px] uppercase text-muted-foreground">{formatDate(b.dueDate, { month: "short" })}</span>
                  <span className="font-display text-base">{Number(b.dueDate.slice(8, 10))}</span>
                </span>
                <div>
                  <p className="text-sm font-medium">{b.name}</p>
                  <p className="text-xs text-muted-foreground">{b.autopay ? "Autopay" : "Manual payment"}</p>
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
  );
}

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

const connectionLabel: Record<string, string> = {
  login_required: "Reconnect needed",
  pending_expiration: "Consent expiring",
  revoked: "Access revoked",
  error: "Sync error",
  disconnected: "Disconnected",
};

export function AccountCards({ model, now }: { model: Model; now: Date }) {
  return (
    <section aria-labelledby="accounts-title">
      <div className="mb-3 flex items-center justify-between">
        <h2 id="accounts-title" className="font-display text-lg font-medium">Accounts</h2>
        <Link href="/accounts" className="text-sm font-medium text-accent-ink">
          Manage
        </Link>
      </div>
      <ul className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-2 sm:mx-0 sm:grid sm:grid-cols-2 sm:overflow-visible sm:px-0 xl:grid-cols-3">
        {model.accounts.map(({ account, snapshot, freshness }) => {
          const isCredit = account.type === "credit";
          const Icon = isCredit ? CreditCard : account.source === "manual" ? Wallet : Landmark;
          const healthy = account.connectionStatus === "active";
          return (
            <li
              key={account.id}
              className="w-[78%] shrink-0 snap-start rounded-[var(--radius-card)] border border-border bg-surface p-4 shadow-card sm:w-auto"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2.5">
                  <span className="flex size-9 items-center justify-center rounded-full bg-blush text-blush-foreground">
                    <Icon className="size-4" aria-hidden />
                  </span>
                  <div>
                    <p className="text-sm font-medium">{account.nickname ?? account.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {account.institutionName}
                      {account.mask && <span aria-label={`account ending in ${account.mask}`}> ••{account.mask}</span>}
                    </p>
                  </div>
                </div>
              </div>

              <p className="mt-4 text-xs text-muted-foreground">{isCredit ? "Balance owed" : "Current balance"}</p>
              <p className="font-display text-2xl tracking-tight">
                {snapshot?.currentMinor != null ? (
                  <Money minor={snapshot.currentMinor} currency={account.currency} />
                ) : (
                  <span className="text-muted-foreground">-</span>
                )}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {isCredit ? (
                  snapshot?.creditLimitMinor != null ? (
                    <>
                      Available credit <Money minor={snapshot.availableMinor ?? 0} currency={account.currency} /> of{" "}
                      <Money minor={snapshot.creditLimitMinor} currency={account.currency} options={{ wholeUnits: true }} /> limit
                    </>
                  ) : (
                    "Credit limit not reported"
                  )
                ) : snapshot?.availableMinor != null ? (
                  <>
                    Available <Money minor={snapshot.availableMinor} currency={account.currency} />
                  </>
                ) : (
                  "Available balance not reported by this institution"
                )}
              </p>

              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                {!healthy && <Badge variant="attention">{connectionLabel[account.connectionStatus] ?? "Needs attention"}</Badge>}
                {freshness === "stale" && <DataStatus kind="stale" />}
                {freshness === "unavailable" && <DataStatus kind="unavailable" />}
                <span className="text-xs text-muted-foreground">
                  {account.source === "manual"
                    ? snapshot
                      ? `Updated manually ${relativeTime(snapshot.asOf, now)}`
                      : "Manual account"
                    : account.lastSuccessfulSyncAt
                      ? `Synced ${relativeTime(account.lastSuccessfulSyncAt, now)}`
                      : "Never synced"}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Recent transactions
// ---------------------------------------------------------------------------

export function RecentTransactions({ model }: { model: Model }) {
  const accountName = new Map(model.accounts.map((a) => [a.account.id, a.account.nickname ?? a.account.name]));
  return (
    <Card aria-labelledby="recent-title">
      <CardHeader>
        <CardTitle id="recent-title">Recent activity</CardTitle>
        <Link href="/transactions" className="text-sm font-medium text-accent-ink">
          See all
        </Link>
      </CardHeader>
      <ul className="divide-y divide-border">
        {model.recentTransactions.map((t) => {
          const isTransfer = t.flow === "transfer" || t.flow === "credit_card_payment";
          return (
            <li key={t.id} className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{t.displayMerchant}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {t.flow === "credit_card_payment" ? "Card payment" : isTransfer ? "Transfer" : (t.category?.name ?? "Uncategorized")}
                  {" · "}
                  {accountName.get(t.accountId)}
                  {" · "}
                  {formatDate(t.date)}
                </p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <Money
                  minor={t.amountMinor}
                  currency={t.currency}
                  options={{ signDisplay: "exceptZero" }}
                  colorize={!isTransfer}
                  className={cn("text-sm font-medium", isTransfer && "text-muted-foreground")}
                />
                {t.status === "pending" && <DataStatus kind="pending" />}
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
