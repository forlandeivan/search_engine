import { useCallback, useState, useRef, useEffect } from "react";
import { Mic, Square, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

type RecordingState = "idle" | "recording" | "processing";

type AudioRecorderProps = {
  onTranscription: (text: string) => void;
  onError?: (error: string) => void;
  disabled?: boolean;
};

const MAX_RECORDING_DURATION_MS = 30000;

export default function AudioRecorder({
  onTranscription,
  onError,
  disabled,
}: AudioRecorderProps) {
  const [state, setState] = useState<RecordingState>("idle");
  const [recordingDuration, setRecordingDuration] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const durationIntervalRef = useRef<number | null>(null);
  const startTimeRef = useRef<number>(0);

  const cleanup = useCallback(() => {
    if (durationIntervalRef.current) {
      clearInterval(durationIntervalRef.current);
      durationIntervalRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    mediaRecorderRef.current = null;
    audioChunksRef.current = [];
    setRecordingDuration(0);
  }, []);

  useEffect(() => {
    return cleanup;
  }, [cleanup]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && state === "recording") {
      mediaRecorderRef.current.stop();
    }
  }, [state]);

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const mimeType = MediaRecorder.isTypeSupported("audio/ogg;codecs=opus")
        ? "audio/ogg;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
          ? "audio/webm;codecs=opus"
          : MediaRecorder.isTypeSupported("audio/webm")
            ? "audio/webm"
            : "audio/ogg";

      const mediaRecorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        setState("processing");

        const audioBlob = new Blob(audioChunksRef.current, { type: mimeType });
        
        if (audioBlob.size === 0) {
          cleanup();
          setState("idle");
          onError?.("Не удалось записать аудио");
          return;
        }

        try {
          const formData = new FormData();
          const extension = mimeType.includes("ogg") ? "ogg" : mimeType.includes("webm") ? "webm" : "ogg";
          formData.append("audio", audioBlob, `recording.${extension}`);

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
            onTranscription(result.text.trim());
          } else {
            onError?.("Речь не распознана. Попробуйте говорить громче и чётче.");
          }
        } catch (error) {
          console.error("[AudioRecorder] Transcription error:", error);
          onError?.(error instanceof Error ? error.message : "Ошибка при транскрибации");
        } finally {
          cleanup();
          setState("idle");
        }
      };

      mediaRecorder.onerror = () => {
        cleanup();
        setState("idle");
        onError?.("Ошибка записи аудио");
      };

      startTimeRef.current = Date.now();
      mediaRecorder.start(100);
      setState("recording");

      durationIntervalRef.current = window.setInterval(() => {
        const elapsed = Date.now() - startTimeRef.current;
        setRecordingDuration(elapsed);

        if (elapsed >= MAX_RECORDING_DURATION_MS) {
          stopRecording();
        }
      }, 100);
    } catch (error) {
      console.error("[AudioRecorder] Start recording error:", error);
      cleanup();
      setState("idle");
      
      if (error instanceof DOMException && error.name === "NotAllowedError") {
        onError?.("Доступ к микрофону запрещён. Разрешите доступ в настройках браузера.");
      } else if (error instanceof DOMException && error.name === "NotFoundError") {
        onError?.("Микрофон не найден. Подключите микрофон и попробуйте снова.");
      } else {
        onError?.("Не удалось начать запись");
      }
    }
  }, [cleanup, onError, onTranscription, stopRecording]);

  const handleClick = useCallback(() => {
    if (state === "idle") {
      startRecording();
    } else if (state === "recording") {
      stopRecording();
    }
  }, [state, startRecording, stopRecording]);

  const formatDuration = (ms: number) => {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
  };

  const isDisabled = disabled || state === "processing";

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant={state === "recording" ? "destructive" : "ghost"}
          size="icon"
          onClick={handleClick}
          disabled={isDisabled}
          className={`h-11 w-11 shrink-0 rounded-full ${
            state === "recording"
              ? "animate-pulse"
              : ""
          }`}
          aria-label={
            state === "idle"
              ? "Начать запись голоса"
              : state === "recording"
                ? "Остановить запись"
                : "Транскрибация..."
          }
          data-testid="button-audio-record"
        >
          {state === "idle" && <Mic className="h-5 w-5" />}
          {state === "recording" && <Square className="h-4 w-4" />}
          {state === "processing" && <Loader2 className="h-5 w-5 animate-spin" />}
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        {state === "idle" && "Записать голосовое сообщение"}
        {state === "recording" && `Остановить запись (${formatDuration(recordingDuration)})`}
        {state === "processing" && "Распознавание речи..."}
      </TooltipContent>
    </Tooltip>
  );
}
