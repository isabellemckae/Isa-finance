"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

/** Horizontally scrollable segmented navigation between sub-pages. */
export function SectionTabs({ items, label }: { items: Array<{ href: string; label: string }>; label: string }) {
  const pathname = usePathname();
  return (
    <nav aria-label={label} className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <ul className="inline-flex min-w-full gap-1 rounded-full border border-border bg-surface p-1 sm:min-w-0">
        {items.map((item) => {
          const active = pathname === item.href;
          return (
            <li key={item.href} className="flex-1 sm:flex-none">
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-h-10 items-center justify-center whitespace-nowrap rounded-full px-4 text-sm font-medium text-muted-foreground transition-colors",
                  active ? "bg-blush text-blush-foreground" : "hover:text-foreground",
                )}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
