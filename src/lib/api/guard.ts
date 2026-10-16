import "server-only";
import { NextResponse } from "next/server";
import { getAccessState, type SessionUser } from "@/lib/auth/dal";

/**
 * Guards for JSON route handlers (which can't use redirects):
 * - same-origin check (CSRF): the Origin header must match the request host
 * - JSON content type and a body size cap
 * - authorization with the same policy as pages (allowlist + MFA)
 */

export function jsonError(status: number, error: string, headers?: Record<string, string>) {
  return NextResponse.json({ error }, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

export function checkSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export async function readJsonBody(request: Request, maxBytes: number): Promise<unknown | Response> {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return jsonError(415, "Expected application/json.");
  }
  const text = await request.text();
  if (text.length > maxBytes) return jsonError(413, "Request too large.");
  try {
    return JSON.parse(text);
  } catch {
    return jsonError(400, "Invalid JSON.");
  }
}

export async function requireApiUser(): Promise<SessionUser | Response> {
  const { decision, user } = await getAccessState();
  if (decision.kind === "allow" && user) return user;
  if (decision.kind === "login") return jsonError(401, "Sign in required.");
  return jsonError(403, "Not allowed.");
}
