import { useCallback, useEffect, useRef, useState } from "react";
import type { KnowledgeBaseCrawlJobStatus } from "@shared/knowledge-base";
import { KnowledgeBaseCrawlProgress } from "@/components/knowledge-base/KnowledgeBaseCrawlProgress";
import { apiRequest } from "@/lib/queryClient";
import { updateKnowledgeBaseCrawlJob } from "@/lib/knowledge-base";
import type { ActiveCrawlResponse, CrawlActivityEvent } from "@/types/crawl";

const TERMINAL_STATUSES: Array<KnowledgeBaseCrawlJobStatus["status"]> = [
  "done",
  "failed",
  "canceled",
];

const STATUS_MESSAGES: Record<KnowledgeBaseCrawlJobStatus["status"], string> = {
  running: "Краулинг выполняется",
  paused: "Краулинг приостановлен",
  canceled: "Задача отменена",
  failed: "Краулинг завершился с ошибкой",
  done: "Краулинг завершён",
};

const buildEventId = (() => {
  let counter = 0;
  return (prefix: string) => {
    counter = (counter + 1) % Number.MAX_SAFE_INTEGER;
    return `${prefix}-${Date.now()}-${counter}`;
  };
})();

export type CrawlInlineState = {
  running: boolean;
  job: KnowledgeBaseCrawlJobStatus | null;
  lastRun?: KnowledgeBaseCrawlJobStatus | null;
};

type CrawlInlineProgressProps = {
  baseId?: string | null;
  pollIntervalMs?: number;
  onStateChange?: (state: CrawlInlineState) => void;
  onDocumentsSaved?: (delta: number, job: KnowledgeBaseCrawlJobStatus) => void;
  initialJob?: KnowledgeBaseCrawlJobStatus | null; // Начальное состояние джобы (например, при создании базы)
};

export function CrawlInlineProgress({
  baseId,
  pollIntervalMs = 4000,
  onStateChange,
  onDocumentsSaved,
  initialJob = null,
}: CrawlInlineProgressProps) {
  const [job, setJob] = useState<KnowledgeBaseCrawlJobStatus | null>(null);
  const [events, setEvents] = useState<CrawlActivityEvent[]>([]);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isPausing, setIsPausing] = useState(false);
  const [isResuming, setIsResuming] = useState(false);
  const [isCanceling, setIsCanceling] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);

  const previousJobRef = useRef<KnowledgeBaseCrawlJobStatus | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onStateChangeRef = useRef(onStateChange);
  const onDocumentsSavedRef = useRef(onDocumentsSaved);

  useEffect(() => {
    onStateChangeRef.current = onStateChange;
    onDocumentsSavedRef.current = onDocumentsSaved;
  }, [onStateChange, onDocumentsSaved]);

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      abortControllerRef.current?.abort();
      abortControllerRef.current = null;
    };
  }, []);

  const handleJobUpdate = useCallback(
    (incoming: KnowledgeBaseCrawlJobStatus) => {
      const isTerminal = TERMINAL_STATUSES.includes(incoming.status);
      const previous = previousJobRef.current;
      const isSameJob = previous?.jobId === incoming.jobId;
      const normalizedPrevious = isSameJob ? previous : null;

      if (!isSameJob) {
        setEvents([]);
      }

      if (isTerminal) {
        previousJobRef.current = incoming;
        setJob(null);
        setEvents([]);
        setConnectionError(null);
        setActionError(null);
        if (baseId) {
          updateKnowledgeBaseCrawlJob(baseId, null);
        }
        onStateChangeRef.current?.({ running: false, job: null, lastRun: incoming });
        return;
      }

      const timestamp = new Date().toISOString();
      const nextEvents: CrawlActivityEvent[] = [];

      if (!normalizedPrevious || normalizedPrevious.status !== incoming.status) {
        const statusMessage = STATUS_MESSAGES[incoming.status] ?? "Статус обновлён";
        nextEvents.push({
          id: buildEventId(`${incoming.jobId}-status`),
          type: incoming.status === "failed" ? "error" : "status",
          message: statusMessage,
          timestamp,
        });
      }

      if (!normalizedPrevious) {
        nextEvents.push({
          id: buildEventId(`${incoming.jobId}-start`),
          type: "status",
          message: "Задача краулинга запущена",
          timestamp,
        });
      } else {
        const savedDiff = incoming.saved - normalizedPrevious.saved;
        if (savedDiff > 0) {
          nextEvents.push({
            id: buildEventId(`${incoming.jobId}-saved`),
            type: "info",
            message: `Сохранено документов: +${savedDiff.toLocaleString("ru-RU")}`,
            timestamp,
          });
        }

        const fetchedDiff = incoming.fetched - normalizedPrevious.fetched;
        if (fetchedDiff > 0) {
          nextEvents.push({
            id: buildEventId(`${incoming.jobId}-fetched`),
            type: "info",
            message: `Загружено страниц: +${fetchedDiff.toLocaleString("ru-RU")}`,
            timestamp,
          });
        }

        const extractedPrev = normalizedPrevious.extracted ?? normalizedPrevious.fetched;
        const extractedCurrent = incoming.extracted ?? incoming.fetched;
        const extractedDiff = extractedCurrent - extractedPrev;
        if (extractedDiff > 0) {
          nextEvents.push({
            id: buildEventId(`${incoming.jobId}-extracted`),
            type: "info",
            message: `Извлечено контента: +${extractedDiff.toLocaleString("ru-RU")}`,
            timestamp,
          });
        }

        const failedDiff = incoming.failed - normalizedPrevious.failed;
        if (failedDiff > 0) {
          nextEvents.push({
            id: buildEventId(`${incoming.jobId}-failed`),
            type: "error",
            message: `Ошибки: +${failedDiff.toLocaleString("ru-RU")}`,
            timestamp,
          });
        }

        if (incoming.lastUrl && incoming.lastUrl !== normalizedPrevious.lastUrl) {
          nextEvents.push({
            id: buildEventId(`${incoming.jobId}-url`),
            type: "info",
            message: `Обработан URL: ${incoming.lastUrl}`,
            timestamp,
          });
        }

        if (incoming.lastError && incoming.lastError !== normalizedPrevious.lastError) {
          nextEvents.push({
            id: buildEventId(`${incoming.jobId}-error`),
            type: "error",
            message: `Ошибка: ${incoming.lastError}`,
            timestamp,
          });
        }
      }

      if (nextEvents.length > 0) {
        setEvents((current) => [...nextEvents, ...current].slice(0, 5));
      }

      if (normalizedPrevious) {
        const savedDiff = incoming.saved - normalizedPrevious.saved;
        if (savedDiff > 0) {
          onDocumentsSavedRef.current?.(savedDiff, incoming);
        }
      }

      previousJobRef.current = incoming;
      setJob(incoming);
      setConnectionError(null);
      setActionError(null);
      if (baseId) {
        updateKnowledgeBaseCrawlJob(baseId, incoming);
      }
      onStateChangeRef.current?.({ running: true, job: incoming });
    },
    [baseId],
  );

  // Инициализация начального состояния джобы при создании базы
  useEffect(() => {
    if (initialJob && !job && !previousJobRef.current) {
      handleJobUpdate(initialJob);
    }
  }, [initialJob, job, handleJobUpdate]);

  useEffect(() => {
    if (!baseId) {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      abortControllerRef.current?.abort();
      abortControllerRef.current = null;
      setJob(null);
      setEvents([]);
      setConnectionError(null);
      setActionError(null);
      previousJobRef.current = null;
      onStateChangeRef.current?.({ running: false, job: null });
      return;
    }

    let cancelled = false;

    const scheduleNextPoll = (delay = pollIntervalMs) => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
      const timeout = Number.isFinite(delay) ? Math.max(1000, delay) : 4000;
      timerRef.current = setTimeout(() => {
        void fetchState();
      }, timeout);
    };

    const fetchState = async () => {
      abortControllerRef.current?.abort();
      const controller = new AbortController();
      abortControllerRef.current = controller;

      try {
        const response = await apiRequest(
          "GET",
          `/api/kb/${encodeURIComponent(baseId)}/crawl/active`,
          undefined,
          undefined,
          { signal: controller.signal },
        );
        const payload = (await response.json()) as ActiveCrawlResponse;

        if (cancelled) {
          return;
        }

        if (!payload.running) {
          const lastRun = payload.lastRun?.job ?? previousJobRef.current ?? null;
          previousJobRef.current = lastRun;
          setJob(null);
          setEvents([]);
          setConnectionError(null);
          if (baseId) {
            updateKnowledgeBaseCrawlJob(baseId, null);
          }
          onStateChangeRef.current?.({
            running: false,
            job: null,
            lastRun: lastRun ?? undefined,
          });
        } else {
          if (!payload.job) {
            throw new Error("Не удалось получить детали активного краулинга");
          }
          handleJobUpdate(payload.job);
        }

        setConnectionError(null);
      } catch (error) {
        if (cancelled || controller.signal.aborted) {
          return;
        }
        const message =
          error instanceof Error ? error.message : "Не удалось получить статус краулинга";
        setConnectionError(message);
      } finally {
        if (abortControllerRef.current === controller) {
          abortControllerRef.current = null;
        }
        if (!cancelled) {
          scheduleNextPoll();
        }
      }
    };

    void fetchState();

    return () => {
      cancelled = true;
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      abortControllerRef.current?.abort();
      abortControllerRef.current = null;
    };
  }, [baseId, pollIntervalMs, handleJobUpdate]);

  const executeJobCommand = useCallback(
    async (
      action: "pause" | "resume" | "cancel" | "retry",
      setPending: (value: boolean) => void,
    ) => {
      if (!job) {
        return;
      }

      setPending(true);
      setActionError(null);
      try {
        const response = await apiRequest(
          "POST",
          `/api/jobs/${encodeURIComponent(job.jobId)}/${action}`,
        );
        const payload = (await response.json()) as { job: KnowledgeBaseCrawlJobStatus };
        handleJobUpdate(payload.job);
      } catch (error) {
        setActionError(error instanceof Error ? error.message : String(error));
      } finally {
        setPending(false);
      }
    },
    [job, handleJobUpdate],
  );

  const pause = useCallback(async () => {
    await executeJobCommand("pause", setIsPausing);
  }, [executeJobCommand]);

  const resume = useCallback(async () => {
    await executeJobCommand("resume", setIsResuming);
  }, [executeJobCommand]);

  const cancel = useCallback(async () => {
    await executeJobCommand("cancel", setIsCanceling);
  }, [executeJobCommand]);

  const retry = useCallback(async () => {
    await executeJobCommand("retry", setIsRetrying);
  }, [executeJobCommand]);

  if (!job) {
    return null;
  }

  return (
    <KnowledgeBaseCrawlProgress
      job={job}
      events={events}
      onPause={pause}
      onResume={resume}
      onCancel={cancel}
      onRetry={retry}
      isPausing={isPausing}
      isResuming={isResuming}
      isCanceling={isCanceling}
      isRetrying={isRetrying}
      connectionError={connectionError}
      actionError={actionError}
    />
  );
}
