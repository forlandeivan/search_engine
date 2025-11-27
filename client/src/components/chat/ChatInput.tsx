import { useCallback, useState, useEffect, useRef } from "react";
import { Send, Paperclip, Loader2, X } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

type ChatInputProps = {
  onSend: (message: string) => Promise<void> | void;
  onTranscribe?: (text: string) => void;
  disabled?: boolean;
  placeholder?: string;
  showAudioAttach?: boolean;
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
  showAudioAttach = true 
}: ChatInputProps) {
  const [value, setValue] = useState("");
  const [sttAvailable, setSttAvailable] = useState<boolean | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [attachedFile, setAttachedFile] = useState<File | null>(null);
  const [uploadedOperationId, setUploadedOperationId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  useEffect(() => {
    if (!showAudioAttach) {
      return;
    }
    
    fetch("/api/chat/transcribe/status", { credentials: "include" })
      .then((res) => res.json())
      .then((data) => {
        setSttAvailable(data.available === true);
      })
      .catch(() => {
        setSttAvailable(false);
      });
  }, [showAudioAttach]);

  const handleUploadAudio = useCallback(async (file: File): Promise<string | null> => {
    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append("audio", file);

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
        setUploadedOperationId(result.operationId);
        return result.operationId;
      } else {
        toast({
          title: "Ошибка",
          description: "Не удалось запустить транскрибацию. Попробуйте еще раз.",
          variant: "destructive",
        });
        return null;
      }
    } catch (error) {
      console.error("[ChatInput] Transcription error:", error);
      toast({
        title: "Ошибка транскрибации",
        description: error instanceof Error ? error.message : "Не удалось распознать аудио",
        variant: "destructive",
      });
      return null;
    } finally {
      setIsUploading(false);
    }
  }, [toast]);

  const handleSend = useCallback(async () => {
    if (disabled) {
      return;
    }

    // If file is attached and uploaded, send it
    if (attachedFile && uploadedOperationId) {
      if (onTranscribe) {
        onTranscribe(`__PENDING_OPERATION:${uploadedOperationId}:${attachedFile.name}`);
      }
      setAttachedFile(null);
      setUploadedOperationId(null);
      return;
    }

    // Otherwise send text message
    const trimmed = value.trim();
    if (!trimmed) {
      return;
    }
    setValue("");
    await onSend(trimmed);
  }, [disabled, onSend, value, attachedFile, uploadedOperationId, onTranscribe]);

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

  const validateAudioFile = (file: File): boolean => {
    if (!file.type.startsWith("audio/")) {
      toast({
        title: "Неподдерживаемый формат",
        description: "Пожалуйста, прикрепите аудиофайл (MP3, OGG, WAV, WebM и др.)",
        variant: "destructive",
      });
      return false;
    }

    const fileSizeMB = file.size / (1024 * 1024);
    if (fileSizeMB > MAX_FILE_SIZE_MB) {
      toast({
        title: "Файл слишком большой",
        description: `Максимальный размер файла: ${MAX_FILE_SIZE_MB} МБ`,
        variant: "destructive",
      });
      return false;
    }

    return true;
  };

  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);

    const files = e.dataTransfer.files;
    if (!files || files.length === 0) {
      return;
    }

    const file = files[0];
    if (validateAudioFile(file)) {
      setAttachedFile(file);
      handleUploadAudio(file);
    }
  }, [toast, handleUploadAudio]);

  const handleFileChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    event.target.value = "";

    if (validateAudioFile(file)) {
      setAttachedFile(file);
      handleUploadAudio(file);
    }
  }, [toast, handleUploadAudio]);

  const isSendDisabled = disabled || (value.trim().length === 0 && !attachedFile) || (attachedFile && !uploadedOperationId);
  const showAttachButton = showAudioAttach;
  const isAttachDisabled = disabled || isUploading || !!attachedFile;
  
  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="mx-auto w-full max-w-[880px] pb-14">
      {attachedFile && (
        <div className="mb-2 flex items-center gap-2 rounded-lg bg-blue-50 p-3 dark:bg-blue-950/30">
          {isUploading ? (
            <Loader2 className="h-5 w-5 shrink-0 animate-spin text-blue-600 dark:text-blue-400" />
          ) : null}
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-blue-900 truncate dark:text-blue-100">{attachedFile.name}</p>
            <p className="text-xs text-blue-700 dark:text-blue-300">
              {isUploading ? "Загрузка..." : formatFileSize(attachedFile.size)}
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0"
            onClick={() => {
              setAttachedFile(null);
              setUploadedOperationId(null);
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
        className={`rounded-[28px] border px-4 py-3 shadow-lg transition-colors sm:px-5 sm:py-4 ${
          isDragOver
            ? "border-blue-400 bg-blue-50/50 dark:border-blue-500 dark:bg-blue-950/30"
            : "border-slate-200 bg-white/95 dark:border-slate-700 dark:bg-slate-900/90"
        }`}
      >
        <div className="flex items-end gap-2 sm:gap-3">
          {showAttachButton && (
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
                    className="h-11 w-11 shrink-0 rounded-full"
                    onClick={handleAttachClick}
                    disabled={isAttachDisabled}
                    data-testid="button-attach-audio"
                  >
                    {isUploading ? (
                      <Loader2 className="h-5 w-5 animate-spin" />
                    ) : (
                      <Paperclip className="h-5 w-5" />
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top">
                  <p>Прикрепить аудиофайл для транскрибации</p>
                </TooltipContent>
              </Tooltip>
            </>
          )}
          <Textarea
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder={placeholder ?? "Напишите сообщение и нажмите Enter"}
            disabled={disabled}
            rows={3}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                handleSend();
              }
            }}
            className="min-h-[52px] flex-1 resize-none border-none bg-transparent px-0 py-0 text-base leading-6 focus-visible:ring-0 focus-visible:ring-offset-0"
            data-testid="input-chat-message"
          />
          <Button
            type="button"
            aria-label={attachedFile ? "Отправить аудиофайл" : "Отправить сообщение"}
            title={attachedFile ? "Отправить аудиофайл" : "Отправить сообщение"}
            size="icon"
            className="h-11 w-11 shrink-0 rounded-full shadow-md"
            onClick={handleSend}
            disabled={isSendDisabled}
            data-testid="button-send-message"
          >
            {isUploading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : attachedFile ? (
              <EqualizerIcon />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>
      <p className="mt-3 text-center text-xs text-muted-foreground">
        {showAttachButton ? "Прикрепите аудиофайл для транскрибации • " : ""}
        Shift + Enter — новая строка
      </p>
    </div>
  );
}
