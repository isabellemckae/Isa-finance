"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, ArrowUp, Calculator, Loader2, Sparkles } from "lucide-react";
import type { CfoMessageMeta } from "@/lib/cfo/service";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { DataStatus } from "@/components/ui/data-status";
import { RichText } from "./rich-text";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  metadata?: Partial<CfoMessageMeta>;
}

const TOOL_LABELS: Record<string, string> = {
  get_account_balances: "Balances",
  get_spending_summary: "Spending",
  search_transactions: "Transactions",
  get_budget_status: "Budget",
  get_upcoming_bills: "Bills",
  get_income: "Income",
  get_savings_goals: "Savings goals",
  get_debts: "Debts",
  simulate_debt_payoff: "Payoff simulation",
  forecast_cash_flow: "Cash-flow forecast",
  get_safe_to_spend: "Safe-to-spend",
  check_affordability: "Affordability check",
  compare_spending: "Month comparison",
  get_insights: "Insights",
  get_briefing: "Briefing",
  category_average: "Category history",
};

function Sources({ meta }: { meta: Partial<CfoMessageMeta> }) {
  const tools = [...new Set((meta.toolCalls ?? []).filter((t) => t.ok).map((t) => TOOL_LABELS[t.name] ?? t.name))];
  const periods = meta.periods ?? [];
  return (
    <div className="mt-3 space-y-2 border-t border-border pt-3">
      <div className="flex flex-wrap items-center gap-1.5">
        {meta.mode === "offline" && (
          <Badge variant="info">
            <Calculator aria-hidden /> Calculated answer
          </Badge>
        )}
        {meta.dataStatus === "estimate" && <DataStatus kind="estimated" label="Includes estimates" />}
        {meta.dataStatus === "projection" && <DataStatus kind="estimated" label="Includes projections" />}
        {meta.isDemo && <DataStatus kind="demo" label="Fictional data" />}
      </div>
      {tools.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Based on: {tools.join(" · ")}
          {periods.length > 0 && ` · ${periods.map((p) => (p.start === p.end ? p.start : `${p.start} – ${p.end}`)).join(", ")}`}
        </p>
      )}
      {meta.notice && <p className="text-xs text-muted-foreground">{meta.notice}</p>}
      {meta.unverifiedAmounts && meta.unverifiedAmounts.length > 0 && (
        <p className="flex items-start gap-1.5 text-xs text-attention">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          Couldn&apos;t verify {meta.unverifiedAmounts.join(", ")} against your data. Treat {meta.unverifiedAmounts.length === 1 ? "it" : "them"} with caution.
        </p>
      )}
    </div>
  );
}

export function CfoChat({
  conversationId: initialConversationId,
  initialMessages,
  suggestions,
  aiEnabled,
}: {
  conversationId: string | null;
  initialMessages: ChatMessage[];
  suggestions: string[];
  aiEnabled: boolean;
}) {
  const [conversationId, setConversationId] = useState(initialConversationId);
  const [messages, setMessages] = useState(initialMessages);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: messages.length > 1 ? "smooth" : "auto", block: "end" });
  }, [messages, pending]);

  async function send(text: string) {
    const message = text.trim();
    if (!message || pending) return;
    setError(null);
    setPending(true);
    setDraft("");
    setMessages((m) => [...m, { role: "user", content: message }]);
    try {
      const res = await fetch("/api/cfo/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId, message }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        conversationId?: string;
        message?: ChatMessage;
      };
      if (!res.ok || !body.message || !body.conversationId) {
        throw new Error(body.error ?? "The Personal CFO couldn't answer right now.");
      }
      setMessages((m) => [...m, body.message!]);
      if (body.conversationId !== conversationId) {
        setConversationId(body.conversationId);
        window.history.replaceState(null, "", `/cfo?c=${encodeURIComponent(body.conversationId)}`);
      }
    } catch (e) {
      setMessages((m) => m.slice(0, -1));
      setDraft(message);
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setPending(false);
      inputRef.current?.focus();
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {messages.length === 0 && (
        <div className="rounded-[var(--radius-card)] border border-border bg-blush/40 p-5 sm:p-6">
          <p className="flex items-center gap-2 font-display text-xl">
            <Sparkles className="size-5 text-accent-ink" aria-hidden /> Ask your Personal CFO
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Answers use your accounts, transactions, budget and plans, with every number calculated by ISA Finance.
            {!aiEnabled && " AI is off, so common questions get calculated answers."}
          </p>
          <ul className="mt-4 flex flex-wrap gap-2" aria-label="Suggested questions">
            {suggestions.map((s) => (
              <li key={s}>
                <button
                  type="button"
                  onClick={() => send(s)}
                  className="min-h-10 rounded-full border border-border bg-surface px-4 py-2 text-left text-sm transition-colors hover:bg-surface-muted"
                >
                  {s}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <ol className="flex flex-col gap-4" aria-live="polite" aria-label="Conversation">
        {messages.map((m, i) => (
          <li key={i} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
            {m.role === "user" ? (
              <div className="max-w-[85%] whitespace-pre-wrap rounded-3xl rounded-br-lg bg-primary px-4 py-3 text-[15px] text-primary-foreground">
                <span className="sr-only">You said: </span>
                {m.content}
              </div>
            ) : (
              <div className="w-full max-w-[min(100%,42rem)] rounded-3xl rounded-bl-lg border border-border bg-surface px-4 py-4 shadow-card sm:px-5">
                <p className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-accent-ink">
                  <Sparkles className="size-3.5" aria-hidden /> Personal CFO
                </p>
                <RichText text={m.content} />
                {m.metadata && <Sources meta={m.metadata} />}
              </div>
            )}
          </li>
        ))}
        {pending && (
          <li className="flex justify-start" aria-label="The Personal CFO is working">
            <div className="flex items-center gap-2 rounded-3xl rounded-bl-lg border border-border bg-surface px-4 py-3 text-sm text-muted-foreground shadow-card">
              <Loader2 className="size-4 animate-spin" aria-hidden /> Checking your numbers…
            </div>
          </li>
        )}
      </ol>
      <div ref={endRef} />

      {error && (
        <p role="alert" className="flex items-start gap-2 rounded-2xl bg-attention-soft px-4 py-3 text-sm text-attention">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          {error}
        </p>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(draft);
        }}
        className="sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-30 flex items-end gap-2 rounded-[1.75rem] border border-border bg-surface/95 p-2 shadow-card backdrop-blur lg:bottom-4"
      >
        <label htmlFor="cfo-input" className="sr-only">
          Ask a question
        </label>
        <textarea
          id="cfo-input"
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send(draft);
            }
          }}
          rows={1}
          maxLength={2000}
          placeholder="Ask about spending, bills, savings…"
          className="max-h-40 min-h-11 flex-1 resize-none bg-transparent px-3 py-2.5 text-base outline-none placeholder:text-subtle-foreground [field-sizing:content]"
        />
        <button
          type="submit"
          disabled={pending || !draft.trim()}
          aria-label="Send"
          className="flex size-11 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-opacity disabled:opacity-40"
        >
          {pending ? <Loader2 className="size-5 animate-spin" aria-hidden /> : <ArrowUp className="size-5" aria-hidden />}
        </button>
      </form>
      <p className="text-center text-xs text-muted-foreground">
        Read-only: the CFO can&apos;t move money or change anything. Not professional financial, tax or legal advice.
      </p>
    </div>
  );
}
