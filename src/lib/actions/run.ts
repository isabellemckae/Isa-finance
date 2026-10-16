import "server-only";
import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { z } from "zod";
import { requireUser, type SessionUser } from "@/lib/auth/dal";
import { getRepository } from "@/lib/data";
import { RepositoryError, type FinanceRepository } from "@/lib/data/repository";
import { firstError } from "@/lib/forms";

/** Result shape every form action returns (consumed by `useActionState`). */
export interface ActionState {
  ok: boolean;
  message: string | null;
  error: string | null;
  /** Changes on every result so the UI can react to repeated identical outcomes. */
  at: number;
}

export const idle: ActionState = { ok: false, message: null, error: null, at: 0 };

export const success = (message: string): ActionState => ({ ok: true, message, error: null, at: Date.now() });
export const failure = (error: string): ActionState => ({ ok: false, message: null, error, at: Date.now() });

export interface ActionContext {
  user: SessionUser;
  repo: FinanceRepository;
  now: Date;
}

/**
 * Runs a mutation: authorizes the user, binds the repository to them, maps errors
 * to safe messages, and revalidates affected pages. Redirects pass through.
 */
export async function runAction(
  fn: (ctx: ActionContext) => Promise<string | ActionState>,
  revalidate: string[] = [],
): Promise<ActionState> {
  try {
    const user = await requireUser();
    const repo = await getRepository(user);
    const result = await fn({ user, repo, now: new Date() });
    for (const path of new Set(["/", ...revalidate])) revalidatePath(path);
    return typeof result === "string" ? success(result) : result;
  } catch (error) {
    unstable_rethrow(error);
    if (error instanceof RepositoryError) return failure(error.message);
    if (error instanceof z.ZodError) return failure(firstError(error));
    // Unknown errors may contain data: log only the type, show a generic message.
    console.error("action_failed", { name: error instanceof Error ? error.name : typeof error });
    return failure("Something went wrong. Nothing was changed.");
  }
}

/** Validates input before running; validation errors are returned, not thrown. */
export function parse<S extends z.ZodTypeAny>(schema: S, input: unknown): z.infer<S> {
  return schema.parse(input);
}
