import { History } from "lucide-react";
import { loadPageData } from "@/lib/data/load";
import { getEnv } from "@/lib/env";
import { SUGGESTED_QUESTIONS } from "@/lib/cfo/service";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { CfoChat, type ChatMessage } from "@/components/cfo/chat";
import { ConversationList } from "@/components/cfo/conversation-list";

export const metadata = { title: "Personal CFO" };

export default async function CfoPage({ searchParams }: PageProps<"/cfo">) {
  const { repo, isDemo } = await loadPageData();
  const params = await searchParams;
  const requested = typeof params.c === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(params.c) ? params.c : null;
  const [conversations, conversation] = await Promise.all([
    repo.listConversations(30),
    requested ? repo.getConversation(requested) : Promise.resolve(null),
  ]);
  const aiEnabled = Boolean(getEnv().OPENAI_API_KEY);
  const messages: ChatMessage[] = (conversation?.messages ?? []).map((m) => ({
    role: m.role,
    content: m.content,
    metadata: m.role === "assistant" ? (m.metadata as ChatMessage["metadata"]) : undefined,
  }));

  return (
    <div className="grid gap-6 lg:grid-cols-[16rem_1fr]">
      <aside className="hidden lg:block">
        <ConversationList conversations={conversations} activeId={conversation?.id ?? null} />
      </aside>
      <div className="min-w-0 space-y-5">
        <PageHeader
          title="Personal CFO"
          description={conversation ? conversation.title : "Questions about your money, answered from your own numbers."}
          actions={
            <div className="flex flex-wrap gap-1.5">
              <Badge variant={aiEnabled ? "positive" : "info"}>{aiEnabled ? "AI on" : "Calculated answers (AI off)"}</Badge>
              {isDemo && <Badge variant="blush">Demo data</Badge>}
            </div>
          }
        />
        <details className="lg:hidden">
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 text-sm font-medium text-muted-foreground">
            <History className="size-4" aria-hidden /> Conversations ({conversations.length})
          </summary>
          <div className="mt-2 rounded-[var(--radius-card)] border border-border bg-surface p-3">
            <ConversationList conversations={conversations} activeId={conversation?.id ?? null} />
          </div>
        </details>
        <CfoChat
          key={conversation?.id ?? "new"}
          conversationId={conversation?.id ?? null}
          initialMessages={messages}
          suggestions={SUGGESTED_QUESTIONS.slice(0, 6)}
          aiEnabled={aiEnabled}
        />
      </div>
    </div>
  );
}
