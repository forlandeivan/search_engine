import { useEffect, useMemo, useRef, type RefObject } from "react";
import { Loader2, Sparkles, Music } from "lucide-react";
import MarkdownRenderer from "@/components/ui/markdown";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ChatMessage } from "@/types/chat";
import { useTypewriter } from "@/hooks/useTypewriter";

type ChatMessagesAreaProps = {
  chatTitle: string | null;
  skillName: string | null;
  messages: ChatMessage[];
  isLoading: boolean;
  isNewChat: boolean;
  isStreaming: boolean;
  isTranscribing: boolean;
  streamError: string | null;
  errorMessage: string | null;
  onReset?: () => void;
  scrollContainerRef?: RefObject<HTMLElement | null>;
  onOpenTranscript?: (transcriptId: string) => void;
};

export default function ChatMessagesArea({
  chatTitle,
  skillName,
  messages,
  isLoading,
  isNewChat,
  isStreaming,
  isTranscribing,
  streamError,
  errorMessage,
  onReset,
  scrollContainerRef,
  onOpenTranscript,
}: ChatMessagesAreaProps) {
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const target = scrollContainerRef?.current ?? listRef.current;
    if (!target) {
      return;
    }
    target.scrollTo({ top: target.scrollHeight, behavior: "smooth" });
  }, [messages, scrollContainerRef]);

  const headerTitle = useMemo(() => {
    if (isNewChat) {
      return "";
    }
    if (chatTitle && chatTitle.trim().length > 0) {
      return chatTitle.trim();
    }
    return "Последний разговор";
  }, [chatTitle, isNewChat]);

  const headerSkillLabel = skillName || "Unica Chat";
  const streamingAssistantId = useMemo(() => {
    if (!isStreaming || messages.length === 0) {
      return null;
    }
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const candidate = messages[index];
      if (candidate.role === "assistant" && candidate.id?.startsWith("local-assistant")) {
        return candidate.id;
      }
    }
    return null;
  }, [isStreaming, messages]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="border-b bg-white/80 px-6 py-4 dark:bg-slate-900/40">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{headerSkillLabel}</p>
        {headerTitle && <h1 className="text-xl font-semibold">{headerTitle}</h1>}
      </header>

      <div
        ref={listRef}
        className="flex-1 min-h-0 px-5 pb-24 pt-5 sm:px-6 lg:px-8 overflow-visible"
      >
        {/* 10px horizontal padding keeps bubbles near the edges but not touching */}
        <div className="flex h-full min-h-0 flex-col px-2.5">
          {errorMessage ? (
            <div className="mx-auto mt-10 max-w-lg rounded-2xl border bg-white p-6 text-center shadow-sm dark:border-slate-800 dark:bg-slate-900/60">
              <h2 className="text-lg font-semibold">Не удалось открыть чат</h2>
              <p className="mt-2 text-sm text-muted-foreground">{errorMessage}</p>
              {onReset ? (
                <Button className="mt-4" variant="outline" onClick={onReset}>
                  Вернуться к списку
                </Button>
              ) : null}
            </div>
          ) : null}

          {!errorMessage && isNewChat && messages.length === 0 ? (
            <div className="mx-auto mt-10 max-w-xl rounded-2xl border bg-white p-6 text-center shadow-sm dark:border-slate-800 dark:bg-slate-900/60">
              <Sparkles className="mx-auto h-8 w-8 text-primary" />
              <h2 className="mt-4 text-lg font-semibold">Начните новый чат</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Системный навык Unica Chat готов помочь. Задайте свой первый вопрос, чтобы начать
              </p>
            </div>
          ) : null}

          {isLoading && !errorMessage ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Загрузка истории чата...
            </div>
          ) : null}

          {!errorMessage
            ? messages.map((message, index) => (
                <ChatBubble
                  key={message.id}
                  message={message}
                  previousRole={index > 0 ? messages[index - 1]?.role : undefined}
                  isStreamingBubble={streamingAssistantId === message.id}
                  isTranscribingBubble={isTranscribing && index === messages.length - 1 && message.role === "assistant" && !message.content}
                  onOpenTranscript={onOpenTranscript}
                />
              ))
            : null}

          {!isLoading && !errorMessage && messages.length === 0 && !isNewChat ? (
            <div className="text-center text-sm text-muted-foreground">Сообщений нет.</div>
          ) : null}
        </div>
      </div>

      {streamError ? (
        <div className="border-t bg-destructive/10 px-6 py-3 text-sm text-destructive">{streamError}</div>
      ) : null}

      {isStreaming ? (
        <div className="border-t bg-white/60 px-6 py-3 text-sm text-muted-foreground dark:bg-slate-900/60">
          Помощник печатает...
        </div>
      ) : null}
    </div>
  );
}

type ChatBubbleProps = {
  message: ChatMessage;
  previousRole?: ChatMessage["role"];
  isStreamingBubble?: boolean;
  isTranscribingBubble?: boolean;
  onOpenTranscript?: (transcriptId: string) => void;
};

function ChatBubble({
  message,
  previousRole,
  isStreamingBubble = false,
  isTranscribingBubble = false,
  onOpenTranscript,
}: ChatBubbleProps) {
  const isUser = message.role === "user";
  const isGroupedWithPrevious = previousRole === message.role;
  const timestamp =
    message.createdAt && !Number.isNaN(Date.parse(message.createdAt))
      ? new Date(message.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
      : "";
  
  const isAudioFile = message.content?.startsWith("__AUDIO_FILE__:");
  const audioFileName = isAudioFile ? message.content.substring("__AUDIO_FILE__:".length) : "";
  const getAudioExtension = (fileName: string) => {
    const match = fileName.match(/\.([^.]+)$/);
    return match ? match[1].toUpperCase() : "AUDIO";
  };
  
  const displayContent = useTypewriter(message.content ?? "", {
    enabled: isStreamingBubble && !isAudioFile,
    resetKey: message.id,
  });

  const metadata = (message.metadata ?? {}) as ChatMessage["metadata"];
  const isTranscript = metadata?.type === "transcript" && metadata.transcriptId;

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
        {isTranscript ? (
          <TranscriptCard
            status={(metadata?.transcriptStatus as string) ?? "processing"}
            preview={metadata?.previewText || message.content}
            onOpen={() => metadata?.transcriptId && onOpenTranscript?.(metadata.transcriptId)}
          />
        ) : isTranscribingBubble ? (
          <div className="flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>Анализируем запись...</span>
          </div>
        ) : isAudioFile ? (
          <div className="flex items-center gap-2">
            <Music className="h-5 w-5 shrink-0" />
            <div className="min-w-0">
              <p className="font-medium truncate">{audioFileName}</p>
              <p className="text-xs opacity-70">{getAudioExtension(audioFileName)}</p>
            </div>
          </div>
        ) : (
          <MarkdownRenderer markdown={displayContent} className="break-words" />
        )}
        {timestamp ? (
          <p className={cn("text-xs", isUser ? "text-right text-[#6C7A89]" : "text-left text-muted-foreground")}>
            {timestamp}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function TranscriptCard({
  status,
  preview,
  onOpen,
}: {
  status: string;
  preview?: string;
  onOpen?: () => void;
}) {
  if (status === "processing") {
    return (
      <div className="space-y-2">
        <p className="text-sm font-semibold">Аудиозапись загружена</p>
        <p className="text-sm text-muted-foreground">Идёт расшифровка…</p>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Обработка может занять несколько минут
        </div>
      </div>
    );
  }

  if (status === "failed") {
    return (
      <div className="space-y-2">
        <p className="text-sm font-semibold text-destructive">Не удалось распознать аудио</p>
        <p className="text-sm text-muted-foreground">Попробуйте загрузить запись повторно.</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-sm font-semibold">Стенограмма заседания</p>
      {preview ? <p className="text-sm text-muted-foreground line-clamp-2">{preview}</p> : null}
      <Button size="sm" onClick={onOpen}>
        Открыть стенограмму
      </Button>
    </div>
  );
}
