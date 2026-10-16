import Link from "next/link";
import { Sparkles } from "lucide-react";
import { getEnv } from "@/lib/env";
import { safeNextPath } from "@/lib/auth/access";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { LoginForm } from "@/components/auth/forms";

export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const env = getEnv();
  const params = await searchParams;
  const next = safeNextPath(typeof params.next === "string" ? params.next : null);
  const forbidden = params.error === "forbidden";

  if (env.AUTH_MODE === "demo") {
    return (
      <Card className="space-y-4 text-center">
        <Sparkles className="mx-auto size-6 text-accent-ink" aria-hidden />
        <h1 className="font-display text-2xl">Local demo mode</h1>
        <p className="text-sm text-muted-foreground">
          Sign-in is disabled and only fictional data is shown. Set <code>AUTH_MODE=supabase</code> to use real
          authentication.
        </p>
        <Button asChild className="w-full">
          <Link href="/">Open the demo dashboard</Link>
        </Button>
      </Card>
    );
  }

  return (
    <Card className="space-y-6">
      <div>
        <h1 className="font-display text-2xl">Welcome back</h1>
        <p className="mt-1 text-sm text-muted-foreground">Sign in to your private dashboard.</p>
      </div>
      {forbidden && (
        <p role="alert" className="rounded-2xl bg-attention-soft px-4 py-3 text-sm text-attention">
          This account is not permitted to use ISA Finance.
        </p>
      )}
      <LoginForm next={next} />
    </Card>
  );
}
