import { ChevronDown, Info } from "lucide-react";
import { formatDate } from "@/lib/finance/dates";
import type { SafeToSpendResult } from "@/lib/finance/safe-to-spend";
import { DataStatus } from "@/components/ui/data-status";
import { Money } from "@/components/ui/money";

export function SafeToSpendCard({
  result,
  horizonReason,
}: {
  result: SafeToSpendResult;
  horizonReason: "next_paycheck" | "end_of_month";
}) {
  const { currency } = result;
  const until =
    horizonReason === "next_paycheck"
      ? `through ${formatDate(result.horizon.end, { weekday: "long", month: "short", day: "numeric" })}, before your next paycheck`
      : `through the end of the month (${formatDate(result.horizon.end)})`;

  return (
    <section
      aria-labelledby="sts-title"
      className="relative overflow-hidden rounded-[var(--radius-card)] bg-primary p-6 text-primary-foreground shadow-card sm:p-8"
    >
      <div aria-hidden className="pointer-events-none absolute -right-16 -top-20 size-64 rounded-full bg-[radial-gradient(circle,rgb(243_201_212/0.35),transparent_65%)] dark:bg-[radial-gradient(circle,rgb(29_25_27/0.25),transparent_65%)]" />
      <div className="relative">
        <div className="flex flex-wrap items-center gap-2">
          <h2 id="sts-title" className="text-xs font-medium uppercase tracking-[0.18em] opacity-80">
            Safe to spend
          </h2>
          {result.confidence === "estimated" && <DataStatus kind="estimated" />}
        </div>
        <p className="mt-3 font-display text-5xl font-medium tracking-tight sm:text-6xl">
          {result.isShortfall ? (
            <>
              <span className="sr-only">Shortfall of </span>
              <Money minor={result.amountMinor} currency={currency} options={{ wholeUnits: true }} />
            </>
          ) : (
            <Money minor={result.amountMinor} currency={currency} options={{ wholeUnits: true }} />
          )}
        </p>
        <p className="mt-2 max-w-md text-sm opacity-80">
          {result.isShortfall ? "Planned commitments exceed spendable cash " : "Discretionary money "}
          {until}.
        </p>

        <details className="group mt-6 rounded-2xl bg-white/10 p-4 text-sm dark:bg-black/10">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-2 font-medium">
            How this is calculated
            <ChevronDown className="size-4 transition-transform group-open:rotate-180" aria-hidden />
          </summary>
          <dl className="mt-4 space-y-2">
            {result.components.map((c) => (
              <div key={c.key} className="flex items-baseline justify-between gap-4">
                <dt>
                  {c.label}
                  <span className="block text-xs opacity-70">{c.detail}</span>
                </dt>
                <dd className="shrink-0">
                  <Money minor={c.amountMinor} currency={currency} options={{ signDisplay: "exceptZero" }} />
                </dd>
              </div>
            ))}
            <div className="flex justify-between gap-4 border-t border-current/20 pt-2 font-medium">
              <dt>Safe to spend</dt>
              <dd>
                <Money minor={result.amountMinor} currency={currency} />
              </dd>
            </div>
          </dl>
          <div className="mt-4 space-y-1 text-xs opacity-80">
            <p className="flex items-center gap-1 font-medium">
              <Info className="size-3.5" aria-hidden /> Assumptions
            </p>
            <ul className="list-disc space-y-0.5 pl-5">
              {result.assumptions.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
            {result.warnings.length > 0 && (
              <>
                <p className="pt-2 font-medium">Data gaps</p>
                <ul className="list-disc space-y-0.5 pl-5">
                  {result.warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </details>
      </div>
    </section>
  );
}
