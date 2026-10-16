import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeftRight, Info, Lock } from "lucide-react";
import { loadPageData } from "@/lib/data/load";
import { formatDate } from "@/lib/finance/dates";
import { transferCandidates } from "@/lib/finance/transfers";
import { reviewQueue } from "@/lib/finance/review";
import {
  createCategoryAction,
  linkTransferAction,
  saveTransactionEditsAction,
  unlinkTransferAction,
} from "@/lib/actions/transactions";
import { PageHeader } from "@/components/layout/page-header";
import { DemoEditsNote } from "@/components/layout/demo-edits-note";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DataStatus } from "@/components/ui/data-status";
import { Money } from "@/components/ui/money";
import { Checkbox, Field, Select, TextArea, TextInput } from "@/components/ui/field";
import { ActionForm, SubmitButton } from "@/components/forms/action-form";
import { flowLabel } from "@/components/transactions/transaction-list";

export const metadata = { title: "Transaction" };

export default async function TransactionDetailPage({ params }: PageProps<"/transactions/[id]">) {
  const { id } = await params;
  const { data, transactions, isDemo } = await loadPageData();
  const tx = transactions.find((t) => t.id === id);
  if (!tx) notFound();

  const account = data.accounts.find((a) => a.id === tx.accountId);
  const override = data.overrides.find((o) => o.transactionId === id);
  const link = data.transferLinks.find((l) => l.outflowTransactionId === id || l.inflowTransactionId === id);
  const partnerId = link ? (link.outflowTransactionId === id ? link.inflowTransactionId : link.outflowTransactionId) : null;
  const partner = partnerId ? transactions.find((t) => t.id === partnerId) : null;
  const candidates = link ? [] : transferCandidates(tx, data.transactions, data.transferLinks).slice(0, 5);
  const accountName = (accountId: string) => {
    const a = data.accounts.find((x) => x.id === accountId);
    return a ? `${a.nickname ?? a.name}${a.mask ? ` ••${a.mask}` : ""}` : "Unknown account";
  };
  const review = reviewQueue(data, transactions);
  const providerCategory = data.categories.find((c) => c.id === tx.defaultCategoryId);
  const byKind = (kind: string) => data.categories.filter((c) => c.kind === kind);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        back={{ href: "/transactions", label: "Activity" }}
        eyebrow={`${formatDate(tx.date, { weekday: "long", month: "long", day: "numeric", year: "numeric" })} · ${accountName(tx.accountId)}`}
        title={tx.displayMerchant}
      />

      <Card className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-display text-4xl tracking-tight">
            <Money
              minor={tx.amountMinor}
              currency={tx.currency}
              options={{ signDisplay: "exceptZero" }}
              colorize={tx.flow !== "transfer" && tx.flow !== "credit_card_payment"}
            />
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {tx.amountMinor < 0 ? "Money out" : "Money in"} · {flowLabel(tx)}
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {tx.status === "pending" ? <DataStatus kind="pending" /> : <Badge variant="neutral">Posted</Badge>}
          {tx.flow === "excluded" && <Badge variant="outline">Excluded from budget</Badge>}
          {review.ids.has(tx.id) && <Badge variant="attention">Needs review</Badge>}
        </div>
        {tx.status === "pending" && (
          <p className="w-full text-xs text-muted-foreground">
            Pending: the final amount can change when it posts. Your edits carry over to the posted transaction.
          </p>
        )}
      </Card>

      <Card aria-labelledby="edit-title">
        <CardHeader>
          <div>
            <CardTitle id="edit-title">Your details</CardTitle>
            <CardDescription>Saved separately. The bank&apos;s original record below is never changed.</CardDescription>
          </div>
        </CardHeader>
        <ActionForm action={saveTransactionEditsAction} className="space-y-4">
          <input type="hidden" name="id" value={tx.id} />
          <Field label="Category" htmlFor="categoryId">
            <Select id="categoryId" name="categoryId" defaultValue={override?.categoryId ?? tx.defaultCategoryId ?? ""}>
              <option value="">Uncategorized</option>
              <optgroup label="Spending">
                {byKind("expense").map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </optgroup>
              <optgroup label="Income">
                {byKind("income").map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </optgroup>
              <optgroup label="Transfers">
                {byKind("transfer").map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </optgroup>
            </Select>
          </Field>
          <Field label="Merchant name" htmlFor="merchantName" hint="Rename how this appears across the app.">
            <TextInput id="merchantName" name="merchantName" maxLength={200} defaultValue={override?.merchantName ?? ""} placeholder={tx.merchantName ?? tx.description} />
          </Field>
          <Field label="Note" htmlFor="note">
            <TextArea id="note" name="note" maxLength={2000} defaultValue={override?.note ?? ""} placeholder="Add context for future you" />
          </Field>
          <Field label="Is this a transfer between your accounts?" htmlFor="transferMode">
            <Select id="transferMode" name="transferMode" defaultValue={override?.transferOverride ?? "auto"}>
              <option value="auto">Decide automatically</option>
              <option value="is_transfer">Yes, it&apos;s a transfer (not income or spending)</option>
              <option value="not_transfer">No, count it as income or spending</option>
            </Select>
          </Field>
          <Checkbox
            name="excludeFromBudget"
            defaultChecked={override?.excludeFromBudget ?? false}
            label="Exclude from budget"
            description="Keeps it in your history but out of spending, budgets and safe-to-spend."
          />
          <SubmitButton>Save changes</SubmitButton>
          <DemoEditsNote show={isDemo} />
        </ActionForm>
        <details className="mt-4 text-sm">
          <summary className="cursor-pointer text-muted-foreground">Create a new category</summary>
          <ActionForm action={createCategoryAction} className="mt-3 space-y-3" resetOnSuccess>
            <Field label="Name" htmlFor="new-cat-name">
              <TextInput id="new-cat-name" name="name" maxLength={60} required />
            </Field>
            <Field label="Kind" htmlFor="new-cat-kind">
              <Select id="new-cat-kind" name="kind" defaultValue="expense">
                <option value="expense">Spending</option>
                <option value="income">Income</option>
              </Select>
            </Field>
            <Checkbox name="isEssential" label="Essential" description="Reserved when calculating safe-to-spend." />
            <SubmitButton variant="outline" size="sm">Create category</SubmitButton>
          </ActionForm>
        </details>
      </Card>

      <Card aria-labelledby="transfer-title">
        <CardHeader>
          <div>
            <CardTitle id="transfer-title">Transfer matching</CardTitle>
            <CardDescription>Transfers and card payments are excluded from income and spending so nothing is counted twice.</CardDescription>
          </div>
          <ArrowLeftRight className="size-5 text-accent-ink" aria-hidden />
        </CardHeader>
        {link && partner ? (
          <div className="space-y-3">
            <p className="text-sm">
              Linked as a {link.kind === "credit_card_payment" ? "credit card payment" : "transfer"}
              {link.detectedBy === "rule" ? " (detected automatically)" : " (linked by you)"} with:
            </p>
            <Link href={`/transactions/${partner.id}`} className="flex items-center justify-between gap-3 rounded-2xl bg-surface-muted px-4 py-3 text-sm">
              <span className="min-w-0">
                <span className="block truncate font-medium">{partner.displayMerchant}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {accountName(partner.accountId)} · {formatDate(partner.date)}
                </span>
              </span>
              <Money minor={partner.amountMinor} currency={partner.currency} options={{ signDisplay: "exceptZero" }} />
            </Link>
            <ActionForm action={unlinkTransferAction}>
              <input type="hidden" name="id" value={tx.id} />
              <SubmitButton variant="outline" size="sm" pendingLabel="Updating…">This isn&apos;t a transfer</SubmitButton>
            </ActionForm>
          </div>
        ) : candidates.length > 0 ? (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">Possible matching {tx.amountMinor < 0 ? "deposits" : "withdrawals"} in your other accounts:</p>
            <ul className="space-y-2">
              {candidates.map((c) => {
                const enriched = transactions.find((t) => t.id === c.id);
                return (
                  <li key={c.id} className="flex flex-col gap-2 rounded-2xl bg-surface-muted px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{enriched?.displayMerchant ?? c.description}</span>
                      <span className="block text-xs text-muted-foreground">
                        {accountName(c.accountId)} · {formatDate(c.date)} · <Money minor={c.amountMinor} currency={c.currency} options={{ signDisplay: "exceptZero" }} />
                      </span>
                    </span>
                    <ActionForm action={linkTransferAction} inlineStatus>
                      <input type="hidden" name="id" value={tx.id} />
                      <input type="hidden" name="partnerId" value={c.id} />
                      <SubmitButton size="sm" variant="blush" pendingLabel="Linking…">Link as transfer</SubmitButton>
                    </ActionForm>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            {tx.flow === "unmatched_transfer"
              ? "Categorized as a transfer, but no matching amount was found in your other accounts. It's excluded from spending until matched or recategorized."
              : "No matching transaction found in your other accounts."}
          </p>
        )}
      </Card>

      <Card aria-labelledby="original-title" className="bg-surface-muted/60">
        <CardHeader>
          <div>
            <CardTitle id="original-title">Original record</CardTitle>
            <CardDescription>
              {tx.source === "plaid" ? "As provided by your bank." : tx.source === "csv" ? "As imported from CSV." : "Entered manually."}
            </CardDescription>
          </div>
          <Lock className="size-4 text-subtle-foreground" aria-hidden />
        </CardHeader>
        <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
          <Detail label="Description" value={tx.description} />
          <Detail label="Merchant" value={tx.merchantName ?? "Not provided"} />
          <Detail label="Amount" value={<Money minor={tx.amountMinor} currency={tx.currency} options={{ signDisplay: "exceptZero" }} />} />
          <Detail label="Date" value={formatDate(tx.date, { month: "long", day: "numeric", year: "numeric" })} />
          <Detail label="Status" value={tx.status === "pending" ? "Pending" : "Posted"} />
          <Detail label="Default category" value={providerCategory?.name ?? "None"} />
          <Detail label="Account" value={account ? accountName(account.id) : "Unknown"} />
          <Detail label="Source" value={tx.source === "plaid" ? "Bank connection" : tx.source === "csv" ? "CSV import" : "Manual entry"} />
        </dl>
        <p className="mt-4 flex items-start gap-1.5 text-xs text-muted-foreground">
          <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          Amounts use one convention everywhere: negative is money leaving the account.
        </p>
      </Card>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="break-words">{value}</dd>
    </div>
  );
}
