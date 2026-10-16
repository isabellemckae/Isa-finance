import { Landmark, Link2, RefreshCw, Unplug } from "lucide-react";
import type { BankConnectionSummary } from "@/lib/data/repository";
import type { PlaidReadiness } from "@/lib/plaid/readiness";
import type { ConnectionStatus } from "@/lib/finance/types";
import { disconnectConnectionAction, syncConnectionAction } from "@/lib/actions/plaid";
import { relativeTime } from "@/lib/format";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ActionForm, SubmitButton } from "@/components/forms/action-form";
import { PlaidLinkButton } from "./plaid-link";

const STATUS: Record<ConnectionStatus, { label: string; variant: "positive" | "attention" | "info"; help?: string }> = {
  active: { label: "Connected", variant: "positive" },
  login_required: { label: "Reconnect needed", variant: "attention", help: "Your bank needs you to sign in again." },
  pending_expiration: { label: "Access expiring", variant: "attention", help: "Reconnect soon to keep syncing." },
  revoked: { label: "Access revoked", variant: "attention", help: "Access was revoked at the bank. Reconnect to restore it." },
  error: { label: "Needs relinking", variant: "attention", help: "This connection stopped working. Reconnect or link it again." },
  disconnected: { label: "Disconnected", variant: "info", help: "History is kept. Nothing new syncs." },
};

const NEEDS_RECONNECT = new Set<ConnectionStatus>(["login_required", "pending_expiration", "revoked", "error"]);

export function BankConnections({
  connections,
  readiness,
  now,
}: {
  connections: BankConnectionSummary[];
  readiness: PlaidReadiness;
  now: Date;
}) {
  const canAct = readiness.ready;
  return (
    <Card aria-labelledby="connections-title" id="connections">
      <CardHeader>
        <div>
          <CardTitle id="connections-title">Bank connections</CardTitle>
          <CardDescription>Read-only access through Plaid ({readiness.ready ? "sandbox" : "not active"}). Money can never be moved.</CardDescription>
        </div>
        <Landmark className="size-5 text-accent-ink" aria-hidden />
      </CardHeader>

      {connections.length > 0 && (
        <ul className="mb-5 divide-y divide-border">
          {connections.map((c) => {
            const status = STATUS[c.status];
            return (
              <li key={c.id} className="space-y-3 py-4 first:pt-0">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium">{c.institutionName}</p>
                    <p className="text-xs text-muted-foreground">
                      {c.accountCount} account{c.accountCount === 1 ? "" : "s"} ·{" "}
                      {c.lastSuccessfulSyncAt ? `synced ${relativeTime(c.lastSuccessfulSyncAt, now)}` : "never synced"}
                    </p>
                  </div>
                  <Badge variant={status.variant}>{status.label}</Badge>
                </div>
                {status.help && <p className="text-sm text-muted-foreground">{status.help}</p>}
                {c.isDemo ? (
                  <p className="text-xs text-muted-foreground">Fictional demo connection: sync, reconnect and disconnect are disabled.</p>
                ) : canAct && c.status !== "disconnected" ? (
                  <div className="flex flex-wrap items-start gap-2">
                    {NEEDS_RECONNECT.has(c.status) && (
                      <PlaidLinkButton connectionId={c.id} size="sm">
                        <RefreshCw aria-hidden /> Reconnect
                      </PlaidLinkButton>
                    )}
                    {c.status !== "revoked" && (
                      <ActionForm action={syncConnectionAction} className="space-y-2">
                        <input type="hidden" name="connectionId" value={c.id} />
                        <SubmitButton variant="outline" size="sm" pendingLabel="Syncing…">
                          <RefreshCw aria-hidden /> Sync now
                        </SubmitButton>
                      </ActionForm>
                    )}
                    <details className="w-full">
                      <summary className="cursor-pointer text-sm font-medium text-muted-foreground">Disconnect…</summary>
                      <ActionForm action={disconnectConnectionAction} className="mt-2 space-y-2 rounded-2xl bg-surface-muted p-3">
                        <input type="hidden" name="connectionId" value={c.id} />
                        <label className="flex items-start gap-2 text-sm">
                          <input type="checkbox" name="confirm" value="yes" required className="mt-1 size-4 accent-[var(--primary)]" />
                          Remove access for {c.institutionName}. Existing history stays; nothing new will sync.
                        </label>
                        <SubmitButton variant="outline" size="sm" pendingLabel="Disconnecting…">
                          <Unplug aria-hidden /> Disconnect
                        </SubmitButton>
                      </ActionForm>
                    </details>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      <ConnectBank readiness={readiness} hasConnections={connections.length > 0} />
    </Card>
  );
}

function ConnectBank({ readiness, hasConnections }: { readiness: PlaidReadiness; hasConnections: boolean }) {
  if (!readiness.ready) {
    return (
      <div className="space-y-3 rounded-2xl bg-surface-muted p-4 text-sm">
        <p className="font-medium">Connect a bank</p>
        {readiness.reason === "demo" ? (
          <p className="text-muted-foreground">
            Bank linking runs only with your own Supabase data and Plaid sandbox keys. Demo mode shows fictional connections
            and never contacts a bank.
          </p>
        ) : (
          <p className="text-muted-foreground">
            Bank linking isn&apos;t configured yet. Missing settings: {readiness.missing.join(", ")}. See README → Configuration.
          </p>
        )}
        <Button variant="outline" disabled aria-disabled>
          <Link2 aria-hidden /> {readiness.reason === "demo" ? "Not available in demo" : "Not configured"}
        </Button>
      </div>
    );
  }
  return (
    <div className="space-y-3 rounded-2xl bg-surface-muted p-4 text-sm">
      <p className="font-medium">{hasConnections ? "Connect another bank" : "Connect a bank"}</p>
      <p className="text-muted-foreground">
        Plaid sandbox: no real bank is contacted. Use Plaid&apos;s test login <span className="font-mono">user_good</span> /{" "}
        <span className="font-mono">pass_good</span>.
        {!readiness.webhooks && " Webhooks aren't configured, so use Sync now to refresh."}
      </p>
      <PlaidLinkButton>
        <Link2 aria-hidden /> Connect a bank (sandbox)
      </PlaidLinkButton>
    </div>
  );
}
