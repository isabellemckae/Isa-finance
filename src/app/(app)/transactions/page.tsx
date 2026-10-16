import Link from "next/link";
import { CircleAlert, CircleCheck, Plus, Upload } from "lucide-react";
import { loadPageData } from "@/lib/data/load";
import { filterTransactions, filtersToQuery, groupByDay, paginate, parseTransactionFilters } from "@/lib/finance/filters";
import { reviewQueue } from "@/lib/finance/review";
import { summarizePeriod } from "@/lib/finance/classification";
import { formatDate } from "@/lib/finance/dates";
import { addMinor } from "@/lib/finance/money";
import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Money } from "@/components/ui/money";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterBar } from "@/components/transactions/filter-bar";
import { TransactionRow } from "@/components/transactions/transaction-list";

export const metadata = { title: "Activity" };

export default async function TransactionsPage({ searchParams }: PageProps<"/transactions">) {
  const params = await searchParams;
  const filters = parseTransactionFilters(params);
  const { data, transactions } = await loadPageData();
  const review = reviewQueue(data, transactions);
  const results = filterTransactions(transactions, filters, review.ambiguousIds);
  const page = paginate(results, filters.page);
  const groups = groupByDay(page.items);
  const accountName = new Map(data.accounts.map((a) => [a.id, a.nickname ?? a.name]));
  const totals = summarizePeriod(results, "0000-01-01", "9999-12-31");
  const net = results.reduce((s, t) => addMinor(s, t.amountMinor), 0);
  const imported = typeof params.imported === "string" ? Number(params.imported) : null;
  const linked = typeof params.linked === "string" ? Number(params.linked) : 0;
  const currency = data.profile.baseCurrency;
  const hasManual = data.accounts.some((a) => a.source === "manual");

  return (
    <div className="space-y-5">
      <PageHeader
        title="Activity"
        description="Every account in one place. Original bank data is never changed; your edits are kept separately."
        actions={
          <>
            <Button asChild size="sm" variant="blush">
              <Link href="/transactions/import">
                <Upload aria-hidden /> Import CSV
              </Link>
            </Button>
            {hasManual && (
              <Button asChild size="sm" variant="outline">
                <Link href="/transactions/new">
                  <Plus aria-hidden /> Add
                </Link>
              </Button>
            )}
          </>
        }
      />

      {imported !== null && Number.isFinite(imported) && (
        <p role="status" className="flex items-start gap-2 rounded-2xl bg-positive-soft px-4 py-3 text-sm text-positive">
          <CircleCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
          Imported {imported} transaction{imported === 1 ? "" : "s"}
          {linked > 0 ? ` and linked ${linked} transfer${linked === 1 ? "" : "s"}` : ""}. Re-importing the same file won&apos;t create duplicates.
        </p>
      )}

      {review.ids.size > 0 && filters.type !== "review" && (
        <Link
          href={`/transactions${filtersToQuery({ type: "review" })}`}
          className="flex items-center justify-between gap-3 rounded-2xl bg-attention-soft px-4 py-3 text-sm text-attention"
        >
          <span className="flex items-center gap-2">
            <CircleAlert className="size-4 shrink-0" aria-hidden />
            {review.ids.size} transaction{review.ids.size === 1 ? " needs" : "s need"} a category or transfer review
          </span>
          <span className="font-medium">Review</span>
        </Link>
      )}

      <FilterBar filters={filters} accounts={data.accounts} categories={data.categories} />

      <div className="flex flex-wrap gap-x-5 gap-y-1 px-1 text-sm text-muted-foreground" aria-live="polite">
        <span>
          {results.length} result{results.length === 1 ? "" : "s"}
        </span>
        <span>
          Income <Money minor={totals.incomeMinor} currency={currency} className="text-foreground" />
        </span>
        <span>
          Spending <Money minor={totals.spendingMinor} currency={currency} className="text-foreground" />
        </span>
        <span>
          Net <Money minor={net} currency={currency} options={{ signDisplay: "exceptZero" }} className="text-foreground" />
        </span>
      </div>

      {results.length === 0 ? (
        <EmptyState icon={CircleCheck} title="Nothing matches">
          Try a different search or <Link href="/transactions" className="font-medium text-accent-ink">clear the filters</Link>.
        </EmptyState>
      ) : (
        <div className="space-y-4">
          {groups.map((g) => (
            <section key={g.date} aria-labelledby={`day-${g.date}`}>
              <div className="mb-1.5 flex items-baseline justify-between px-1">
                <h2 id={`day-${g.date}`} className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  {formatDate(g.date, { weekday: "short", month: "short", day: "numeric", year: "numeric" })}
                </h2>
                <Money minor={g.netMinor} currency={currency} options={{ signDisplay: "exceptZero" }} className="text-xs text-muted-foreground" />
              </div>
              <Card className="p-1.5 sm:p-2">
                <ul className="divide-y divide-border">
                  {g.transactions.map((tx) => (
                    <TransactionRow
                      key={tx.id}
                      tx={tx}
                      accountName={accountName.get(tx.accountId)}
                      showDate={false}
                      needsReview={review.ids.has(tx.id)}
                    />
                  ))}
                </ul>
              </Card>
            </section>
          ))}
          {page.hasMore && (
            <div className="flex justify-center">
              <Button asChild variant="outline">
                <Link href={`/transactions${filtersToQuery({ ...filters, page: page.page + 1 })}`} scroll={false}>
                  Show more ({page.total - page.items.length} remaining)
                </Link>
              </Button>
            </div>
          )}
        </div>
      )}
      <p className="px-1 text-xs text-muted-foreground">Showing the last 13 months. Transfers between your accounts and card payments aren&apos;t counted as income or spending.</p>
    </div>
  );
}
