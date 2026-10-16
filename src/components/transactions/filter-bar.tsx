import Link from "next/link";
import { Search, SlidersHorizontal } from "lucide-react";
import { TRANSACTION_TYPES, UNCATEGORIZED, hasActiveFilters, type TransactionFilters } from "@/lib/finance/filters";
import type { Account, Category } from "@/lib/finance/types";
import { Button } from "@/components/ui/button";
import { Field, Select, TextInput } from "@/components/ui/field";

const TYPE_LABEL: Record<(typeof TRANSACTION_TYPES)[number], string> = {
  all: "All",
  income: "Income",
  expense: "Spending",
  transfer: "Transfers",
  review: "Needs review",
};

/**
 * Plain GET form: filters live in the URL, work without JavaScript, and are
 * validated on the server (parseTransactionFilters).
 */
export function FilterBar({
  filters,
  accounts,
  categories,
}: {
  filters: TransactionFilters;
  accounts: readonly Account[];
  categories: readonly Category[];
}) {
  const active = hasActiveFilters(filters);
  const advanced = Boolean(filters.from || filters.to || filters.accountId || filters.categoryId || filters.status);
  return (
    <form method="get" action="/transactions" className="space-y-3" role="search">
      <div className="flex gap-2">
        <label htmlFor="q" className="sr-only">
          Search transactions
        </label>
        <div className="relative flex-1">
          <Search aria-hidden className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <TextInput
            id="q"
            name="q"
            type="search"
            defaultValue={filters.q}
            placeholder="Search activity"
            className="pl-10"
            maxLength={100}
            enterKeyHint="search"
          />
        </div>
        <Button type="submit" className="h-12">
          Search
        </Button>
      </div>

      <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <div className="flex gap-2" role="group" aria-label="Transaction type">
          {TRANSACTION_TYPES.map((t) => (
            <label key={t} className="shrink-0 cursor-pointer">
              <input type="radio" name="type" value={t} defaultChecked={filters.type === t} className="peer sr-only" />
              <span className="inline-flex min-h-10 items-center rounded-full border border-border bg-surface px-4 text-sm font-medium text-muted-foreground peer-checked:border-transparent peer-checked:bg-blush peer-checked:text-blush-foreground peer-focus-visible:outline-2 peer-focus-visible:outline-ring">
                {TYPE_LABEL[t]}
              </span>
            </label>
          ))}
        </div>
      </div>

      <details className="group rounded-2xl border border-border bg-surface" open={advanced}>
        <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-4 text-sm font-medium">
          <SlidersHorizontal className="size-4" aria-hidden /> More filters
          {advanced && <span className="text-xs font-normal text-accent-ink">(active)</span>}
        </summary>
        <div className="grid gap-4 border-t border-border p-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="From" htmlFor="from">
            <TextInput id="from" name="from" type="date" defaultValue={filters.from ?? ""} />
          </Field>
          <Field label="To" htmlFor="to">
            <TextInput id="to" name="to" type="date" defaultValue={filters.to ?? ""} />
          </Field>
          <Field label="Account" htmlFor="account">
            <Select id="account" name="account" defaultValue={filters.accountId ?? ""}>
              <option value="">All accounts</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.nickname ?? a.name}
                  {a.mask ? ` ••${a.mask}` : ""}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Category" htmlFor="category">
            <Select id="category" name="category" defaultValue={filters.categoryId ?? ""}>
              <option value="">All categories</option>
              <option value={UNCATEGORIZED}>Uncategorized</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Status" htmlFor="status">
            <Select id="status" name="status" defaultValue={filters.status ?? ""}>
              <option value="">Pending and posted</option>
              <option value="pending">Pending only</option>
              <option value="posted">Posted only</option>
            </Select>
          </Field>
        </div>
      </details>

      <div className="flex gap-2">
        <Button type="submit" size="sm" variant="blush">
          Apply filters
        </Button>
        {active && (
          <Button asChild size="sm" variant="ghost">
            <Link href="/transactions">Clear all</Link>
          </Button>
        )}
      </div>
    </form>
  );
}
