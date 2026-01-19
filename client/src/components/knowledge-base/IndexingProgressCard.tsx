import { useState } from "react";
import type { KnowledgeBaseIndexingAction } from "@shared/schema";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Loader2, PauseCircle, PlayCircle, StopCircle, CheckCircle2, XCircle, AlertCircle } from "lucide-react";
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

  const getStatusIcon = () => {
    switch (action.status) {
      case "done":
        return <CheckCircle2 className="h-5 w-5 text-green-500" />;
      case "error":
        return <XCircle className="h-5 w-5 text-red-500" />;
      case "canceled":
        return <XCircle className="h-5 w-5 text-orange-500" />;
      case "processing":
        return <Loader2 className="h-5 w-5 animate-spin text-blue-500" />;
      case "paused":
        return <PauseCircle className="h-5 w-5 text-yellow-500" />;
      default:
        return <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />;
    }
  };

  const failedDocuments = typeof action.payload?.failedDocuments === "number" ? action.payload.failedDocuments : 0;
  const totalChunks = typeof action.payload?.totalChunks === "number" ? action.payload.totalChunks : null;

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {getStatusIcon()}
              <CardTitle className="text-lg">Индексация базы знаний</CardTitle>
            </div>
            <Badge variant={STATUS_VARIANTS[action.status] ?? "default"}>
              {STATUS_LABELS[action.status] ?? action.status}
            </Badge>
          </div>
          <CardDescription>
            {baseName} • Действие #{action.actionId.slice(0, 8)}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!isTerminal && (isProcessing || isPaused) ? (
            <>
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Прогресс</span>
                  <span className="font-medium">{progressValue}%</span>
                </div>
                <Progress value={progressValue} />
              </div>

              <div className="grid grid-cols-2 gap-4 text-sm">
                {totalDocuments !== null && processedDocuments !== null && (
                  <div>
                    <p className="text-muted-foreground">Обработано</p>
                    <p className="font-semibold">
                      {processedDocuments} / {totalDocuments}
                    </p>
                  </div>
                )}
                {totalChunks !== null && (
                  <div>
                    <p className="text-muted-foreground">Создано чанков</p>
                    <p className="font-semibold">{totalChunks}</p>
                  </div>
                )}
                {failedDocuments > 0 && (
                  <div>
                    <p className="text-muted-foreground">Ошибок</p>
                    <p className="font-semibold text-destructive">{failedDocuments}</p>
                  </div>
                )}
                {action.stage && (
                  <div>
                    <p className="text-muted-foreground">Этап</p>
                    <p className="font-semibold">{STAGE_DISPLAY_TEXTS[action.stage] ?? action.stage}</p>
                  </div>
                )}
              </div>

              <div className="flex gap-2 pt-2">
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
                  variant="outline"
                  size="sm"
                  disabled={cancelMutation.isPending}
                  onClick={() => setCancelDialogOpen(true)}
                >
                  <StopCircle className="mr-2 h-4 w-4" />
                  Остановить
                </Button>
              </div>
            </>
          ) : isTerminal ? (
            <>
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  {totalDocuments !== null && processedDocuments !== null && (
                    <div>
                      <p className="text-muted-foreground">Обработано документов</p>
                      <p className="font-semibold">
                        {processedDocuments} / {totalDocuments}
                      </p>
                    </div>
                  )}
                  {totalChunks !== null && (
                    <div>
                      <p className="text-muted-foreground">Создано чанков</p>
                      <p className="font-semibold">{totalChunks}</p>
                    </div>
                  )}
                  {failedDocuments > 0 && (
                    <div>
                      <p className="text-muted-foreground">Ошибок</p>
                      <p className="font-semibold text-destructive">{failedDocuments}</p>
                    </div>
                  )}
                </div>
              </div>

              {action.status === "error" && (
                <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
                  <p className="font-medium text-destructive">Индексация завершилась с ошибкой</p>
                  {action.displayText && (
                    <p className="mt-1 text-muted-foreground">{action.displayText}</p>
                  )}
                </div>
              )}

              {action.status === "done" && (
                <div className="rounded-md border border-green-500/40 bg-green-500/5 p-3 text-sm">
                  <p className="font-medium text-green-700 dark:text-green-400">
                    Индексация успешно завершена
                  </p>
                  {action.displayText && (
                    <p className="mt-1 text-muted-foreground">{action.displayText}</p>
                  )}
                </div>
              )}

              {action.status === "canceled" && (
                <div className="rounded-md border border-orange-500/40 bg-orange-500/5 p-3 text-sm">
                  <p className="font-medium text-orange-700 dark:text-orange-400">
                    Индексация отменена
                  </p>
                  {action.displayText && (
                    <p className="mt-1 text-muted-foreground">{action.displayText}</p>
                  )}
                </div>
              )}
            </>
          ) : null}
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
