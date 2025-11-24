import { useEffect, useMemo, useRef } from "react";
import { Loader2, Sparkles } from "lucide-react";
import MarkdownRenderer from "@/components/ui/markdown";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ChatMessage } from "@/types/chat";

type ChatMessagesAreaProps = {
  chatTitle: string | null;
  skillName: string | null;
  messages: ChatMessage[];
  isLoading: boolean;
  isNewChat: boolean;
  isStreaming: boolean;
  streamError: string | null;
  errorMessage: string | null;
  onReset?: () => void;
};

export default function ChatMessagesArea({
  chatTitle,
  skillName,
  messages,
  isLoading,
  isNewChat,
  isStreaming,
  streamError,
  errorMessage,
  onReset,
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
      return "Start a new conversation";
    }
    if (chatTitle && chatTitle.trim().length > 0) {
      return chatTitle.trim();
    }
    return "Recent conversation";
  }, [chatTitle, isNewChat]);

  const headerSkillLabel = skillName || "Unica Chat";

  return (
    <div className="flex h-full flex-col">
      <header className="border-b bg-white/80 px-6 py-4 dark:bg-slate-900/40">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{headerSkillLabel}</p>
        <h1 className="text-xl font-semibold">{headerTitle}</h1>
      </header>

      <div ref={listRef} className="flex-1 overflow-y-auto px-5 py-5 sm:px-6 lg:px-8">
        {/* 10px horizontal padding keeps bubbles near the edges but not touching */}
        <div className="flex h-full flex-col px-2.5">
          {errorMessage ? (
            <div className="mx-auto mt-10 max-w-lg rounded-2xl border bg-white p-6 text-center shadow-sm dark:border-slate-800 dark:bg-slate-900/60">
              <h2 className="text-lg font-semibold">Unable to open chat</h2>
              <p className="mt-2 text-sm text-muted-foreground">{errorMessage}</p>
              {onReset ? (
                <Button className="mt-4" variant="outline" onClick={onReset}>
                  Back to list
                </Button>
              ) : null}
            </div>
          ) : null}

          {!errorMessage && isNewChat && messages.length === 0 ? (
            <div className="mx-auto mt-10 max-w-xl rounded-2xl border bg-white p-6 text-center shadow-sm dark:border-slate-800 dark:bg-slate-900/60">
              <Sparkles className="mx-auto h-8 w-8 text-primary" />
              <h2 className="mt-4 text-lg font-semibold">Start a new chat</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                The Unica Chat system skill is ready to help. Ask your first question to begin.
              </p>
            </div>
          ) : null}

          {isLoading && !errorMessage ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading chat history...
            </div>
          ) : null}

          {!errorMessage
            ? messages.map((message, index) => (
                <ChatBubble
                  key={message.id}
                  message={message}
                  previousRole={index > 0 ? messages[index - 1]?.role : undefined}
                />
              ))
            : null}

          {!isLoading && !errorMessage && messages.length === 0 && !isNewChat ? (
            <div className="text-center text-sm text-muted-foreground">No messages yet.</div>
          ) : null}
        </div>
      </div>

      {streamError ? (
        <div className="border-t bg-destructive/10 px-6 py-3 text-sm text-destructive">{streamError}</div>
      ) : null}

      {isStreaming ? (
        <div className="border-t bg-white/60 px-6 py-3 text-sm text-muted-foreground dark:bg-slate-900/60">
          Assistant is typing...
        </div>
      ) : null}
    </div>
  );
}

type ChatBubbleProps = {
  message: ChatMessage;
  previousRole?: ChatMessage["role"];
};

function ChatBubble({ message, previousRole }: ChatBubbleProps) {
  const isUser = message.role === "user";
  const isGroupedWithPrevious = previousRole === message.role;
  const timestamp =
    message.createdAt && !Number.isNaN(Date.parse(message.createdAt))
      ? new Date(message.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
      : "";

  return (
    <div
      className={cn(
        "flex w-full first:mt-0",
        isUser ? "justify-end" : "justify-start",
        isGroupedWithPrevious ? "mt-1" : "mt-4",
      )}
    >
      <div
        className={cn(
          "max-w-[90%] space-y-2 rounded-2xl px-4 py-3 text-sm leading-relaxed shadow-sm transition-colors md:max-w-[70%]",
          isUser
            ? "rounded-br-md border border-[#B3D4FF] bg-[#E3F2FF] text-[#0A2342] hover:bg-[#d7ecff] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#9bc1ff]"
            : "rounded-bl-md bg-slate-50 text-slate-900 hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-400/70 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700 dark:focus-visible:outline-slate-300/40",
        )}
        tabIndex={0}
      >
        <MarkdownRenderer markdown={message.content || ""} className="break-words" />
        {timestamp ? (
          <p className={cn("text-xs", isUser ? "text-right text-[#6C7A89]" : "text-left text-muted-foreground")}>
            {timestamp}
          </p>
        ) : null}
      </div>
    </div>
  );
}
