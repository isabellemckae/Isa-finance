import { describe, expect, it } from "vitest";
import { CfoLimitError, chatRequestSchema, handleCfoMessage } from "./service";
import { ModelError, type ChatModel } from "./model";
import { DemoRepository } from "@/lib/data/demo/store";

const now = new Date("2026-10-16T18:00:00Z");
const limits = { dailyRequests: 5, dailyTokens: 10_000 };

const echoModel = (text = "Here's what I found."): ChatModel => ({
  name: "fake-model",
  complete: async () => ({ text, toolCalls: [], outputItems: [], usage: { inputTokens: 400, outputTokens: 60 } }),
});

describe("handleCfoMessage", () => {
  it("creates a conversation, stores both messages and records usage", async () => {
    const repo = DemoRepository.withFreshState(now);
    const r = await handleCfoMessage({ repo, now, conversationId: null, message: "Hello CFO", model: echoModel(), limits });
    expect(r.message.metadata).toMatchObject({ mode: "ai", model: "fake-model", isDemo: true });
    const convo = await repo.getConversation(r.conversationId);
    expect(convo?.title).toBe("Hello CFO");
    expect(convo?.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(await repo.getAiUsageToday(new Date())).toMatchObject({ requests: 1, inputTokens: 400, outputTokens: 60 });
  });

  it("passes prior turns as context for follow-up questions", async () => {
    const repo = DemoRepository.withFreshState(now);
    const seen: number[] = [];
    const model: ChatModel = {
      name: "m",
      complete: async (req) => {
        seen.push(req.input.length);
        return { text: "ok", toolCalls: [], outputItems: [], usage: { inputTokens: 1, outputTokens: 1 } };
      },
    };
    const first = await handleCfoMessage({ repo, now, conversationId: null, message: "first", model, limits });
    await handleCfoMessage({ repo, now, conversationId: first.conversationId, message: "and then?", model, limits });
    expect(seen).toEqual([1, 3]);
  });

  it("answers offline with a clear notice when OpenAI isn't configured", async () => {
    const repo = DemoRepository.withFreshState(now);
    const r = await handleCfoMessage({ repo, now, conversationId: null, message: "What bills are coming up?", model: null, limits });
    expect(r.message.metadata.mode).toBe("offline");
    expect(r.message.metadata.notice).toMatch(/no OpenAI key/);
    expect(r.message.metadata.toolCalls.map((t) => t.name)).toEqual(["get_upcoming_bills"]);
  });

  it("falls back to offline answers when the AI service fails, without leaking details", async () => {
    const repo = DemoRepository.withFreshState(now);
    const failing: ChatModel = { name: "m", complete: async () => { throw new ModelError("auth", "invalid key sk-123"); } };
    const r = await handleCfoMessage({ repo, now, conversationId: null, message: "What's my net worth?", model: failing, limits });
    expect(r.message.metadata.mode).toBe("offline");
    expect(r.message.metadata.notice).toMatch(/unavailable/);
    expect(JSON.stringify(r)).not.toContain("sk-123");
  });

  it("enforces the daily request limit and token budget", async () => {
    const repo = DemoRepository.withFreshState(now);
    for (let i = 0; i < 5; i += 1) await repo.recordAiUsage(0, 0);
    await expect(handleCfoMessage({ repo, now, conversationId: null, message: "hi", model: echoModel(), limits })).rejects.toBeInstanceOf(CfoLimitError);

    const repo2 = DemoRepository.withFreshState(now);
    await repo2.recordAiUsage(9_000, 1_000);
    const r = await handleCfoMessage({ repo: repo2, now, conversationId: null, message: "What bills are coming up?", model: echoModel(), limits });
    expect(r.message.metadata.mode).toBe("offline");
    expect(r.message.metadata.notice).toMatch(/usage limit/);
  });

  it("rejects unknown conversations", async () => {
    const repo = DemoRepository.withFreshState(now);
    await expect(handleCfoMessage({ repo, now, conversationId: "nope", message: "hi", model: null, limits })).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("chatRequestSchema", () => {
  it("validates input", () => {
    expect(chatRequestSchema.safeParse({ message: "  " }).success).toBe(false);
    expect(chatRequestSchema.safeParse({ message: "x".repeat(2_001) }).success).toBe(false);
    expect(chatRequestSchema.safeParse({ message: "hi", conversationId: "../etc" }).success).toBe(false);
    expect(chatRequestSchema.parse({ message: " hi ", conversationId: null })).toEqual({ message: "hi", conversationId: null });
  });
});
