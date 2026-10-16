import Link from "next/link";
import { AlertTriangle, Link2, Plus } from "lucide-react";
import { loadPageData } from "@/lib/data/load";
import { accountBalanceViews, summarizeBalances } from "@/lib/finance/balances";
import { ACCOUNT_GROUPS, accountGroup } from "@/lib/account-kinds";
import { addMinor } from "@/lib/finance/money";
import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Money } from "@/components/ui/money";
import { EmptyState } from "@/components/ui/empty-state";
import { AccountRow } from "@/components/accounts/account-row";
import { BankConnections } from "@/components/accounts/connections";
import { getEnv } from "@/lib/env";
import { plaidReadiness } from "@/lib/plaid/readiness";

export const metadata = { title: "Accounts" };

export default async function AccountsPage() {
  const { data, now, currency, repo } = await loadPageData();
  const connections = await repo.listConnections();
  const readiness = plaidReadiness(getEnv());
  const summary = summarizeBalances(data.accounts, data.balances, { now, currency });
  const views = accountBalanceViews(data.accounts, data.balances, now);
  const visible = views.filter((v) => !v.account.isHidden);
  const hidden = views.filter((v) => v.account.isHidden);
  const attention = views.filter(
    (v) => v.account.connectionStatus !== "active" || v.freshness !== "fresh",
  ).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Accounts"
        description={`${data.accounts.length} account${data.accounts.length === 1 ? "" : "s"} across ${new Set(data.accounts.map((a) => a.institutionName)).size} institutions`}
        actions={
          <Button asChild variant="blush" size="sm">
            <Link href="/accounts/new">
              <Plus aria-hidden /> Manual account
            </Link>
          </Button>
        }
      />

      <Card className="grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-4" aria-label="Balance summary">
        <Figure label="Net worth" minor={summary.netWorthMinor} currency={currency} emphasis />
        <Figure label="Cash" minor={summary.totalCashMinor} currency={currency} />
        <Figure label="Card debt" minor={summary.creditCardDebtMinor} currency={currency} />
        <Figure label="Loans" minor={summary.loanDebtMinor} currency={currency} />
        <p className="col-span-2 text-xs text-muted-foreground sm:col-span-4">
          Assets <Money minor={summary.assetsMinor} currency={currency} /> − liabilities{" "}
          <Money minor={summary.liabilitiesMinor} currency={currency} />. Available credit (
          <Money minor={summary.availableCreditMinor} currency={currency} />) is shown on cards but never counted as cash.
          {summary.unavailableAccountIds.length > 0 &&
            ` ${summary.unavailableAccountIds.length} account(s) without a balance are excluded.`}
        </p>
      </Card>

      {attention > 0 && (
        <p className="flex items-start gap-2 rounded-2xl bg-attention-soft px-4 py-3 text-sm text-attention">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          {attention} account{attention === 1 ? " needs" : "s need"} attention: reconnect, out-of-date or missing balances.
          Figures that depend on {attention === 1 ? "it" : "them"} are estimates.
        </p>
      )}

      {visible.length === 0 ? (
        <EmptyState icon={Link2} title="No accounts yet">
          Add a manual account, import a CSV, or connect a bank below.
        </EmptyState>
      ) : (
        ACCOUNT_GROUPS.map((group) => {
          const items = visible.filter((v) => accountGroup(v.account) === group.key);
          if (items.length === 0) return null;
          const total = items.reduce((s, v) => addMinor(s, v.snapshot?.currentMinor ?? 0), 0);
          return (
            <section key={group.key} aria-labelledby={`group-${group.key}`}>
              <div className="mb-2 flex items-baseline justify-between px-1">
                <h2 id={`group-${group.key}`} className="font-display text-lg font-medium">
                  {group.label}
                </h2>
                <Money minor={total} currency={currency} className="text-sm text-muted-foreground" />
              </div>
              <Card className="p-2 sm:p-3">
                <ul className="divide-y divide-border">
                  {items.map((v) => (
                    <AccountRow key={v.account.id} view={v} now={now} />
                  ))}
                </ul>
              </Card>
            </section>
          );
        })
      )}

      {hidden.length > 0 && (
        <details className="group">
          <summary className="cursor-pointer px-1 text-sm font-medium text-muted-foreground">
            {hidden.length} hidden account{hidden.length === 1 ? "" : "s"} (still counted in totals)
          </summary>
          <Card className="mt-2 p-2 sm:p-3">
            <ul className="divide-y divide-border">
              {hidden.map((v) => (
                <AccountRow key={v.account.id} view={v} now={now} />
              ))}
            </ul>
          </Card>
        </details>
      )}

      <BankConnections connections={connections} readiness={readiness} now={now} />
    </div>
  );
}

function Figure({ label, minor, currency, emphasis }: { label: string; minor: number; currency: string; emphasis?: boolean }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={emphasis ? "font-display text-2xl tracking-tight sm:text-3xl" : "font-display text-xl tracking-tight"}>
        <Money minor={minor} currency={currency} options={{ wholeUnits: true }} />
      </p>
    </div>
  );
}
