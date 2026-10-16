import Link from "next/link";
import { ChevronRight, CreditCard, Landmark, LineChart, PiggyBank, Wallet } from "lucide-react";
import type { AccountBalanceView } from "@/lib/finance/balances";
import { creditUtilizationBps } from "@/lib/finance/balances";
import { accountGroup, accountTypeLabel } from "@/lib/account-kinds";
import { relativeTime, percentFromBps } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { DataStatus } from "@/components/ui/data-status";
import { Money } from "@/components/ui/money";
import { Progress } from "@/components/ui/progress";

export const CONNECTION_LABEL: Record<string, string> = {
  active: "Connected",
  login_required: "Reconnect needed",
  pending_expiration: "Consent expiring soon",
  revoked: "Access revoked",
  error: "Sync error",
  disconnected: "Disconnected",
};

export function AccountIcon({ view }: { view: Pick<AccountBalanceView, "account"> }) {
  const group = accountGroup(view.account);
  const Icon =
    view.account.source === "manual" && group === "cash"
      ? Wallet
      : group === "credit"
        ? CreditCard
        : group === "savings"
          ? PiggyBank
          : group === "investment"
            ? LineChart
            : Landmark;
  return (
    <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-blush text-blush-foreground">
      <Icon className="size-[18px]" aria-hidden />
    </span>
  );
}

export function syncLabel(view: AccountBalanceView, now: Date): string {
  const { account, snapshot } = view;
  if (account.source === "manual") return snapshot ? `Updated ${relativeTime(snapshot.asOf, now)}` : "No balance yet";
  if (account.source === "csv") return "Imported from CSV";
  return account.lastSuccessfulSyncAt ? `Synced ${relativeTime(account.lastSuccessfulSyncAt, now)}` : "Never synced";
}

/** One tappable account row for lists. */
export function AccountRow({ view, now }: { view: AccountBalanceView; now: Date }) {
  const { account, snapshot, freshness } = view;
  const isDebt = account.type === "credit" || account.type === "loan";
  const utilization = account.type === "credit" ? creditUtilizationBps(snapshot) : null;
  const unhealthy = account.connectionStatus !== "active";

  return (
    <li>
      <Link
        href={`/accounts/${account.id}`}
        className="flex items-center gap-3 rounded-2xl px-2 py-3 transition-colors hover:bg-surface-muted sm:px-3"
      >
        <AccountIcon view={view} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-3">
            <p className="truncate text-sm font-medium">{account.nickname ?? account.name}</p>
            <p className="shrink-0 font-display text-lg tracking-tight">
              {snapshot?.currentMinor != null ? (
                <Money minor={snapshot.currentMinor} currency={account.currency} />
              ) : (
                <span className="text-sm text-muted-foreground">No balance</span>
              )}
            </p>
          </div>
          <div className="flex items-baseline justify-between gap-3 text-xs text-muted-foreground">
            <p className="truncate">
              {account.mask && <span aria-label={`ending in ${account.mask}`}>••{account.mask} · </span>}
              {accountTypeLabel(account)} · {account.institutionName}
            </p>
            <p className="shrink-0">
              {isDebt
                ? "owed"
                : snapshot?.availableMinor != null && snapshot.availableMinor !== snapshot.currentMinor
                  ? (
                    <>
                      <Money minor={snapshot.availableMinor} currency={account.currency} /> available
                    </>
                  )
                  : null}
            </p>
          </div>
          {utilization !== null && (
            <div className="mt-2 flex items-center gap-2">
              <Progress
                valueBps={utilization}
                label={`${percentFromBps(utilization)} of credit limit used`}
                tone={utilization >= 5_000 ? "over" : utilization >= 3_000 ? "near" : "default"}
                className="h-1.5"
              />
              <span className="shrink-0 text-xs text-muted-foreground">{percentFromBps(utilization)} used</span>
            </div>
          )}
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {unhealthy && <Badge variant="attention">{CONNECTION_LABEL[account.connectionStatus]}</Badge>}
            {freshness === "stale" && <DataStatus kind="stale" />}
            {freshness === "unavailable" && <DataStatus kind="unavailable" />}
            {account.isHidden && <Badge variant="outline">Hidden</Badge>}
            <span className="text-xs text-subtle-foreground">{syncLabel(view, now)}</span>
          </div>
        </div>
        <ChevronRight className="size-4 shrink-0 text-subtle-foreground" aria-hidden />
      </Link>
    </li>
  );
}
