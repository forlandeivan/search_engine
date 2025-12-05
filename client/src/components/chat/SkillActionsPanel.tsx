import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSkillActions, useRunSkillAction } from "@/hooks/useSkillActions";
import { useToast } from "@/hooks/use-toast";

type SkillActionsPanelProps = {
  workspaceId: string;
  skillId: string;
  transcriptId: string;
  transcriptText: string;
  onActionComplete?: (result: unknown) => void;
};

export function SkillActionsPanel({
  workspaceId,
  skillId,
  transcriptId,
  transcriptText,
  onActionComplete,
}: SkillActionsPanelProps) {
  const { toast } = useToast();
  const { data: actions, isLoading } = useSkillActions(workspaceId, skillId);
  const { mutate: runAction, isPending } = useRunSkillAction(workspaceId);

  // Фильтруем действия: enabled, enabledPlacements содержит "canvas", target = "transcript"
  console.log("[SkillActionsPanel] Received actions:", JSON.stringify(actions, null, 2));
  const canvasActions = (actions ?? []).filter(
    (item) => {
      const pass = 
        item.skillAction?.enabled &&
        item.skillAction?.enabledPlacements.includes("canvas") &&
        item.action.target === "transcript";
      console.log("[SkillActionsPanel] Action filter:", {
        actionId: item.action.id,
        label: item.action.label,
        target: item.action.target,
        enabled: item.skillAction?.enabled,
        enabledPlacements: item.skillAction?.enabledPlacements,
        pass,
      });
      return pass;
    }
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center gap-2 py-4 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Загрузка действий...
      </div>
    );
  }

  if (canvasActions.length === 0) {
    return null;
  }

  const handleRunAction = (skillId: string, actionId: string) => {
    if (!transcriptText.trim()) {
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
        selectionText: transcriptText,
        transcriptId,
      },
      {
        onSuccess: (result) => {
          toast({
            title: "Действие выполнено",
            description: result.ui?.effectiveLabel || "Успешно",
          });
          onActionComplete?.(result);
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

  return (
    <div className="space-y-2 border-t border-slate-200 bg-slate-50/50 p-4 dark:border-slate-800 dark:bg-slate-900/40">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Действия</p>
      <div className="flex flex-wrap gap-2">
        {canvasActions.map((item) => (
          <Button
            key={item.action.id}
            variant="outline"
            size="sm"
            onClick={() => handleRunAction(skillId, item.action.id)}
            disabled={isPending}
            title={item.action.description || ""}
            className="gap-2"
          >
            {isPending && <Loader2 className="h-3 w-3 animate-spin" />}
            {item.ui.effectiveLabel}
          </Button>
        ))}
      </div>
    </div>
  );
}
