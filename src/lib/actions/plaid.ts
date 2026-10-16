"use server";

import { getPlaidDeps } from "@/lib/plaid/deps";
import { plaidErrorMessage } from "@/lib/plaid/http";
import { connectionIdSchema, disconnectConnection, syncConnection } from "@/lib/plaid/service";
import { limiters } from "@/lib/security/rate-limit";
import { failure, runAction, type ActionState } from "./run";

/**
 * Bank connection actions. The user comes from the session (runAction → requireUser);
 * the connection id from the form is validated and checked for ownership by the
 * Plaid service before anything happens.
 */

const DEMO_MESSAGE = "Demo connections are fictional, so there is nothing to sync or disconnect.";

export async function syncConnectionAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const id = connectionIdSchema.safeParse(formData.get("connectionId"));
  if (!id.success) return failure(formData.get("connectionId")?.toString().startsWith("demo-") ? DEMO_MESSAGE : "Invalid connection.");
  return runAction(async ({ user }) => {
    if (!limiters.plaid.check(user.id).allowed) return failure("Too many requests. Try again in a minute.");
    try {
      const r = await syncConnection(getPlaidDeps(), { connectionId: id.data, trigger: "manual", userId: user.id });
      if (r.status === "superseded") return "Already up to date.";
      const { added, modified, removed } = r.counts;
      const changed = added + modified + removed;
      const loading = r.updateStatus === "NOT_READY" ? " Your bank is still preparing transaction history." : "";
      return changed === 0 ? `Up to date.${loading}` : `Synced: ${added} new, ${modified} updated, ${removed} removed.${loading}`;
    } catch (error) {
      return failure(plaidErrorMessage(error));
    }
  }, ["/accounts", "/transactions", "/budget"]);
}

export async function disconnectConnectionAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const id = connectionIdSchema.safeParse(formData.get("connectionId"));
  if (!id.success) return failure(formData.get("connectionId")?.toString().startsWith("demo-") ? DEMO_MESSAGE : "Invalid connection.");
  if (formData.get("confirm") !== "yes") return failure("Confirm that you want to disconnect this bank.");
  return runAction(async ({ user }) => {
    if (!limiters.plaid.check(user.id).allowed) return failure("Too many requests. Try again in a minute.");
    try {
      await disconnectConnection(getPlaidDeps(), user.id, id.data);
      return "Disconnected. Your history is kept; nothing new will sync.";
    } catch (error) {
      return failure(plaidErrorMessage(error));
    }
  }, ["/accounts", "/transactions"]);
}
