import { describe, expect, it } from "vitest";
import { plaidReadiness } from "./readiness";

const full = {
  DATA_SOURCE: "supabase" as const,
  AUTH_MODE: "supabase" as const,
  PLAID_CLIENT_ID: "client",
  PLAID_SECRET: "secret",
  PLAID_ENV: "sandbox" as const,
  PLAID_WEBHOOK_URL: undefined,
  TOKEN_ENCRYPTION_KEYS: "k1:x",
  TOKEN_ENCRYPTION_ACTIVE_KEY_ID: "k1",
  SUPABASE_SECRET_KEY: "service",
  NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co",
};

describe("plaidReadiness", () => {
  it("is never ready in demo mode", () => {
    expect(plaidReadiness({ ...full, DATA_SOURCE: "demo" })).toEqual({ ready: false, reason: "demo", missing: [] });
    expect(plaidReadiness({ ...full, AUTH_MODE: "demo" }).ready).toBe(false);
  });

  it("names missing variables without exposing values", () => {
    const r = plaidReadiness({ ...full, PLAID_SECRET: undefined, TOKEN_ENCRYPTION_KEYS: undefined });
    expect(r).toEqual({ ready: false, reason: "missing_config", missing: ["PLAID_SECRET", "TOKEN_ENCRYPTION_KEYS"] });
    expect(JSON.stringify(r)).not.toContain("client");
  });

  it("is ready with sandbox credentials, noting whether webhooks are configured", () => {
    expect(plaidReadiness(full)).toEqual({ ready: true, webhooks: false });
    expect(plaidReadiness({ ...full, PLAID_WEBHOOK_URL: "https://x/api/plaid/webhook" })).toEqual({ ready: true, webhooks: true });
  });
});
