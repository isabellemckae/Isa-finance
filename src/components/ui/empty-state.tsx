import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

export function EmptyState({ icon: Icon, title, children }: { icon: LucideIcon; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-[var(--radius-card)] border border-dashed border-border px-6 py-10 text-center">
      <span className="flex size-11 items-center justify-center rounded-full bg-blush text-blush-foreground">
        <Icon className="size-5" aria-hidden />
      </span>
      <p className="font-display text-lg">{title}</p>
      {children && <div className="max-w-sm text-sm text-muted-foreground">{children}</div>}
    </div>
  );
}
