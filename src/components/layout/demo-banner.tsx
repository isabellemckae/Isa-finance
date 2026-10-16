import { Sparkles } from "lucide-react";

/** Persistent label shown whenever fictional data or demo authentication is in use. */
export function DemoBanner({ demoData, demoAuth }: { demoData: boolean; demoAuth: boolean }) {
  if (!demoData && !demoAuth) return null;
  return (
    <div role="note" className="border-b border-border bg-blush text-blush-foreground">
      <p className="mx-auto flex max-w-6xl items-center gap-2 px-4 py-2 text-xs font-medium sm:px-6">
        <Sparkles className="size-3.5 shrink-0" aria-hidden />
        <span>
          {demoData && "Fictional demo data. No real accounts are connected."}
          {demoData && demoAuth && " "}
          {demoAuth && "Local demo mode: sign-in is disabled."}
        </span>
      </p>
    </div>
  );
}
