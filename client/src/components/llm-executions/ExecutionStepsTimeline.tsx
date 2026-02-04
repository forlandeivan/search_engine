import { useEffect, useMemo, useState } from "react";
import { 
  Search, 
  Database, 
  FileText, 
  MessageSquare, 
  Zap, 
  CheckCircle2, 
  XCircle, 
  Loader2,
  ArrowRight,
  Send,
  Save
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { getStepMetadata } from "./step-metadata";
import { formatExecutionDuration, formatExecutionTimestamp } from "@/lib/llm-execution-format";
import { cn } from "@/lib/utils";
import type { LlmExecutionStep } from "@/types/llm-execution";

/** Иконка для типа шага */
function StepIcon({ type, status }: { type: string; status: string }) {
  const iconClass = "h-4 w-4";
  
  // Если шаг в процессе - показываем спиннер
  if (status === "running") {
    return <Loader2 className={cn(iconClass, "animate-spin text-blue-500")} />;
  }
  
  // Если ошибка - показываем крестик
  if (status === "error") {
    return <XCircle className={cn(iconClass, "text-red-500")} />;
  }
  
  // Иконки по типу шага
  switch (type) {
    case "VECTOR_SEARCH":
      return <Search className={cn(iconClass, "text-purple-500")} />;
    case "BUILD_RAG_CONTEXT":
      return <Database className={cn(iconClass, "text-blue-500")} />;
    case "BUILD_LLM_PROMPT":
      return <FileText className={cn(iconClass, "text-orange-500")} />;
    case "CALL_RAG_PIPELINE":
      return <Zap className={cn(iconClass, "text-yellow-500")} />;
    case "CALL_LLM":
      return <MessageSquare className={cn(iconClass, "text-green-500")} />;
    case "RECEIVE_HTTP_REQUEST":
      return <ArrowRight className={cn(iconClass, "text-gray-500")} />;
    case "WRITE_USER_MESSAGE":
    case "WRITE_ASSISTANT_MESSAGE":
      return <Save className={cn(iconClass, "text-teal-500")} />;
    case "STREAM_TO_CLIENT_START":
    case "STREAM_TO_CLIENT_FINISH":
      return <Send className={cn(iconClass, "text-indigo-500")} />;
    default:
      if (status === "success") {
        return <CheckCircle2 className={cn(iconClass, "text-green-500")} />;
      }
      return <ArrowRight className={cn(iconClass, "text-gray-400")} />;
  }
}

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
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <StepIcon type={step.type} status={step.status} />
                          <p className="text-sm font-semibold text-foreground">{metadata.title}</p>
                        </div>
                        {metadata.description && (
                          <p className="text-xs text-muted-foreground mt-0.5">{metadata.description}</p>
                        )}
                      </div>
                      <Badge className={cn(
                        step.status === "running" && "animate-pulse",
                        step.status === "error" && "bg-red-600",
                      )}>
                        {step.status === "running" ? "В ПРОЦЕССЕ..." : step.status.toUpperCase()}
                      </Badge>
                    </div>
                    <div className="text-xs text-muted-foreground flex flex-wrap gap-2 mt-1">
                      <span>Начало: {formatExecutionTimestamp(step.startedAt)}</span>
                      {step.finishedAt && <span>Окончание: {formatExecutionTimestamp(step.finishedAt)}</span>}
                      {durationMs !== null && <span>Длительность: {formatExecutionDuration(durationMs)}</span>}
                      {step.status === "running" && !step.finishedAt && (
                        <span className="text-amber-600 font-medium">Ожидание завершения...</span>
                      )}
                    </div>
                    {step.errorMessage && (
                      <p className="text-xs text-destructive mt-1">Ошибка: {step.errorMessage}</p>
                    )}
                    {/* Быстрый просмотр ключевых данных без раскрытия */}
                    <QuickInfo data={step.output} />
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
                      {isOpen ? "Свернуть детали" : "Показать полные данные"}
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
  const { formatted, isEmpty, isComplex } = useMemo(() => {
    if (value === null || value === undefined) {
      return { formatted: "—", isEmpty: true, isComplex: false };
    }
    try {
      const str = JSON.stringify(value, null, 2);
      return { 
        formatted: str, 
        isEmpty: false, 
        isComplex: str.length > 200 || str.includes("\n") 
      };
    } catch {
      return { formatted: String(value), isEmpty: false, isComplex: false };
    }
  }, [value]);

  if (isEmpty) {
    return (
      <div>
        <p className="text-xs uppercase text-muted-foreground">{title}</p>
        <p className="mt-1 text-sm text-muted-foreground italic">Нет данных</p>
      </div>
    );
  }

  return (
    <div>
      <p className="text-xs uppercase text-muted-foreground">{title}</p>
      <pre className={cn(
        "mt-1 rounded-md bg-background p-3 text-xs whitespace-pre-wrap break-all border text-foreground",
        isComplex && "max-h-[300px] overflow-y-auto"
      )}>
        {formatted}
      </pre>
    </div>
  );
}

/** Компактное отображение ключевых полей для быстрого просмотра */
function QuickInfo({ data }: { data: unknown }) {
  if (!data || typeof data !== "object") return null;
  
  const record = data as Record<string, unknown>;
  const highlights: Array<{ label: string; value: string | number }> = [];
  
  // Извлекаем ключевые поля для быстрого просмотра
  if ("chunksFound" in record && typeof record.chunksFound === "number") {
    highlights.push({ label: "Чанков найдено", value: record.chunksFound });
  }
  if ("citationsCount" in record && typeof record.citationsCount === "number") {
    highlights.push({ label: "Источников", value: record.citationsCount });
  }
  if ("contextChunksCount" in record && typeof record.contextChunksCount === "number") {
    highlights.push({ label: "Чанков в контексте", value: record.contextChunksCount });
  }
  if ("contextTotalLength" in record && typeof record.contextTotalLength === "number") {
    highlights.push({ label: "Длина контекста", value: `${Math.round(record.contextTotalLength / 1000)}K символов` });
  }
  if ("usageTokens" in record && typeof record.usageTokens === "number") {
    highlights.push({ label: "Токенов", value: record.usageTokens });
  }
  if ("responsePreview" in record && typeof record.responsePreview === "string") {
    highlights.push({ label: "Ответ", value: record.responsePreview.slice(0, 80) + "..." });
  }
  if ("answerPreview" in record && typeof record.answerPreview === "string") {
    highlights.push({ label: "Ответ", value: record.answerPreview.slice(0, 80) + "..." });
  }
  if ("llmModel" in record && typeof record.llmModel === "string") {
    highlights.push({ label: "Модель", value: record.llmModel });
  }
  if ("query" in record && typeof record.query === "string") {
    highlights.push({ label: "Запрос", value: record.query.slice(0, 60) + (record.query.length > 60 ? "..." : "") });
  }
  if ("knowledgeBaseId" in record && typeof record.knowledgeBaseId === "string") {
    highlights.push({ label: "База знаний", value: record.knowledgeBaseId.slice(0, 8) + "..." });
  }
  
  if (highlights.length === 0) return null;
  
  return (
    <div className="flex flex-wrap gap-2 mt-2">
      {highlights.map((h, i) => (
        <span key={i} className="inline-flex items-center gap-1 text-xs bg-muted px-2 py-1 rounded">
          <span className="text-muted-foreground">{h.label}:</span>
          <span className="font-medium">{h.value}</span>
        </span>
      ))}
    </div>
  );
}
