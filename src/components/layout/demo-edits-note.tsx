import { Sparkles } from "lucide-react";

/** Shown near edit forms in demo mode: edits are real in the UI but temporary. */
export function DemoEditsNote({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <Sparkles className="size-3.5 text-accent-ink" aria-hidden />
      Demo mode: changes are kept in memory only and reset daily or when the server restarts.
    </p>
  );
}
