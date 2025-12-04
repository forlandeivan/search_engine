import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Paperclip, Send, X, Mic } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import type { ChatMessage } from "@/types/chat";

export type TranscribePayload =
  | string
  | {
      operationId: string;
      fileName: string;
      chatId: string;
      audioMessage?: ChatMessage;
      placeholderMessage?: ChatMessage;
    };

type ChatInputProps = {
  onSend: (message: string) => Promise<void> | void;
  onTranscribe?: (payload: TranscribePayload) => void;
  onEnsureChat?: () => Promise<string | null> | string | null;
  disabled?: boolean;
  placeholder?: string;
  showAudioAttach?: boolean;
  chatId?: string | null;
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
  onEnsureChat,
  disabled,
  placeholder,
  showAudioAttach = true,
  chatId = null,
}: ChatInputProps) {
  const [value, setValue] = useState("");
  const [sttAvailable, setSttAvailable] = useState<boolean | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [attachedFile, setAttachedFile] = useState<File | null>(null);
  const [pendingTranscribe, setPendingTranscribe] = useState<TranscribePayload | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

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
        const formData = new FormData();
        formData.append("audio", file);
        formData.append("chatId", targetChatId);

        const response = await fetch("/api/chat/transcribe", {
          method: "POST",
          credentials: "include",
          body: formData,
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.message || `Ошибка отправки аудио: ${response.status}`);
        }

        const result = await response.json();

        if (result.operationId) {
          const payload: TranscribePayload = {
            operationId: result.operationId,
            fileName: file.name,
            chatId: targetChatId,
            audioMessage: result.audioMessage,
            placeholderMessage: result.placeholderMessage,
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
          title: "Ошибка транскрибации",
          description: error instanceof Error ? error.message : "Не удалось отправить файл",
          variant: "destructive",
        });
        return null;
      } finally {
        setIsUploading(false);
      }
    },
    [ensureChatId, toast],
  );

  const handleSend = useCallback(async () => {
    if (disabled) return;
    setIsSending(true);

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
    setValue("");
    await onSend(trimmed);
    setIsSending(false);
  }, [attachedFile, disabled, onSend, onTranscribe, pendingTranscribe, value]);

  const handleAttachClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleDragEnter = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer.items?.length > 0) {
      setIsDragOver(true);
    }
  }, []);

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
      setIsDragOver(false);
      const files = e.dataTransfer.files;
      if (!files || files.length === 0) return;
      const file = files[0];
      if (validateAudioFile(file)) {
        setAttachedFile(file);
        handleUploadAudio(file);
      }
    },
    [handleUploadAudio],
  );

  const handleFileChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;
      event.target.value = "";
      if (validateAudioFile(file)) {
        setAttachedFile(file);
        handleUploadAudio(file);
      }
    },
    [handleUploadAudio],
  );

  const isSendDisabled =
    disabled ||
    isUploading ||
    isSending ||
    (value.trim().length === 0 && !attachedFile) ||
    (attachedFile && !pendingTranscribe);
  const isAttachDisabled = disabled || isUploading || !!attachedFile;

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

      <div
        ref={containerRef}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        className={`rounded-full border bg-white px-3 py-2 shadow-lg transition-colors dark:bg-slate-900 ${
          isDragOver
            ? "border-blue-400 bg-blue-50/50 dark:border-blue-500 dark:bg-blue-950/30"
            : "border-slate-300 dark:border-slate-700"
        }`}
      >
        <div className="flex items-center gap-1">
          {showAudioAttach && (
            <>
              <input
                ref={fileInputRef}
                type="file"
                accept={ACCEPTED_AUDIO_TYPES}
                onChange={handleFileChange}
                className="hidden"
                data-testid="input-audio-file"
              />
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-10 w-10 shrink-0 rounded-full text-slate-400 hover:text-slate-600"
                    onClick={handleAttachClick}
                    disabled={isAttachDisabled}
                    data-testid="button-attach-audio"
                  >
                    <Paperclip className="h-6 w-6" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top">
                  <p>Прикрепите файл для транскрибации</p>
                </TooltipContent>
              </Tooltip>
            </>
          )}

          <Textarea
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder={placeholder ?? "Спросите что-нибудь..."}
            disabled={disabled}
            rows={1}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                handleSend();
              }
            }}
            className="h-10 !min-h-0 flex-1 resize-none border-none bg-transparent px-2 py-2 text-base leading-6 text-slate-600 placeholder:text-slate-400 focus-visible:ring-0 focus-visible:ring-offset-0 dark:text-slate-300 dark:placeholder:text-slate-500"
            data-testid="input-chat-message"
          />

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-10 w-10 shrink-0 rounded-full text-slate-400 hover:text-slate-600"
                data-testid="button-voice-input"
              >
                <Mic className="h-6 w-6" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">
              <p>Голосовой ввод</p>
            </TooltipContent>
          </Tooltip>

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
