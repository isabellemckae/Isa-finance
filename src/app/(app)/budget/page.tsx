import Link from "next/link";
import { ChevronLeft, ChevronRight, CopyPlus, TrendingDown, TrendingUp } from "lucide-react";
import { loadPageData } from "@/lib/data/load";
import { computeBudgetPerformance, type BudgetLine } from "@/lib/finance/budget";
import { addMonths, endOfMonth, formatMonth, monthFromParam, startOfMonth } from "@/lib/finance/dates";
import { addMinor } from "@/lib/finance/money";
import { compareMonths, planIncomeForMonth } from "@/lib/finance/planning";
import { UNCATEGORIZED } from "@/lib/finance/filters";
import { copyPreviousBudgetAction, setAllocationAction } from "@/lib/actions/budget";
import { PageHeader } from "@/components/layout/page-header";
import { DemoEditsNote } from "@/components/layout/demo-edits-note";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Money } from "@/components/ui/money";
import { Field, MoneyInput, Select } from "@/components/ui/field";
import { ActionForm, SubmitButton } from "@/components/forms/action-form";
import { AllocationRow } from "@/components/budget/allocation-row";
import { cn } from "@/lib/utils";

export const metadata = { title: "Budget" };

const KINDS: BudgetLine["kind"][] = ["fixed", "variable", "savings", "debt"];

const SECTIONS: Array<{ kind: BudgetLine["kind"]; title: string; description: string }> = [
  { kind: "fixed", title: "Fixed expenses", description: "Rent, utilities, subscriptions: roughly the same each month." },
  { kind: "variable", title: "Variable spending", description: "Groceries, dining, shopping: where day-to-day choices happen." },
  { kind: "savings", title: "Savings", description: "Money moved to savings (transfers in the Savings category)." },
  { kind: "debt", title: "Debt payments", description: "Card and loan payments (Credit card payment category)." },
];

export default async function BudgetPage({ searchParams }: PageProps<"/budget">) {
  const params = await searchParams;
  const { data, transactions, asOf, currency, isDemo } = await loadPageData();
  const month = monthFromParam(params.month, asOf);
  const prevMonth = addMonths(month, -1);
  const nextMonth = addMonths(month, 1);
  const isCurrent = month === startOfMonth(asOf);

  const budget = data.budgets.find((b) => b.month === month && b.currency === currency);
  const prevBudget = data.budgets.find((b) => b.month === prevMonth && b.allocations.length > 0);
  const perf = budget ? computeBudgetPerformance(budget, transactions, data.categories) : null;
  const income = planIncomeForMonth(data.incomeSources, transactions, month);
  const comparison = compareMonths(transactions, month, asOf);
  const planned = (kind: BudgetLine["kind"]) =>
    (perf?.lines ?? []).filter((l) => l.kind === kind).reduce((s, l) => addMinor(s, l.plannedMinor), 0);
  const totalPlanned = KINDS.reduce((s, k) => addMinor(s, planned(k)), 0);
  const leftToAssign = income.expectedMinor - totalPlanned;
  const allocated = new Set(budget?.allocations.map((a) => a.categoryId));
  const addable = data.categories.filter((c) => c.kind !== "income" && !allocated.has(c.id));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Budget"
        description="Plan the month, then compare it with actual spending. Transfers and card payments never count as spending."
      />

      <nav aria-label="Month" className="flex items-center justify-between gap-2 rounded-full border border-border bg-surface p-1">
        <Button asChild variant="ghost" size="icon">
          <Link href={`/budget?month=${prevMonth.slice(0, 7)}`} aria-label={`Previous month, ${formatMonth(prevMonth)}`}>
            <ChevronLeft aria-hidden />
          </Link>
        </Button>
        <div className="text-center">
          <p className="font-display text-lg leading-tight">{formatMonth(month)}</p>
          {!isCurrent && (
            <Link href="/budget" className="text-xs font-medium text-accent-ink">
              Back to this month
            </Link>
          )}
        </div>
        <Button asChild variant="ghost" size="icon">
          <Link href={`/budget?month=${nextMonth.slice(0, 7)}`} aria-label={`Next month, ${formatMonth(nextMonth)}`}>
            <ChevronRight aria-hidden />
          </Link>
        </Button>
      </nav>

      <section aria-label="Month summary" className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <SummaryTile label="Expected income" minor={income.expectedMinor} currency={currency}>
          <Money minor={income.receivedMinor} currency={currency} /> received so far
          {income.unplannedSources.length > 0 &&
            ` · ${income.unplannedSources.length} irregular source${income.unplannedSources.length === 1 ? "" : "s"} not counted`}
        </SummaryTile>
        <SummaryTile label="Planned" minor={totalPlanned} currency={currency}>
          Spending, savings and debt
        </SummaryTile>
        <SummaryTile label="Spent" minor={perf?.spending.actualMinor ?? 0} currency={currency}>
          of <Money minor={perf?.spending.plannedMinor ?? 0} currency={currency} /> planned spending
        </SummaryTile>
        <SummaryTile label="Left to assign" minor={leftToAssign} currency={currency} tone={leftToAssign < 0 ? "attention" : "default"}>
          {leftToAssign < 0 ? "Plan exceeds expected income" : "Expected income not yet planned"}
        </SummaryTile>
      </section>

      {!budget || budget.allocations.length === 0 ? (
        <Card className="space-y-3 text-center">
          <p className="font-display text-xl">No plan for {formatMonth(month)} yet</p>
          <p className="text-sm text-muted-foreground">Start from last month&apos;s plan, or add categories below.</p>
          {prevBudget && (
            <ActionForm action={copyPreviousBudgetAction} className="flex flex-col items-center">
              <input type="hidden" name="month" value={month} />
              <SubmitButton variant="blush" pendingLabel="Copying…">
                <CopyPlus aria-hidden /> Copy {formatMonth(prevMonth, "short")} plan
              </SubmitButton>
            </ActionForm>
          )}
        </Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          {SECTIONS.map((section) => {
            const lines = (perf?.lines ?? []).filter((l) => l.kind === section.kind).sort((a, b) => b.plannedMinor - a.plannedMinor);
            if (lines.length === 0) return null;
            const actual = lines.reduce((s, l) => addMinor(s, l.actualMinor), 0);
            return (
              <Card key={section.kind} aria-labelledby={`sec-${section.kind}`}>
                <CardHeader className="mb-1">
                  <div>
                    <CardTitle id={`sec-${section.kind}`}>{section.title}</CardTitle>
                    <CardDescription>{section.description}</CardDescription>
                  </div>
                  <p className="shrink-0 text-right text-sm">
                    <Money minor={actual} currency={currency} className="font-medium" />
                    <span className="block text-xs text-muted-foreground">
                      of <Money minor={planned(section.kind)} currency={currency} />
                    </span>
                  </p>
                </CardHeader>
                <ul className="divide-y divide-border">
                  {lines.map((line) => (
                    <AllocationRow key={line.categoryId} line={line} month={month} currency={currency} />
                  ))}
                </ul>
              </Card>
            );
          })}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card aria-labelledby="add-title">
          <CardHeader>
            <div>
              <CardTitle id="add-title">Add to {formatMonth(month, "short")} plan</CardTitle>
              <CardDescription>Set a planned amount for a category.</CardDescription>
            </div>
          </CardHeader>
          {addable.length === 0 ? (
            <p className="text-sm text-muted-foreground">Every category is already in this month&apos;s plan.</p>
          ) : (
            <ActionForm action={setAllocationAction} className="space-y-4" resetOnSuccess>
              <input type="hidden" name="month" value={month} />
              <Field label="Category" htmlFor="add-category">
                <Select id="add-category" name="categoryId" required>
                  {addable.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Type" htmlFor="add-kind">
                  <Select id="add-kind" name="kind" defaultValue="variable">
                    <option value="fixed">Fixed</option>
                    <option value="variable">Variable</option>
                    <option value="savings">Savings</option>
                    <option value="debt">Debt</option>
                  </Select>
                </Field>
                <Field label="Amount" htmlFor="add-planned">
                  <MoneyInput id="add-planned" name="planned" required placeholder="0.00" />
                </Field>
              </div>
              <SubmitButton>Add to plan</SubmitButton>
            </ActionForm>
          )}
          <div className="mt-3">
            <DemoEditsNote show={isDemo} />
          </div>
        </Card>

        <Card aria-labelledby="unbudgeted-title">
          <CardHeader>
            <div>
              <CardTitle id="unbudgeted-title">Outside the plan</CardTitle>
              <CardDescription>Spending in categories without a planned amount.</CardDescription>
            </div>
          </CardHeader>
          {!perf || perf.unbudgeted.length === 0 ? (
            <p className="text-sm text-muted-foreground">All spending this month falls inside your plan.</p>
          ) : (
            <ul className="divide-y divide-border text-sm">
              {perf.unbudgeted.map((u) => (
                <li key={u.categoryId ?? UNCATEGORIZED} className="flex items-center justify-between gap-3 py-2.5">
                  <Link
                    href={`/transactions?category=${u.categoryId ?? UNCATEGORIZED}&from=${month}&to=${endOfMonth(month)}`}
                    className="hover:underline"
                  >
                    {u.name}
                  </Link>
                  <Money minor={u.actualMinor} currency={currency} />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card aria-labelledby="mom-title">
        <CardHeader>
          <div>
            <CardTitle id="mom-title">Compared with {formatMonth(comparison.previousMonth)}</CardTitle>
            <CardDescription>
              {comparison.toDate
                ? `Days 1–${comparison.throughDay} of each month, so a partial month isn't compared with a full one.`
                : "Full months."}
            </CardDescription>
          </div>
        </CardHeader>
        <div className="mb-4 grid grid-cols-2 gap-3 text-sm">
          <CompareFigure label="Spending" current={comparison.current.spendingMinor} previous={comparison.previous.spendingMinor} currency={currency} goodWhenLower />
          <CompareFigure label="Income" current={comparison.current.incomeMinor} previous={comparison.previous.incomeMinor} currency={currency} />
        </div>
        {comparison.rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No spending in either period.</p>
        ) : (
          <ul className="divide-y divide-border text-sm">
            {comparison.rows.slice(0, 8).map((r) => (
              <li key={r.categoryId ?? UNCATEGORIZED} className="flex items-center justify-between gap-3 py-2.5">
                <span className="min-w-0 truncate">{r.name}</span>
                <span className="flex shrink-0 items-center gap-3">
                  <span className="hidden text-xs text-muted-foreground sm:inline">
                    <Money minor={r.previousMinor} currency={currency} options={{ wholeUnits: true }} /> →{" "}
                    <Money minor={r.currentMinor} currency={currency} options={{ wholeUnits: true }} />
                  </span>
                  <span
                    className={cn(
                      "inline-flex min-w-20 items-center justify-end gap-1 font-medium",
                      r.changeMinor > 0 ? "text-attention" : r.changeMinor < 0 ? "text-positive" : "text-muted-foreground",
                    )}
                  >
                    {r.changeMinor > 0 ? (
                      <TrendingUp className="size-3.5" aria-label="up" />
                    ) : r.changeMinor < 0 ? (
                      <TrendingDown className="size-3.5" aria-label="down" />
                    ) : null}
                    <Money minor={r.changeMinor} currency={currency} options={{ wholeUnits: true, signDisplay: "exceptZero" }} />
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function SummaryTile({
  label,
  minor,
  currency,
  children,
  tone = "default",
}: {
  label: string;
  minor: number;
  currency: string;
  children?: React.ReactNode;
  tone?: "default" | "attention";
}) {
  return (
    <div className="rounded-[var(--radius-card)] border border-border bg-surface p-4 shadow-card">
      <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={cn("mt-1 font-display text-2xl tracking-tight", tone === "attention" && "text-attention")}>
        <Money minor={minor} currency={currency} options={{ wholeUnits: true }} />
      </p>
      {children && <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{children}</p>}
    </div>
  );
}

function CompareFigure({
  label,
  current,
  previous,
  currency,
  goodWhenLower = false,
}: {
  label: string;
  current: number;
  previous: number;
  currency: string;
  goodWhenLower?: boolean;
}) {
  const change = current - previous;
  const good = goodWhenLower ? change <= 0 : change >= 0;
  return (
    <div className="rounded-2xl bg-surface-muted px-3 py-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-medium">
        <Money minor={current} currency={currency} options={{ wholeUnits: true }} />
      </p>
      <p className={cn("text-xs", change === 0 ? "text-muted-foreground" : good ? "text-positive" : "text-attention")}>
        <Money minor={change} currency={currency} options={{ wholeUnits: true, signDisplay: "exceptZero" }} /> vs last month
      </p>
    </div>
  );
}
