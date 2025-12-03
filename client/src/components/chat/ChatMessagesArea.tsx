import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { Loader2, Sparkles, Music, EllipsisVertical } from "lucide-react";
import MarkdownRenderer from "@/components/ui/markdown";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ChatMessage } from "@/types/chat";
import { useTypewriter } from "@/hooks/useTypewriter";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";

type MessageAction = {
  id: string;
  label: string;
  description?: string | null;
  target: string;
  inputType: string;
  outputMode: string;
  scope: string;
};

type ChatMessagesAreaProps = {
  chatTitle: string | null;
  skillName: string | null;
  chatId?: string | null;
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
  onRenameChat?: (title: string) => Promise<void>;
  messageActions?: MessageAction[];
  messageActionsLoading?: boolean;
  messageActionsError?: string | null;
  onRunMessageAction?: (message: ChatMessage, action: MessageAction) => void;
};

export default function ChatMessagesArea({
  chatTitle,
  skillName,
  chatId,
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
  messageActions,
  messageActionsLoading,
  messageActionsError,
}: ChatMessagesAreaProps) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [draftTitle, setDraftTitle] = useState(chatTitle ?? "");
  const [isSavingTitle, setIsSavingTitle] = useState(false);

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

  const headerSkillLabel = skillName || "Unica Chat";
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

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="border-b bg-white/80 px-6 py-4 dark:bg-slate-900/40">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{headerSkillLabel}</p>
        {headerTitle && !isEditingTitle ? (
          <h1
            className="text-xl font-semibold cursor-pointer hover:underline"
            title="Переименовать чат"
            onClick={() => {
              if (!chatId || !onRenameChat) return;
              setDraftTitle(headerTitle);
              setIsEditingTitle(true);
            }}
          >
            {headerTitle}
          </h1>
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
            />
            {isSavingTitle ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : null}
          </div>
        ) : null}
      </header>

      <div ref={listRef} className="flex-1 min-h-0 px-5 pb-24 pt-5 sm:px-6 lg:px-8 overflow-visible">
        <div className="flex h-full min-h-0 flex-col px-2.5">
          {errorMessage ? (
            <div className="mx-auto mt-10 max-w-lg rounded-2xl border bg-white p-6 text-center shadow-sm dark:border-slate-800 dark:bg-slate-900/60">
              <h2 className="text-lg font-semibold">Не удалось загрузить историю</h2>
              <p className="mt-2 text-sm text-muted-foreground">{errorMessage}</p>
              {onReset ? (
                <Button className="mt-4" variant="outline" onClick={onReset}>
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
            ? sortedMessages.map((message, index) => (
                <ChatBubble
                  key={message.id}
                  message={message}
                  previousRole={index > 0 ? sortedMessages[index - 1]?.role : undefined}
                  isStreamingBubble={streamingAssistantId === message.id}
                  isTranscribingBubble={
                    isTranscribing && index === messages.length - 1 && message.role === "assistant" && !message.content
                  }
                  onOpenTranscript={onOpenTranscript}
                  messageActions={messageActions}
                  messageActionsLoading={messageActionsLoading}
                  messageActionsError={messageActionsError}
                />
              ))
            : null}

          {!isLoading && !errorMessage && messages.length === 0 && !isNewChat ? (
            <div className="text-center text-sm text-muted-foreground">Сообщений пока нет.</div>
          ) : null}
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
  onOpenTranscript?: (transcriptId: string) => void;
  messageActions?: MessageAction[];
  messageActionsLoading?: boolean;
  messageActionsError?: string | null;
};

function ChatBubble({
  message,
  previousRole,
  isStreamingBubble = false,
  isTranscribingBubble = false,
  onOpenTranscript,
  messageActions,
  messageActionsLoading,
  messageActionsError,
  onRunMessageAction,
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

  const hasActions = (messageActions?.length ?? 0) > 0;

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
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            {isTranscript ? (
              <TranscriptCard
                status={(metadata?.transcriptStatus as string) ?? "processing"}
                preview={metadata?.previewText || message.content}
                onOpen={() => metadata?.transcriptId && onOpenTranscript?.(metadata.transcriptId)}
              />
            ) : isTranscribingBubble ? (
              <div className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>Идёт расшифровка ответа</span>
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
          {hasActions ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Действия с сообщением">
                  <EllipsisVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>Действия</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {messageActionsLoading ? (
                  <DropdownMenuItem disabled className="text-muted-foreground">
                    Загружаем...
                  </DropdownMenuItem>
                ) : messageActionsError ? (
                  <DropdownMenuItem disabled className="text-destructive">
                    Не удалось загрузить
                  </DropdownMenuItem>
                  ) : (
                    messageActions!.map((action) => (
                      <DropdownMenuItem
                        key={action.id}
                        onClick={() => onRunMessageAction?.(message, action)}
                      >
                      <TooltipProvider delayDuration={200}>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="flex w-full items-center justify-between gap-2">
                              <span className="truncate">{action.label}</span>
                              <Badge variant={action.scope === "system" ? "secondary" : "outline"} className="text-[10px]">
                                {action.scope === "system" ? "SYS" : "WS"}
                              </Badge>
                            </span>
                          </TooltipTrigger>
                          {action.description ? (
                            <TooltipContent side="left" className="max-w-xs text-xs">
                              {action.description}
                            </TooltipContent>
                          ) : null}
                        </Tooltip>
                      </TooltipProvider>
                    </DropdownMenuItem>
                  ))
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
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
  if (status === "processing") {
    return (
      <div className="space-y-2">
        <p className="text-sm font-semibold">Идёт расшифровка аудио</p>
        <p className="text-sm text-muted-foreground">Обработка может занять несколько минут</p>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Подождите, готовим стенограмму
        </div>
      </div>
    );
  }

  if (status === "failed") {
    return (
      <div className="space-y-2">
        <p className="text-sm font-semibold text-destructive">Не удалось распознать аудио</p>
        <p className="text-sm text-muted-foreground">Попробуйте позже или загрузите другой файл.</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold">Стенограмма заседания</p>
          {status === "ready" ? <p className="text-xs text-muted-foreground">Готова к просмотру</p> : null}
        </div>
        <Button size="sm" variant="outline" onClick={onOpen}>
          Открыть стенограмму
        </Button>
      </div>
      {preview ? <p className="text-sm text-muted-foreground line-clamp-4">{preview}</p> : null}
    </div>
  );
}
