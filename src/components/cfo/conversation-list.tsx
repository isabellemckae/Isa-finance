import Link from "next/link";
import { MessageSquarePlus, Trash2 } from "lucide-react";
import type { ConversationSummary } from "@/lib/data/repository";
import { deleteConversationAction } from "@/lib/actions/cfo";
import { cn } from "@/lib/utils";
import { ActionForm, SubmitButton } from "@/components/forms/action-form";

export function ConversationList({ conversations, activeId }: { conversations: ConversationSummary[]; activeId: string | null }) {
  return (
    <nav aria-label="Conversations" className="space-y-2">
      <Link
        href="/cfo"
        className="flex min-h-11 items-center gap-2 rounded-full bg-blush px-4 text-sm font-medium text-blush-foreground"
      >
        <MessageSquarePlus className="size-4" aria-hidden /> New conversation
      </Link>
      {conversations.length === 0 ? (
        <p className="px-2 text-sm text-muted-foreground">No conversations yet.</p>
      ) : (
        <ul className="space-y-1">
          {conversations.map((c) => (
            <li key={c.id} className="group flex items-center gap-1">
              <Link
                href={`/cfo?c=${encodeURIComponent(c.id)}`}
                aria-current={c.id === activeId ? "page" : undefined}
                className={cn(
                  "min-h-11 flex-1 truncate rounded-2xl px-3 py-2.5 text-sm text-muted-foreground hover:bg-surface-muted hover:text-foreground",
                  c.id === activeId && "bg-surface-muted font-medium text-foreground",
                )}
              >
                {c.title}
              </Link>
              <ActionForm action={deleteConversationAction} inlineStatus>
                <input type="hidden" name="id" value={c.id} />
                <SubmitButton variant="ghost" size="icon" aria-label={`Delete conversation: ${c.title}`} pendingLabel="">
                  <Trash2 aria-hidden />
                </SubmitButton>
              </ActionForm>
            </li>
          ))}
        </ul>
      )}
    </nav>
  );
}
