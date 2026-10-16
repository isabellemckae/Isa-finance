import Link from "next/link";
import { notFound } from "next/navigation";
import { Link2, Plus, RefreshCw } from "lucide-react";
import { loadPageData } from "@/lib/data/load";
import { accountBalanceViews, creditUtilizationBps } from "@/lib/finance/balances";
import { summarizePeriod } from "@/lib/finance/classification";
import { formatDate, startOfMonth } from "@/lib/finance/dates";
import { addMinor, minorToDecimalString } from "@/lib/finance/money";
import { accountTypeLabel } from "@/lib/account-kinds";
import { percentFromBps, relativeTime } from "@/lib/format";
import { deleteManualAccountAction, recordBalanceAction, updateAccountAction } from "@/lib/actions/accounts";
import { PageHeader } from "@/components/layout/page-header";
import { DemoEditsNote } from "@/components/layout/demo-edits-note";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataStatus } from "@/components/ui/data-status";
import { Money } from "@/components/ui/money";
import { Progress } from "@/components/ui/progress";
import { Checkbox, Field, MoneyInput, TextInput } from "@/components/ui/field";
import { ActionForm, SubmitButton } from "@/components/forms/action-form";
import { AccountIcon, CONNECTION_LABEL, syncLabel } from "@/components/accounts/account-row";
import { TransactionList } from "@/components/transactions/transaction-list";

export const metadata = { title: "Account" };

export default async function AccountDetailPage({ params }: PageProps<"/accounts/[id]">) {
  const { id } = await params;
  const { data, repo, now, transactions, asOf, isDemo } = await loadPageData();
  const account = data.accounts.find((a) => a.id === id);
  if (!account) notFound();
  const view = accountBalanceViews([account], data.balances, now)[0];
  const { snapshot, freshness } = view;
  const history = (await repo.getBalanceHistory(id)).slice(0, 8);
  const accountTx = transactions.filter((t) => t.accountId === id);
  const month = summarizePeriod(accountTx, startOfMonth(asOf), asOf);
  const thisMonth = accountTx.filter((t) => t.date >= startOfMonth(asOf));
  const moneyIn = thisMonth.filter((t) => t.amountMinor > 0).reduce((s, t) => addMinor(s, t.amountMinor), 0);
  const moneyOut = thisMonth.filter((t) => t.amountMinor < 0).reduce((s, t) => addMinor(s, -t.amountMinor), 0);
  const isCredit = account.type === "credit";
  const isDebt = isCredit || account.type === "loan";
  const utilization = isCredit ? creditUtilizationBps(snapshot) : null;
  const isManual = account.source === "manual";

  return (
    <div className="space-y-6">
      <PageHeader
        back={{ href: "/accounts", label: "Accounts" }}
        title={account.nickname ?? account.name}
        eyebrow={
          <span className="flex items-center gap-2">
            <AccountIcon view={view} />
            <span>
              {account.institutionName}
              {account.mask && ` ••${account.mask}`} · {accountTypeLabel(account)}
            </span>
          </span>
        }
      />

      <Card aria-labelledby="balance-title">
        <CardHeader>
          <div>
            <CardTitle id="balance-title">{isDebt ? "Balance owed" : "Current balance"}</CardTitle>
            <CardDescription>
              {snapshot ? `As of ${new Date(snapshot.asOf).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: data.profile.timezone })}` : "No balance recorded"}
            </CardDescription>
          </div>
          <div className="flex flex-wrap justify-end gap-1.5">
            {freshness === "stale" && <DataStatus kind="stale" />}
            {freshness === "unavailable" && <DataStatus kind="unavailable" />}
          </div>
        </CardHeader>
        <p className="font-display text-4xl tracking-tight">
          {snapshot?.currentMinor != null ? <Money minor={snapshot.currentMinor} currency={account.currency} /> : "-"}
        </p>
        <dl className="mt-4 grid grid-cols-2 gap-4 text-sm">
          {isCredit ? (
            <>
              <Stat label="Credit limit" value={snapshot?.creditLimitMinor} currency={account.currency} missing="Not reported" />
              <Stat label="Available credit (not cash)" value={snapshot?.availableMinor} currency={account.currency} missing="Not reported" />
            </>
          ) : account.type === "depository" ? (
            <Stat
              label="Available to spend"
              value={snapshot?.availableMinor}
              currency={account.currency}
              missing="Not reported by this institution"
            />
          ) : null}
          <div>
            <dt className="text-xs text-muted-foreground">This month</dt>
            <dd className="tabular">
              +<Money minor={moneyIn} currency={account.currency} /> / −<Money minor={moneyOut} currency={account.currency} />
            </dd>
          </div>
        </dl>
        {utilization !== null && (
          <div className="mt-4 space-y-1.5">
            <Progress
              valueBps={utilization}
              label={`${percentFromBps(utilization)} of credit limit used`}
              tone={utilization >= 5_000 ? "over" : utilization >= 3_000 ? "near" : "default"}
            />
            <p className="text-xs text-muted-foreground">
              {percentFromBps(utilization)} of the limit used. Keeping utilization under 30% is a common guideline.
            </p>
          </div>
        )}
        {month.pendingCount > 0 && (
          <p className="mt-3 text-xs text-muted-foreground">
            {month.pendingCount} pending transaction{month.pendingCount === 1 ? "" : "s"} may not be reflected in the current balance yet.
          </p>
        )}
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card aria-labelledby="conn-title">
          <CardHeader>
            <div>
              <CardTitle id="conn-title">{isManual ? "Manual account" : "Connection"}</CardTitle>
              <CardDescription>{syncLabel(view, now)}</CardDescription>
            </div>
            {!isManual && (
              <Badge variant={account.connectionStatus === "active" ? "positive" : "attention"}>
                {CONNECTION_LABEL[account.connectionStatus]}
              </Badge>
            )}
          </CardHeader>
          {isManual ? (
            <ActionForm action={recordBalanceAction} className="space-y-4">
              <input type="hidden" name="id" value={account.id} />
              <Field label={isDebt ? "Amount owed now" : "Balance now"} htmlFor="currentBalance">
                <MoneyInput id="currentBalance" name="currentBalance" required defaultValue="" placeholder="0.00" />
              </Field>
              {isCredit && (
                <Field label="Credit limit" htmlFor="creditLimit" hint="Optional">
                  <MoneyInput id="creditLimit" name="creditLimit" defaultValue={snapshot?.creditLimitMinor != null ? minorToDecimalString(snapshot.creditLimitMinor, account.currency) : ""} />
                </Field>
              )}
              <div className="flex flex-wrap gap-2">
                <SubmitButton>Update balance</SubmitButton>
                <Button asChild variant="outline">
                  <Link href={`/transactions/new?account=${account.id}`}>
                    <Plus aria-hidden /> Add transaction
                  </Link>
                </Button>
              </div>
            </ActionForm>
          ) : (
            <div className="space-y-3 text-sm">
              <p className="text-muted-foreground">
                {account.connectionStatus === "active"
                  ? "Balances and transactions update from the bank through Plaid (read-only)."
                  : account.connectionStatus === "disconnected"
                    ? "This bank was disconnected. Its history is kept; nothing new syncs."
                    : "This connection needs to be renewed before it can sync again."}
              </p>
              <Button asChild variant="outline">
                <Link href="/accounts#connections">
                  <RefreshCw aria-hidden /> Sync, reconnect or disconnect
                </Link>
              </Button>
            </div>
          )}
        </Card>

        <Card aria-labelledby="settings-title">
          <CardHeader>
            <CardTitle id="settings-title">Display</CardTitle>
          </CardHeader>
          <ActionForm action={updateAccountAction} className="space-y-4">
            <input type="hidden" name="id" value={account.id} />
            <Field label="Nickname" htmlFor="nickname" hint={`Official name: ${account.name}`}>
              <TextInput id="nickname" name="nickname" maxLength={60} defaultValue={account.nickname ?? ""} placeholder={account.name} />
            </Field>
            <Checkbox
              name="isHidden"
              defaultChecked={account.isHidden}
              label="Hide from lists"
              description="Hidden accounts still count in totals and calculations."
            />
            <SubmitButton>Save</SubmitButton>
          </ActionForm>
          <div className="mt-3">
            <DemoEditsNote show={isDemo} />
          </div>
        </Card>
      </div>

      <Card aria-labelledby="recent-title">
        <CardHeader>
          <CardTitle id="recent-title">Recent transactions</CardTitle>
          <Link href={`/transactions?account=${account.id}`} className="text-sm font-medium text-accent-ink">
            See all
          </Link>
        </CardHeader>
        <TransactionList transactions={accountTx.slice(0, 8)} accounts={data.accounts} showAccount={false} emptyLabel="No transactions in the last 13 months." />
      </Card>

      {history.length > 0 && (
        <Card aria-labelledby="history-title">
          <CardHeader>
            <CardTitle id="history-title">Balance history</CardTitle>
          </CardHeader>
          <ul className="divide-y divide-border text-sm">
            {history.map((h) => (
              <li key={h.asOf} className="flex justify-between gap-3 py-2.5">
                <span className="text-muted-foreground">
                  {formatDate(h.asOf.slice(0, 10), { month: "short", day: "numeric", year: "numeric" })} · {relativeTime(h.asOf, now)}
                </span>
                <span className="tabular">
                  {h.currentMinor != null ? <Money minor={h.currentMinor} currency={h.currency} /> : "-"}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {isManual && (
        <Card aria-labelledby="danger-title" className="border-attention/30">
          <CardHeader>
            <div>
              <CardTitle id="danger-title">Delete account</CardTitle>
              <CardDescription>Removes this manual account and its transactions. This can&apos;t be undone.</CardDescription>
            </div>
          </CardHeader>
          <ActionForm action={deleteManualAccountAction} className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <input type="hidden" name="id" value={account.id} />
            <Field label='Type "delete" to confirm' htmlFor="confirm" className="flex-1">
              <TextInput id="confirm" name="confirm" autoComplete="off" required />
            </Field>
            <SubmitButton variant="outline" pendingLabel="Deleting…">
              Delete account
            </SubmitButton>
          </ActionForm>
        </Card>
      )}

      {!isManual && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Link2 className="size-3.5" aria-hidden /> Bank-provided data is read-only. Your edits (nicknames, categories, notes) are stored separately.
        </p>
      )}
    </div>
  );
}

function Stat({ label, value, currency, missing }: { label: string; value: number | null | undefined; currency: string; missing: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd>{value != null ? <Money minor={value} currency={currency} /> : <span className="text-muted-foreground">{missing}</span>}</dd>
    </div>
  );
}
