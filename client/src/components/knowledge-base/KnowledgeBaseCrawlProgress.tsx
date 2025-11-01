import type { KnowledgeBaseCrawlJobStatus } from "@shared/knowledge-base";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { AlertTriangle, Clock3, PauseCircle, PlayCircle, RefreshCw, StopCircle } from "lucide-react";
import type { CrawlActivityEvent } from "@/hooks/useKnowledgeBaseCrawlJob";

const STATUS_LABELS: Record<KnowledgeBaseCrawlJobStatus["status"], string> = {
  running: "Выполняется",
  paused: "На паузе",
  canceled: "Отменено",
  failed: "Ошибка",
  done: "Завершено",
};

const STATUS_VARIANTS: Record<KnowledgeBaseCrawlJobStatus["status"], "default" | "secondary" | "outline" | "destructive"> = {
  running: "default",
  paused: "secondary",
  canceled: "outline",
  failed: "destructive",
  done: "default",
};

const TERMINAL_STATUSES: Array<KnowledgeBaseCrawlJobStatus["status"]> = [
  "canceled",
  "failed",
  "done",
];

const formatNumber = (value: number | null | undefined) =>
  typeof value === "number" && Number.isFinite(value) ? value.toLocaleString("ru-RU") : "0";

const formatEta = (value?: number | null) => {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return "—";
  }

  const totalSeconds = Math.max(0, Math.round(value));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes === 0) {
    return `${seconds} с`;
  }

  return `${minutes} мин ${seconds.toString().padStart(2, "0")} с`;
};

const METRIC_CONFIG: Array<{
  key: keyof Pick<KnowledgeBaseCrawlJobStatus, "discovered" | "queued" | "fetched" | "extracted" | "saved" | "failed">;
  label: string;
}> = [
  { key: "discovered", label: "Обнаружено" },
  { key: "queued", label: "В очереди" },
  { key: "fetched", label: "Загружено" },
  { key: "extracted", label: "Извлечено" },
  { key: "saved", label: "Сохранено" },
  { key: "failed", label: "Ошибки" },
];

type KnowledgeBaseCrawlProgressProps = {
  job: KnowledgeBaseCrawlJobStatus;
  events: CrawlActivityEvent[];
  onPause?: () => void | Promise<void>;
  onResume?: () => void | Promise<void>;
  onCancel?: () => void | Promise<void>;
  onRetry?: () => void | Promise<void>;
  isPausing?: boolean;
  isResuming?: boolean;
  isCanceling?: boolean;
  isRetrying?: boolean;
  connectionError?: string | null;
  actionError?: string | null;
};

export function KnowledgeBaseCrawlProgress({
  job,
  events,
  onPause,
  onResume,
  onCancel,
  onRetry,
  isPausing = false,
  isResuming = false,
  isCanceling = false,
  isRetrying = false,
  connectionError,
  actionError,
}: KnowledgeBaseCrawlProgressProps) {
  const isTerminal = TERMINAL_STATUSES.includes(job.status);
  const showPause = job.status === "running";
  const showResume = job.status === "paused";
  const showCancel = !isTerminal;
  const showRetry = job.status === "failed";

  return (
    <Card className="border border-primary/30 bg-primary/5">
      <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
            <Clock3 className="h-4 w-4" />
            Краулинг сайта
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Каждая найденная страница автоматически сохраняется в документы базы знаний.
          </p>
        </div>
        <Badge variant={STATUS_VARIANTS[job.status]} className="self-start text-xs sm:text-sm">
          {STATUS_LABELS[job.status]}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex-1 space-y-1">
            <Progress value={job.percent} className="h-2" />
            <div className="flex flex-wrap items-center justify-between text-xs text-muted-foreground">
              <span>Прогресс: {job.percent}%</span>
              <span>ETA: {formatEta(job.etaSec)}</span>
              <span>
                Документов: {formatNumber(job.saved)}
                {job.pagesNew !== null && job.pagesNew !== undefined
                  ? ` / новых: ${formatNumber(job.pagesNew)}`
                  : null}
              </span>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {showPause && (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={isPausing}
                onClick={() => {
                  void onPause?.();
                }}
              >
                <PauseCircle className="mr-2 h-4 w-4" /> Пауза
              </Button>
            )}
            {showResume && (
              <Button
                type="button"
                variant="default"
                size="sm"
                disabled={isResuming}
                onClick={() => {
                  void onResume?.();
                }}
              >
                <PlayCircle className="mr-2 h-4 w-4" /> Возобновить
              </Button>
            )}
            {showCancel && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={isCanceling}
                onClick={() => {
                  void onCancel?.();
                }}
              >
                <StopCircle className="mr-2 h-4 w-4" /> Отменить
              </Button>
            )}
            {showRetry && onRetry && (
              <Button
                type="button"
                variant="default"
                size="sm"
                disabled={isRetrying}
                onClick={() => {
                  void onRetry?.();
                }}
              >
                <RefreshCw className="mr-2 h-4 w-4" /> Повторить
              </Button>
            )}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {METRIC_CONFIG.map((metric) => (
            <div key={metric.key} className="rounded-md border bg-background px-3 py-2">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                {metric.label}
              </p>
              <p className="text-sm font-semibold">
                {formatNumber(job[metric.key])}
              </p>
            </div>
          ))}
        </div>

        {job.lastUrl && (
          <div className="rounded-md border bg-background px-3 py-2 text-xs text-muted-foreground">
            Последний URL: <span className="break-all text-foreground">{job.lastUrl}</span>
          </div>
        )}

        <div>
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold">Последние операции</p>
            <span className="text-xs text-muted-foreground">обновление ~1 раз/сек</span>
          </div>
          <ScrollArea className="mt-2 max-h-40">
            <ul className="space-y-1 text-xs">
              {events.length === 0 ? (
                <li className="text-muted-foreground">Ожидаем события от краулера…</li>
              ) : (
                events.map((event) => (
                  <li
                    key={event.id}
                    className={cn(
                      "flex items-start gap-2 rounded-sm px-2 py-1",
                      event.type === "error" && "bg-destructive/10 text-destructive",
                      event.type === "status" && "bg-primary/10 text-primary",
                      event.type === "info" && "bg-muted/60 text-muted-foreground",
                    )}
                  >
                    <span className="whitespace-nowrap font-mono text-[10px] text-foreground/60">
                      {new Date(event.timestamp).toLocaleTimeString("ru-RU", {
                        hour: "2-digit",
                        minute: "2-digit",
                        second: "2-digit",
                      })}
                    </span>
                    <span className="flex-1">{event.message}</span>
                  </li>
                ))
              )}
            </ul>
          </ScrollArea>
        </div>

        {(connectionError || actionError) && (
          <Alert variant="destructive" className="border-destructive/40 bg-destructive/5">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription className="text-xs">
              {connectionError ?? actionError}
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}
