/**
 * Provider-neutral chat model interface used by the CFO agent. The OpenAI adapter
 * implements it in production; tests use a scripted fake.
 */

export type ConversationItem =
  | { type: "message"; role: "user" | "assistant"; content: string }
  | { type: "function_call_output"; call_id: string; output: string }
  /** Provider-specific item (e.g. a function call or reasoning item) echoed back verbatim. */
  | { type: "opaque"; item: unknown };

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ModelRequest {
  instructions: string;
  input: ConversationItem[];
  tools: ToolDefinition[];
  maxOutputTokens: number;
}

export interface ModelToolCall {
  callId: string;
  name: string;
  argumentsJson: string;
}

export interface ModelResponse {
  text: string;
  toolCalls: ModelToolCall[];
  /** Items to append to the conversation before sending tool outputs back. */
  outputItems: ConversationItem[];
  usage: { inputTokens: number; outputTokens: number };
}

export interface ChatModel {
  readonly name: string;
  complete(request: ModelRequest, signal?: AbortSignal): Promise<ModelResponse>;
}

/** Errors from the model provider, classified so the UI can show a safe message. */
export class ModelError extends Error {
  constructor(
    public readonly kind: "unavailable" | "rate_limited" | "auth" | "timeout" | "bad_response",
    message: string,
  ) {
    super(message);
    this.name = "ModelError";
  }
}
