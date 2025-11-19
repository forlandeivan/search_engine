import { useEffect, useMemo, useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { AlertCircle, ArrowLeft, Clipboard, ClipboardCheck, Loader2, RefreshCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type {
  KnowledgeBaseAskAiRunDetail,
  KnowledgeBaseAskAiRunListResponse,
  KnowledgeBaseAskAiRunSummary,
} from "@shared/knowledge-base";

const PAGE_SIZE = 20;

function formatDate(value: string | null | undefined): string {
  if (!value) {
    return "—";
  }

  try {
    return new Date(value).toLocaleString("ru-RU");
  } catch {
    return value;
  }
}

function formatSeconds(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) {
    return "—";
  }

  return (ms / 1000).toFixed(2);
}

function formatTokens(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return "—";
  }

  return value.toLocaleString("ru-RU");
}

function formatArticlesCount(run: Pick<
  KnowledgeBaseAskAiRunSummary,
  "vectorDocumentCount" | "combinedResultCount" | "vectorResultCount" | "bm25ResultCount"
>): string {
  const candidates = [
    run.vectorDocumentCount,
    run.combinedResultCount,
    run.vectorResultCount,
    run.bm25ResultCount,
  ];

  for (const candidate of candidates) {
    if (candidate !== null && candidate !== undefined) {
      return candidate.toLocaleString("ru-RU");
    }
  }

  return "—";
}

async function fetchAskAiRuns(
  knowledgeBaseId: string,
  offset: number,
  limit: number,
): Promise<KnowledgeBaseAskAiRunListResponse> {
  const params = new URLSearchParams();
  params.set("offset", String(offset));
  params.set("limit", String(limit));

  const response = await fetch(`/api/knowledge/bases/${knowledgeBaseId}/ask-ai/runs?${params}`);
  if (!response.ok) {
    throw new Error("Не удалось загрузить журнал Ask AI");
  }

  return (await response.json()) as KnowledgeBaseAskAiRunListResponse;
}

async function fetchAskAiRunDetail(
  knowledgeBaseId: string,
  runId: string,
): Promise<KnowledgeBaseAskAiRunDetail> {
  const response = await fetch(`/api/knowledge/bases/${knowledgeBaseId}/ask-ai/runs/${runId}`);
  if (!response.ok) {
    throw new Error("Не удалось загрузить детали запуска");
  }

  return (await response.json()) as KnowledgeBaseAskAiRunDetail;
}

function RunStatusBadge({ status }: { status: KnowledgeBaseAskAiRunSummary["status"] }) {
  if (status === "success") {
    return <Badge className="bg-emerald-600 hover:bg-emerald-600">Успешно</Badge>;
  }

  return <Badge variant="destructive">Ошибка</Badge>;
}

function RunsTable({
  runs,
  isLoading,
  isRetrying,
  error,
  onRetry,
  onSelect,
}: {
  runs: KnowledgeBaseAskAiRunSummary[];
  isLoading: boolean;
  isRetrying: boolean;
  error: string | null;
  onRetry: () => void;
  onSelect: (run: KnowledgeBaseAskAiRunSummary) => void;
}) {
  const [copiedRunId, setCopiedRunId] = useState<string | null>(null);

  const handleCopyRunId = async (runId: string) => {
    try {
      await navigator.clipboard.writeText(runId);
      setCopiedRunId(runId);
      window.setTimeout(() => {
        setCopiedRunId((current) => (current === runId ? null : current));
      }, 2000);
    } catch (copyError) {
      console.error("Не удалось скопировать идентификатор запуска", copyError);
    }
  };
  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
        <AlertCircle className="h-5 w-5 text-destructive" />
        <div className="space-y-1 text-sm text-muted-foreground">
          <p>Не удалось загрузить журнал Ask AI.</p>
          <p className="text-xs text-muted-foreground/80">{error}</p>
        </div>
        <Button type="button" size="sm" onClick={onRetry} disabled={isRetrying}>
          {isRetrying ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          Повторить попытку
        </Button>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (runs.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-sm text-muted-foreground">
        <p>Запуски Ask AI пока не выполнялись.</p>
        <p>Задайте вопрос, чтобы увидеть историю выполнения.</p>
      </div>
    );
  }

  return (
    <ScrollArea className="h-[60vh]">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[160px]">Дата</TableHead>
            <TableHead>Промпт</TableHead>
            <TableHead className="w-[190px]">ID запуска</TableHead>
            <TableHead className="w-[90px] text-right">Статус</TableHead>
            <TableHead className="w-[110px] text-right">Статьи</TableHead>
            <TableHead className="w-[110px] text-right">Токены</TableHead>
            <TableHead className="w-[110px] text-right">Время, c</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {runs.map((run) => (
          <TableRow
            key={run.id}
            className="cursor-pointer"
            onClick={() => onSelect(run)}
          >
            <TableCell className="font-medium">{formatDate(run.createdAt)}</TableCell>
            <TableCell>
              <div className="truncate text-sm" title={run.prompt}>
                {run.prompt}
              </div>
            </TableCell>
            <TableCell>
              <div className="flex items-center gap-2">
                <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground" title={run.id}>
                  {run.id.slice(0, 6)}…{run.id.slice(-4)}
                </code>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-xs"
                  onClick={(event) => {
                    event.stopPropagation();
                    handleCopyRunId(run.id);
                  }}
                >
                  {copiedRunId === run.id ? (
                    <ClipboardCheck className="mr-1.5 h-3.5 w-3.5" />
                  ) : (
                    <Clipboard className="mr-1.5 h-3.5 w-3.5" />
                  )}
                  {copiedRunId === run.id ? "Скопировано" : "Копировать"}
                </Button>
              </div>
            </TableCell>
            <TableCell className="text-right">
              <RunStatusBadge status={run.status} />
            </TableCell>
            <TableCell className="text-right">{formatArticlesCount(run)}</TableCell>
            <TableCell className="text-right">{formatTokens(run.totalTokens)}</TableCell>
            <TableCell className="text-right">{formatSeconds(run.totalDurationMs)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
      </Table>
    </ScrollArea>
  );
}

function PipelineSection({
  detail,
}: {
  detail: KnowledgeBaseAskAiRunDetail;
}) {
  if (detail.pipelineLog.length === 0) {
    return <p className="text-sm text-muted-foreground">Подробный лог отсутствует.</p>;
  }

  return (
    <div className="space-y-3">
      {detail.pipelineLog.map((step) => (
        <div
          key={step.key + (step.startedAt ?? "") + (step.finishedAt ?? "")}
          className="rounded-lg border bg-muted/30 p-3"
        >
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-sm font-medium">{step.title ?? step.key}</p>
              <p className="text-xs text-muted-foreground">
                Статус: {step.status === "success" ? "успешно" : step.status === "skipped" ? "пропущено" : "ошибка"}
              </p>
            </div>
            <p className="text-xs text-muted-foreground">
              {step.durationMs !== null && step.durationMs !== undefined
                ? `${(step.durationMs / 1000).toFixed(2)} с`
                : "—"}
            </p>
          </div>
          {step.error ? (
            <p className="mt-2 text-xs text-destructive">{step.error}</p>
          ) : null}
          {step.input ? (
            <pre className="mt-2 max-h-32 overflow-auto rounded bg-background/80 p-2 text-xs">
              {JSON.stringify(step.input, null, 2)}
            </pre>
          ) : null}
          {step.output ? (
            <pre className="mt-2 max-h-32 overflow-auto rounded bg-background/80 p-2 text-xs">
              {JSON.stringify(step.output, null, 2)}
            </pre>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function RunDetailView({
  detail,
  onBack,
  isLoading,
  isRetrying,
  error,
  onRetry,
}: {
  detail: KnowledgeBaseAskAiRunDetail | null;
  onBack: () => void;
  isLoading: boolean;
  isRetrying: boolean;
  error: string | null;
  onRetry: () => void;
}) {
  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
        <AlertCircle className="h-5 w-5 text-destructive" />
        <div className="space-y-1 text-sm text-muted-foreground">
          <p>Не удалось загрузить детали запуска.</p>
          <p className="text-xs text-muted-foreground/80">{error}</p>
        </div>
        <Button type="button" size="sm" onClick={onRetry} disabled={isRetrying}>
          {isRetrying ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          Повторить попытку
        </Button>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-sm text-muted-foreground">
        <p>Выберите запуск, чтобы увидеть подробности.</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onBack} className="px-2">
            <ArrowLeft className="mr-1 h-4 w-4" /> Назад
          </Button>
          <RunStatusBadge status={detail.status} />
        </div>
        <p className="text-xs text-muted-foreground">{formatDate(detail.createdAt)}</p>
      </div>

      <div className="space-y-1">
        <p className="text-sm font-medium">Промпт</p>
        <p className="rounded border bg-muted/30 p-2 text-sm">{detail.prompt}</p>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">Нормализованный запрос</p>
          <p className="rounded border bg-muted/30 p-2 text-sm">
            {detail.normalizedQuery ?? "—"}
          </p>
        </div>
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">Параметры</p>
          <div className="rounded border bg-muted/30 p-2 text-xs leading-5">
            <p>Top-K: {detail.topK ?? "—"}</p>
            <p>BM25 вес: {detail.bm25Weight ?? "—"}</p>
            <p>Векторный вес: {detail.vectorWeight ?? "—"}</p>
            <p>LLM модель: {detail.llmModel ?? "—"}</p>
          </div>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <div className="rounded border bg-muted/30 p-2 text-xs leading-5">
          <p className="text-muted-foreground">Найдено статей</p>
          <p className="text-sm font-semibold">{formatArticlesCount(detail)}</p>
          <p className="text-xs text-muted-foreground">
            Векторных документов: {detail.vectorDocumentCount ?? "—"}
          </p>
        </div>
        <div className="rounded border bg-muted/30 p-2 text-xs leading-5">
          <p className="text-muted-foreground">Токены всего</p>
          <p className="text-sm font-semibold">{formatTokens(detail.totalTokens)}</p>
        </div>
        <div className="rounded border bg-muted/30 p-2 text-xs leading-5">
          <p className="text-muted-foreground">Время пайплайна, c</p>
          <p className="text-sm font-semibold">{formatSeconds(detail.totalDurationMs)}</p>
        </div>
      </div>

      <div className="rounded border bg-muted/30 p-3 text-xs leading-5">
        <p className="font-medium">Длительности этапов (мс)</p>
        <div className="mt-1 grid grid-cols-2 gap-x-4 gap-y-1">
          <span className="text-muted-foreground">BM25</span>
          <span>{detail.bm25DurationMs ?? "—"}</span>
          <span className="text-muted-foreground">Vector</span>
          <span>{detail.vectorDurationMs ?? "—"}</span>
          <span className="text-muted-foreground">LLM</span>
          <span>{detail.llmDurationMs ?? "—"}</span>
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium">Этапы пайплайна</p>
        <PipelineSection detail={detail} />
      </div>
    </div>
  );
}

export type AskAiRunJournalDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  knowledgeBaseId: string | null;
};

export function AskAiRunJournalDialog({
  open,
  onOpenChange,
  knowledgeBaseId,
}: AskAiRunJournalDialogProps) {
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setSelectedRunId(null);
    }
  }, [open]);

  const runsQuery = useInfiniteQuery({
    queryKey: ["ask-ai", "runs", knowledgeBaseId],
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      if (!knowledgeBaseId) {
        return { items: [], hasMore: false, nextOffset: null };
      }
      return fetchAskAiRuns(knowledgeBaseId, pageParam as number, PAGE_SIZE);
    },
    getNextPageParam: (lastPage) => {
      if (lastPage.hasMore && lastPage.nextOffset !== null) {
        return lastPage.nextOffset;
      }
      return undefined;
    },
    enabled: open && Boolean(knowledgeBaseId),
    refetchOnWindowFocus: false,
  });

  const runs = useMemo(
    () => runsQuery.data?.pages.flatMap((page) => page.items) ?? [],
    [runsQuery.data?.pages],
  );

  const hasMore = runsQuery.data?.pages.at(-1)?.hasMore ?? false;
  const loadMore = () => runsQuery.fetchNextPage();

  const runsError = runsQuery.isError
    ? runsQuery.error instanceof Error
      ? runsQuery.error.message
      : "Неизвестная ошибка"
    : null;
  const runsRetrying = runsQuery.isFetching && !runsQuery.isLoading;

  const detailQuery = useQuery({
    queryKey: ["ask-ai", "runs", knowledgeBaseId, selectedRunId],
    queryFn: async () => {
      if (!knowledgeBaseId || !selectedRunId) {
        throw new Error("Нет идентификатора запуска");
      }
      return fetchAskAiRunDetail(knowledgeBaseId, selectedRunId);
    },
    enabled: open && Boolean(knowledgeBaseId) && Boolean(selectedRunId),
    refetchOnWindowFocus: false,
  });

  const detailError = detailQuery.isError
    ? detailQuery.error instanceof Error
      ? detailQuery.error.message
      : "Неизвестная ошибка"
    : null;
  const detailRetrying = detailQuery.isFetching && !detailQuery.isLoading;

  const handleSelectRun = (run: KnowledgeBaseAskAiRunSummary) => {
    setSelectedRunId(run.id);
  };

  const handleOpenChange = (next: boolean) => {
    onOpenChange(next);
  };

  const handleRefresh = () => {
    runsQuery.refetch();
    if (selectedRunId) {
      detailQuery.refetch();
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-5xl">
        <DialogHeader>
          <DialogTitle>Журнал Ask AI</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              История запусков пайплайна Ask AI по выбранной базе знаний.
            </p>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="h-8 w-8"
              onClick={handleRefresh}
              disabled={runsQuery.isFetching || detailQuery.isFetching}
            >
              <RefreshCcw
                className={cn("h-4 w-4", {
                  "animate-spin": runsQuery.isFetching || detailQuery.isFetching,
                })}
              />
            </Button>
          </div>
          {!knowledgeBaseId ? (
            <p className="text-sm text-muted-foreground">
              Выберите базу знаний, чтобы просмотреть журнал Ask AI.
            </p>
          ) : (
            <div className="grid gap-4 lg:grid-cols-[1.5fr_1fr]">
              <div className="min-h-[320px] rounded-lg border p-3">
                <RunsTable
                  runs={runs}
                  isLoading={runsQuery.isLoading}
                  isRetrying={runsRetrying}
                  error={runsError}
                  onRetry={() => runsQuery.refetch()}
                  onSelect={handleSelectRun}
                />
                {hasMore && !runsError ? (
                  <div className="mt-3 flex justify-center">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={loadMore}
                      disabled={runsQuery.isFetchingNextPage}
                    >
                      {runsQuery.isFetchingNextPage ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : null}
                      Показать ещё
                    </Button>
                  </div>
                ) : null}
              </div>
              <div className="min-h-[320px] rounded-lg border p-3">
                <RunDetailView
                  detail={detailQuery.data ?? null}
                  onBack={() => setSelectedRunId(null)}
                  isLoading={detailQuery.isLoading}
                  isRetrying={detailRetrying}
                  error={detailError}
                  onRetry={() => detailQuery.refetch()}
                />
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

