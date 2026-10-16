import { Calculator, KeyRound, LogOut, ShieldCheck } from "lucide-react";
import { loadPageData } from "@/lib/data/load";
import { updateProfileAction } from "@/lib/actions/budget";
import { minorToDecimalString } from "@/lib/finance/money";
import { Checkbox, Field, MoneyInput, Select, TextInput } from "@/components/ui/field";
import { ActionForm, SubmitButton } from "@/components/forms/action-form";
import { DemoEditsNote } from "@/components/layout/demo-edits-note";
import { signOut } from "@/lib/auth/actions";
import { getEnv } from "@/lib/env";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/layout/theme";

export const metadata = { title: "Settings" };

const TIMEZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Phoenix",
  "America/Los_Angeles",
  "America/Anchorage",
  "Pacific/Honolulu",
  "UTC",
];

export default async function SettingsPage() {
  const { user, data } = await loadPageData();
  const profile = data.profile;
  const env = getEnv();
  const integrations = [
    { name: "Supabase data", configured: env.DATA_SOURCE === "supabase", phase: 2, note: "RLS-protected storage" },
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
          <div>
            <CardTitle>Calculation preferences</CardTitle>
            <CardDescription>These change how safe-to-spend and plans are calculated.</CardDescription>
          </div>
          <Calculator className="size-5 text-accent-ink" aria-hidden />
        </CardHeader>
        <ActionForm action={updateProfileAction} className="space-y-4">
          <Field label="Your name" htmlFor="displayName">
            <TextInput id="displayName" name="displayName" maxLength={80} defaultValue={profile.displayName ?? ""} />
          </Field>
          <Field label="Safety buffer" htmlFor="safetyBuffer" hint="Always kept aside in safe-to-spend.">
            <MoneyInput id="safetyBuffer" name="safetyBuffer" required defaultValue={minorToDecimalString(profile.safetyBufferMinor, profile.baseCurrency)} />
          </Field>
          <Field label="Time zone" htmlFor="timezone" hint="Defines “today” and month boundaries.">
            <Select id="timezone" name="timezone" defaultValue={profile.timezone}>
              {TIMEZONES.includes(profile.timezone) ? null : <option value={profile.timezone}>{profile.timezone}</option>}
              {TIMEZONES.map((tz) => (
                <option key={tz} value={tz}>{tz.replace("_", " ")}</option>
              ))}
            </Select>
          </Field>
          <Checkbox
            name="includeExpectedIncome"
            defaultChecked={profile.includeExpectedIncome}
            label="Count expected paychecks in safe-to-spend"
            description="Off by default: income only counts once it arrives. Turning this on is less conservative."
          />
          <SubmitButton>Save preferences</SubmitButton>
          <DemoEditsNote show={data.isDemo} />
        </ActionForm>
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
