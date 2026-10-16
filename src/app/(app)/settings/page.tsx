import { KeyRound, LogOut, ShieldCheck } from "lucide-react";
import { requireUser } from "@/lib/auth/dal";
import { signOut } from "@/lib/auth/actions";
import { getEnv } from "@/lib/env";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/layout/theme";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const user = await requireUser();
  const env = getEnv();
  const integrations = [
    { name: "Plaid (bank connections)", configured: Boolean(env.PLAID_CLIENT_ID && env.PLAID_SECRET), phase: 4, note: "Sandbox only" },
    { name: "OpenAI (Personal CFO)", configured: Boolean(env.OPENAI_API_KEY), phase: 3, note: "Server-side only" },
    { name: "Token encryption keyring", configured: Boolean(env.TOKEN_ENCRYPTION_KEYS), phase: 4, note: "Required before linking banks" },
  ];

  return (
    <div className="space-y-6">
      <h1 className="font-display text-3xl font-medium tracking-tight">Settings</h1>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Security</CardTitle>
            <CardDescription>Signed in as {user.email}</CardDescription>
          </div>
          <ShieldCheck className="size-5 text-accent-ink" aria-hidden />
        </CardHeader>
        <dl className="space-y-3 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">Authentication</dt>
            <dd>{user.mode === "demo" ? <Badge variant="attention">Disabled (local demo)</Badge> : <Badge variant="positive">Supabase Auth</Badge>}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">Two-factor authentication</dt>
            <dd>
              {user.mode === "demo" ? (
                <Badge>Not applicable</Badge>
              ) : (
                <Badge variant="positive">{env.REQUIRE_MFA ? "Required · verified" : "Optional"}</Badge>
              )}
            </dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">Data source</dt>
            <dd>{env.DATA_SOURCE === "demo" ? <Badge variant="blush">Fictional demo data</Badge> : <Badge>Supabase</Badge>}</dd>
          </div>
        </dl>
        {user.mode === "supabase" && (
          <form action={signOut} className="mt-5">
            <Button type="submit" variant="outline">
              <LogOut aria-hidden /> Sign out
            </Button>
          </form>
        )}
      </Card>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Integrations</CardTitle>
            <CardDescription>Credentials are set in the server environment, never in this app.</CardDescription>
          </div>
          <KeyRound className="size-5 text-accent-ink" aria-hidden />
        </CardHeader>
        <ul className="divide-y divide-border text-sm">
          {integrations.map((i) => (
            <li key={i.name} className="flex items-center justify-between gap-4 py-3">
              <div>
                <p className="font-medium">{i.name}</p>
                <p className="text-xs text-muted-foreground">
                  Phase {i.phase} · {i.note}
                </p>
              </div>
              {i.configured ? <Badge variant="positive">Configured</Badge> : <Badge>Not configured</Badge>}
            </li>
          ))}
        </ul>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Appearance</CardTitle>
        </CardHeader>
        <ThemeToggle />
      </Card>
    </div>
  );
}
