import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Paperclip, Send, X, Mic } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import { formatApiErrorMessage, isInsufficientCreditsError } from "@/lib/api-errors";
import { throwIfResNotOk } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import type { ChatMessage } from "@/types/chat";

export type TranscribePayload =
  | string
  | {
      operationId?: string | null;
      fileName: string;
      chatId: string;
      audioMessage?: ChatMessage;
      status?: "uploaded";
      fileId?: string | null;
    };

type ChatInputProps = {
  onSend: (message: string) => Promise<void> | void;
  onTranscribe?: (payload: TranscribePayload) => void;
  onSendFile?: (file: File) => Promise<void> | void;
  onCancelFileUpload?: () => void;
  onEnsureChat?: () => Promise<string | null> | string | null;
  disabled?: boolean;
  readOnlyHint?: string;
  placeholder?: string;
  showAudioAttach?: boolean;
  chatId?: string | null;
  disableAudioTranscription?: boolean;
  fileUploadState?: { fileName: string; size: number | null; status: "uploading" | "error" } | null;
};

const ACCEPTED_AUDIO_TYPES = ".ogg,.webm,.wav,.mp3,.m4a,.aac,.flac";
const MAX_FILE_SIZE_MB = 500;

function EqualizerIcon() {
  return (
    <div className="flex items-center justify-center gap-1">
      <div className="h-4 w-1 rounded-full bg-current animate-[pulse_0.6s_ease-in-out_infinite_0s]" />
      <div className="h-5 w-1 rounded-full bg-current animate-[pulse_0.6s_ease-in-out_infinite_0.2s]" />
      <div className="h-4 w-1 rounded-full bg-current animate-[pulse_0.6s_ease-in-out_infinite_0.4s]" />
    </div>
  );
}

export default function ChatInput({
  onSend,
  onTranscribe,
  onSendFile,
  onCancelFileUpload,
  onEnsureChat,
  disabled,
  readOnlyHint,
  placeholder,
  showAudioAttach = true,
  chatId = null,
  disableAudioTranscription = false,
  fileUploadState = null,
}: ChatInputProps) {
  const [value, setValue] = useState("");
  const [sttAvailable, setSttAvailable] = useState<boolean | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isUploadingFile, setIsUploadingFile] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [attachedFile, setAttachedFile] = useState<File | null>(null);
  const [pendingTranscribe, setPendingTranscribe] = useState<TranscribePayload | null>(null);
  const attachInputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { toast } = useToast();
  const MAX_ROWS = 10;
  const disabledTooltip = disabled ? readOnlyHint ?? "Чат архивирован, ввод недоступен" : null;

  const autoResize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const lineHeight = parseFloat(getComputedStyle(el).lineHeight || "24") || 24;
    const maxHeight = lineHeight * MAX_ROWS;
    const scrollHeight = el.scrollHeight;
    if (scrollHeight <= maxHeight) {
      el.style.height = `${scrollHeight}px`;
      el.style.overflowY = "hidden";
    } else {
      el.style.height = `${maxHeight}px`;
      el.style.overflowY = "auto";
    }
  }, []);

  useEffect(() => {
    if (!showAudioAttach) return;
    fetch("/api/chat/transcribe/status", { credentials: "include" })
      .then((res) => res.json())
      .then((data) => setSttAvailable(data.available === true))
      .catch(() => setSttAvailable(false));
  }, [showAudioAttach]);

  const validateAudioFile = (file: File): boolean => {
    if (!file.type.startsWith("audio/")) {
      toast({
        title: "Неподдерживаемый тип файла",
        description: "Выберите аудио-файл (MP3, OGG, WAV, WebM и т.д.).",
        variant: "destructive",
      });
      return false;
    }
    const sizeMb = file.size / (1024 * 1024);
    if (sizeMb > MAX_FILE_SIZE_MB) {
      toast({
        title: "Файл слишком большой",
        description: `Максимальный размер: ${MAX_FILE_SIZE_MB} МБ`,
        variant: "destructive",
      });
      return false;
    }
    return true;
  };

  const ensureChatId = useCallback(async (): Promise<string | null> => {
    if (chatId) return chatId;
    if (onEnsureChat) {
      const res = await onEnsureChat();
      return res ?? null;
    }
    return null;
  }, [chatId, onEnsureChat]);

  const handleUploadAudio = useCallback(
    async (file: File): Promise<TranscribePayload | null> => {
      const targetChatId = await ensureChatId();
      if (!targetChatId) {
        toast({
          title: "Нужен чат",
          description: "Сначала выберите или создайте чат, чтобы прикрепить файл.",
          variant: "destructive",
        });
        return null;
      }

      setIsUploading(true);
      try {
        const operationId =
          (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" && crypto.randomUUID()) ||
          `asr-${Date.now()}-${Math.random().toString(16).slice(2)}`;
        const formData = new FormData();
        formData.append("audio", file);
        formData.append("chatId", targetChatId);
        formData.append("operationId", operationId);

        const response = await fetch("/api/chat/transcribe", {
          method: "POST",
          credentials: "include",
          body: formData,
          headers: {
            "Idempotency-Key": operationId,
          },
        });

        if (response.status === 409) {
          // В No-code режиме сервер сообщает 409 — переключаемся на прямую отправку файла.
          if (onSendFile) {
            await onSendFile(file);
          }
          setAttachedFile(null);
          setPendingTranscribe(null);
          return null;
        }

        try {
          await throwIfResNotOk(response);
        } catch (error) {
          const friendlyMessage = formatApiErrorMessage(error);
          toast({
            title: isInsufficientCreditsError(error) ? "Недостаточно кредитов" : "Не удалось отправить аудио",
            description: friendlyMessage,
            variant: "destructive",
          });
          throw error;
        }

        const result = await response.json();

        if (result.status === "uploaded") {
          const payload: TranscribePayload = {
            operationId: null,
            status: "uploaded",
            fileName: file.name,
            chatId: targetChatId,
            audioMessage: result.audioMessage,
            fileId: result.fileId ?? null,
          };
          setPendingTranscribe(payload);
          return payload;
        }

        if (result.operationId) {
          const payload: TranscribePayload = {
            operationId: result.operationId,
            fileName: file.name,
            chatId: targetChatId,
            audioMessage: result.audioMessage,
          };
          setPendingTranscribe(payload);
          return payload;
        }

        toast({
          title: "Ошибка",
          description: "Не удалось начать транскрибацию файла.",
          variant: "destructive",
        });
        return null;
      } catch (error) {
        console.error("[ChatInput] Transcription error:", error);
        toast({
          title: "Не удалось отправить аудио",
          description: formatApiErrorMessage(error),
          variant: "destructive",
        });
        return null;
      } finally {
        setIsUploading(false);
      }
    },
    [ensureChatId, toast, disableAudioTranscription, onSendFile],
  );

  const handleSendFile = useCallback(
    async (file: File) => {
      if (!onSendFile) return;
      const targetChatId = await ensureChatId();
      if (!targetChatId) {
        toast({
          title: "Нужен чат",
          description: "Сначала выберите или создайте чат, чтобы прикрепить файл.",
          variant: "destructive",
        });
        return;
      }
      setIsUploadingFile(true);
      try {
        await onSendFile(file);
      } catch (error) {
        toast({
          title: "Не удалось отправить файл",
          description: formatApiErrorMessage(error),
          variant: "destructive",
        });
      } finally {
        setIsUploadingFile(false);
      }
    },
    [onSendFile, ensureChatId, toast],
  );

  const handleSend = useCallback(async () => {
    if (disabled) {
      if (readOnlyHint) {
        toast({
          title: "Только чтение",
          description: readOnlyHint,
        });
      }
      return;
    }
    setIsSending(true);

    if (attachedFile && disableAudioTranscription) {
      if (onSendFile) {
        await onSendFile(attachedFile);
      }
      setAttachedFile(null);
      setPendingTranscribe(null);
      setIsSending(false);
      return;
    }

    if (attachedFile && pendingTranscribe) {
      if (onTranscribe) {
        onTranscribe(pendingTranscribe);
      }
      setAttachedFile(null);
      setPendingTranscribe(null);
      setIsSending(false);
      return;
    }

    const trimmed = value.trim();
    if (!trimmed) {
      setIsSending(false);
      return;
    }

    try {
      await onSend(trimmed);
      setValue("");
    } finally {
      setIsSending(false);
    }
  }, [attachedFile, disabled, onSend, onTranscribe, pendingTranscribe, readOnlyHint, toast, value]);

  const handleDragEnter = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (disabled) return;
    if (e.dataTransfer.items?.length > 0) {
      setIsDragOver(true);
    }
  }, [disabled]);

  const handleDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.currentTarget === containerRef.current) {
      setIsDragOver(false);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      if (disabled) return;
      setIsDragOver(false);
      const files = e.dataTransfer.files;
      if (!files || files.length === 0) return;
      const file = files[0];
      if (validateAudioFile(file)) {
        if (!disableAudioTranscription) {
          setAttachedFile(file);
        }
        handleUploadAudio(file);
      }
    },
    [handleUploadAudio],
  );

  useEffect(() => {
    autoResize();
  }, [value, autoResize]);

  const isSendDisabled =
    disabled ||
    isUploading ||
    isSending ||
    (value.trim().length === 0 && !attachedFile) ||
    (attachedFile && !disableAudioTranscription && !pendingTranscribe);
  const isAttachDisabled =
    disabled || isUploading || isUploadingFile || fileUploadState?.status === "uploading" || !!attachedFile;

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-2">
      {attachedFile && (
        <div className="mb-2 flex items-center gap-2 rounded-lg bg-blue-50 p-3 dark:bg-blue-950/30">
          {isUploading ? <Loader2 className="h-5 w-5 shrink-0 animate-spin text-blue-600 dark:text-blue-400" /> : null}
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-blue-900 dark:text-blue-100">{attachedFile.name}</p>
            <p className="text-xs text-blue-700 dark:text-blue-300">
              {isUploading ? "Загружаем..." : formatFileSize(attachedFile.size)}
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0"
            onClick={() => {
              setAttachedFile(null);
              setPendingTranscribe(null);
            }}
            disabled={isUploading}
            data-testid="button-remove-audio"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      )}
      {fileUploadState && (
        <div className="mb-2 flex items-center gap-2 rounded-lg bg-blue-50 p-3 dark:bg-blue-950/30">
          {fileUploadState.status === "uploading" ? (
            <Loader2 className="h-5 w-5 shrink-0 animate-spin text-blue-600 dark:text-blue-400" />
          ) : (
            <X className="h-5 w-5 shrink-0 text-red-500" />
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-blue-900 dark:text-blue-100">
              {fileUploadState.fileName}
            </p>
            <p className="text-xs text-blue-700 dark:text-blue-300">
              {fileUploadState.status === "uploading"
                ? "Загружаем..."
                : "Не удалось отправить файл"}
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0"
            onClick={() => onCancelFileUpload?.()}
            data-testid="button-cancel-file-upload"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      )}

      <div
        ref={containerRef}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        className={cn(
          "rounded-2xl border bg-white px-3 py-2 shadow-lg transition-colors dark:bg-slate-900",
          isDragOver
            ? "border-blue-400 bg-blue-50/50 dark:border-blue-500 dark:bg-blue-950/30"
            : "border-slate-300 dark:border-slate-700",
          disabled ? "opacity-75 cursor-not-allowed" : ""
        )}
      >
        <div className="flex items-end gap-1">
          {showAudioAttach && (
            <>
              <input
                ref={attachInputRef}
                type="file"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (!file) return;
                if (showAudioAttach && file.type?.startsWith("audio/")) {
                  if (validateAudioFile(file)) {
                    if (!disableAudioTranscription) {
                      setAttachedFile(file);
                    }
                    void handleUploadAudio(file);
                  }
                  return;
                }
                  void handleSendFile(file);
                }}
            className="hidden"
            data-testid="input-chat-file"
          />
              {disabledTooltip ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-10 w-10 shrink-0 rounded-full text-slate-400 hover:text-slate-600"
                      onClick={() => attachInputRef.current?.click()}
                      disabled={isAttachDisabled}
                      data-testid="button-attach-file"
                    >
                      <Paperclip className="h-6 w-6" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="top">
                    <p>{disabledTooltip}</p>
                  </TooltipContent>
                </Tooltip>
              ) : (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-10 w-10 shrink-0 rounded-full text-slate-400 hover:text-slate-600"
                  onClick={() => attachInputRef.current?.click()}
                  disabled={isAttachDisabled}
                  data-testid="button-attach-file"
                >
                  <Paperclip className="h-6 w-6" />
                </Button>
              )}
            </>
          )}

          {disabledTooltip ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Textarea
                  ref={textareaRef}
                  value={value}
                  onChange={(event) => {
                    setValue(event.target.value);
                    requestAnimationFrame(autoResize);
                  }}
                  placeholder={placeholder ?? "Спросите что-нибудь..."}
                  disabled={disabled}
                  rows={1}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      handleSend();
                    }
                  }}
                  style={{ maxHeight: "240px", overflowY: "hidden", borderRadius: "12px" }}
                  className={cn(
                    "!min-h-0 flex-1 resize-none border-none px-2 py-2 text-base leading-6",
                    disabled
                      ? "cursor-not-allowed bg-transparent text-slate-400 dark:text-slate-600"
                      : "bg-transparent text-slate-600 placeholder:text-slate-400 focus-visible:ring-0 focus-visible:ring-offset-0 dark:text-slate-300 dark:placeholder:text-slate-500"
                  )}
                  data-testid="input-chat-message"
                />
              </TooltipTrigger>
              <TooltipContent side="top">
                <p>{disabledTooltip}</p>
              </TooltipContent>
            </Tooltip>
          ) : (
            <Textarea
              ref={textareaRef}
              value={value}
              onChange={(event) => {
                setValue(event.target.value);
                requestAnimationFrame(autoResize);
              }}
              placeholder={placeholder ?? "Спросите что-нибудь..."}
              disabled={disabled}
              rows={1}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  handleSend();
                }
              }}
              style={{ maxHeight: "240px", overflowY: "hidden", borderRadius: "12px" }}
              className={cn(
                "!min-h-0 flex-1 resize-none border-none px-2 py-2 text-base leading-6",
                disabled
                  ? "cursor-not-allowed bg-transparent text-slate-400 dark:text-slate-600"
                  : "bg-transparent text-slate-600 placeholder:text-slate-400 focus-visible:ring-0 focus-visible:ring-offset-0 dark:text-slate-300 dark:placeholder:text-slate-500"
              )}
              data-testid="input-chat-message"
            />
          )}

          <Button
            type="button"
            aria-label={attachedFile ? "Отправить аудио" : "Отправить сообщение"}
            title={attachedFile ? "Отправить аудио" : "Отправить сообщение"}
            size="icon"
            className="h-10 w-10 shrink-0 rounded-full bg-[#095998] shadow-md hover:bg-[#0a6ab8]"
            onClick={handleSend}
            disabled={isSendDisabled || false}
            data-testid="button-send-message"
          >
            {isSending ? (
              <Loader2 className="h-5 w-5 animate-spin text-white" />
            ) : attachedFile ? (
              <EqualizerIcon />
            ) : (
              <Send className="h-5 w-5 text-white" />
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
