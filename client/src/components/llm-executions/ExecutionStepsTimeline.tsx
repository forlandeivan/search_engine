import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { getStepMetadata } from "./step-metadata";
import { formatExecutionDuration, formatExecutionTimestamp } from "@/lib/llm-execution-format";
import { cn } from "@/lib/utils";
import type { LlmExecutionStep } from "@/types/llm-execution";

const STEP_STATUS_COLORS: Record<string, string> = {
  success: "bg-green-100 text-green-900 border-green-200",
  error: "bg-red-100 text-red-900 border-red-200",
  pending: "bg-muted text-muted-foreground border-muted",
  running: "bg-blue-100 text-blue-900 border-blue-200",
  skipped: "bg-muted text-muted-foreground border-muted",
};

interface ExecutionStepsTimelineProps {
  steps: LlmExecutionStep[];
}

export function ExecutionStepsTimeline({ steps }: ExecutionStepsTimelineProps) {
  const [openMap, setOpenMap] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const initial: Record<string, boolean> = {};
    for (const step of steps) {
      initial[step.id] = step.status === "error";
    }
    setOpenMap(initial);
  }, [steps]);

  const hasSteps = steps.length > 0;

  const expandAll = () => {
    const next: Record<string, boolean> = {};
    for (const step of steps) {
      next[step.id] = true;
    }
    setOpenMap(next);
  };

  const collapseAll = () => {
    const next: Record<string, boolean> = {};
    for (const step of steps) {
      next[step.id] = false;
    }
    setOpenMap(next);
  };

  if (!hasSteps) {
    return (
      <Card>
        <CardContent className="py-6">
          <p className="text-sm text-muted-foreground">
            Для этого запуска ещё нет подробных шагов. Проверьте позже, когда логирование завершится.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="text-base font-semibold">Пайплайн выполнения</h3>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={expandAll}>
            Развернуть все
          </Button>
          <Button size="sm" variant="ghost" onClick={collapseAll}>
            Свернуть все
          </Button>
        </div>
      </div>

      <div className="relative pl-6">
        <div className="absolute left-3 top-1 bottom-1 border-l border-border" />
        <div className="space-y-4">
          {steps.map((step) => {
            const metadata = getStepMetadata(step);
            const isOpen = openMap[step.id] ?? false;
            const durationMs =
              step.finishedAt && step.startedAt
                ? new Date(step.finishedAt).getTime() - new Date(step.startedAt).getTime()
                : null;

            return (
              <div key={step.id} className="relative pl-6">
                <div className="absolute left-[-5px] top-3 h-2 w-2 rounded-full bg-primary" />
                <div
                  className={cn(
                    "rounded-lg border p-4 bg-card shadow-sm transition-colors",
                    STEP_STATUS_COLORS[step.status] ?? "bg-muted text-muted-foreground border-muted",
                  )}
                >
                  <div className="flex flex-col gap-1">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-semibold text-foreground">{metadata.title}</p>
                        {metadata.description && (
                          <p className="text-xs text-muted-foreground">{metadata.description}</p>
                        )}
                      </div>
                      <Badge>{step.status.toUpperCase()}</Badge>
                    </div>
                    <div className="text-xs text-muted-foreground flex flex-wrap gap-2">
                      <span>Начало: {formatExecutionTimestamp(step.startedAt)}</span>
                      {step.finishedAt && <span>Окончание: {formatExecutionTimestamp(step.finishedAt)}</span>}
                      {durationMs !== null && <span>Длительность: {formatExecutionDuration(durationMs)}</span>}
                    </div>
                    {step.errorMessage && (
                      <p className="text-xs text-destructive">Ошибка: {step.errorMessage}</p>
                    )}
                    <button
                      className="text-sm text-primary underline-offset-2 hover:underline text-left mt-2"
                      type="button"
                      onClick={() =>
                        setOpenMap((prev) => ({
                          ...prev,
                          [step.id]: !isOpen,
                        }))
                      }
                    >
                      {isOpen ? "Свернуть детали" : "Развернуть детали"}
                    </button>
                  </div>
                  {isOpen && (
                    <div className="mt-3 space-y-3 text-sm">
                      <JsonBlock title="Входные данные" value={step.input} />
                      <JsonBlock title="Выходные данные" value={step.output} />
                      {(step.errorCode || step.errorMessage || step.diagnosticInfo) && (
                        <div className="rounded-md border bg-background/70 p-3">
                          <p className="text-xs uppercase text-muted-foreground">Ошибка</p>
                          {step.errorCode && <p className="text-sm font-medium">Код: {step.errorCode}</p>}
                          {step.errorMessage && <p className="text-sm">Сообщение: {step.errorMessage}</p>}
                          {step.diagnosticInfo && (
                            <pre className="mt-2 whitespace-pre-wrap break-all text-xs text-muted-foreground">
                              {step.diagnosticInfo}
                            </pre>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function JsonBlock({ title, value }: { title: string; value: unknown }) {
  const formatted = useMemo(() => {
    if (value === null || value === undefined) {
      return "—";
    }
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }, [value]);

  return (
    <div>
      <p className="text-xs uppercase text-muted-foreground">{title}</p>
      <pre className="mt-1 rounded-md bg-background p-3 text-xs whitespace-pre-wrap break-all border text-foreground">
        {formatted}
      </pre>
    </div>
  );
}
