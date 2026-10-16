import { after, NextResponse } from "next/server";
import { headers } from "next/headers";
import { limiters } from "@/lib/security/rate-limit";
import { getPlaidDeps } from "@/lib/plaid/deps";
import { PlaidNotConfiguredError } from "@/lib/plaid/ports";
import { handleWebhook } from "@/lib/plaid/service";

const MAX_BODY_BYTES = 64 * 1024;

const reply = (status: number, body: Record<string, string> = { ok: "true" }) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

/**
 * POST /api/plaid/webhook: Plaid → ISA Finance. No session: authenticity comes from
 * the signed `Plaid-Verification` JWT, checked against the exact raw body. Replays
 * are no-ops (idempotency by body hash). Syncs run after the response is sent.
 */
export async function POST(request: Request) {
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
  if (!limiters.plaidWebhook.check(ip).allowed) return reply(429, { error: "rate_limited" });

  const length = Number(request.headers.get("content-length") ?? "0");
  if (length > MAX_BODY_BYTES) return reply(413, { error: "too_large" });
  const rawBody = await request.text();
  if (rawBody.length > MAX_BODY_BYTES) return reply(413, { error: "too_large" });

  try {
    const outcome = await handleWebhook(getPlaidDeps(), {
      rawBody,
      verificationHeader: request.headers.get("plaid-verification"),
    });
    if (outcome.result === "rejected") {
      console.warn("plaid_webhook_rejected", { reason: outcome.reason });
      return reply(401, { error: "unverified" });
    }
    if (outcome.result === "accepted" && outcome.followUp) after(outcome.followUp);
    return reply(200);
  } catch (error) {
    if (error instanceof PlaidNotConfiguredError) return reply(503, { error: "not_configured" });
    console.error("plaid_webhook_failed", { name: error instanceof Error ? error.name : typeof error });
    // Non-2xx makes Plaid retry later; the body-hash log keeps the retry idempotent.
    return reply(500, { error: "failed" });
  }
}
