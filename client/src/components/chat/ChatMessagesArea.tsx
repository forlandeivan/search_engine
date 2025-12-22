import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { Loader2, Sparkles, Music, Search, Archive } from "lucide-react";
import MarkdownRenderer from "@/components/ui/markdown";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ChatMessage } from "@/types/chat";
import { useTypewriter } from "@/hooks/useTypewriter";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

type ReadOnlyReason = "chat" | "skill";

type ChatMessagesAreaProps = {
  chatTitle: string | null;
  skillName: string | null;
  chatId?: string | null;
  isReadOnly?: boolean;
  readOnlyReason?: ReadOnlyReason | null;
  messages: ChatMessage[];
  isLoading: boolean;
  isNewChat: boolean;
  isStreaming: boolean;
  isTranscribing: boolean;
  streamError: string | null;
  errorMessage: string | null;
  onReset?: () => void;
  scrollContainerRef?: RefObject<HTMLElement | null>;
  onOpenTranscript?: (transcriptId: string, defaultTabId?: string | null) => void;
  onRenameChat?: (title: string) => Promise<void>;
};

export default function ChatMessagesArea({
  chatTitle,
  skillName,
  chatId,
  isReadOnly = false,
  readOnlyReason,
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
  onRenameChat,
}: ChatMessagesAreaProps) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [draftTitle, setDraftTitle] = useState(chatTitle ?? "");
  const [isSavingTitle, setIsSavingTitle] = useState(false);
  const resolvedReadOnlyReason = readOnlyReason ?? (isReadOnly ? "chat" : null);
  const readOnlyBannerText =
    resolvedReadOnlyReason === "skill"
      ? "Навык архивирован. Этот диалог доступен только для чтения."
      : "Чат архивирован. Этот диалог доступен только для чтения.";
  const readOnlyTooltipText =
    resolvedReadOnlyReason === "skill"
      ? "Навык архивирован, доступ только для чтения"
      : "Чат архивирован, доступ только для чтения";

  useEffect(() => {
    const target = scrollContainerRef?.current ?? listRef.current;
    if (!target) return;
    target.scrollTo({ top: target.scrollHeight, behavior: "smooth" });
  }, [messages, scrollContainerRef]);

  const headerTitle = useMemo(() => {
    if (isNewChat) return "";
    if (chatTitle && chatTitle.trim().length > 0) return chatTitle.trim();
    return "Новый разговор";
  }, [chatTitle, isNewChat]);

  const readonlyBanner = isReadOnly ? (
    <div className="mb-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
      {readOnlyBannerText}
    </div>
  ) : null;

  const streamingAssistantId = useMemo(() => {
    if (!isStreaming || messages.length === 0) return null;
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const candidate = messages[index];
      if (candidate.role === "assistant" && candidate.id?.startsWith("local-assistant")) {
        return candidate.id;
      }
    }
    return null;
  }, [isStreaming, messages]);

  const sortedMessages = useMemo(() => {
    return [...messages].sort((a, b) => {
      const dateA = new Date(a.createdAt).getTime();
      const dateB = new Date(b.createdAt).getTime();
      return dateA - dateB;
    });
  }, [messages]);

  // Debug: helps detect phantom bubbles (messages without content)
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.log("[ChatMessagesArea] render messages", sortedMessages.map((m) => ({
      id: m.id,
      role: m.role,
      contentPreview: (m.content ?? "").slice(0, 30),
      createdAt: m.createdAt,
      metadataType: (m.metadata as Record<string, unknown> | undefined)?.type ?? null,
    })));
  }, [sortedMessages]);

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-slate-50 dark:bg-slate-900">
      <header className="flex h-20 shrink-0 items-center justify-between border-b border-slate-200 bg-slate-50 px-6 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex-1">
          {headerTitle && !isEditingTitle ? (
            <div className="flex items-center gap-2">
              {isReadOnly ? (
                <TooltipProvider delayDuration={200}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Archive className="h-5 w-5 text-amber-600" aria-label="Архивный чат" />
                    </TooltipTrigger>
                    <TooltipContent side="top">
                      {readOnlyTooltipText}
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              ) : null}
              <h1
                className="text-2xl font-semibold tracking-tight text-slate-900 cursor-pointer hover:underline dark:text-slate-100"
                title="Переименовать чат"
                onClick={() => {
                  if (!chatId || !onRenameChat) return;
                  setDraftTitle(headerTitle);
                  setIsEditingTitle(true);
                }}
                data-testid="text-chat-title"
              >
                {headerTitle}
              </h1>
            </div>
          ) : null}
          {isEditingTitle ? (
            <div className="flex items-center gap-2">
              <input
                className="w-full max-w-xs rounded-md border border-slate-300 bg-white px-2 py-1 text-sm outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200 dark:border-slate-700 dark:bg-slate-800"
                value={draftTitle}
                autoFocus
                onChange={(e) => setDraftTitle(e.target.value)}
                onKeyDown={async (e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    if (!onRenameChat || !draftTitle.trim()) {
                      setIsEditingTitle(false);
                      return;
                    }
                    try {
                      setIsSavingTitle(true);
                      await onRenameChat(draftTitle);
                    } finally {
                      setIsSavingTitle(false);
                      setIsEditingTitle(false);
                    }
                  }
                  if (e.key === "Escape") {
                    e.preventDefault();
                    setDraftTitle(headerTitle);
                    setIsEditingTitle(false);
                  }
                }}
                onBlur={async () => {
                  if (!onRenameChat || !draftTitle.trim()) {
                    setIsEditingTitle(false);
                    return;
                  }
                  try {
                    setIsSavingTitle(true);
                    await onRenameChat(draftTitle);
                  } finally {
                    setIsSavingTitle(false);
                    setIsEditingTitle(false);
                  }
                }}
                data-testid="input-rename-title"
              />
              {isSavingTitle ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : null}
            </div>
          ) : null}
        </div>
        <div className="flex items-center">
          <Button
            variant="outline"
            size="icon"
            className="h-10 w-10 rounded-full border-slate-300"
            data-testid="button-search-messages"
          >
            <Search className="h-5 w-5 text-slate-600" />
          </Button>
        </div>
      </header>

      <div ref={listRef} className="flex-1 min-h-0 overflow-y-auto py-6">
        <div className="mx-auto max-w-3xl px-4">
          {readonlyBanner}
          <div className="flex h-full min-h-0 flex-col gap-3">
          {errorMessage ? (
            <div className="mx-auto mt-10 max-w-lg rounded-2xl border bg-white p-6 text-center shadow-sm dark:border-slate-800 dark:bg-slate-900/60">
              <h2 className="text-lg font-semibold">Не удалось загрузить историю</h2>
              <p className="mt-2 text-sm text-muted-foreground">{errorMessage}</p>
              {onReset ? (
                <Button className="mt-4" variant="outline" onClick={onReset} data-testid="button-reset-chat">
                  Вернуться к списку диалогов
                </Button>
              ) : null}
            </div>
          ) : null}

          {!errorMessage && isNewChat && messages.length === 0 ? (
            <div className="mx-auto mt-10 max-w-xl rounded-2xl border bg-white p-6 text-center shadow-sm dark:border-slate-800 dark:bg-slate-900/60">
              <Sparkles className="mx-auto h-8 w-8 text-primary" />
              <h2 className="mt-4 text-lg font-semibold">Начните новый диалог</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Задайте вопрос или опишите задачу — и получите ответ на основе навыка.
              </p>
            </div>
          ) : null}

          {isLoading && !errorMessage ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Загрузка истории сообщений...
            </div>
          ) : null}

          {!errorMessage
            ? sortedMessages
                .filter((message) => {
                  // Отсекаем временные локальные ассистентские сообщения без контента (плейсхолдеры стрима),
                  // чтобы не рендерить пустой bubble.
                  const isEmptyAssistant =
                    message.role === "assistant" &&
                    (!message.content || message.content.trim().length === 0) &&
                    message.id?.startsWith("local-assistant");
                  return !isEmptyAssistant;
                })
                .map((message, index) => (
                  <ChatBubble
                    key={message.id}
                    message={message}
                    previousRole={index > 0 ? sortedMessages[index - 1]?.role : undefined}
                    isStreamingBubble={streamingAssistantId === message.id}
                    isTranscribingBubble={
                      isTranscribing &&
                      index === messages.length - 1 &&
                      message.role === "assistant" &&
                      !message.content
                    }
                    onOpenTranscript={onOpenTranscript}
                  />
                ))
            : null}

          {!isLoading && !errorMessage && messages.length === 0 && !isNewChat ? (
            <div className="text-center text-sm text-muted-foreground">Сообщений пока нет.</div>
          ) : null}
          </div>
        </div>
      </div>

      {streamError ? (
        <div className="border-t bg-destructive/10 px-6 py-3 text-sm text-destructive">{streamError}</div>
      ) : null}

      {isStreaming ? (
        <div className="border-t bg-white/60 px-6 py-3 text-sm text-muted-foreground dark:bg-slate-900/60">
          Ассистент печатает...
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
  onOpenTranscript?: (transcriptId: string, defaultTabId?: string | null) => void;
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

  const isAudioMessage = message.metadata?.type === "audio";
  const audioFileName = isAudioMessage ? (message.metadata?.fileName as string) || message.content : "";
  
  const isAudioFile = message.content?.startsWith("__AUDIO_FILE__:") || message.content?.startsWith("__PENDING_OPERATION:");
  let legacyAudioFileName = "";
  
  if (message.content?.startsWith("__AUDIO_FILE__:")) {
    legacyAudioFileName = message.content.substring("__AUDIO_FILE__:".length);
  } else if (message.content?.startsWith("__PENDING_OPERATION:")) {
    const parts = message.content.split(":");
    if (parts.length >= 3) {
      legacyAudioFileName = decodeURIComponent(parts.slice(2).join(":"));
    }
  }
  
  const getAudioExtension = (fileName: string) => {
    const match = fileName.match(/\.([^.]+)$/);
    return match ? match[1].toLowerCase() : "audio";
  };

  const displayContent = useTypewriter(message.content ?? "", {
    enabled: isStreamingBubble && !isAudioFile && !isAudioMessage,
    resetKey: message.id,
  });

  const metadata = (message.metadata ?? {}) as ChatMessage["metadata"];
  const isTranscript = metadata?.type === "transcript" && metadata.transcriptId;

  const renderAudioBubble = (fileName: string) => (
    <div className="flex items-start gap-2">
      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-white">
        <Music className="h-4 w-4 text-[#4497d9]" />
      </div>
      <div className="min-w-0">
        <p className="font-semibold text-white">{fileName}</p>
        <p className="text-xs text-white/60">
          {getAudioExtension(fileName)}
        </p>
      </div>
    </div>
  );

  if (isUser) {
    return (
      <div
        className={cn(
          "flex w-full justify-end",
          isGroupedWithPrevious ? "mt-1" : "mt-3"
        )}
      >
        <div className="max-w-[70%]">
          {(isAudioMessage || isAudioFile) ? (
            <div className="rounded-2xl bg-[#2278bf] p-1">
              <div className="rounded-xl bg-[#1269a2] border border-[#4497d9] p-3">
                {renderAudioBubble(audioFileName || legacyAudioFileName)}
              </div>
              <div className="flex items-center justify-end gap-1 p-2">
                <span className="text-xs text-indigo-300">{timestamp}</span>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-1 rounded-2xl bg-[#2278bf] px-3 py-2.5">
              <p className="flex-1 text-sm font-medium text-white">{displayContent}</p>
              <span className="shrink-0 pl-2 text-xs text-indigo-300">{timestamp}</span>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex w-full justify-start",
        isGroupedWithPrevious ? "mt-1" : "mt-3"
      )}
    >
      <div className="max-w-[70%]">
        <div className="rounded-2xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-800">
          {isTranscript ? (
            <TranscriptCard
              status={(metadata?.transcriptStatus as string) ?? "processing"}
              preview={metadata?.previewText || message.content}
              onOpen={() =>
                metadata?.transcriptId &&
                onOpenTranscript?.(
                  metadata.transcriptId,
                  (
                    (metadata as Record<string, unknown>)?.defaultViewId ??
                    (metadata as Record<string, unknown>)?.preferredTranscriptTabId ??
                    (metadata as Record<string, unknown>)?.defaultViewActionId ??
                    null
                  ) as string | null
                )
              }
            />
          ) : isTranscribingBubble ? (
            <div className="flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-sm text-slate-900 dark:text-slate-100">Идёт расшифровка ответа</span>
            </div>
          ) : (
            <>
              <MarkdownRenderer
                markdown={displayContent}
                className="text-sm text-slate-900 break-words dark:text-slate-100"
              />
              <div className="mt-2">
                <span className="text-xs text-slate-500">{timestamp}</span>
              </div>
            </>
          )}
        </div>
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
  const isProcessing = status === "processing" || status === "postprocessing";
  const isFailed = status === "failed" || status === "auto_action_failed";

  return (
    <div className="space-y-2">
      <div className="rounded-lg bg-slate-100 border-l-2 border-[#095998] p-3 dark:bg-slate-700">
        <p className="text-sm font-medium text-slate-800 dark:text-slate-200">
          Транскрипция аудиофайла
        </p>
      </div>
      
      {isProcessing ? (
        <div className="flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" />
          <p className="text-sm text-muted-foreground">Подождите, готовим стенограмму</p>
        </div>
      ) : isFailed ? (
        <p className="text-sm text-muted-foreground">Попробуйте позже или загрузите другой файл.</p>
      ) : (
        <>
          {preview ? (
            <p className="text-sm text-slate-900 line-clamp-6 dark:text-slate-100">{preview}</p>
          ) : null}
          <div className="flex items-center gap-2 pt-2">
            <Button
              size="sm"
              variant="outline"
              className="rounded-full text-xs text-[#326994]"
              onClick={onOpen}
              data-testid="button-open-transcript"
            >
              Читать целиком
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
