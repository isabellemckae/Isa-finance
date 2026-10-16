import { Hammer } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

/**
 * Explicit "not built yet" state. Never a silent placeholder: it names the phase and
 * what will ship.
 */
export function PlannedFeature({
  title,
  phase,
  summary,
  items,
}: {
  title: string;
  phase: number;
  summary: string;
  items: string[];
}) {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-3xl font-medium tracking-tight">{title}</h1>
      </header>
      <Card className="space-y-4">
        <div className="flex items-center gap-2">
          <Hammer className="size-5 text-accent-ink" aria-hidden />
          <Badge variant="blush">Planned for Phase {phase}</Badge>
        </div>
        <p className="text-sm text-muted-foreground">{summary}</p>
        <ul className="grid gap-2 sm:grid-cols-2">
          {items.map((item) => (
            <li key={item} className="rounded-2xl bg-surface-muted px-4 py-3 text-sm">
              {item}
            </li>
          ))}
        </ul>
        <p className="text-xs text-muted-foreground">
          This page is intentionally not functional yet. See PROJECT_PLAN.md for the phase schedule.
        </p>
      </Card>
    </div>
  );
}
