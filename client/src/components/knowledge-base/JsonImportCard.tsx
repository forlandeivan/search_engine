import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { apiRequest } from "@/lib/queryClient";
import { useQuery } from "@tanstack/react-query";
import { Loader2, CheckCircle2, XCircle, AlertCircle, ExternalLink } from "lucide-react";
import type { GetJsonImportStatusResponse } from "@shared/json-import";
import { Link } from "wouter";

interface JsonImportCardProps {
  jobId: string;
  baseId: string;
  workspaceId: string;
  onComplete?: () => void;
}

export function JsonImportCard({ jobId, baseId, workspaceId, onComplete }: JsonImportCardProps) {
  const [pollingInterval, setPollingInterval] = useState<number | false>(2000);

  const { data: status, isLoading } = useQuery<GetJsonImportStatusResponse>({
    queryKey: ["json-import-status", jobId, workspaceId],
    queryFn: async () => {
      const res = await apiRequest(
        "GET",
        `/api/knowledge/json-import/${jobId}`,
        undefined,
        undefined,
        { workspaceId },
      );
      return (await res.json()) as GetJsonImportStatusResponse;
    },
    refetchInterval: pollingInterval,
    enabled: Boolean(jobId),
  });

  useEffect(() => {
    if (status?.status === "completed" || status?.status === "completed_with_errors" || status?.status === "failed") {
      setPollingInterval(false);
      onComplete?.();
    }
  }, [status?.status, onComplete]);

  if (isLoading || !status) {
    return (
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Загрузка статуса импорта...
          </div>
        </CardContent>
      </Card>
    );
  }

  const getStatusIcon = () => {
    switch (status.status) {
      case "completed":
        return <CheckCircle2 className="h-5 w-5 text-green-500" />;
      case "completed_with_errors":
        return <AlertCircle className="h-5 w-5 text-yellow-500" />;
      case "failed":
        return <XCircle className="h-5 w-5 text-red-500" />;
      case "processing":
        return <Loader2 className="h-5 w-5 animate-spin text-blue-500" />;
      default:
        return <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />;
    }
  };

  const getStatusLabel = () => {
    switch (status.status) {
      case "pending":
        return "В очереди";
      case "processing":
        return "Выполняется";
      case "completed":
        return "Завершён";
      case "completed_with_errors":
        return "Завершён с ошибками";
      case "failed":
        return "Ошибка";
      default:
        return "Неизвестно";
    }
  };

  const getStatusVariant = (): "default" | "secondary" | "destructive" | "outline" => {
    switch (status.status) {
      case "completed":
        return "default";
      case "completed_with_errors":
        return "secondary";
      case "failed":
        return "destructive";
      default:
        return "outline";
    }
  };

  const isTerminal = status.status === "completed" || status.status === "completed_with_errors" || status.status === "failed";

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {getStatusIcon()}
            <CardTitle className="text-lg">Импорт JSON/JSONL</CardTitle>
          </div>
          <Badge variant={getStatusVariant()}>{getStatusLabel()}</Badge>
        </div>
        <CardDescription>
          {status.baseName} • Задача #{jobId.slice(0, 8)}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {status.status === "processing" || status.status === "pending" ? (
          <>
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Прогресс</span>
                <span className="font-medium">{status.progress.percent}%</span>
              </div>
              <Progress value={status.progress.percent} />
            </div>

            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-muted-foreground">Обработано</p>
                <p className="font-semibold">
                  {status.progress.processedRecords} / {status.progress.totalRecords}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">Создано документов</p>
                <p className="font-semibold">{status.progress.createdDocuments}</p>
              </div>
              {status.progress.skippedRecords > 0 && (
                <div>
                  <p className="text-muted-foreground">Пропущено</p>
                  <p className="font-semibold">{status.progress.skippedRecords}</p>
                </div>
              )}
              {status.progress.errorRecords > 0 && (
                <div>
                  <p className="text-muted-foreground">Ошибок</p>
                  <p className="font-semibold text-destructive">{status.progress.errorRecords}</p>
                </div>
              )}
            </div>
          </>
        ) : isTerminal ? (
          <>
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-muted-foreground">Создано документов</p>
                  <p className="font-semibold">{status.progress.createdDocuments}</p>
                </div>
                {status.progress.skippedRecords > 0 && (
                  <div>
                    <p className="text-muted-foreground">Пропущено</p>
                    <p className="font-semibold">{status.progress.skippedRecords}</p>
                  </div>
                )}
                {status.progress.errorRecords > 0 && (
                  <div>
                    <p className="text-muted-foreground">Ошибок</p>
                    <p className="font-semibold text-destructive">{status.progress.errorRecords}</p>
                  </div>
                )}
                {status.timing.durationSeconds !== null && (
                  <div>
                    <p className="text-muted-foreground">Время выполнения</p>
                    <p className="font-semibold">{status.timing.durationSeconds} сек</p>
                  </div>
                )}
              </div>

              {status.status === "completed_with_errors" && (
                <Alert variant="destructive">
                  <AlertDescription>
                    Импорт завершён, но {status.progress.errorRecords} записей не были импортированы.
                    {status.hasMoreErrors && " Скачайте отчёт для просмотра всех ошибок."}
                  </AlertDescription>
                </Alert>
              )}

              {status.status === "failed" && (
                <Alert variant="destructive">
                  <AlertDescription>
                    Импорт завершился с ошибкой. Попробуйте повторить или обратитесь в поддержку.
                  </AlertDescription>
                </Alert>
              )}

              {status.status === "completed" && (
                <Alert>
                  <AlertDescription>
                    Импорт успешно завершён. Добавлено {status.progress.createdDocuments} документов.
                  </AlertDescription>
                </Alert>
              )}

              <div className="flex gap-2 pt-2">
                <Button asChild variant="default">
                  <Link href={`/knowledge/${baseId}`}>
                    <ExternalLink className="mr-2 h-4 w-4" />
                    Перейти к базе знаний
                  </Link>
                </Button>
              </div>
            </div>
          </>
        ) : null}

        {status.recentErrors.length > 0 && (
          <div className="space-y-2">
            <p className="text-sm font-medium">Последние ошибки:</p>
            <div className="space-y-1 max-h-32 overflow-y-auto">
              {status.recentErrors.map((err, idx) => (
                <div key={idx} className="rounded-md border bg-muted/40 p-2 text-xs">
                  <p className="font-medium">
                    Строка {err.lineNumber}: {err.message}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
