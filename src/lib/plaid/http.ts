import "server-only";
import { z } from "zod";
import { jsonError } from "@/lib/api/guard";
import { PlaidError, PlaidNotConfiguredError } from "./ports";
import { messageForErrorCode, PlaidActionError } from "./service";

/** Maps Plaid-path errors to safe JSON responses. Details are never returned or logged. */
export function plaidErrorResponse(error: unknown, operation: string): Response {
  if (error instanceof PlaidNotConfiguredError) return jsonError(503, error.message);
  if (error instanceof PlaidActionError) return jsonError(error.code === "NOT_FOUND" ? 404 : 400, error.message);
  if (error instanceof PlaidError) {
    console.error("plaid_request_failed", { operation, code: error.code });
    return jsonError(502, messageForErrorCode(error.code));
  }
  if (error instanceof z.ZodError) return jsonError(400, "Invalid request.");
  console.error("plaid_request_failed", { operation, name: error instanceof Error ? error.name : typeof error });
  return jsonError(500, "Something went wrong with the bank connection. Nothing was changed.");
}

/** Plaid action outcomes for server actions: a safe message, never raw errors. */
export function plaidErrorMessage(error: unknown): string {
  if (error instanceof PlaidNotConfiguredError || error instanceof PlaidActionError) return error.message;
  if (error instanceof PlaidError) return messageForErrorCode(error.code);
  console.error("plaid_action_failed", { name: error instanceof Error ? error.name : typeof error });
  return "Something went wrong with the bank connection. Nothing was changed.";
}
