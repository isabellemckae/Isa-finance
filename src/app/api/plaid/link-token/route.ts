import { NextResponse } from "next/server";
import { z } from "zod";
import { checkSameOrigin, jsonError, readJsonBody, requireApiUser } from "@/lib/api/guard";
import { limiters } from "@/lib/security/rate-limit";
import { getPlaidDeps } from "@/lib/plaid/deps";
import { plaidErrorResponse } from "@/lib/plaid/http";
import { connectionIdSchema, createLinkToken } from "@/lib/plaid/service";

const bodySchema = z.object({ connectionId: connectionIdSchema.nullable().optional() }).strict();

/**
 * POST /api/plaid/link-token: a short-lived Plaid Link token (sandbox). With
 * `connectionId`, the token opens Link in update mode to repair that connection.
 */
export async function POST(request: Request) {
  if (!checkSameOrigin(request)) return jsonError(403, "Cross-site requests are not allowed.");
  const user = await requireApiUser();
  if (user instanceof Response) return user;
  if (!limiters.plaid.check(user.id).allowed) return jsonError(429, "Too many requests. Try again in a minute.");

  const body = await readJsonBody(request, 1_024);
  if (body instanceof Response) return body;
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return jsonError(400, "Invalid request.");

  try {
    const result = await createLinkToken(getPlaidDeps(), user.id, { connectionId: parsed.data.connectionId ?? undefined });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return plaidErrorResponse(error, "link_token");
  }
}
