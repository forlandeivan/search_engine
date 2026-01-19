import { useState } from "react";
import { format } from "date-fns";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { Loader2, PauseCircle, PlayCircle, StopCircle, CheckCircle2, XCircle, AlertCircle } from "lucide-react";
import { usePauseIndexing, useResumeIndexing } from "@/hooks/usePauseIndexing";
import { useCancelIndexing } from "@/hooks/useCancelIndexing";
import { CancelIndexingDialog } from "./CancelIndexingDialog";
import type { IndexingHistoryItem, KnowledgeBaseIndexingAction } from "@shared/schema";

const INDEXING_STATUS_COLORS: Record<IndexingHistoryItem["status"] | "paused" | "canceled", string> = {
  processing: "bg-blue-600 hover:bg-blue-600",
  paused: "bg-yellow-600 hover:bg-yellow-600",
  canceled: "bg-orange-600 hover:bg-orange-600",
  done: "bg-emerald-600 hover:bg-emerald-600",
  error: "bg-destructive hover:bg-destructive",
};

const INDEXING_STATUS_LABELS: Record<IndexingHistoryItem["status"] | "paused" | "canceled", string> = {
  processing: "Выполняется",
  paused: "На паузе",
  canceled: "Отменено",
  done: "Завершено",
  error: "Ошибка",
};

function formatDateTime(value: string | null | undefined): string {
  if (!value) {
    return "—";
  }

  try {
    return format(new Date(value), "dd.MM.yyyy HH:mm");
  } catch {
    return value;
  }
}

function formatUser(userName: string | null, userEmail: string | null): string {
  if (userName) {
    return userName;
  }
  if (userEmail) {
    return userEmail;
  }
  return "Система";
}

function formatDocumentsCount(processed: number, total: number): string {
  return `${processed} / ${total}`;
}

type IndexingHistoryPanelProps = {
  items: IndexingHistoryItem[];
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  onViewLog?: (actionId: string) => void;
  activeAction?: KnowledgeBaseIndexingAction & { baseName: string; userName?: string | null; userEmail?: string | null };
  baseId?: string;
  totalDocumentsInBase?: number | null;
};

export function IndexingHistoryPanel({
  items,
  isLoading,
  isError,
  error,
  onViewLog,
  activeAction,
  baseId,
  totalDocumentsInBase,
}: IndexingHistoryPanelProps) {
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  
  const pauseMutation = usePauseIndexing(baseId ?? "");
  const resumeMutation = useResumeIndexing(baseId ?? "");
  const cancelMutation = useCancelIndexing(baseId ?? "");

  // Преобразуем activeAction в формат IndexingHistoryItem для единообразия
  const activeItem: IndexingHistoryItem | null = activeAction
    ? {
        actionId: activeAction.actionId,
        status: activeAction.status as IndexingHistoryItem["status"],
        stage: activeAction.stage,
        displayText: activeAction.displayText,
        startedAt: activeAction.createdAt ?? new Date().toISOString(),
        finishedAt: null,
        userId: activeAction.userId,
        userName: activeAction.userName ?? null,
        userEmail: activeAction.userEmail ?? null,
        totalDocuments: typeof activeAction.payload?.totalDocuments === "number" ? activeAction.payload.totalDocuments : 0,
        processedDocuments: typeof activeAction.payload?.processedDocuments === "number" ? activeAction.payload.processedDocuments : 0,
        failedDocuments: typeof activeAction.payload?.failedDocuments === "number" ? activeAction.payload.failedDocuments : 0,
        totalChunks: typeof activeAction.payload?.totalChunks === "number" ? activeAction.payload.totalChunks : 0,
      }
    : null;

  const isProcessing = activeAction?.status === "processing";
  const isPaused = activeAction?.status === "paused";
  
  // Рассчитываем процент от общего количества документов в базе, а не только от текущей индексации
  const processedDocuments = activeAction?.payload?.processedDocuments ?? 0;
  const totalDocuments = totalDocumentsInBase ?? activeItem?.totalDocuments ?? 0;
  const progressPercent = totalDocuments > 0
    ? Math.round((processedDocuments / totalDocuments) * 100)
    : 0;
  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 5 }).map((_, index) => (
          <Skeleton key={index} className="h-12 w-full" />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-8 text-center text-sm text-destructive">
        <p>Не удалось загрузить историю индексаций</p>
        {error && <p className="text-xs text-muted-foreground">{error.message}</p>}
      </div>
    );
  }

  if (items.length === 0 && !activeItem) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-8 text-center text-sm text-muted-foreground">
        <p>История индексаций пуста</p>
        <p className="text-xs">Запустите индексацию, чтобы увидеть историю</p>
      </div>
    );
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
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

  const renderActiveRow = (item: IndexingHistoryItem) => {
    return (
      <>
        <TableRow key={item.actionId} className="bg-primary/5">
          <TableCell colSpan={6} className="p-4">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {getStatusIcon(item.status)}
                  <div className="flex flex-col">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{formatDateTime(item.startedAt)}</span>
                      <span className="text-xs text-muted-foreground font-mono">{item.actionId.slice(0, 8)}…</span>
                    </div>
                    <div className="text-sm text-muted-foreground mt-1">
                      {formatUser(item.userName, item.userEmail)}
                    </div>
                  </div>
                  <Badge
                    className={cn(
                      "justify-center text-xs",
                      INDEXING_STATUS_COLORS[item.status] ?? "bg-muted text-muted-foreground",
                    )}
                  >
                    {INDEXING_STATUS_LABELS[item.status] ?? item.status}
                  </Badge>
                </div>
                <div className="flex items-center gap-2">
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
                  {onViewLog && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => onViewLog(item.actionId)}
                    >
                      Лог
                    </Button>
                  )}
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Прогресс</span>
                  <span className="font-medium">{progressPercent}%</span>
                </div>
                <Progress value={progressPercent} />
              </div>

              <div className="grid grid-cols-4 gap-4 text-sm">
                <div>
                  <p className="text-muted-foreground">Обработано</p>
                  <p className="font-semibold">
                    {item.processedDocuments} / {item.totalDocuments}
                  </p>
                </div>
                {item.totalChunks > 0 && (
                  <div>
                    <p className="text-muted-foreground">Создано чанков</p>
                    <p className="font-semibold">{item.totalChunks.toLocaleString("ru-RU")}</p>
                  </div>
                )}
                {item.failedDocuments > 0 && (
                  <div>
                    <p className="text-muted-foreground">Ошибок</p>
                    <p className="font-semibold text-destructive">{item.failedDocuments}</p>
                  </div>
                )}
                {activeAction?.stage && (
                  <div>
                    <p className="text-muted-foreground">Этап</p>
                    <p className="font-semibold text-xs">
                      {activeAction.stage === "initializing" && "Инициализация"}
                      {activeAction.stage === "creating_collection" && "Создание коллекции"}
                      {activeAction.stage === "chunking" && "Разбиение на фрагменты"}
                      {activeAction.stage === "vectorizing" && "Векторизация"}
                      {activeAction.stage === "uploading" && "Загрузка в коллекцию"}
                      {activeAction.stage === "verifying" && "Проверка данных"}
                      {activeAction.stage === "completed" && "Завершено"}
                    </p>
                  </div>
                )}
              </div>

              {item.displayText && (
                <div className="text-sm text-muted-foreground">
                  {item.displayText}
                </div>
              )}
            </div>
          </TableCell>
        </TableRow>
        {baseId && (
          <CancelIndexingDialog
            open={cancelDialogOpen}
            onClose={() => setCancelDialogOpen(false)}
            baseName={activeAction?.baseName ?? "База знаний"}
            processedDocuments={item.processedDocuments}
            totalDocuments={item.totalDocuments}
            onConfirm={async (deleteData) => {
              try {
                await cancelMutation.mutateAsync({ deleteIndexedData: deleteData });
                setCancelDialogOpen(false);
              } catch {
                // Ошибка обрабатывается в хуке
              }
            }}
          />
        )}
      </>
    );
  };

  const renderHistoryRow = (item: IndexingHistoryItem) => (
    <TableRow key={item.actionId}>
      <TableCell className="font-medium">
        <div className="flex flex-col">
          <span>{formatDateTime(item.startedAt)}</span>
          <span className="text-xs text-muted-foreground font-mono">{item.actionId.slice(0, 8)}…</span>
        </div>
      </TableCell>
      <TableCell>
        <div className="flex flex-col">
          <span>{formatUser(item.userName, item.userEmail)}</span>
          {item.userId && (
            <span className="text-xs text-muted-foreground font-mono">{item.userId.slice(0, 8)}…</span>
          )}
        </div>
      </TableCell>
      <TableCell>
        <Badge
          className={cn(
            "justify-center text-xs",
            INDEXING_STATUS_COLORS[item.status] ?? "bg-muted text-muted-foreground",
          )}
        >
          {INDEXING_STATUS_LABELS[item.status] ?? item.status}
        </Badge>
      </TableCell>
      <TableCell className="text-right">
        <div className="flex flex-col items-end">
          <span className="font-medium">{formatDocumentsCount(item.processedDocuments, item.totalDocuments)}</span>
          {item.failedDocuments > 0 && (
            <span className="text-xs text-destructive">Ошибок: {item.failedDocuments}</span>
          )}
        </div>
      </TableCell>
      <TableCell>
        <div className="flex flex-col">
          {item.displayText && (
            <span className="text-sm">{item.displayText}</span>
          )}
          {item.totalChunks > 0 && (
            <span className="text-xs text-muted-foreground">Чанков: {item.totalChunks.toLocaleString("ru-RU")}</span>
          )}
        </div>
      </TableCell>
      <TableCell className="text-right">
        {onViewLog && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onViewLog(item.actionId)}
          >
            Лог
          </Button>
        )}
      </TableCell>
    </TableRow>
  );

  // Фильтруем items, чтобы не показывать активную индексацию дважды
  const historyItems = activeItem
    ? items.filter((item) => item.actionId !== activeItem.actionId)
    : items;

  return (
    <div className="space-y-4">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[180px]">Время запуска</TableHead>
            <TableHead>Пользователь</TableHead>
            <TableHead className="w-[120px]">Статус</TableHead>
            <TableHead className="w-[140px] text-right">Документы</TableHead>
            <TableHead>Результат</TableHead>
            <TableHead className="w-[140px] text-right">Действия</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {activeItem && renderActiveRow(activeItem)}
          {historyItems.map(renderHistoryRow)}
        </TableBody>
      </Table>
    </div>
  );
}
