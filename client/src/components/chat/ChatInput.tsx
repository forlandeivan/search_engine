import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Paperclip, Send, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { ChatMessage } from "@/types/chat";

type ToolbarAction = {
  id: string;
  label: string;
  description?: string | null;
  target: string;
  inputType: string;
  outputMode: string;
};

type ChatInputProps = {
  onSend: (message: string) => Promise<void> | void;
  onTranscribe?: (payload: string | { operationId: string; placeholder?: ChatMessage }) => void;
  disabled?: boolean;
  placeholder?: string;
  showAudioAttach?: boolean;
  chatId?: string | null;
  toolbarActions?: ToolbarAction[];
  toolbarLoadingId?: string | null;
  onRunToolbarAction?: (action: ToolbarAction, currentText: string) => void;
  externalValue?: string;
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
  disabled,
  placeholder,
  showAudioAttach = true,
  chatId,
  toolbarActions,
  toolbarLoadingId,
  onRunToolbarAction,
  externalValue,
}: ChatInputProps) {
  const [value, setValue] = useState("");
  const [sttAvailable, setSttAvailable] = useState<boolean | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [attachedFile, setAttachedFile] = useState<File | null>(null);
  const [uploadedTranscription, setUploadedTranscription] = useState<
    | {
        operationId: string;
        placeholder?: ChatMessage;
      }
    | null
  >(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  useEffect(() => {
    setValue("");
  }, [chatId]);

  useEffect(() => {
    if (externalValue !== undefined) {
      setValue(externalValue);
    }
  }, [externalValue]);

  useEffect(() => {
    if (!showAudioAttach) return;

    fetch("/api/chat/transcribe/status", { credentials: "include" })
      .then((res) => res.json())
      .then((data) => setSttAvailable(data.available === true))
      .catch(() => setSttAvailable(false));
  }, [showAudioAttach]);

  const handleUploadAudio = useCallback(
    async (file: File): Promise<{ operationId: string; placeholder?: ChatMessage } | null> => {
      if (!chatId) {
        toast({
          title: "Ошибка",
          description: "Нет чата. Создайте или выберите чат перед отправкой аудио.",
          variant: "destructive",
        });
        return null;
      }

      setIsUploading(true);
      try {
        const formData = new FormData();
        formData.append("audio", file);
        formData.append("chatId", chatId);

        const response = await fetch("/api/chat/transcribe", {
          method: "POST",
          credentials: "include",
          body: formData,
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.message || `Ошибка транскрибации: ${response.status}`);
        }

        const result = await response.json();

        if (result.operationId) {
          const payload = {
            operationId: result.operationId as string,
            placeholder: result.chatMessage as ChatMessage | undefined,
          };
          setUploadedTranscription(payload);
          return payload;
        }

        toast({
          title: "Ошибка",
          description: "Не удалось инициировать транскрибацию. Попробуйте ещё раз.",
          variant: "destructive",
        });
        return null;
      } catch (error) {
        console.error("[ChatInput] Transcription error:", error);
        toast({
          title: "Ошибка транскрибации",
          description: error instanceof Error ? error.message : "Не удалось распознать файл",
          variant: "destructive",
        });
        return null;
      } finally {
        setIsUploading(false);
      }
    },
    [chatId, toast],
  );

  const handleFileChange = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;
      if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
        toast({
          title: "Файл слишком большой",
          description: `Максимальный размер ${MAX_FILE_SIZE_MB} МБ`,
          variant: "destructive",
        });
        return;
      }
      const transcription = await handleUploadAudio(file);
      if (transcription && onTranscribe) {
        onTranscribe(transcription);
      }
    },
    [handleUploadAudio, onTranscribe, toast],
  );

  const handleDrop = useCallback(
    async (event: React.DragEvent) => {
      event.preventDefault();
      setIsDragOver(false);
      const file = event.dataTransfer.files?.[0];
      if (!file) return;
      if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
        toast({
          title: "Файл слишком большой",
          description: `Максимальный размер ${MAX_FILE_SIZE_MB} МБ`,
          variant: "destructive",
        });
        return;
      }
      setAttachedFile(file);
      const transcription = await handleUploadAudio(file);
      if (transcription && onTranscribe) {
        onTranscribe(transcription);
      }
    },
    [handleUploadAudio, onTranscribe, toast],
  );

  const resetFile = () => {
    setAttachedFile(null);
    setUploadedTranscription(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleSubmit = useCallback(async () => {
    const trimmed = value.trim();
    if (!trimmed) {
      return;
    }

    setIsSending(true);
    try {
      await onSend(trimmed);
      setValue("");
    } finally {
      setIsSending(false);
    }
  }, [onSend, value]);

  const disableSend =
    disabled || isSending || isUploading || (!value.trim() && !attachedFile && !uploadedTranscription);

  const showAudioButton = showAudioAttach && sttAvailable !== false;

  return (
    <div
      ref={containerRef}
      className={cn(
        "relative flex flex-col gap-2 rounded-2xl border border-slate-200 bg-white p-4 shadow-xl dark:border-slate-800 dark:bg-slate-900",
        isDragOver && "border-dashed border-primary",
        disabled && "opacity-60 pointer-events-none",
      )}
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragOver(true);
      }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={handleDrop}
    >
      {toolbarActions && toolbarActions.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          {toolbarActions.map((action) => (
            <Tooltip key={action.id}>
              <TooltipTrigger asChild>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={Boolean(toolbarLoadingId)}
                  onClick={() => onRunToolbarAction?.(action, value)}
                  className="h-8"
                >
                  {toolbarLoadingId === action.id ? (
                    <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                  ) : null}
                  {action.label}
                </Button>
              </TooltipTrigger>
              {action.description ? (
                <TooltipContent side="top" className="max-w-xs text-xs">
                  {action.description}
                </TooltipContent>
              ) : null}
            </Tooltip>
          ))}
        </div>
      ) : null}

      <div className="flex items-start gap-3">
        {showAudioButton ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-10 w-10"
                onClick={() => fileInputRef.current?.click()}
                disabled={disabled || isSending || isUploading}
              >
                <Paperclip className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top" className="text-xs">
              Прикрепить аудио для транскрибации
            </TooltipContent>
          </Tooltip>
        ) : null}

        <div className="flex-1 space-y-2">
          <Textarea
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={placeholder || "Напишите сообщение..."}
            className="min-h-[80px]"
            disabled={disabled}
          />
          {attachedFile ? (
            <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800/60">
              <span className="truncate">{attachedFile.name}</span>
              <Button type="button" size="icon" variant="ghost" onClick={resetFile} aria-label="Удалить файл">
                <X className="h-4 w-4" />
              </Button>
            </div>
          ) : null}
          {uploadedTranscription?.placeholder ? (
            <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800/60">
              <span className="truncate">{uploadedTranscription.placeholder.content}</span>
              <Button type="button" size="icon" variant="ghost" onClick={resetFile} aria-label="Удалить">
                <X className="h-4 w-4" />
              </Button>
            </div>
          ) : null}
        </div>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button type="button" variant="default" size="icon" disabled={disableSend} onClick={handleSubmit}>
              {isSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top" className="text-xs">
            Отправить
          </TooltipContent>
        </Tooltip>
      </div>

      {showAudioButton ? (
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPTED_AUDIO_TYPES}
          onChange={handleFileChange}
          hidden
        />
      ) : null}

      {isUploading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <EqualizerIcon />
          Загружаем аудио...
        </div>
      ) : null}
    </div>
  );
}
