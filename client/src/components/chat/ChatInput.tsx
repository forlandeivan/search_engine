import { useCallback, useState, useEffect, useRef } from "react";
import { Send, Paperclip, Loader2 } from "lucide-react";
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
const MAX_FILE_SIZE_MB = 10;

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
  const fileInputRef = useRef<HTMLInputElement>(null);
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

  const handleSend = useCallback(async () => {
    const trimmed = value.trim();
    if (!trimmed || disabled) {
      return;
    }
    setValue("");
    await onSend(trimmed);
  }, [disabled, onSend, value]);

  const handleAttachClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    event.target.value = "";

    if (!file.type.startsWith("audio/")) {
      toast({
        title: "Неподдерживаемый формат",
        description: "Пожалуйста, выберите аудиофайл (MP3, OGG, WAV, WebM и др.)",
        variant: "destructive",
      });
      return;
    }

    const fileSizeMB = file.size / (1024 * 1024);
    if (fileSizeMB > MAX_FILE_SIZE_MB) {
      toast({
        title: "Файл слишком большой",
        description: `Максимальный размер файла: ${MAX_FILE_SIZE_MB} МБ`,
        variant: "destructive",
      });
      return;
    }

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
      
      if (result.text && result.text.trim().length > 0) {
        if (onTranscribe) {
          onTranscribe(result.text.trim());
        }
      } else {
        toast({
          title: "Речь не распознана",
          description: "В аудиофайле не обнаружена речь. Попробуйте другой файл.",
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error("[ChatInput] Transcription error:", error);
      toast({
        title: "Ошибка транскрибации",
        description: error instanceof Error ? error.message : "Не удалось распознать аудио",
        variant: "destructive",
      });
    } finally {
      setIsUploading(false);
    }
  }, [onTranscribe, toast]);

  const isSendDisabled = disabled || value.trim().length === 0;
  const showAttachButton = showAudioAttach && sttAvailable === true;
  const isAttachDisabled = disabled || isUploading;

  return (
    <div className="mx-auto w-full max-w-[880px] pb-14">
      <div className="rounded-[28px] border border-slate-200 bg-white/95 px-4 py-3 shadow-lg dark:border-slate-700 dark:bg-slate-900/90 sm:px-5 sm:py-4">
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
            aria-label="Отправить сообщение"
            title="Отправить сообщение"
            size="icon"
            className="h-11 w-11 shrink-0 rounded-full shadow-md"
            onClick={handleSend}
            disabled={isSendDisabled}
            data-testid="button-send-message"
          >
            <Send className="h-4 w-4" />
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
