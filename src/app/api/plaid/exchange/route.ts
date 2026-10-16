import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { z } from "zod";
import { checkSameOrigin, jsonError, readJsonBody, requireApiUser } from "@/lib/api/guard";
import { limiters } from "@/lib/security/rate-limit";
import { getPlaidDeps } from "@/lib/plaid/deps";
import { plaidErrorResponse } from "@/lib/plaid/http";
import { exchangePublicToken } from "@/lib/plaid/service";

const bodySchema = z.object({ publicToken: z.string().min(1).max(300) }).strict();

/**
 * POST /api/plaid/exchange: completes Plaid Link. The public token is exchanged
 * server-side; the access token is encrypted and stored, and never returned.
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
    const result = await exchangePublicToken(getPlaidDeps(), user.id, parsed.data.publicToken);
    revalidatePath("/", "layout");
    return NextResponse.json(
      {
        connectionId: result.connectionId,
        institutionName: result.institutionName,
        counts: result.sync?.counts ?? null,
        syncError: result.syncError,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return plaidErrorResponse(error, "exchange");
  }
}
