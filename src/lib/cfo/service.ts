import { z } from "zod";
import type { FinanceRepository, StoredMessage } from "@/lib/data/repository";
import { RepositoryError } from "@/lib/data/repository";
import { createCfoContext } from "./context";
import { runCfoTurn, LIMITS, type CfoAnswer, type HistoryMessage } from "./agent";
import { answerOffline, type OfflineAnswer } from "./offline";
import { ModelError, type ChatModel } from "./model";

/**
 * One Personal CFO exchange, end to end. Framework-free so it can be tested with the
 * demo repository and a fake model; the API route supplies the authenticated user's
 * repository and the configured model.
 */

export const chatRequestSchema = z.object({
  conversationId: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/).nullable().optional(),
  message: z.string().trim().min(1, "Type a question.").max(LIMITS.maxMessageChars, "That message is too long."),
});

export interface CfoLimits {
  dailyRequests: number;
  dailyTokens: number;
}

export interface CfoMessageMeta {
  mode: "ai" | "offline";
  model?: string;
  toolCalls: Array<{ name: string; ok: boolean; status?: string }>;
  dataStatus: string | null;
  periods: Array<{ start: string; end: string }>;
  unverifiedAmounts: string[];
  isDemo: boolean;
  notice?: string;
}

export interface ChatResult {
  conversationId: string;
  message: { role: "assistant"; content: string; metadata: CfoMessageMeta };
}

export class CfoLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CfoLimitError";
  }
}

const NOTICES = {
  notConfigured: "AI answers are off because no OpenAI key is configured. This answer was calculated by ISA Finance directly.",
  budget: "You've reached today's AI usage limit. This answer was calculated by ISA Finance directly.",
  unavailable: "The AI service is unavailable right now. This answer was calculated by ISA Finance directly.",
};

function toHistory(messages: StoredMessage[]): HistoryMessage[] {
  return messages.map((m) => ({ role: m.role, content: m.content }));
}

export async function handleCfoMessage(input: {
  repo: FinanceRepository;
  now: Date;
  conversationId: string | null;
  message: string;
  model: ChatModel | null;
  limits: CfoLimits;
}): Promise<ChatResult> {
  const { repo, now } = input;

  const usage = await repo.getAiUsageToday(now);
  if (usage.requests >= input.limits.dailyRequests) {
    throw new CfoLimitError("You've reached today's Personal CFO limit. It resets at midnight UTC.");
  }

  let conversationId = input.conversationId;
  let history: HistoryMessage[] = [];
  if (conversationId) {
    const conversation = await repo.getConversation(conversationId);
    if (!conversation) throw new RepositoryError("not_found", "Conversation not found.");
    history = toHistory(conversation.messages);
  }

  const data = await repo.getFinancialData(input.now);
  const ctx = createCfoContext(data, input.now);

  let answer: CfoAnswer | OfflineAnswer;
  let notice: string | undefined;
  const overTokenBudget = usage.inputTokens + usage.outputTokens >= input.limits.dailyTokens;
  if (!input.model) {
    answer = answerOffline(input.message, ctx);
    notice = NOTICES.notConfigured;
  } else if (overTokenBudget) {
    answer = answerOffline(input.message, ctx);
    notice = NOTICES.budget;
  } else {
    try {
      answer = await runCfoTurn({ model: input.model, ctx, history, question: input.message });
    } catch (error) {
      if (!(error instanceof ModelError)) throw error;
      // Never surface provider error details; answer deterministically instead.
      answer = answerOffline(input.message, ctx);
      notice = NOTICES.unavailable;
    }
  }

  await repo.recordAiUsage(answer.usage.inputTokens, answer.usage.outputTokens);

  const periods = [
    ...new Map(answer.toolCalls.filter((t) => t.period).map((t) => [`${t.period!.start}|${t.period!.end}`, t.period!])).values(),
  ];
  const metadata: CfoMessageMeta = {
    mode: answer.mode,
    model: answer.mode === "ai" ? input.model?.name : undefined,
    toolCalls: answer.toolCalls.map((t) => ({ name: t.name, ok: t.ok, status: t.status })),
    dataStatus: answer.dataStatus,
    periods: periods.slice(0, 5),
    unverifiedAmounts: answer.unverifiedAmounts,
    isDemo: data.isDemo,
    notice,
  };

  if (!conversationId) {
    conversationId = await repo.createConversation(input.message.replace(/\s+/g, " ").slice(0, 60));
  }
  await repo.appendMessages(conversationId, [
    { role: "user", content: input.message },
    { role: "assistant", content: answer.text, metadata: metadata as unknown as Record<string, unknown> },
  ]);
  await repo.audit(`cfo.message.${answer.mode}`, "ai_conversation", conversationId);

  return { conversationId, message: { role: "assistant", content: answer.text, metadata } };
}

export const SUGGESTED_QUESTIONS = [
  "Where did my money go this month?",
  "How much can I safely spend this weekend?",
  "Which expenses have increased?",
  "What bills are coming up?",
  "How much should I budget for groceries?",
  "How can I reduce unnecessary spending?",
  "How much can I save this month?",
  "How would paying $500 a month change my credit card payoff?",
];
