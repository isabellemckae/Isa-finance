import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { z } from "zod";
import { checkSameOrigin, jsonError, readJsonBody, requireApiUser } from "@/lib/api/guard";
import { limiters } from "@/lib/security/rate-limit";
import { getPlaidDeps } from "@/lib/plaid/deps";
import { plaidErrorResponse } from "@/lib/plaid/http";
import { completeReconnect, connectionIdSchema } from "@/lib/plaid/service";

const bodySchema = z.object({ connectionId: connectionIdSchema }).strict();

/**
 * POST /api/plaid/reconnect: called after Link update mode succeeds. Confirms with
 * Plaid that the Item is healthy, reactivates the connection and syncs.
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
    const sync = await completeReconnect(getPlaidDeps(), user.id, parsed.data.connectionId);
    revalidatePath("/", "layout");
    return NextResponse.json({ counts: sync.counts }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return plaidErrorResponse(error, "reconnect");
  }
}
