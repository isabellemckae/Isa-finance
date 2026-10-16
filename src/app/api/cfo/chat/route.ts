import { NextResponse } from "next/server";
import { getEnv } from "@/lib/env";
import { getRepository } from "@/lib/data";
import { RepositoryError } from "@/lib/data/repository";
import { limiters } from "@/lib/security/rate-limit";
import { checkSameOrigin, jsonError, readJsonBody, requireApiUser } from "@/lib/api/guard";
import { CfoLimitError, chatRequestSchema, handleCfoMessage } from "@/lib/cfo/service";
import { createOpenAIModel, DEFAULT_OPENAI_MODEL } from "@/lib/cfo/openai-model";

/** POST /api/cfo/chat — one Personal CFO message. Read-only access to the user's data. */
export async function POST(request: Request) {
  if (!checkSameOrigin(request)) return jsonError(403, "Cross-site requests are not allowed.");

  const user = await requireApiUser();
  if (user instanceof Response) return user;

  const limit = limiters.cfo.check(user.id);
  if (!limit.allowed) {
    return jsonError(429, "You're sending messages quickly. Try again in a moment.", {
      "Retry-After": String(Math.ceil(limit.retryAfterMs / 1000)),
    });
  }

  const body = await readJsonBody(request, 8_192);
  if (body instanceof Response) return body;
  const parsed = chatRequestSchema.safeParse(body);
  if (!parsed.success) return jsonError(400, parsed.error.issues[0]?.message ?? "Invalid request.");

  const env = getEnv();
  try {
    const repo = await getRepository(user);
    const model = env.OPENAI_API_KEY
      ? createOpenAIModel({ apiKey: env.OPENAI_API_KEY, model: env.OPENAI_MODEL ?? DEFAULT_OPENAI_MODEL })
      : null;
    const result = await handleCfoMessage({
      repo,
      now: new Date(),
      conversationId: parsed.data.conversationId ?? null,
      message: parsed.data.message,
      model,
      limits: { dailyRequests: env.CFO_DAILY_REQUEST_LIMIT, dailyTokens: env.CFO_DAILY_TOKEN_LIMIT },
    });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof CfoLimitError) return jsonError(429, error.message);
    if (error instanceof RepositoryError) return jsonError(error.code === "not_found" ? 404 : 400, error.message);
    // Never return error details: they could contain financial data.
    console.error("cfo_chat_failed", { name: error instanceof Error ? error.name : typeof error });
    return jsonError(500, "The Personal CFO couldn't answer right now. Nothing was changed.");
  }
}
