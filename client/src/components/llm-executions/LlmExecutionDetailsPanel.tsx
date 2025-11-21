import type { ReactNode } from "react";
import { X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EXECUTION_STATUS_COLORS, EXECUTION_STATUS_LABELS } from "@/components/llm-executions/status";
import { useLlmExecutionDetails } from "@/hooks/useLlmExecutions";
import { ExecutionStepsTimeline } from "@/components/llm-executions/ExecutionStepsTimeline";
import { formatExecutionDuration, formatExecutionTimestamp } from "@/lib/llm-execution-format";
import { cn } from "@/lib/utils";

interface LlmExecutionDetailsPanelProps {
  executionId?: string;
  onClose: () => void;
}

export function LlmExecutionDetailsPanel({ executionId, onClose }: LlmExecutionDetailsPanelProps) {
  if (!executionId) {
    return (
      <Card className="h-fit border-dashed">
        <CardHeader>
          <CardTitle>Детали запуска</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Выберите запуск слева, чтобы увидеть подробности его выполнения.
          </p>
        </CardContent>
      </Card>
    );
  }

  const { execution, isLoading, isError, error } = useLlmExecutionDetails(executionId, {
    enabled: true,
  });

  if (isLoading) {
    return (
      <Card className="h-fit">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Детали запуска</CardTitle>
          <Button variant="ghost" size="sm" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {Array.from({ length: 5 }).map((_, index) => (
            <Skeleton key={index} className="h-4 w-full" />
          ))}
        </CardContent>
      </Card>
    );
  }

  if (isError || !execution) {
    const message =
      error?.message === "Not Found"
        ? "Запуск не найден или уже удалён."
        : error?.message ?? "Не удалось загрузить запуск.";
    return (
      <Card className="h-fit">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Детали запуска</CardTitle>
          <Button variant="ghost" size="sm" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <p className="text-destructive">{message}</p>
          <Button variant="outline" size="sm" onClick={onClose}>
            Вернуться к списку
          </Button>
        </CardContent>
      </Card>
    );
  }

  const summary = execution.execution;
  const durationMs =
    summary.durationMs ??
    (summary.finishedAt ? new Date(summary.finishedAt).getTime() - new Date(summary.startedAt).getTime() : null);

  return (
    <Card className="h-fit">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Детали запуска</CardTitle>
        <Button variant="ghost" size="sm" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Badge
              className={cn(
                "px-3 py-1 text-xs",
                EXECUTION_STATUS_COLORS[summary.status] ?? "bg-muted text-muted-foreground",
              )}
            >
              {EXECUTION_STATUS_LABELS[summary.status] ?? summary.status}
            </Badge>
            {summary.hasError && <span className="text-xs text-destructive">Есть ошибки</span>}
          </div>
          <p className="text-sm text-muted-foreground break-all">{summary.id}</p>
        </div>

        <div className="grid gap-3 text-sm">
          <InfoRow label="Начало">{formatExecutionTimestamp(summary.startedAt)}</InfoRow>
          <InfoRow label="Завершение">
            {summary.finishedAt ? formatExecutionTimestamp(summary.finishedAt) : "—"}
          </InfoRow>
          <InfoRow label="Длительность">{formatExecutionDuration(durationMs)}</InfoRow>
          <InfoRow label="Воркспейс">
            <span className="flex flex-col">
              <span>{summary.workspaceName ?? "—"}</span>
              <span className="text-xs text-muted-foreground break-all">{summary.workspaceId}</span>
            </span>
          </InfoRow>
          <InfoRow label="Пользователь">
            <span className="flex flex-col">
              <span>{summary.userName ?? summary.userEmail ?? "—"}</span>
              <span className="text-xs text-muted-foreground break-all">{summary.userId ?? "—"}</span>
            </span>
          </InfoRow>
          <InfoRow label="Навык">
            <span className="flex flex-col">
              <span>{summary.skillName ?? summary.skillId}</span>
              {summary.skillIsSystem && <span className="text-xs text-muted-foreground">Системный Unica Chat</span>}
            </span>
          </InfoRow>
          <InfoRow label="Chat ID">{summary.chatId ?? "—"}</InfoRow>
          <InfoRow label="Сообщение пользователя">
            {summary.userMessagePreview ? (
              <span className="line-clamp-4">{summary.userMessagePreview}</span>
            ) : (
              "—"
            )}
          </InfoRow>
        </div>

        <ExecutionStepsTimeline steps={execution.steps} />
      </CardContent>
    </Card>
  );
}

function InfoRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p className="text-xs uppercase text-muted-foreground tracking-wide">{label}</p>
      <div className="text-sm font-medium">{children}</div>
    </div>
  );
}
