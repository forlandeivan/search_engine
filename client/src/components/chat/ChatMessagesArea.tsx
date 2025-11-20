import { useEffect, useMemo, useRef } from "react";
import MarkdownRenderer from "@/components/ui/markdown";
import { cn } from "@/lib/utils";
import type { ChatMessage } from "@/types/chat";
import { Loader2, Sparkles } from "lucide-react";

type ChatMessagesAreaProps = {
  chatTitle?: string | null;
  skillName?: string | null;
  messages: ChatMessage[];
  isLoading?: boolean;
  isNewChat?: boolean;
  isStreaming?: boolean;
  streamError?: string | null;
};

export default function ChatMessagesArea({
  chatTitle,
  skillName,
  messages,
  isLoading,
  isNewChat,
  isStreaming,
  streamError,
}: ChatMessagesAreaProps) {
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!listRef.current) {
      return;
    }
    listRef.current.scrollTo({
      top: listRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages]);

  const headerTitle = useMemo(() => {
    if (isNewChat) {
      return "Новый диалог";
    }
    if (chatTitle && chatTitle.trim().length > 0) {
      return chatTitle.trim();
    }
    return "Без названия";
  }, [chatTitle, isNewChat]);

  const headerSkillLabel = skillName || "Unica Chat";

  return (
    <div className="flex h-full flex-col">
      <header className="border-b bg-white/80 px-6 py-4 dark:bg-slate-900/40">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{headerSkillLabel}</p>
        <h1 className="text-xl font-semibold">{headerTitle}</h1>
      </header>
      <div ref={listRef} className="flex-1 space-y-4 overflow-y-auto bg-muted/20 px-6 py-4">
        {isNewChat && messages.length === 0 ? (
          <div className="mx-auto mt-10 max-w-xl rounded-2xl border bg-white p-6 text-center shadow-sm dark:border-slate-800 dark:bg-slate-900/60">
            <Sparkles className="mx-auto h-8 w-8 text-primary" />
            <h2 className="mt-4 text-lg font-semibold">Начните новый диалог</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Системный навык Unica Chat готов отвечать на ваши вопросы. Просто напишите сообщение ниже.
            </p>
          </div>
        ) : null}
        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Загружаем историю…
          </div>
        ) : (
          messages.map((message) => <ChatBubble key={message.id} message={message} />)
        )}
      </div>
      {streamError ? (
        <div className="border-t bg-destructive/10 px-6 py-3 text-sm text-destructive">{streamError}</div>
      ) : null}
      {isStreaming ? (
        <div className="border-t bg-white/60 px-6 py-3 text-sm text-muted-foreground dark:bg-slate-900/60">
          Ассистент отвечает…
        </div>
      ) : null}
    </div>
  );
}

function ChatBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";

  return (
    <div className={cn("flex w-full", isUser ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[80%] space-y-2 rounded-2xl px-4 py-3 shadow-sm",
          isUser
            ? "bg-primary text-primary-foreground rounded-br-none"
            : "bg-white rounded-bl-none text-foreground dark:bg-slate-900",
        )}
      >
        <MarkdownRenderer content={message.content || ""} />
        <p className="text-right text-xs text-muted-foreground">
          {message.createdAt ? new Date(message.createdAt).toLocaleTimeString() : ""}
        </p>
      </div>
    </div>
  );
}
