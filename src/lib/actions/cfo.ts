"use server";

import { redirect } from "next/navigation";
import { idField } from "@/lib/forms";
import { failure, runAction, type ActionState } from "./run";

export async function deleteConversationAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const id = idField.safeParse(formData.get("id"));
  if (!id.success) return failure("Invalid conversation.");
  const result = await runAction(async ({ repo }) => {
    await repo.deleteConversation(id.data);
    await repo.audit("cfo.conversation_deleted", "ai_conversation", id.data);
    return "Deleted.";
  }, ["/cfo"]);
  if (result.ok) redirect("/cfo");
  return result;
}
