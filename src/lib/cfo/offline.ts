import { executeTool, type DataStatus, type ToolResult } from "./tools";
import { summarizePeriod } from "@/lib/finance/classification";
import { addMonths, endOfMonth, startOfMonth } from "@/lib/finance/dates";
import { divRoundHalfUp, formatMoney } from "@/lib/finance/money";
import type { CfoContext } from "./context";
import type { ToolCallRecord } from "./agent";

/**
 * Offline Personal CFO: answers common questions WITHOUT a language model by mapping
 * them to the same read-only tools and filling templates from their results. Used when
 * OpenAI is not configured, over budget, or unavailable. Every number comes from the
 * deterministic services.
 */

export interface OfflineAnswer {
  text: string;
  mode: "offline";
  toolCalls: ToolCallRecord[];
  dataStatus: DataStatus | null;
  unverifiedAmounts: string[];
  usage: { inputTokens: number; outputTokens: number };
  stoppedEarly: false;
}

type Money = { minor: number; formatted: string };
// Tool data shapes are produced in tools.ts; offline templates read them loosely.
type Data = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function call(ctx: CfoContext, name: string, args: Record<string, unknown>, calls: ToolCallRecord[]): { data: Data; meta: ToolResult["meta"] } | null {
  const r = executeTool(name, JSON.stringify(args), ctx);
  calls.push({ name, ok: r.ok, status: r.result?.meta.status, period: r.result?.meta.period });
  return r.result ? { data: r.result.data as Data, meta: r.result.meta } : null;
}

/** Extracts a dollar amount the user typed ("$250", "250", "1,200.50"). */
export function extractUserAmount(text: string): string | null {
  const m = text.match(/\$\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?|\b(\d{2,7})(?:\.(\d{1,2}))?\b/);
  if (!m) return null;
  const whole = (m[1] ?? m[3]).replace(/,/g, "");
  const frac = m[2] ?? m[4];
  return frac ? `${whole}.${frac}` : whole;
}

const bullets = (items: string[]) => items.filter(Boolean).map((i) => `• ${i}`).join("\n");
const notesLine = (meta: ToolResult["meta"]) => (meta.notes.length ? `\n\n_${meta.notes.join(" ")}_` : "");

const INTENTS: Array<{ test: RegExp; run: (q: string, ctx: CfoContext, calls: ToolCallRecord[]) => string | null }> = [
  {
    test: /\b(afford|can i (buy|spend|get|pay for))\b/,
    run(q, ctx, calls) {
      const amount = extractUserAmount(q);
      if (!amount) return "Tell me the amount, for example: “Can I afford $250 this weekend?”";
      const r = call(ctx, "check_affordability", { amount, by_date: null, description: null }, calls);
      if (!r) return null;
      const d = r.data;
      const verdict =
        d.verdict === "fits"
          ? `Yes, **${d.purchase.formatted}** fits.`
          : d.verdict === "tight"
            ? `It's **tight**: ${d.purchase.formatted} only fits by dipping into your safety buffer.`
            : `I'd hold off: **${d.purchase.formatted}** doesn't fit your current plan.`;
      return `${verdict}\n\n${bullets([
        `Safe-to-spend through ${d.through}: ${d.safeToSpendBefore.formatted} now, ${d.safeToSpendAfter.formatted} after the purchase (estimate).`,
        `Projected lowest balance afterwards: ${d.projectedLowestBalanceAfterPurchase.balance.formatted} around ${d.projectedLowestBalanceAfterPurchase.date} (projection).`,
        `Safety buffer: ${d.safetyBuffer.formatted}.`,
      ])}${notesLine(r.meta)}`;
    },
  },
  {
    test: /\b(safe to spend|safely spend|how much can i spend|left to spend|spend this (weekend|week))\b/,
    run(_q, ctx, calls) {
      const r = call(ctx, "get_safe_to_spend", { through_date: null }, calls);
      if (!r) return null;
      const d = r.data;
      return `${d.isShortfall ? "You're short" : "You can safely spend about"} **${d.safeToSpend.formatted}** through ${d.through} (estimate).\n\n${bullets(
        d.components.map((c: { item: string; amount: Money }) => `${c.item}: ${c.amount.formatted}`),
      )}${d.warnings.length ? `\n\nData gaps: ${d.warnings.join(" ")}` : ""}${notesLine(r.meta)}`;
    },
  },
  {
    test: /\b(bills?|due|upcoming payments?)\b/,
    run(_q, ctx, calls) {
      const r = call(ctx, "get_upcoming_bills", { days: 30 }, calls);
      if (!r) return null;
      const d = r.data;
      if (!d.bills.length) return "No bills are due in the next 30 days.";
      return `**${d.bills.length} bills** are due in the next 30 days, **${d.total.formatted}** in total.\n\n${bullets(
        d.bills.slice(0, 8).map((b: { name: string; due: string; amount: Money; amountIsEstimate: boolean }) => `${b.due}: ${b.name}, ${b.amount.formatted}${b.amountIsEstimate ? " (estimate)" : ""}`),
      )}${notesLine(r.meta)}`;
    },
  },
  {
    test: /\b(increase|increased|went up|more than last|compared?|vs\.? last|changed)\b/,
    run(_q, ctx, calls) {
      const r = call(ctx, "compare_spending", { month: null }, calls);
      if (!r) return null;
      const d = r.data;
      const up = d.categories.filter((c: { direction: string }) => c.direction === "up").slice(0, 4);
      return `Spending is **${d.spending.current.formatted}** this month vs **${d.spending.previous.formatted}** over the same days last month (change: ${d.spending.change.formatted}).\n\n${
        up.length
          ? `Biggest increases:\n${bullets(up.map((c: { category: string; change: Money; previous: Money; current: Money }) => `${c.category}: ${c.previous.formatted} → ${c.current.formatted} (+${c.change.formatted.replace("-", "")})`))}`
          : "No category increased."
      }${notesLine(r.meta)}`;
    },
  },
  {
    test: /\bhow much should i budget for ([a-z &]+)/,
    run(q, ctx, calls) {
      const name = q.match(/budget for ([a-z &]+)/)?.[1]?.trim().replace(/\?$/, "") ?? "";
      const category = ctx.data.categories.find((c) => c.name.toLowerCase() === name || c.name.toLowerCase().startsWith(name));
      if (!category) return `I couldn't find a category called “${name}”.`;
      calls.push({ name: "category_average", ok: true, status: "actual" });
      const months = [1, 2, 3].map((k) => addMonths(startOfMonth(ctx.asOf), -k));
      const totals = months.map(
        (m) => summarizePeriod(ctx.transactions, m, endOfMonth(m)).byCategory.find((c) => c.categoryId === category.id)?.spentMinor ?? 0,
      );
      const average = Number(divRoundHalfUp(BigInt(totals.reduce((s, v) => s + v, 0)), 3n));
      const fmt = (m: number) => formatMoney(m, ctx.currency);
      return `Over the last three full months you spent an average of **${fmt(average)}** a month on ${category.name}.\n\n${bullets(
        months.map((m, i) => `${m.slice(0, 7)}: ${fmt(totals[i])}`),
      )}\n\nA budget near ${fmt(average)} matches your recent habits; set it lower if you want to cut back.`;
    },
  },
  {
    test: /\b(budget|over budget|on track)\b/,
    run(_q, ctx, calls) {
      const r = call(ctx, "get_budget_status", { month: null }, calls);
      if (!r) return null;
      const d = r.data;
      if (!d.hasBudget) return "You don't have a budget for this month yet. Add one under Budget.";
      const over = d.lines.filter((l: { status: string }) => l.status === "over");
      return `You've spent **${d.spendingActual.formatted}** of **${d.spendingPlanned.formatted}** planned this month (${d.spendingRemaining.formatted} remaining).\n\n${
        over.length
          ? `Over budget:\n${bullets(over.map((l: { category: string; actual: Money; planned: Money }) => `${l.category}: ${l.actual.formatted} of ${l.planned.formatted}`))}`
          : "No category is over budget."
      }${notesLine(r.meta)}`;
    },
  },
  {
    test: /\b(debt|pay off|payoff|interest|credit card)\b/,
    run(q, ctx, calls) {
      const amount = extractUserAmount(q);
      if (amount) {
        const r = call(ctx, "simulate_debt_payoff", { debt_name: null, monthly_payment: amount }, calls);
        if (!r || !r.data.found || r.data.balanceKnown === false) return "I couldn't find a debt plan with a known balance to simulate.";
        const d = r.data;
        return d.paysOff
          ? `Paying **${d.monthlyPayment.formatted}** a month on ${d.name} (${d.balanceOwed.formatted} owed) pays it off in **${d.months} months** (${d.payoffMonth}), with ${d.totalInterest.formatted} in interest (projection).${
              d.comparedWithCurrentPlan
                ? `\n\n• Versus your current plan of ${d.comparedWithCurrentPlan.currentPlanPayment.formatted}: ${d.comparedWithCurrentPlan.monthsDifference} months difference.`
                : ""
            }`
          : `**${d.monthlyPayment.formatted}** a month ${d.paymentTooLowToCoverInterest ? "doesn't cover the monthly interest" : "isn't enough to pay it off within 50 years"} on ${d.name}.`;
      }
      const r = call(ctx, "get_debts", {}, calls);
      if (!r) return null;
      const debts = r.data.debts as Array<{ name: string; balanceOwed: Money | null; apr: string; atPlannedPayment: { months: number; payoffMonth: string; totalInterest: Money } | null; plannedPayment: Money }>;
      if (!debts.length) return "You don't have any debt plans yet. Add one under Budget → Goals.";
      return bullets(
        debts.map((d) =>
          d.balanceOwed && d.atPlannedPayment
            ? `${d.name}: ${d.balanceOwed.formatted} at ${d.apr}. At ${d.plannedPayment.formatted}/month it's paid off by ${d.atPlannedPayment.payoffMonth} with ${d.atPlannedPayment.totalInterest.formatted} interest (projection).`
            : `${d.name}: balance unknown.`,
        ),
      );
    },
  },
  {
    test: /\b(save|saving|savings|goal)\b/,
    run(_q, ctx, calls) {
      const r = call(ctx, "get_savings_goals", {}, calls);
      if (!r) return null;
      const goals = r.data.goals as Array<{ name: string; saved: Money; target: Money; progress: string; projectedCompletion: string | null }>;
      if (!goals.length) return "You don't have savings goals yet. Add one under Budget → Goals.";
      return `${bullets(goals.map((g) => `${g.name}: ${g.saved.formatted} of ${g.target.formatted} (${g.progress})${g.projectedCompletion ? `, on pace for ${g.projectedCompletion.slice(0, 7)}` : ""}`))}\n\n_Completion dates are projections._`;
    },
  },
  {
    test: /\b(forecast|cash flow|run out|next (30|60|90) days|low point)\b/,
    run(_q, ctx, calls) {
      const r = call(ctx, "forecast_cash_flow", { days: 30, include_expected_income: true }, calls);
      if (!r) return null;
      const d = r.data;
      return `**Projection** for the next 30 days: starting from ${d.startingCash.formatted}, your checking and cash would end near **${d.endingBalance.formatted}**, with a low point of **${d.lowestPoint.balance.formatted}** around ${d.lowestPoint.date}.\n\n${bullets([
        `Paychecks: ${d.totals.income.formatted}`,
        `Bills: ${d.totals.bills.formatted}`,
        `Debt payments: ${d.totals.debtPayments.formatted}`,
        `Everyday spending at your usual pace: ${d.totals.everydaySpending.formatted}`,
      ])}\n\n_${d.assumptions.join(" ")}_`;
    },
  },
  {
    test: /\b(balance|balances|net worth|how much (money|cash)|accounts?)\b/,
    run(_q, ctx, calls) {
      const r = call(ctx, "get_account_balances", {}, calls);
      if (!r) return null;
      const t = r.data.totals;
      return `You have **${t.cash.formatted}** in cash accounts and **${t.creditCardDebt.formatted}** of card debt; net worth is **${t.netWorth.formatted}**.\n\n${bullets(
        (r.data.accounts as Array<{ name: string; current: Money | null; currentMeaning: string; balanceStatus: string }>).map(
          (a) => `${a.name}: ${a.current?.formatted ?? "no balance"} (${a.currentMeaning}${a.balanceStatus !== "current" ? `, ${a.balanceStatus.replaceAll("_", " ")}` : ""})`,
        ),
      )}${notesLine(r.meta)}`;
    },
  },
  {
    test: /\b(reduce|cut|cut back|unnecessary|save money|spend less)\b/,
    run(_q, ctx, calls) {
      const s = call(ctx, "get_spending_summary", { period: "last_30_days", start_date: null, end_date: null }, calls);
      const i = call(ctx, "get_insights", {}, calls);
      if (!s) return null;
      const top = (s.data.byCategory as Array<{ category: string; spent: Money; shareOfSpending: string }>).slice(0, 4);
      return `Your biggest spending categories over the last 30 days:\n${bullets(top.map((c) => `${c.category}: ${c.spent.formatted} (${c.shareOfSpending})`))}${
        i && i.data.insights.length ? `\n\nWorth a look:\n${bullets(i.data.insights.slice(0, 3).map((x: { title: string }) => x.title))}` : ""
      }\n\nFixed costs (rent, utilities) are hard to change quickly; flexible categories like dining and shopping are usually where small cuts add up.`;
    },
  },
  {
    test: /\b(where did|spent|spending|spend on|money go|how am i doing|summary|this month|last month|this week)\b/,
    run(q, ctx, calls) {
      const period = /last month/.test(q) ? "last_month" : /this week|last 7/.test(q) ? "this_week" : "this_month";
      const r = call(ctx, "get_spending_summary", { period, start_date: null, end_date: null }, calls);
      if (!r) return null;
      const d = r.data;
      return `From ${r.meta.period?.start} to ${r.meta.period?.end} you spent **${d.spending.formatted}** (${d.spendingPending.formatted} still pending) and earned **${d.income.formatted}**.\n\nWhere it went:\n${bullets(
        (d.byCategory as Array<{ category: string; spent: Money; shareOfSpending: string }>).slice(0, 6).map((c) => `${c.category}: ${c.spent.formatted} (${c.shareOfSpending})`),
      )}${notesLine(r.meta)}`;
    },
  },
];

export const OFFLINE_HELP =
  "I can answer questions like:\n• Where did my money go this month?\n• How much can I safely spend this weekend?\n• Can I afford $250?\n• What bills are coming up?\n• Which expenses have increased?\n• How much should I budget for groceries?\n• How would paying $500 a month change my credit card payoff?\n• What does my cash flow look like for the next 30 days?";

export function answerOffline(question: string, ctx: CfoContext): OfflineAnswer {
  const q = question.toLowerCase();
  const calls: ToolCallRecord[] = [];
  let text: string | null = null;
  for (const intent of INTENTS) {
    if (intent.test.test(q)) {
      text = intent.run(q, ctx, calls);
      if (text) break;
    }
  }
  const rank = { actual: 0, estimate: 1, projection: 2 } as const;
  const dataStatus = calls.reduce<DataStatus | null>(
    (best, c) => (c.status && (!best || rank[c.status] > rank[best]) ? c.status : best),
    null,
  );
  return {
    text: text ?? OFFLINE_HELP,
    mode: "offline",
    toolCalls: calls,
    dataStatus,
    unverifiedAmounts: [],
    usage: { inputTokens: 0, outputTokens: 0 },
    stoppedEarly: false,
  };
}
