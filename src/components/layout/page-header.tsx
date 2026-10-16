import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import type { ReactNode } from "react";

export function PageHeader({
  title,
  description,
  back,
  actions,
  eyebrow,
}: {
  title: ReactNode;
  description?: ReactNode;
  back?: { href: string; label: string };
  actions?: ReactNode;
  eyebrow?: ReactNode;
}) {
  return (
    <header className="space-y-3">
      {back && (
        <Link
          href={back.href}
          className="-ml-1 inline-flex min-h-11 items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="size-4" aria-hidden />
          {back.label}
        </Link>
      )}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          {eyebrow && <div className="mb-1 text-sm text-muted-foreground">{eyebrow}</div>}
          <h1 className="font-display text-3xl font-medium tracking-tight sm:text-4xl">{title}</h1>
          {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>
    </header>
  );
}
