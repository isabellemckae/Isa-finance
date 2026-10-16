"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { LinkOutcome, OAUTH_STATE_KEY, runPlaidLink } from "./plaid-link";

type Outcome = Parameters<typeof LinkOutcome>[0]["outcome"];

export function OAuthResume() {
  const started = useRef(false);
  const [busy, setBusy] = useState(true);
  const [outcome, setOutcome] = useState<Outcome>(null);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    let saved: { linkToken?: unknown; connectionId?: unknown } | null = null;
    try {
      saved = JSON.parse(sessionStorage.getItem(OAUTH_STATE_KEY) ?? "null");
      sessionStorage.removeItem(OAUTH_STATE_KEY);
    } catch {
      saved = null;
    }
    const linkToken = typeof saved?.linkToken === "string" ? saved.linkToken : null;
    const connectionId = typeof saved?.connectionId === "string" ? saved.connectionId : null;
    (linkToken
      ? runPlaidLink({ linkToken, connectionId, receivedRedirectUri: window.location.href })
      : Promise.reject(new Error("This link session expired. Start again from Accounts."))
    )
      .then((r) => setOutcome(r ?? { kind: "error", text: "Linking didn't finish. Nothing was connected." }))
      .catch((e: unknown) => setOutcome({ kind: "error", text: e instanceof Error ? e.message : "Linking failed." }))
      .finally(() => setBusy(false));
  }, []);

  return (
    <div className="space-y-4 text-sm">
      {busy && (
        <p className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden /> Finishing the connection…
        </p>
      )}
      <LinkOutcome outcome={outcome} />
      {!busy && (
        <Link href="/accounts" className="inline-flex font-medium text-accent-ink">
          Back to Accounts
        </Link>
      )}
    </div>
  );
}
