import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
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
      status?: "uploaded" | "started";
      fileId?: string | null;
      /** For pre-uploaded files */
      s3Uri?: string;
      objectKey?: string;
      bucketName?: string;
      durationSeconds?: number | null;
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

export type ChatInputHandle = {
  handleFileDrop: (file: File) => void;
  focus: () => void;
};

const ACCEPTED_AUDIO_TYPES = ".ogg,.webm,.wav,.mp3,.m4a,.aac,.flac";
const MAX_FILE_SIZE_MB = 500;

// File type configuration
const ALLOWED_FILE_TYPES = {
  audio: {
    mimeTypes: ['audio/mp3', 'audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/ogg', 'audio/webm', 'audio/m4a', 'audio/aac', 'audio/flac'],
    extensions: ['.mp3', '.wav', '.ogg', '.webm', '.m4a', '.aac', '.flac'],
    label: 'Аудио',
  },
  document: {
    mimeTypes: [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/msword',
      'text/plain',
    ],
    extensions: ['.pdf', '.docx', '.doc', '.txt'],
    label: 'Документы',
  },
} as const;

type FileCategory = keyof typeof ALLOWED_FILE_TYPES;

const MAX_DOCUMENT_SIZE_MB = 50;
const MAX_DOCUMENT_SIZE_BYTES = MAX_DOCUMENT_SIZE_MB * 1024 * 1024;

function getFileExtension(filename: string): string {
  const match = filename.match(/\.([^.]+)$/);
  return match ? `.${match[1].toLowerCase()}` : '';
}

function getFileCategory(file: File): FileCategory | null {
  const ext = getFileExtension(file.name);
  const mimeType = file.type;
  
  for (const [category, config] of Object.entries(ALLOWED_FILE_TYPES)) {
    if (config.extensions.includes(ext as any)) return category as FileCategory;
    if (config.mimeTypes.includes(mimeType as any)) return category as FileCategory;
  }
  
  return null;
}

function validateChatFile(file: File): { 
  valid: boolean; 
  category?: FileCategory; 
  error?: string;
} {
  // Определение категории
  const category = getFileCategory(file);
  if (!category) {
    const ext = getFileExtension(file.name);
    const allowedExts = [
      ...ALLOWED_FILE_TYPES.audio.extensions,
      ...ALLOWED_FILE_TYPES.document.extensions,
    ].join(', ');
    return { 
      valid: false, 
      error: `Неподдерживаемый формат: ${ext || 'неизвестный'}. Поддерживаются: ${allowedExts}` 
    };
  }
  
  // Проверка размера для документов
  if (category === 'document' && file.size > MAX_DOCUMENT_SIZE_BYTES) {
    return { 
      valid: false, 
      error: `Файл слишком большой. Максимум для документов: ${MAX_DOCUMENT_SIZE_MB} MB` 
    };
  }
  
  // Проверка размера для аудио
  if (category === 'audio' && file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
    return { 
      valid: false, 
      error: `Файл слишком большой. Максимум для аудио: ${MAX_FILE_SIZE_MB} MB` 
    };
  }
  
  return { valid: true, category };
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function EqualizerIcon() {
  return (
    <div className="flex items-center justify-center gap-1">
      <div className="h-4 w-1 rounded-full bg-current animate-[pulse_0.6s_ease-in-out_infinite_0s]" />
      <div className="h-5 w-1 rounded-full bg-current animate-[pulse_0.6s_ease-in-out_infinite_0.2s]" />
      <div className="h-4 w-1 rounded-full bg-current animate-[pulse_0.6s_ease-in-out_infinite_0.4s]" />
    </div>
  );
}

const ChatInput = forwardRef<ChatInputHandle, ChatInputProps>(function ChatInput(props, ref) {
  const {
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
  } = props;
  const [value, setValue] = useState("");
  const [sttAvailable, setSttAvailable] = useState<boolean | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isUploadingFile, setIsUploadingFile] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [attachedFile, setAttachedFile] = useState<File | null>(null);
  const [pendingDocument, setPendingDocument] = useState<{
    file: File;
    category: FileCategory;
  } | null>(null);
  const [pendingTranscribe, setPendingTranscribe] = useState<TranscribePayload | null>(null);
  // Pre-uploaded file info (uploaded to S3, waiting for user to press Send)
  const [preUploadedFile, setPreUploadedFile] = useState<{
    fileName: string;
    s3Uri: string;
    objectKey: string;
    bucketName: string;
    durationSeconds: number | null;
    chatId: string;
  } | null>(null);
  const attachInputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { toast } = useToast();
  const MAX_ROWS = 10;
  // Показываем tooltip только когда есть readOnlyHint (архивация), а не просто при disabled (обработка запроса)
  const disabledTooltip = readOnlyHint ?? null;

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

  const handleUploadDocument = useCallback(
    async (): Promise<boolean> => {
      if (!pendingDocument) return false;
      
      const targetChatId = await ensureChatId();
      if (!targetChatId) {
        toast({
          title: "Нужен чат",
          description: "Сначала выберите или создайте чат, чтобы прикрепить файл.",
          variant: "destructive",
        });
        return false;
      }

      setIsUploadingFile(true);
      try {
        const formData = new FormData();
        formData.append("file", pendingDocument.file);

        const response = await fetch(`/api/chat/sessions/${targetChatId}/messages/attachment`, {
          method: "POST",
          body: formData,
          credentials: "include",
        });

        if (!response.ok) {
          const error = await response.json().catch(() => ({}));
          throw new Error(error.message || 'Ошибка загрузки файла');
        }

        const data = await response.json();

        // Успешно - очистить pending document
        setPendingDocument(null);

        // Toast с информацией (минималистичный)
        if (pendingDocument.category === 'document') {
          toast({
            title: "Документ загружен",
            description: "Файл готов к использованию в чате",
          });
        }

        return true;
      } catch (error) {
        const friendlyMessage = formatApiErrorMessage(error);
        toast({
          title: "Ошибка загрузки",
          description: friendlyMessage,
          variant: "destructive",
        });
        return false;
      } finally {
        setIsUploadingFile(false);
      }
    },
    [pendingDocument, ensureChatId, toast],
  );

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

        // Check if skill is in no-code mode - use file upload flow
        if (result.status === "no_code_required") {
          // В No-code режиме загружаем файл и ждём отправки пользователем.
          // Загружаем файл на сервер (без отправки события)
          const uploadFormData = new FormData();
          uploadFormData.append("file", file);

          const uploadResponse = await fetch(
            `/api/chat/sessions/${targetChatId}/messages/file`,
            {
              method: "POST",
              credentials: "include",
              body: uploadFormData,
            },
          );

          if (!uploadResponse.ok) {
            const errorData = await uploadResponse.json().catch(() => ({}));
            toast({
              title: "Не удалось загрузить файл",
              description: errorData.message || "Ошибка загрузки",
              variant: "destructive",
            });
            return null;
          }

          const uploadResult = await uploadResponse.json();
          
          console.log("[ChatInput] File uploaded in no-code mode", {
            uploadResult,
            messageId: uploadResult.message?.id,
            hasMessage: !!uploadResult.message,
          });
          
          // Устанавливаем pendingTranscribe с информацией о загруженном файле
          const payload: TranscribePayload = {
            operationId: null,
            status: "uploaded",
            fileName: file.name,
            chatId: targetChatId,
            audioMessage: uploadResult.message,
            fileId: uploadResult.fileId ?? null,
          };
          setPendingTranscribe(payload);
          console.log("[ChatInput] Set pendingTranscribe", {
            payload,
            hasAudioMessage: !!payload.audioMessage,
            audioMessageId: payload.audioMessage?.id,
          });
          return payload;
        }

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

  /**
   * Pre-upload audio file to S3 without starting transcription.
   * Called when user attaches a file.
   */
  const handlePreUploadAudio = useCallback(
    async (file: File): Promise<boolean> => {
      const targetChatId = await ensureChatId();
      if (!targetChatId) {
        toast({
          title: "Нужен чат",
          description: "Сначала выберите или создайте чат, чтобы прикрепить файл.",
          variant: "destructive",
        });
        return false;
      }

      // Show file immediately with loading indicator
      setAttachedFile(file);
      setIsUploading(true);
      
      try {
        const formData = new FormData();
        formData.append("audio", file);
        formData.append("chatId", targetChatId);

        const response = await fetch("/api/chat/transcribe/upload", {
          method: "POST",
          credentials: "include",
          body: formData,
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          
          // Check for no-code mode - fall back to old behavior (keep file attached)
          if (errorData.status === "no_code_required") {
            console.log("[ChatInput] No-code mode detected, will use handleUploadAudio on send");
            return true;
          }
          
          // On error, remove the attached file
          setAttachedFile(null);
          toast({
            title: "Не удалось загрузить файл",
            description: errorData.message || "Ошибка загрузки",
            variant: "destructive",
          });
          return false;
        }

        const result = await response.json();

        // Check for no-code mode
        if (result.status === "no_code_required") {
          console.log("[ChatInput] No-code mode detected, will use handleUploadAudio on send");
          return true;
        }

        // For some ASR providers (e.g. Unica) we intentionally skip pre-upload
        // and do upload+start in a single call on Send.
        if (result.status === "skip_preupload") {
          console.log("[ChatInput] Pre-upload skipped by server, will use handleUploadAudio on send", result);
          return true;
        }

        if (result.status === "uploaded" && result.s3Uri) {
          console.log("[ChatInput] File pre-uploaded to S3", {
            s3Uri: result.s3Uri,
            objectKey: result.objectKey,
            durationSeconds: result.durationSeconds,
          });
          
          setPreUploadedFile({
            fileName: file.name,
            s3Uri: result.s3Uri,
            objectKey: result.objectKey,
            bucketName: result.bucketName,
            durationSeconds: result.durationSeconds ?? null,
            chatId: targetChatId,
          });
          return true;
        }

        // Fallback - keep the file attached for old behavior
        return true;
      } catch (error) {
        console.error("[ChatInput] Pre-upload error:", error);
        // On error, remove the attached file
        setAttachedFile(null);
        toast({
          title: "Не удалось загрузить файл",
          description: formatApiErrorMessage(error),
          variant: "destructive",
        });
        return false;
      } finally {
        setIsUploading(false);
      }
    },
    [ensureChatId, toast],
  );

  /**
   * Start transcription for a pre-uploaded file.
   * Called when user presses Send.
   */
  const handleStartTranscription = useCallback(
    async (): Promise<TranscribePayload | null> => {
      if (!preUploadedFile) return null;

      try {
        const operationId =
          (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" && crypto.randomUUID()) ||
          `asr-${Date.now()}-${Math.random().toString(16).slice(2)}`;

        const response = await fetch("/api/chat/transcribe/start", {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": operationId,
          },
          body: JSON.stringify({
            chatId: preUploadedFile.chatId,
            s3Uri: preUploadedFile.s3Uri,
            objectKey: preUploadedFile.objectKey,
            durationSeconds: preUploadedFile.durationSeconds,
            operationId,
            fileName: preUploadedFile.fileName,
          }),
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          toast({
            title: "Не удалось начать транскрибацию",
            description: errorData.message || "Ошибка",
            variant: "destructive",
          });
          return null;
        }

        const result = await response.json();

        if (result.status === "started" && result.operationId) {
          console.log("[ChatInput] Transcription started for pre-uploaded file", {
            operationId: result.operationId,
          });

          const payload: TranscribePayload = {
            operationId: result.operationId,
            fileName: preUploadedFile.fileName,
            chatId: preUploadedFile.chatId,
            status: "started",
            s3Uri: preUploadedFile.s3Uri,
            objectKey: preUploadedFile.objectKey,
          };
          
          return payload;
        }

        return null;
      } catch (error) {
        console.error("[ChatInput] Start transcription error:", error);
        toast({
          title: "Не удалось начать транскрибацию",
          description: formatApiErrorMessage(error),
          variant: "destructive",
        });
        return null;
      }
    },
    [preUploadedFile, toast],
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

    // Handle document upload
    if (pendingDocument) {
      const uploaded = await handleUploadDocument();
      if (uploaded && value.trim()) {
        // If user typed a message along with the document, send it
        await onSend(value);
        setValue("");
      }
      setIsSending(false);
      return;
    }

    if (attachedFile && disableAudioTranscription) {
      if (onSendFile) {
        await onSendFile(attachedFile);
      }
      setAttachedFile(null);
      setPendingTranscribe(null);
      setIsSending(false);
      return;
    }

    // If we have an attached audio file, start transcription now (on Send)
    if (attachedFile && !disableAudioTranscription) {
      console.log("[ChatInput] handleSend - starting transcription for attached file", {
        hasPreUploadedFile: !!preUploadedFile,
      });
      try {
        let transcribePayload: TranscribePayload | null = null;
        
        // If file was pre-uploaded to S3, use the start endpoint
        if (preUploadedFile) {
          transcribePayload = await handleStartTranscription();
        } else {
          // Fallback to old behavior (upload + start in one call)
          transcribePayload = await handleUploadAudio(attachedFile);
        }
        
        if (transcribePayload && onTranscribe) {
          console.log("[ChatInput] handleSend - calling onTranscribe", {
            hasAttachedFile: !!attachedFile,
            pendingTranscribeStatus: typeof transcribePayload === 'object' ? transcribePayload.status : undefined,
            pendingTranscribeMessageId: typeof transcribePayload === 'object' ? transcribePayload.audioMessage?.id : undefined,
          });
          onTranscribe(transcribePayload);
        }
      } catch (error) {
        console.error("[ChatInput] handleSend - transcription error:", error);
      }
      setAttachedFile(null);
      setPendingTranscribe(null);
      setPreUploadedFile(null);
      setIsSending(false);
      return;
    }

    const trimmed = value.trim();
    if (!trimmed) {
      setIsSending(false);
      return;
    }

    // Очищаем поле ввода сразу, чтобы текст "улетел" в бабл сообщения
    setValue("");

    try {
      await onSend(trimmed);
    } finally {
      setIsSending(false);
    }
  }, [attachedFile, pendingDocument, handleUploadDocument, disabled, disableAudioTranscription, handleUploadAudio, handleStartTranscription, onSend, onSendFile, onTranscribe, preUploadedFile, readOnlyHint, toast, value]);

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
          // Pre-upload file to S3 immediately when attached
          void handlePreUploadAudio(file);
        }
      }
    },
    [validateAudioFile, disableAudioTranscription, handlePreUploadAudio],
  );

  // Handler for files dropped from parent component (page-level drag & drop)
  const handleExternalFileDrop = useCallback(
    (file: File) => {
      if (disabled) return;
      
      // Validate and categorize file
      const validation = validateChatFile(file);
      
      if (!validation.valid) {
        toast({
          title: "Ошибка загрузки",
          description: validation.error,
          variant: "destructive",
        });
        return;
      }
      
      const category = validation.category!;
      
      // Handle audio files
      if (category === 'audio') {
        if (!disableAudioTranscription) {
          // Pre-upload file to S3 immediately when attached
          void handlePreUploadAudio(file);
        } else if (onSendFile) {
          void onSendFile(file);
        }
        return;
      }
      
      // Handle document files
      if (category === 'document') {
        setPendingDocument({
          file,
          category,
        });
        return;
      }
      
      // For other files, use the file upload handler
      if (onSendFile) {
        void handleSendFile(file);
      }
    },
    [disabled, validateChatFile, disableAudioTranscription, handlePreUploadAudio, onSendFile, handleSendFile, toast],
  );

  // Expose handleFileDrop and focus methods via ref for parent components
  useImperativeHandle(ref, () => ({
    handleFileDrop: handleExternalFileDrop,
    focus: () => textareaRef.current?.focus(),
  }), [handleExternalFileDrop]);

  useEffect(() => {
    autoResize();
  }, [value, autoResize]);

  const isSendDisabled =
    disabled ||
    isUploading ||
    isSending ||
    isUploadingFile ||
    (value.trim().length === 0 && !attachedFile && !pendingDocument);
  const isAttachDisabled =
    disabled || isUploading || isUploadingFile || fileUploadState?.status === "uploading" || !!attachedFile || !!pendingDocument;

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
              setPreUploadedFile(null);
            }}
            disabled={isUploading}
            data-testid="button-remove-audio"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      )}
      
      {pendingDocument && (
        <div className="mb-2 flex items-center gap-2 rounded-lg bg-muted p-3">
          <div className="flex-shrink-0 rounded bg-background p-2">
            <Paperclip className="h-5 w-5 text-muted-foreground" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{pendingDocument.file.name}</p>
            <p className="text-xs text-muted-foreground">
              {ALLOWED_FILE_TYPES[pendingDocument.category].label} • {formatBytes(pendingDocument.file.size)}
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0"
            onClick={() => setPendingDocument(null)}
            disabled={isUploadingFile}
            aria-label="Удалить файл"
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
          "rounded-2xl border border-input bg-background px-3 py-2 shadow-sm transition-colors",
          isDragOver
            ? "border-blue-400 bg-blue-50/50 dark:border-blue-500 dark:bg-blue-950/30"
            : "",
          disabled ? "opacity-75 cursor-not-allowed" : ""
        )}
      >
        <div className="flex items-end gap-1">
          {showAudioAttach && (
            <>
              <input
                ref={attachInputRef}
                type="file"
                accept={[
                  ...ALLOWED_FILE_TYPES.audio.extensions,
                  ...ALLOWED_FILE_TYPES.document.extensions,
                ].join(',')}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (!file) return;
                  
                  const validation = validateChatFile(file);
                  
                  if (!validation.valid) {
                    toast({
                      title: "Ошибка загрузки",
                      description: validation.error,
                      variant: "destructive",
                    });
                    return;
                  }
                  
                  const category = validation.category!;
                  
                  // Handle audio
                  if (category === 'audio' && showAudioAttach) {
                    if (!disableAudioTranscription) {
                      void handlePreUploadAudio(file);
                    } else {
                      void handleSendFile(file);
                    }
                    return;
                  }
                  
                  // Handle document
                  if (category === 'document') {
                    setPendingDocument({
                      file,
                      category,
                    });
                    return;
                  }
                  
                  // Fallback
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
                      className="h-9 w-9 shrink-0 rounded-full text-muted-foreground hover:text-foreground"
                      onClick={() => attachInputRef.current?.click()}
                      disabled={isAttachDisabled}
                      data-testid="button-attach-file"
                    >
                      <Paperclip className="h-5 w-5" />
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
                  className="h-9 w-9 shrink-0 rounded-full text-muted-foreground hover:text-foreground"
                  onClick={() => attachInputRef.current?.click()}
                  disabled={isAttachDisabled}
                  data-testid="button-attach-file"
                >
                  <Paperclip className="h-5 w-5" />
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
                    "!min-h-0 flex-1 resize-none border-none px-2 py-2 text-sm leading-5",
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
                "!min-h-0 flex-1 resize-none border-none px-2 py-2 text-sm leading-5",
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
            className="h-9 w-9 shrink-0 rounded-full bg-primary shadow-sm hover:bg-primary/90"
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
});

export default ChatInput;
