import { useState, useEffect } from "react";
import { X, Save, RotateCcw, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useTranscript, useUpdateTranscript } from "@/hooks/useTranscript";
import { SkillActionsPanel } from "@/components/chat/SkillActionsPanel";
import { useToast } from "@/hooks/use-toast";

type TranscriptCanvasProps = {
  workspaceId: string;
  transcriptId: string;
  skillId?: string;
  onClose: () => void;
};

export function TranscriptCanvas({
  workspaceId,
  transcriptId,
  skillId,
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
  const [originalText, setOriginalText] = useState("");
  const [hasChanges, setHasChanges] = useState(false);

  useEffect(() => {
    if (transcript?.fullText) {
      setDraftText(transcript.fullText);
      setOriginalText(transcript.fullText);
      setHasChanges(false);
    }
  }, [transcript?.fullText]);

  const handleSave = async () => {
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
        onSuccess: (updatedTranscript) => {
          setOriginalText(updatedTranscript.fullText || "");
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
    setDraftText(originalText);
    setHasChanges(false);
    toast({
      description: "Изменения отменены",
    });
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
      <div className="flex items-center justify-between border-b border-slate-200 px-6 py-3 dark:border-slate-800">
        <div className="flex-1">
          <h2 className="text-lg font-semibold">Стенограмма</h2>
          {hasChanges && <p className="text-xs text-amber-600 dark:text-amber-400">Есть несохранённые изменения</p>}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleReset}
            disabled={!hasChanges || isPending || isLoading}
            className="gap-2"
          >
            <RotateCcw className="h-4 w-4" />
            Отменить
          </Button>
          <Button
            size="sm"
            onClick={handleSave}
            disabled={!hasChanges || isPending || isLoading}
            className="gap-2"
          >
            {isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            Сохранить
          </Button>
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
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-hidden flex flex-col px-6 py-4">
        {isLoading ? (
          <div className="flex items-center justify-center gap-2 text-muted-foreground h-full">
            <Loader2 className="h-4 w-4 animate-spin" />
            Загрузка стенограммы...
          </div>
        ) : (
          <Textarea
            value={draftText}
            onChange={(e) => {
              const newText = e.target.value;
              setDraftText(newText);
              setHasChanges(newText !== originalText);
            }}
            placeholder="Текст стенограммы..."
            className="flex-1 resize-none border-0 focus-visible:ring-0 p-4 bg-slate-50 dark:bg-slate-800/50"
          />
        )}
      </div>

      {/* Actions Panel - shrink-0 чтобы не сжималась */}
      {skillId && (
        <div className="shrink-0">
          <SkillActionsPanel
            workspaceId={workspaceId}
            skillId={skillId}
            transcriptText={draftText}
            onActionComplete={(result) => {
              if (result && typeof result === 'object' && 'output' in result) {
                const output = (result as { output?: string }).output;
                if (output) {
                  setDraftText(output);
                  setHasChanges(output !== originalText);
                  toast({
                    title: "Текст обновлён",
                    description: "Результат действия применён к стенограмме",
                  });
                  return;
                }
              }
              toast({
                description: "Действие выполнено",
              });
            }}
          />
        </div>
      )}
    </div>
  );
}
