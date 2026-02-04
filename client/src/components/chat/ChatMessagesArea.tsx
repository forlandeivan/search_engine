import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { Loader2, Sparkles, Music, Search, Archive, File as FileIcon, Download } from "lucide-react";
import MarkdownRenderer from "@/components/ui/markdown";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { AssistantActionState, ChatMessage } from "@/types/chat";
import { useTypewriter } from "@/hooks/useTypewriter";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ChatCitations } from "./ChatCitations";
import { DocumentAttachment } from "./DocumentAttachment";
// TODO: Epic 8, US-5 - Накопленные источники диалога
// import { ChatSourcesPanel } from "./ChatSourcesPanel";
import type { RagChunk } from "@/types/search";

type ReadOnlyReason = "chat" | "skill";

type ChatMessagesAreaProps = {
  chatTitle: string | null;
  skillName: string | null;
  chatId?: string | null;
  assistantAction?: AssistantActionState | null;
  isReadOnly?: boolean;
  readOnlyReason?: ReadOnlyReason | null;
  messages: ChatMessage[];
  isLoading: boolean;
  isNewChat: boolean;
  isStreaming: boolean;
  streamError: string | null;
  errorMessage: string | null;
  onReset?: () => void;
  scrollContainerRef?: RefObject<HTMLElement | null>;
  onOpenTranscript?: (transcriptId: string, defaultTabId?: string | null) => void;
  onOpenCard?: (cardId: string, fallbackTranscriptId?: string | null, defaultTabId?: string | null) => void;
  onRenameChat?: (title: string) => Promise<void>;
  workspaceId?: string;
  isRagSkill?: boolean; // Является ли навык RAG-навыком
  /** Контент под областью сообщений (например, поле ввода), внутри колонки 768px */
  children?: ReactNode;
};

export default function ChatMessagesArea({
  chatTitle,
  skillName,
  chatId,
  assistantAction = null,
  isReadOnly = false,
  readOnlyReason,
  messages,
  isLoading,
  isNewChat,
  isStreaming,
  streamError,
  errorMessage,
  onReset,
  scrollContainerRef,
  onOpenTranscript,
  onOpenCard,
  onRenameChat,
  workspaceId,
  isRagSkill = false,
  children,
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

  const assistantActionText = useMemo(() => {
    if (!assistantAction?.type) return null;
    const explicit = assistantAction.text?.trim();
    if (explicit) return explicit;
    switch (assistantAction.type) {
      case "ANALYZING":
        return "Ассистент анализирует...";
      case "TRANSCRIBING":
        return "Готовит стенограмму...";
      case "TYPING":
        return "Ассистент печатает...";
      default:
        return null;
    }
  }, [assistantAction]);

  const readonlyBanner = isReadOnly ? (
    <div className="mb-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-950 dark:text-amber-100">
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
    <div className="flex h-full min-h-0 flex-1 flex-col bg-background">
      {/* Шапка на всю ширину (вне колонки 768px) */}
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-background px-4">
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
                className="text-lg font-semibold tracking-tight text-foreground cursor-pointer hover:underline"
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
              
              {/* Панель источников для RAG-навыков */}
              {/* TODO: Epic 8, US-5 - Накопленные источники диалога */}
              {/* {isRagSkill && chatId && workspaceId && (
                <ChatSourcesPanel 
                  chatId={chatId}
                  workspaceId={workspaceId}
                />
              )} */}
            </div>
          ) : null}
          {isEditingTitle ? (
            <div className="flex items-center gap-2">
              <input
                className="w-full max-w-xs rounded-md border border-input bg-background px-2 py-1 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/20"
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
            className="h-9 w-9 rounded-full"
            data-testid="button-search-messages"
          >
            <Search className="h-4 w-4 text-muted-foreground" />
          </Button>
        </div>
      </header>

      {/* Скролл на всю ширину — скроллбар у правого края экрана */}
      <div ref={listRef} className="flex-1 min-h-0 overflow-y-auto py-5">
        <div className="mx-auto max-w-[800px] px-4">
        <div className="flex min-h-full flex-col gap-3">
          {readonlyBanner}
          {assistantActionText ? (
            <div className="mb-3 flex items-center gap-2 rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-900 dark:border-sky-500/40 dark:bg-sky-900/40 dark:text-sky-100">
              <Sparkles className="h-4 w-4 text-sky-600 dark:text-sky-200" />
              <div className="flex flex-col leading-tight">
                <span>{assistantActionText}</span>
              </div>
            </div>
          ) : null}
          {errorMessage ? (
            <div className="mx-auto mt-10 max-w-lg rounded-2xl border border-border bg-card p-6 text-center shadow-sm">
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
            <div className="mx-auto mt-10 max-w-xl rounded-2xl border border-border bg-card p-6 text-center shadow-sm">
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

          {!errorMessage && !isLoading && messages.length > 0 ? (
            <div className="flex min-h-0 flex-1 flex-col justify-end gap-3">
              {sortedMessages
                .filter((message) => {
                  const isEmptyAssistant =
                    message.role === "assistant" &&
                    (!message.content || message.content.trim().length === 0) &&
                    message.id?.startsWith("local-assistant");
                  const isTranscriptPlaceholder =
                    message.metadata?.type === "transcript" &&
                    (message.metadata?.transcriptStatus === "processing" ||
                      message.metadata?.transcriptStatus === "postprocessing");
                  return !isEmptyAssistant && !isTranscriptPlaceholder;
                })
                .map((message, index) => (
                  <ChatBubble
                    key={message.id}
                    message={message}
                    previousRole={index > 0 ? sortedMessages[index - 1]?.role : undefined}
                    isStreamingBubble={streamingAssistantId === message.id || message.metadata?.streaming === true}
                    onOpenTranscript={onOpenTranscript}
                    onOpenCard={onOpenCard}
                    workspaceId={workspaceId}
                  />
                ))}
            </div>
          ) : null}

          {!isLoading && !errorMessage && messages.length === 0 && !isNewChat ? (
            <div className="text-center text-sm text-muted-foreground">Сообщений пока нет.</div>
          ) : null}
        </div>
        </div>
      </div>

      {/* Колонка 768px под скроллом: ошибки, «печатает», поле ввода */}
      <div className="mx-auto w-full max-w-[800px] shrink-0 px-4">
    {streamError ? (
        <div className="border-t bg-destructive/10 px-6 py-3 text-sm text-destructive">{streamError}</div>
      ) : null}

      {isStreaming && !assistantActionText ? (
        <div className="border-t bg-background px-6 py-3 text-sm text-muted-foreground">
          Ассистент печатает...
        </div>
      ) : null}
      {children}
      </div>
    </div>
  );
}

type ChatBubbleProps = {
  message: ChatMessage;
  previousRole?: ChatMessage["role"];
  isStreamingBubble?: boolean;
  onOpenTranscript?: (transcriptId: string, defaultTabId?: string | null) => void;
  onOpenCard?: (cardId: string, fallbackTranscriptId?: string | null, defaultTabId?: string | null) => void;
  workspaceId?: string;
};

function ChatBubble({
  message,
  previousRole,
  isStreamingBubble = false,
  onOpenTranscript,
  onOpenCard,
  workspaceId,
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

  const metadata = (message.metadata ?? {}) as ChatMessage["metadata"];
  const cardId = (message as any).cardId ?? (metadata as any)?.cardId ?? null;
  const isTranscript =
    (metadata?.type === "transcript" && metadata.transcriptId) ||
    Boolean(cardId);
  const resolvedStreaming = isStreamingBubble || metadata?.streaming === true;
  const fileMeta = message.file ?? (metadata as any)?.file;
  const isFileMessage =
    message.type === "file" ||
    Boolean(fileMeta?.attachmentId || fileMeta?.storageKey || fileMeta?.filename) ||
    (message.role === "user" && fileMeta);

  const displayContent = useTypewriter(message.content ?? "", {
    enabled: resolvedStreaming && !isAudioFile && !isAudioMessage,
    resetKey: message.id,
  });

  // Извлечь citations из metadata
  const citations = useMemo(() => {
    const raw = message.metadata?.citations;
    
    // Логирование для отладки
    if (message.role === "assistant") {
      console.log('[ChatCitations Debug]', {
        messageId: message.id,
        hasMetadata: !!message.metadata,
        rawCitations: raw,
        isArray: Array.isArray(raw),
        citationsType: typeof raw,
      });
    }
    
    if (!Array.isArray(raw)) {
      return [];
    }
    // Валидация структуры
    const filtered = raw.filter(
      (item): item is RagChunk =>
        typeof item === "object" &&
        item !== null &&
        typeof item.chunk_id === "string" &&
        typeof item.doc_id === "string"
    );
    
    if (message.role === "assistant" && filtered.length !== raw.length) {
      console.warn('[ChatCitations] Some citations were filtered out', {
        original: raw.length,
        filtered: filtered.length,
        sample: raw[0],
      });
    }
    
    return filtered;
  }, [message.metadata?.citations, message.id, message.role]);

  // Не показывать источники во время стриминга
  const showCitations = !resolvedStreaming && citations.length > 0;

  const formatSize = (size?: number | null) => {
    if (!size || size <= 0) return null;
    const kb = size / 1024;
    if (kb < 1024) return `${kb.toFixed(1)} КБ`;
    const mb = kb / 1024;
    return `${mb.toFixed(1)} МБ`;
  };

  const renderDocumentAttachment = () => {
    const meta = message.metadata as any;
    
    if (meta?.type !== 'document') return null;
    
    // Критическая ошибка: файл пустой или вообще не удалось обработать
    const hasCriticalError = Boolean(meta.extractionError) && 
                              (meta.extractedTextLength ?? 0) === 0;
    
    return (
      <DocumentAttachment
        filename={meta.fileName}
        mimeType={meta.mimeType}
        sizeBytes={meta.sizeBytes}
        hasCriticalError={hasCriticalError}
        errorMessage={hasCriticalError ? meta.extractionError : undefined}
        className="mt-2"
      />
    );
  };

  const renderFileBubble = () => {
    const name = fileMeta?.filename || message.content || "Файл";
    const sizeLabel = formatSize(fileMeta?.sizeBytes ?? null);
    const downloadUrl = fileMeta?.downloadUrl || null;
    const iconClassName =
      "flex h-10 w-10 items-center justify-center rounded-lg " +
      (isUser ? "bg-primary-foreground/15 text-primary-foreground" : "bg-muted text-foreground");
    const titleClassName = "break-words font-semibold " + (isUser ? "text-primary-foreground" : "text-foreground");
    const metaClassName = "text-xs " + (isUser ? "text-primary-foreground/70" : "text-muted-foreground");
    const linkClassName =
      "inline-flex items-center gap-2 text-sm font-medium " +
      (isUser ? "text-primary-foreground hover:underline" : "text-foreground hover:underline");
    return (
      <div className="flex items-center gap-3">
        <div className={iconClassName}>
          <FileIcon className="h-5 w-5" />
        </div>
        <div className="min-w-0 space-y-1">
          <p className={titleClassName}>{name}</p>
          <div className={metaClassName}>
            {sizeLabel ? <span>{sizeLabel}</span> : null}
          </div>
          {downloadUrl ? (
            <div className="pt-1">
              <a
                href={downloadUrl}
                className={linkClassName}
                target="_blank"
                rel="noreferrer"
              >
                <Download className="h-4 w-4" />
                Скачать
              </a>
            </div>
          ) : null}
        </div>
      </div>
    );
  };

  const renderAudioBubble = (fileName: string) => (
    <div className="flex items-start gap-2">
      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary-foreground">
        <Music className="h-4 w-4 text-primary" />
      </div>
      <div className="min-w-0">
        <p className="break-words font-semibold text-primary-foreground">{fileName}</p>
        <p className="text-xs text-primary-foreground/70">
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
        <div className="min-w-0 max-w-[70%]">
          {isFileMessage ? (
            <div className="min-w-0 overflow-hidden rounded-2xl bg-primary px-3 py-2.5 text-primary-foreground">
              {metadata?.type === 'document' ? (
                <>
                  {message.content && <p className="text-sm mb-2 break-words">{message.content}</p>}
                  {renderDocumentAttachment()}
                </>
              ) : (
                renderFileBubble()
              )}
              <div className="mt-2 flex items-center justify-end gap-1 text-xs text-primary-foreground/70">
                <span>{timestamp}</span>
              </div>
            </div>
          ) : (isAudioMessage || isAudioFile) ? (
            <div className="min-w-0 overflow-hidden rounded-2xl bg-primary p-1">
              <div className="rounded-xl bg-primary/90 border border-primary-foreground/20 p-3">
                {renderAudioBubble(audioFileName || legacyAudioFileName)}
              </div>
              <div className="flex items-center justify-end gap-1 p-2">
                <span className="text-xs text-primary-foreground/70">{timestamp}</span>
              </div>
            </div>
          ) : (
            <div className="min-w-0 overflow-hidden rounded-2xl bg-primary px-3 py-2.5">
              <p className="min-w-0 break-words text-sm font-medium text-primary-foreground">{displayContent}</p>
              <div className="mt-2 flex justify-end">
                <span className="text-xs text-primary-foreground/70">{timestamp}</span>
              </div>
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
      <div className="min-w-0 max-w-[70%]">
        <div className="min-w-0 overflow-hidden rounded-2xl border border-border bg-card p-3">
          {isTranscript ? (
              <TranscriptCard
                status={(metadata?.transcriptStatus as string) ?? "processing"}
                preview={metadata?.previewText || message.content}
                onOpen={() => {
                  const defaultTabId = (
                    (metadata as Record<string, unknown>)?.defaultViewId ??
                    (metadata as Record<string, unknown>)?.preferredTranscriptTabId ??
                    (metadata as Record<string, unknown>)?.defaultViewActionId ??
                    null
                  ) as string | null;
                  if (cardId && onOpenCard) {
                    onOpenCard(cardId, metadata?.transcriptId ?? null, defaultTabId);
                    return;
                  }
                  if (metadata?.transcriptId) {
                    onOpenTranscript?.(metadata.transcriptId, defaultTabId);
                  }
                }}
              />
          ) : isFileMessage ? (
            <>
              {metadata?.type === 'document' ? (
                <>
                  {message.content && (
                    <MarkdownRenderer
                      markdown={message.content}
                      className="text-sm text-foreground break-words mb-2"
                    />
                  )}
                  {renderDocumentAttachment()}
                </>
              ) : (
                renderFileBubble()
              )}
            </>
          ) : (
            <>
              <MarkdownRenderer
                markdown={displayContent}
                className="min-w-0 break-words text-sm text-foreground"
              />
              
              {/* Источники RAG */}
              {showCitations && (
                <ChatCitations
                  citations={citations}
                  workspaceId={workspaceId}
                />
              )}
              
              <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                {resolvedStreaming ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                <span>{resolvedStreaming ? "Ассистент печатает..." : timestamp}</span>
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
      <div className="rounded-lg bg-muted border-l-2 border-primary p-3">
        <p className="text-sm font-medium text-foreground">
          Транскрипция аудиофайла
        </p>
      </div>
      
      {isFailed ? (
        <p className="text-sm text-muted-foreground">Попробуйте позже или загрузите другой файл.</p>
      ) : (
        <>
          {preview ? (
            <p className="text-sm text-foreground line-clamp-6">{preview}</p>
          ) : null}
          <div className="flex items-center gap-2 pt-2">
            <Button
              size="sm"
              variant="outline"
              className="rounded-full text-xs"
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
