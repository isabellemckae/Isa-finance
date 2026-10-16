export function Brand({ className }: { className?: string }) {
  return (
    <span className={className}>
      <span className="font-display text-xl font-medium tracking-tight">ISA</span>{" "}
      <span className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">Finance</span>
    </span>
  );
}
