import { useState, useEffect } from "react";
import { X, Save, RotateCcw, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useTranscript, useUpdateTranscript } from "@/hooks/useTranscript";
import { useToast } from "@/hooks/use-toast";

type TranscriptCanvasProps = {
  workspaceId: string;
  transcriptId: string;
  onClose: () => void;
};

export function TranscriptCanvas({
  workspaceId,
  transcriptId,
  onClose,
}: TranscriptCanvasProps) {
  const { toast } = useToast();
  const { data: transcript, isLoading, isError } = useTranscript(
    workspaceId,
    transcriptId
  );
  const { mutate: updateTranscript, isPending } = useUpdateTranscript(
    workspaceId
  );

  const [draftText, setDraftText] = useState("");
  const [hasChanges, setHasChanges] = useState(false);

  useEffect(() => {
    if (transcript?.fullText) {
      setDraftText(transcript.fullText);
      setHasChanges(false);
    }
  }, [transcript?.fullText]);

  const handleSave = () => {
    if (!draftText.trim()) {
      toast({
        title: "Ошибка",
        description: "Текст стенограммы не может быть пустым",
        variant: "destructive",
      });
      return;
    }

    updateTranscript(
      { transcriptId, fullText: draftText.trim() },
      {
        onSuccess: () => {
          setHasChanges(false);
          toast({
            title: "Сохранено",
            description: "Стенограмма успешно обновлена",
          });
        },
        onError: (error) => {
          toast({
            title: "Ошибка",
            description:
              error instanceof Error ? error.message : "Не удалось сохранить",
            variant: "destructive",
          });
        },
      }
    );
  };

  const handleReset = () => {
    if (transcript?.fullText) {
      setDraftText(transcript.fullText);
      setHasChanges(false);
    }
  };

  if (isError) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-6">
        <p className="text-sm text-destructive">Не удалось загрузить стенограмму</p>
        <Button variant="outline" size="sm" onClick={onClose}>
          Закрыть
        </Button>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col border-l border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900/80">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4 dark:border-slate-800">
        <h2 className="text-lg font-semibold">Стенограмма</h2>
        <Button
          variant="ghost"
          size="icon"
          onClick={onClose}
          className="h-8 w-8"
          aria-label="Закрыть холст"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden px-6 py-4">
        {isLoading ? (
          <div className="flex items-center justify-center gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Загрузка стенограммы...
          </div>
        ) : (
          <Textarea
            value={draftText}
            onChange={(e) => {
              setDraftText(e.target.value);
              setHasChanges(e.target.value !== transcript?.fullText);
            }}
            placeholder="Текст стенограммы..."
            className="h-full resize-none border-0 focus-visible:ring-0"
          />
        )}
      </div>

      {/* Footer */}
      <div className="flex gap-2 border-t border-slate-200 bg-slate-50/50 px-6 py-4 dark:border-slate-800 dark:bg-slate-900/40">
        <Button
          variant="outline"
          size="sm"
          onClick={handleReset}
          disabled={!hasChanges || isPending || isLoading}
        >
          <RotateCcw className="mr-2 h-4 w-4" />
          Отменить
        </Button>
        <Button
          size="sm"
          onClick={handleSave}
          disabled={!hasChanges || isPending || isLoading}
        >
          {isPending ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Save className="mr-2 h-4 w-4" />
          )}
          Сохранить
        </Button>
      </div>
    </div>
  );
}
