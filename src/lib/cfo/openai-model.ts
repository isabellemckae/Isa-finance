import "server-only";
import OpenAI from "openai";
import { ModelError, type ChatModel, type ConversationItem, type ModelRequest, type ModelResponse } from "./model";

/**
 * OpenAI Responses API adapter. Server-only: the API key never reaches the browser.
 * - `store: false`: OpenAI is asked not to retain conversations for later retrieval.
 * - Reasoning items are passed back encrypted when the model returns them.
 * - No automatic retries inside a user request; failures fall back to offline answers.
 */

/** Used when OPENAI_MODEL is not set. Override it in the environment. */
export const DEFAULT_OPENAI_MODEL = "gpt-5-mini";

type InputItem = Record<string, unknown>;

function toInput(items: ConversationItem[]): InputItem[] {
  return items.map((item) => {
    switch (item.type) {
      case "message":
        return { role: item.role, content: item.content };
      case "function_call_output":
        return { type: "function_call_output", call_id: item.call_id, output: item.output };
      case "opaque":
        return item.item as InputItem;
    }
  });
}

export function createOpenAIModel(options: { apiKey: string; model: string; timeoutMs?: number }): ChatModel {
  const client = new OpenAI({ apiKey: options.apiKey, maxRetries: 0, timeout: options.timeoutMs ?? 45_000 });
  return {
    name: options.model,
    async complete(request: ModelRequest, signal?: AbortSignal): Promise<ModelResponse> {
      try {
        const response = await client.responses.create(
          {
            model: options.model,
            instructions: request.instructions,
            // The SDK's input union is wide; our items are built to its documented shapes.
            input: toInput(request.input) as unknown as OpenAI.Responses.ResponseInput,
            tools: request.tools.map((t) => ({
              type: "function" as const,
              name: t.name,
              description: t.description,
              parameters: t.parameters,
              strict: true,
            })),
            tool_choice: request.tools.length ? "auto" : "none",
            parallel_tool_calls: true,
            max_output_tokens: request.maxOutputTokens,
            store: false,
            include: ["reasoning.encrypted_content"],
          },
          { signal },
        );
        const toolCalls = response.output
          .filter((o): o is OpenAI.Responses.ResponseFunctionToolCall => o.type === "function_call")
          .map((o) => ({ callId: o.call_id, name: o.name, argumentsJson: o.arguments }));
        return {
          text: response.output_text ?? "",
          toolCalls,
          outputItems: response.output.map((o) => ({ type: "opaque" as const, item: o })),
          usage: {
            inputTokens: response.usage?.input_tokens ?? 0,
            outputTokens: response.usage?.output_tokens ?? 0,
          },
        };
      } catch (error) {
        throw classify(error);
      }
    },
  };
}

function classify(error: unknown): ModelError {
  if (error instanceof ModelError) return error;
  if (error instanceof OpenAI.APIConnectionTimeoutError) return new ModelError("timeout", "The AI service timed out.");
  if (error instanceof OpenAI.RateLimitError) return new ModelError("rate_limited", "The AI service is busy.");
  if (error instanceof OpenAI.AuthenticationError || error instanceof OpenAI.PermissionDeniedError) {
    return new ModelError("auth", "The AI service rejected the API key.");
  }
  if (error instanceof OpenAI.APIError) return new ModelError("unavailable", "The AI service returned an error.");
  if (error instanceof Error && error.name === "AbortError") return new ModelError("timeout", "The request was cancelled.");
  return new ModelError("unavailable", "The AI service could not be reached.");
}
