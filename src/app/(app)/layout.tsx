import Link from "next/link";
import { Settings } from "lucide-react";
import { requireUser } from "@/lib/auth/dal";
import { getEnv } from "@/lib/env";
import { BottomNav, SideNav } from "@/components/layout/app-nav";
import { Brand } from "@/components/layout/brand";
import { DemoBanner } from "@/components/layout/demo-banner";
import { ThemeToggle } from "@/components/layout/theme";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const user = await requireUser();
  const env = getEnv();

  return (
    <div className="min-h-dvh">
      <DemoBanner demoData={env.DATA_SOURCE === "demo"} demoAuth={user.mode === "demo"} />
      <div className="mx-auto flex max-w-6xl gap-8 lg:px-6">
        <aside className="sticky top-0 hidden h-dvh w-56 shrink-0 flex-col gap-8 py-8 lg:flex">
          <Link href="/" className="px-4" aria-label="ISA Finance home">
            <Brand />
          </Link>
          <SideNav />
          <ThemeToggle className="mx-4 self-start" />
        </aside>

        <div className="min-w-0 flex-1">
          <header className="flex items-center justify-between px-4 pt-5 sm:px-6 lg:hidden">
            <Link href="/" aria-label="ISA Finance home">
              <Brand />
            </Link>
            <Link
              href="/settings"
              aria-label="Settings"
              className="inline-flex size-10 items-center justify-center rounded-full border border-border bg-surface text-muted-foreground"
            >
              <Settings className="size-[18px]" aria-hidden />
            </Link>
          </header>
          <main id="main" className="px-4 pb-28 pt-6 sm:px-6 lg:pb-12 lg:pt-8">
            {children}
          </main>
        </div>
      </div>
      <BottomNav />
    </div>
  );
}
