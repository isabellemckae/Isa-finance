export default function Loading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading">
      <div className="h-10 w-64 animate-pulse rounded-full bg-surface-muted" />
      <div className="h-56 animate-pulse rounded-[var(--radius-card)] bg-surface-muted" />
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="h-28 animate-pulse rounded-[var(--radius-card)] bg-surface-muted" />
        ))}
      </div>
    </div>
  );
}
