import { useState } from "react";
import type { KnowledgeBaseIndexingAction } from "@shared/schema";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Clock3, Minimize2, PauseCircle, PlayCircle, StopCircle } from "lucide-react";
import { usePauseIndexing, useResumeIndexing } from "@/hooks/usePauseIndexing";
import { useCancelIndexing } from "@/hooks/useCancelIndexing";
import { CancelIndexingDialog } from "./CancelIndexingDialog";

const STAGE_DISPLAY_TEXTS: Record<string, string> = {
  initializing: "Инициализация...",
  creating_collection: "Создаём коллекцию...",
  chunking: "Разбиваем на фрагменты...",
  vectorizing: "Векторизуем...",
  uploading: "Загружаем в коллекцию...",
  verifying: "Проверяем данные...",
  completed: "Завершено",
  error: "Ошибка",
};

const STATUS_LABELS: Record<string, string> = {
  processing: "Выполняется",
  paused: "На паузе",
  canceled: "Отменено",
  done: "Завершено",
  error: "Ошибка",
};

const STATUS_VARIANTS: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  processing: "default",
  paused: "secondary",
  canceled: "outline",
  done: "default",
  error: "destructive",
};

interface IndexingProgressCardProps {
  action: KnowledgeBaseIndexingAction;
  baseName: string;
  onMinimize?: () => void;
}

export function IndexingProgressCard({
  action,
  baseName,
  onMinimize,
}: IndexingProgressCardProps) {
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const pauseMutation = usePauseIndexing(action.baseId);
  const resumeMutation = useResumeIndexing(action.baseId);
  const cancelMutation = useCancelIndexing(action.baseId);

  const isProcessing = action.status === "processing";
  const isPaused = action.status === "paused";
  const isTerminal = action.status === "done" || action.status === "error" || action.status === "canceled";

  const displayText = action.displayText ?? STAGE_DISPLAY_TEXTS[action.stage] ?? "Индексация...";
  const progressPercent =
    typeof action.payload?.progressPercent === "number"
      ? action.payload.progressPercent
      : null;
  const totalDocuments =
    typeof action.payload?.totalDocuments === "number" ? action.payload.totalDocuments : null;
  const processedDocuments =
    typeof action.payload?.processedDocuments === "number"
      ? action.payload.processedDocuments
      : null;

  const progressValue =
    progressPercent !== null
      ? progressPercent
      : totalDocuments !== null && processedDocuments !== null && totalDocuments > 0
        ? Math.round((processedDocuments / totalDocuments) * 100)
        : 0;

  const progressLabel =
    totalDocuments !== null && processedDocuments !== null
      ? `${processedDocuments} из ${totalDocuments} документов`
      : displayText;

  return (
    <>
      <Card className="border border-primary/30 bg-primary/5">
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <div className="flex items-center gap-2">
            <Clock3 className="h-4 w-4" />
            <CardTitle className="text-base">Индексация: {baseName}</CardTitle>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={STATUS_VARIANTS[action.status] ?? "default"} className="text-xs">
              {STATUS_LABELS[action.status] ?? action.status}
            </Badge>
            {onMinimize && (
              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onMinimize}>
                <Minimize2 className="h-3 w-3" />
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-2">
            <Progress value={progressValue} className="h-2" />
            <p className="text-xs text-muted-foreground">{progressLabel}</p>
          </div>

          {!isTerminal && (
            <div className="flex gap-2">
              {isProcessing && (
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={pauseMutation.isPending}
                  onClick={() => pauseMutation.mutate()}
                >
                  <PauseCircle className="mr-2 h-4 w-4" />
                  {pauseMutation.isPending ? "..." : "Пауза"}
                </Button>
              )}

              {isPaused && (
                <Button
                  variant="default"
                  size="sm"
                  disabled={resumeMutation.isPending}
                  onClick={() => resumeMutation.mutate()}
                >
                  <PlayCircle className="mr-2 h-4 w-4" />
                  {resumeMutation.isPending ? "..." : "Продолжить"}
                </Button>
              )}

              <Button
                variant="ghost"
                size="sm"
                disabled={cancelMutation.isPending}
                onClick={() => setCancelDialogOpen(true)}
              >
                <StopCircle className="mr-2 h-4 w-4" />
                Остановить
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <CancelIndexingDialog
        open={cancelDialogOpen}
        onClose={() => setCancelDialogOpen(false)}
        baseName={baseName}
        processedDocuments={processedDocuments ?? 0}
        totalDocuments={totalDocuments ?? 0}
        onConfirm={(deleteData) =>
          cancelMutation.mutateAsync({ deleteIndexedData: deleteData })
        }
      />
    </>
  );
}
