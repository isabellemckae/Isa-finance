import Link from "next/link";
import { AlertTriangle, ChevronRight, CircleAlert, Lightbulb, Sparkles } from "lucide-react";
import type { InsightSeverity, ProactiveInsight } from "@/lib/finance/insights";
import { cn } from "@/lib/utils";
import { DataStatus } from "@/components/ui/data-status";

const ICON: Record<InsightSeverity, typeof Lightbulb> = {
  warning: AlertTriangle,
  attention: CircleAlert,
  info: Lightbulb,
  positive: Sparkles,
};

const TONE: Record<InsightSeverity, string> = {
  warning: "text-attention",
  attention: "text-attention",
  info: "text-accent-ink",
  positive: "text-positive",
};

/** Proactive insights. Computed deterministically; projections carry an Estimated label. */
export function InsightList({ insights, empty = "Nothing needs your attention right now." }: { insights: ProactiveInsight[]; empty?: string }) {
  if (insights.length === 0) return <p className="text-sm text-muted-foreground">{empty}</p>;
  return (
    <ul className="space-y-3">
      {insights.map((i) => {
        const Icon = ICON[i.severity];
        const body = (
          <>
            <Icon className={cn("mt-0.5 size-5 shrink-0", TONE[i.severity])} aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                {i.title}
                {i.isEstimate && <DataStatus kind="estimated" label="Projection" />}
              </p>
              <p className="mt-0.5 text-sm text-muted-foreground">{i.body}</p>
            </div>
            {i.href && <ChevronRight className="mt-0.5 size-4 shrink-0 text-subtle-foreground" aria-hidden />}
          </>
        );
        return (
          <li key={i.id}>
            {i.href ? (
              <Link href={i.href} className="flex gap-3 rounded-2xl bg-surface p-4 transition-colors hover:bg-surface-muted">
                {body}
              </Link>
            ) : (
              <div className="flex gap-3 rounded-2xl bg-surface p-4">{body}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
