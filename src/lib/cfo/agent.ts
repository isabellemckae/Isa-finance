import { CFO_TOOLS, executeTool, type DataStatus } from "./tools";
import { cfoInstructions } from "./prompt";
import { allowedAmountKeys, findUnverifiedAmounts } from "./verify";
import type { CfoContext } from "./context";
import { ModelError, type ChatModel, type ConversationItem } from "./model";

/**
 * The Personal CFO turn loop:
 *   history + question → model ⇄ read-only tools (bounded) → answer → amount check.
 * All numbers must come from tool results; unverified amounts trigger one repair
 * round, then the answer is flagged.
 */

export const LIMITS = {
  maxToolRounds: 6,
  maxToolCallsPerTurn: 12,
  maxOutputTokens: 900,
  maxHistoryMessages: 12,
  maxHistoryChars: 16_000,
  maxMessageChars: 2_000,
} as const;

export interface HistoryMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ToolCallRecord {
  name: string;
  ok: boolean;
  status?: DataStatus;
  period?: { start: string; end: string };
}

export interface CfoAnswer {
  text: string;
  mode: "ai";
  toolCalls: ToolCallRecord[];
  /** Strongest data status among tool results: "projection" > "estimate" > "actual". */
  dataStatus: DataStatus | null;
  unverifiedAmounts: string[];
  usage: { inputTokens: number; outputTokens: number };
  stoppedEarly: boolean;
}

/** Keeps the most recent messages within count and character budgets. */
export function trimHistory(history: readonly HistoryMessage[]): HistoryMessage[] {
  const recent = history.slice(-LIMITS.maxHistoryMessages).map((m) => ({
    role: m.role,
    content: m.content.slice(0, 4_000),
  }));
  let total = 0;
  const kept: HistoryMessage[] = [];
  for (let i = recent.length - 1; i >= 0; i -= 1) {
    total += recent[i].content.length;
    if (total > LIMITS.maxHistoryChars) break;
    kept.unshift(recent[i]);
  }
  // Conversations must start with the user.
  while (kept.length && kept[0].role !== "user") kept.shift();
  return kept;
}

const STATUS_RANK: Record<DataStatus, number> = { actual: 0, estimate: 1, projection: 2 };

export async function runCfoTurn(input: {
  model: ChatModel;
  ctx: CfoContext;
  history: readonly HistoryMessage[];
  question: string;
  signal?: AbortSignal;
}): Promise<CfoAnswer> {
  const { model, ctx } = input;
  const question = input.question.slice(0, LIMITS.maxMessageChars);
  const instructions = cfoInstructions(ctx);
  const tools = CFO_TOOLS.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters }));
  const conversation: ConversationItem[] = [
    ...trimHistory(input.history).map((m) => ({ type: "message" as const, role: m.role, content: m.content })),
    { type: "message", role: "user", content: question },
  ];

  const usage = { inputTokens: 0, outputTokens: 0 };
  const toolCalls: ToolCallRecord[] = [];
  const toolOutputs: string[] = [];
  let dataStatus: DataStatus | null = null;
  let text = "";
  let stoppedEarly = false;

  for (let round = 0; ; round += 1) {
    const forceAnswer = round >= LIMITS.maxToolRounds || toolCalls.length >= LIMITS.maxToolCallsPerTurn;
    const response = await model.complete(
      {
        instructions: forceAnswer
          ? `${instructions}\n\nTool budget exhausted: answer now with the results you already have, and say what you could not check.`
          : instructions,
        input: conversation,
        tools: forceAnswer ? [] : tools,
        maxOutputTokens: LIMITS.maxOutputTokens,
      },
      input.signal,
    );
    usage.inputTokens += response.usage.inputTokens;
    usage.outputTokens += response.usage.outputTokens;

    if (response.toolCalls.length === 0 || forceAnswer) {
      text = response.text.trim();
      stoppedEarly = forceAnswer && response.toolCalls.length > 0;
      break;
    }

    conversation.push(...response.outputItems);
    for (const call of response.toolCalls) {
      if (toolCalls.length >= LIMITS.maxToolCallsPerTurn) {
        conversation.push({ type: "function_call_output", call_id: call.callId, output: JSON.stringify({ error: "Tool call limit reached for this question." }) });
        continue;
      }
      const result = executeTool(call.name, call.argumentsJson, ctx);
      toolCalls.push({ name: call.name, ok: result.ok, status: result.result?.meta.status, period: result.result?.meta.period });
      if (result.result) {
        const s = result.result.meta.status;
        if (!dataStatus || STATUS_RANK[s] > STATUS_RANK[dataStatus]) dataStatus = s;
      }
      toolOutputs.push(result.output);
      conversation.push({ type: "function_call_output", call_id: call.callId, output: result.output });
    }
  }

  if (!text) throw new ModelError("bad_response", "The model returned an empty answer.");

  // Verify amounts; allow one repair round.
  const userTexts = [...input.history.filter((m) => m.role === "user").map((m) => m.content), question];
  // Amounts from earlier answers in this conversation were verified when produced.
  const priorAnswers = input.history.filter((m) => m.role === "assistant").map((m) => m.content);
  const allowed = allowedAmountKeys([...toolOutputs, ...priorAnswers], userTexts);
  let unverified = findUnverifiedAmounts(text, allowed);
  if (unverified.length > 0) {
    conversation.push({ type: "message", role: "assistant", content: text });
    conversation.push({
      type: "message",
      role: "user",
      content: `System check: these amounts in your answer do not appear in any tool result: ${unverified.join(", ")}. Rewrite the answer using only amounts quoted exactly from tool results, or remove them. Do not mention this check.`,
    });
    const repair = await model.complete(
      { instructions, input: conversation, tools: [], maxOutputTokens: LIMITS.maxOutputTokens },
      input.signal,
    );
    usage.inputTokens += repair.usage.inputTokens;
    usage.outputTokens += repair.usage.outputTokens;
    const repaired = repair.text.trim();
    if (repaired) {
      const stillUnverified = findUnverifiedAmounts(repaired, allowed);
      if (stillUnverified.length < unverified.length || stillUnverified.length === 0) {
        text = repaired;
        unverified = stillUnverified;
      }
    }
  }

  return { text, mode: "ai", toolCalls, dataStatus, unverifiedAmounts: unverified, usage, stoppedEarly };
}
