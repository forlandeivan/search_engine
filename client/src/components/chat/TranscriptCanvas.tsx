import { useState, useEffect } from "react";
import { X, Save, RotateCcw, Loader2, MoreVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { useTranscript, useUpdateTranscript } from "@/hooks/useTranscript";
import { useSkillActions, useRunSkillAction } from "@/hooks/useSkillActions";
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

  const { data: actions } = useSkillActions(workspaceId, skillId || "");
  const { mutate: runAction, isPending: isActionPending } = useRunSkillAction(workspaceId);

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

  const canvasActions = (actions ?? []).filter(
    (item) =>
      item.skillAction?.enabled &&
      item.skillAction?.enabledPlacements.includes("canvas") &&
      item.action.target === "transcript"
  );

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

  const handleRunAction = (actionId: string, label: string) => {
    if (!skillId) return;
    
    if (!draftText.trim()) {
      toast({
        title: "Ошибка",
        description: "Текст стенограммы пуст",
        variant: "destructive",
      });
      return;
    }

    runAction(
      {
        skillId,
        actionId,
        placement: "canvas",
        target: "transcript",
        selectionText: draftText,
      },
      {
        onSuccess: (result) => {
          const outputText = result.result?.text || result.output;
          if (outputText) {
            setDraftText(outputText);
            setHasChanges(outputText !== originalText);
            toast({
              title: "Текст обновлён",
              description: `Действие "${label}" применено`,
            });
          } else {
            toast({
              title: "Выполнено",
              description: result.ui?.effectiveLabel || label,
            });
          }
        },
        onError: (error) => {
          toast({
            title: "Ошибка",
            description: error instanceof Error ? error.message : "Не удалось выполнить действие",
            variant: "destructive",
          });
        },
      }
    );
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
          {/* Actions dropdown */}
          {skillId && canvasActions.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  disabled={isActionPending || isLoading}
                  data-testid="button-canvas-actions"
                >
                  {isActionPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <MoreVertical className="h-4 w-4" />
                  )}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>Действия</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {canvasActions.map((item) => (
                  <DropdownMenuItem
                    key={item.action.id}
                    onClick={() => handleRunAction(item.action.id, item.ui.effectiveLabel)}
                    disabled={isActionPending}
                    data-testid={`action-${item.action.id}`}
                  >
                    {item.ui.effectiveLabel}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
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
    </div>
  );
}
