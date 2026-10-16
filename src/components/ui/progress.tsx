import { cn } from "@/lib/utils";

/** Accessible progress bar. `valueBps` is basis points (10000 = 100%). */
export function Progress({
  valueBps,
  label,
  tone = "default",
  className,
}: {
  valueBps: number;
  label: string;
  tone?: "default" | "over" | "near";
  className?: string;
}) {
  const pct = Math.max(0, Math.min(valueBps / 100, 100));
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct)}
      className={cn("h-2 w-full overflow-hidden rounded-full bg-surface-muted", className)}
    >
      <div
        className={cn(
          "h-full rounded-full transition-[width]",
          tone === "over" ? "bg-attention" : tone === "near" ? "bg-accent-ink" : "bg-chart-income",
        )}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
