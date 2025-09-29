import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { type ProjectVectorizationJobStatus } from "@shared/vectorization";

interface VectorizationStatusCardProps {
  status: ProjectVectorizationJobStatus;
}

const statusLabels: Record<ProjectVectorizationJobStatus["status"], string> = {
  idle: "Ожидает",
  pending: "Готовится",
  running: "Выполняется",
  completed: "Завершено",
  failed: "Ошибка",
};

const statusVariants: Record<ProjectVectorizationJobStatus["status"], "default" | "secondary" | "destructive"> = {
  idle: "secondary",
  pending: "secondary",
  running: "default",
  completed: "default",
  failed: "destructive",
};

function formatDateTime(value?: string | null) {
  if (!value) {
    return "—";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "—";
  }

  return date.toLocaleString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

export default function VectorizationStatusCard({ status }: VectorizationStatusCardProps) {
  const totalRecords = status.totalRecords ?? status.totalChunks ?? 0;
  const createdRecords = status.createdRecords ?? status.processedChunks ?? 0;
  const totalChunks = status.totalChunks ?? totalRecords;
  const processedChunks = status.processedChunks ?? createdRecords;
  const totalPages = status.totalPages ?? 0;
  const processedPages = status.processedPages ?? 0;

  const safeTotalRecords = totalRecords > 0 ? totalRecords : totalChunks;
  const safeCreatedRecords = Math.min(createdRecords, safeTotalRecords);
  const progressPercent = safeTotalRecords > 0 ? Math.round((safeCreatedRecords / safeTotalRecords) * 100) : 0;
  const clampedPercent = Math.min(100, Math.max(0, progressPercent));
  const remainingPercent = Math.max(0, 100 - clampedPercent);

  return (
    <Card>
      <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <CardTitle>Статус векторизации</CardTitle>
          <p className="text-sm text-muted-foreground">
            Коллекция: {status.collectionName ?? "—"}
            {status.providerName ? ` · Сервис: ${status.providerName}` : ""}
          </p>
        </div>
        <Badge variant={statusVariants[status.status]}>{statusLabels[status.status]}</Badge>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Progress value={clampedPercent} className="h-2" />
          <p className="text-sm text-muted-foreground">
            Создано {safeCreatedRecords.toLocaleString("ru-RU")} из {safeTotalRecords.toLocaleString("ru-RU")} записей · Осталось
            {" "}
            {remainingPercent}%
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <p className="text-xs uppercase text-muted-foreground">Векторизованные чанки</p>
            <p className="text-base font-medium">
              {processedChunks.toLocaleString("ru-RU")} / {totalChunks.toLocaleString("ru-RU")}
            </p>
          </div>
          <div>
            <p className="text-xs uppercase text-muted-foreground">Обработанные страницы</p>
            <p className="text-base font-medium">
              {processedPages.toLocaleString("ru-RU")} / {totalPages.toLocaleString("ru-RU")}
            </p>
          </div>
          <div>
            <p className="text-xs uppercase text-muted-foreground">Последнее обновление</p>
            <p className="text-base font-medium">{formatDateTime(status.lastUpdatedAt)}</p>
          </div>
        </div>
        {status.message && (
          <p className="text-sm text-muted-foreground">{status.message}</p>
        )}
        {status.status === "failed" && status.error && (
          <p className="text-sm font-medium text-destructive">Ошибка: {status.error}</p>
        )}
      </CardContent>
    </Card>
  );
}
