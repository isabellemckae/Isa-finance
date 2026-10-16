import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** A single headline figure. Helper text explains what is (and is not) included. */
export function StatTile({
  label,
  value,
  helper,
  status,
  icon,
  className,
}: {
  label: string;
  value: ReactNode;
  helper?: ReactNode;
  status?: ReactNode;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-2 rounded-[var(--radius-card)] border border-border bg-surface p-4 shadow-card sm:p-5", className)}>
      <span className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {icon}
        {label}
      </span>
      <div className="font-display text-2xl font-medium tracking-tight sm:text-[1.7rem]">{value}</div>
      {status && <div className="flex flex-wrap gap-1">{status}</div>}
      {helper && <div className="text-xs leading-relaxed text-muted-foreground">{helper}</div>}
    </div>
  );
}
