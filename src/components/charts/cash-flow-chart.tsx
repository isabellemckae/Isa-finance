"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatMoney } from "@/lib/finance/money";
import { formatDate } from "@/lib/finance/dates";

export interface CashFlowDatum {
  month: string;
  incomeMinor: number;
  spendingMinor: number;
  netMinor: number;
  isPartial: boolean;
}

const SERIES = [
  { key: "incomeMinor", label: "Income", color: "var(--chart-income)" },
  { key: "spendingMinor", label: "Spending", color: "var(--chart-spending)" },
] as const;

/** Monthly income vs spending. Grouped bars, one y-axis, legend + tooltip + table view. */
export function CashFlowChart({ data, currency }: { data: CashFlowDatum[]; currency: string }) {
  const rows = data.map((d) => ({
    ...d,
    label: `${formatDate(d.month, { month: "short" })}${d.isPartial ? "*" : ""}`,
  }));

  return (
    <div>
      <ul className="mb-3 flex gap-4 text-xs text-muted-foreground" aria-label="Legend">
        {SERIES.map((s) => (
          <li key={s.key} className="flex items-center gap-1.5">
            <span aria-hidden className="size-2.5 rounded-sm" style={{ background: s.color }} />
            {s.label}
          </li>
        ))}
      </ul>
      <div className="h-56 sm:h-64" aria-hidden>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} barGap={2} barCategoryGap="28%" margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={false}
              tick={{ fill: "var(--chart-axis)", fontSize: 12 }}
            />
            <YAxis
              width={52}
              tickLine={false}
              axisLine={false}
              tick={{ fill: "var(--chart-axis)", fontSize: 12 }}
              tickFormatter={(v: number) => formatMoney(v, currency, { compact: true })}
            />
            <Tooltip
              cursor={{ fill: "var(--surface-muted)" }}
              content={({ active, payload }) => <ChartTooltip active={active} payload={payload} currency={currency} />}
            />
            {SERIES.map((s) => (
              <Bar key={s.key} dataKey={s.key} name={s.label} fill={s.color} radius={[4, 4, 0, 0]} maxBarSize={28} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">* Current month to date. Transfers and card payments are excluded.</p>

      <details className="mt-3 text-sm">
        <summary className="cursor-pointer text-muted-foreground">Show as table</summary>
        <table className="mt-2 w-full text-left text-sm">
          <caption className="sr-only">Monthly income and spending</caption>
          <thead className="text-xs text-muted-foreground">
            <tr>
              <th scope="col" className="py-1 font-medium">Month</th>
              <th scope="col" className="py-1 text-right font-medium">Income</th>
              <th scope="col" className="py-1 text-right font-medium">Spending</th>
              <th scope="col" className="py-1 text-right font-medium">Net</th>
            </tr>
          </thead>
          <tbody className="tabular">
            {data.map((d) => (
              <tr key={d.month} className="border-t border-border">
                <th scope="row" className="py-1.5 font-normal">
                  {formatDate(d.month, { month: "long", year: "numeric" })}
                  {d.isPartial && " (to date)"}
                </th>
                <td className="py-1.5 text-right">{formatMoney(d.incomeMinor, currency)}</td>
                <td className="py-1.5 text-right">{formatMoney(d.spendingMinor, currency)}</td>
                <td className="py-1.5 text-right">{formatMoney(d.netMinor, currency, { signDisplay: "exceptZero" })}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}

function ChartTooltip({
  active,
  payload,
  currency,
}: {
  active?: boolean;
  payload?: ReadonlyArray<{ payload?: unknown }>;
  currency: string;
}) {
  if (!active || !payload?.length) return null;
  const datum = payload[0].payload as CashFlowDatum | undefined;
  if (!datum) return null;
  return (
    <div className="rounded-xl border border-border bg-surface px-3 py-2 text-xs shadow-card">
      <p className="mb-1 font-medium">
        {formatDate(datum.month, { month: "long", year: "numeric" })}
        {datum.isPartial && " (to date)"}
      </p>
      {SERIES.map((s) => (
        <p key={s.key} className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <span aria-hidden className="size-2 rounded-sm" style={{ background: s.color }} />
            {s.label}
          </span>
          <span className="tabular">{formatMoney(datum[s.key], currency)}</span>
        </p>
      ))}
      <p className="mt-1 flex justify-between gap-4 border-t border-border pt-1">
        <span className="text-muted-foreground">Net</span>
        <span className="tabular">{formatMoney(datum.netMinor, currency, { signDisplay: "exceptZero" })}</span>
      </p>
    </div>
  );
}
