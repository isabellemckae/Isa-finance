"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";

/**
 * Plaid Link (sandbox). The browser only ever handles the short-lived link token and
 * the one-time public token; the server exchanges it and keeps the access token.
 *
 * Link's loader is injected from cdn.plaid.com by this (nonced) bundle, which the CSP
 * allows through 'strict-dynamic'. Its UI runs in a cdn.plaid.com iframe.
 */

const LINK_SCRIPT = "https://cdn.plaid.com/link/v2/stable/link-initialize.js";
export const OAUTH_STATE_KEY = "isa.plaid.oauth";

interface PlaidHandler {
  open: () => void;
  destroy: () => void;
}
interface PlaidFactory {
  create: (config: {
    token: string;
    receivedRedirectUri?: string;
    onSuccess: (publicToken: string) => void;
    onExit: (error: { error_code?: string } | null) => void;
  }) => PlaidHandler;
}

let loading: Promise<PlaidFactory> | null = null;

function loadPlaid(): Promise<PlaidFactory> {
  const existing = (window as unknown as { Plaid?: PlaidFactory }).Plaid;
  if (existing) return Promise.resolve(existing);
  loading ??= new Promise<PlaidFactory>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = LINK_SCRIPT;
    script.async = true;
    script.onload = () => {
      const plaid = (window as unknown as { Plaid?: PlaidFactory }).Plaid;
      if (plaid) resolve(plaid);
      else reject(new Error("Plaid Link did not load."));
    };
    script.onerror = () => {
      loading = null;
      reject(new Error("Plaid Link could not be loaded. Check your connection and try again."));
    };
    document.head.appendChild(script);
  });
  return loading;
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(json.error ?? "Something went wrong with the bank connection.");
  return json;
}

type Outcome = { kind: "success" | "error"; text: string } | null;

/** Opens Link with a token; on success, completes the link or the reconnect server-side. */
export async function runPlaidLink(options: {
  linkToken: string;
  connectionId: string | null;
  receivedRedirectUri?: string;
}): Promise<Outcome> {
  const Plaid = await loadPlaid();
  return new Promise<Outcome>((resolve) => {
    const handler = Plaid.create({
      token: options.linkToken,
      receivedRedirectUri: options.receivedRedirectUri,
      onSuccess: async (publicToken) => {
        handler.destroy();
        try {
          if (options.connectionId) {
            await postJson("/api/plaid/reconnect", { connectionId: options.connectionId });
            resolve({ kind: "success", text: "Reconnected and synced." });
          } else {
            const r = await postJson<{ institutionName: string | null; syncError: string | null; counts: { added: number } | null }>(
              "/api/plaid/exchange",
              { publicToken },
            );
            const name = r.institutionName ?? "Your bank";
            resolve(
              r.syncError
                ? { kind: "error", text: `${name} is linked, but the first sync didn't finish: ${r.syncError}` }
                : { kind: "success", text: `${name} is linked. ${r.counts?.added ?? 0} transactions imported.` },
            );
          }
        } catch (e) {
          resolve({ kind: "error", text: e instanceof Error ? e.message : "Linking failed." });
        }
      },
      onExit: (error) => {
        handler.destroy();
        resolve(error ? { kind: "error", text: "Linking didn't finish. Nothing was connected." } : null);
      },
    });
    handler.open();
  });
}

export function PlaidLinkButton({
  connectionId = null,
  children,
  variant = "default",
  size,
}: {
  connectionId?: string | null;
  children: ReactNode;
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>(null);

  async function start() {
    setBusy(true);
    setOutcome(null);
    try {
      const { linkToken } = await postJson<{ linkToken: string }>("/api/plaid/link-token", { connectionId });
      // Needed if the bank uses OAuth and sends the browser back to /accounts/oauth.
      try {
        sessionStorage.setItem(OAUTH_STATE_KEY, JSON.stringify({ linkToken, connectionId }));
      } catch {
        // Storage unavailable: OAuth institutions won't resume, others still work.
      }
      const result = await runPlaidLink({ linkToken, connectionId });
      setOutcome(result);
      if (result?.kind === "success") router.refresh();
    } catch (e) {
      setOutcome({ kind: "error", text: e instanceof Error ? e.message : "Linking failed." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <Button type="button" variant={variant} size={size} onClick={start} disabled={busy} aria-busy={busy}>
        {busy && <Loader2 className="animate-spin" aria-hidden />}
        {children}
      </Button>
      <LinkOutcome outcome={outcome} />
    </div>
  );
}

export function LinkOutcome({ outcome }: { outcome: Outcome }) {
  if (!outcome) return null;
  return outcome.kind === "error" ? (
    <p role="alert" className="flex items-start gap-2 rounded-2xl bg-attention-soft px-4 py-3 text-sm text-attention">
      <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
      {outcome.text}
    </p>
  ) : (
    <p role="status" className="flex items-start gap-2 rounded-2xl bg-positive-soft px-4 py-3 text-sm text-positive">
      <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden />
      {outcome.text}
    </p>
  );
}
