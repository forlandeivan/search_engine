import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KnowledgeBaseCrawlJobStatus } from "@shared/knowledge-base";
import { apiRequest } from "@/lib/queryClient";
import { updateKnowledgeBaseCrawlJob } from "@/lib/knowledge-base";

export type CrawlActivityEvent = {
  id: string;
  type: "info" | "error" | "status";
  message: string;
  timestamp: string;
};

type UseKnowledgeBaseCrawlJobOptions = {
  baseId?: string | null;
  initialJob?: KnowledgeBaseCrawlJobStatus | null;
};

type UseKnowledgeBaseCrawlJobResult = {
  job: KnowledgeBaseCrawlJobStatus | null;
  events: CrawlActivityEvent[];
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  cancel: () => Promise<void>;
  retry: () => Promise<void>;
  isPausing: boolean;
  isResuming: boolean;
  isCanceling: boolean;
  isRetrying: boolean;
  connectionError: string | null;
  actionError: string | null;
};

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

const parseJobKey = (job: KnowledgeBaseCrawlJobStatus | null | undefined): string =>
  job ? `${job.jobId}:${job.updatedAt}` : "";

export function useKnowledgeBaseCrawlJob({
  baseId,
  initialJob,
}: UseKnowledgeBaseCrawlJobOptions): UseKnowledgeBaseCrawlJobResult {
  const [job, setJob] = useState<KnowledgeBaseCrawlJobStatus | null>(initialJob ?? null);
  const [events, setEvents] = useState<CrawlActivityEvent[]>([]);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isPausing, setIsPausing] = useState(false);
  const [isResuming, setIsResuming] = useState(false);
  const [isCanceling, setIsCanceling] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);

  const previousJobRef = useRef<KnowledgeBaseCrawlJobStatus | null>(initialJob ?? null);
  const fetchedJobIdsRef = useRef<Set<string>>(
    initialJob?.jobId ? new Set([initialJob.jobId]) : new Set(),
  );
  const activeSubscriptionRef = useRef<() => void>();

  useEffect(() => {
    previousJobRef.current = initialJob ?? null;
  }, [parseJobKey(initialJob ?? null)]);

  const emitEvents = useCallback((next: KnowledgeBaseCrawlJobStatus) => {
    const previous = previousJobRef.current;
    const timestamp = new Date().toISOString();
    const nextEvents: CrawlActivityEvent[] = [];

    if (!previous || previous.status !== next.status) {
      const statusMessage = STATUS_MESSAGES[next.status] ?? "Статус обновлён";
      nextEvents.push({
        id: buildEventId(`${next.jobId}-status`),
        type: next.status === "failed" ? "error" : "status",
        message: statusMessage,
        timestamp,
      });
    }

    if (!previous) {
      nextEvents.push({
        id: buildEventId(`${next.jobId}-start`),
        type: "status",
        message: "Задача краулинга запущена",
        timestamp,
      });
    } else {
      const savedDiff = next.saved - previous.saved;
      if (savedDiff > 0) {
        nextEvents.push({
          id: buildEventId(`${next.jobId}-saved`),
          type: "info",
          message: `Сохранено документов: +${savedDiff.toLocaleString("ru-RU")}`,
          timestamp,
        });
      }

      const fetchedDiff = next.fetched - previous.fetched;
      if (fetchedDiff > 0) {
        nextEvents.push({
          id: buildEventId(`${next.jobId}-fetched`),
          type: "info",
          message: `Загружено страниц: +${fetchedDiff.toLocaleString("ru-RU")}`,
          timestamp,
        });
      }

      const extractedDiff = next.extracted - previous.extracted;
      if (extractedDiff > 0) {
        nextEvents.push({
          id: buildEventId(`${next.jobId}-extracted`),
          type: "info",
          message: `Извлечено контента: +${extractedDiff.toLocaleString("ru-RU")}`,
          timestamp,
        });
      }

      const failedDiff = next.failed - previous.failed;
      if (failedDiff > 0) {
        nextEvents.push({
          id: buildEventId(`${next.jobId}-failed`),
          type: "error",
          message: `Ошибки: +${failedDiff.toLocaleString("ru-RU")}`,
          timestamp,
        });
      }

      if (next.lastUrl && next.lastUrl !== previous.lastUrl) {
        nextEvents.push({
          id: buildEventId(`${next.jobId}-url`),
          type: "info",
          message: `Обработан URL: ${next.lastUrl}`,
          timestamp,
        });
      }

      if (next.lastError && next.lastError !== previous.lastError) {
        nextEvents.push({
          id: buildEventId(`${next.jobId}-error`),
          type: "error",
          message: `Ошибка: ${next.lastError}`,
          timestamp,
        });
      }
    }

    if (nextEvents.length > 0) {
      setEvents((current) => [...nextEvents, ...current].slice(0, 5));
    }

    previousJobRef.current = next;
  }, []);

  const handleJobUpdate = useCallback(
    (next: KnowledgeBaseCrawlJobStatus) => {
      setJob(next);
      setConnectionError(null);
      emitEvents(next);
      updateKnowledgeBaseCrawlJob(next.baseId, next);
    },
    [emitEvents],
  );

  useEffect(() => {
    if (!baseId) {
      setJob(null);
      setEvents([]);
      previousJobRef.current = null;
      return;
    }

    const incoming = initialJob ?? null;
    if (!incoming) {
      setJob(null);
      setEvents([]);
      previousJobRef.current = null;
      updateKnowledgeBaseCrawlJob(baseId, null);
      return;
    }

    setJob((current) => {
      if (!current || current.jobId !== incoming.jobId) {
        previousJobRef.current = incoming;
        setEvents([]);
        setConnectionError(null);
        fetchedJobIdsRef.current.delete(incoming.jobId);
        return incoming;
      }

      const currentUpdatedAt = new Date(current.updatedAt).getTime();
      const incomingUpdatedAt = new Date(incoming.updatedAt).getTime();
      if (incomingUpdatedAt > currentUpdatedAt) {
        previousJobRef.current = incoming;
        return incoming;
      }

      return current;
    });
  }, [baseId, parseJobKey(initialJob ?? null)]);

  useEffect(() => {
    if (!baseId || !job) {
      return;
    }

    if (fetchedJobIdsRef.current.has(job.jobId)) {
      return;
    }

    let cancelled = false;
    fetchedJobIdsRef.current.add(job.jobId);

    (async () => {
      try {
        const response = await apiRequest(
          "GET",
          `/api/jobs/${encodeURIComponent(job.jobId)}`,
        );
        if (!response.ok) {
          throw new Error(`Не удалось загрузить статус задачи (${response.status})`);
        }
        const payload = (await response.json()) as { job: KnowledgeBaseCrawlJobStatus };
        if (!cancelled) {
          handleJobUpdate(payload.job);
        }
      } catch (error) {
        if (!cancelled) {
          setConnectionError(
            error instanceof Error ? error.message : "Не удалось получить статус краулинга",
          );
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [baseId, job?.jobId, handleJobUpdate]);

  useEffect(() => {
    if (!job || TERMINAL_STATUSES.includes(job.status)) {
      if (activeSubscriptionRef.current) {
        activeSubscriptionRef.current();
        activeSubscriptionRef.current = undefined;
      }
      return;
    }

    if (typeof EventSource === "undefined") {
      return;
    }

    let isActive = true;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let eventSource: EventSource | null = null;

    const subscribe = () => {
      if (!isActive) {
        return;
      }

      eventSource = new EventSource(
        `/api/jobs/${encodeURIComponent(job.jobId)}/sse`,
        { withCredentials: true },
      );

      eventSource.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data) as KnowledgeBaseCrawlJobStatus;
          handleJobUpdate(payload);
        } catch (error) {
          console.error("Failed to parse crawl job event", error);
        }
      };

      eventSource.onerror = () => {
        if (!isActive) {
          return;
        }

        setConnectionError("Поток обновлений временно недоступен, пробуем переподключиться…");
        eventSource?.close();
        reconnectTimer = setTimeout(subscribe, 3000);
      };
    };

    subscribe();

    activeSubscriptionRef.current = () => {
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
      }
      eventSource?.close();
    };

    return () => {
      isActive = false;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
      }
      eventSource?.close();
      activeSubscriptionRef.current = undefined;
    };
  }, [job, handleJobUpdate]);

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
        if (!response.ok) {
          const payload = await response.json().catch(() => ({}));
          const message = typeof payload.error === "string" ? payload.error : null;
          throw new Error(message ?? `Не удалось выполнить действие (${response.status})`);
        }
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

  return useMemo(
    () => ({
      job,
      events,
      pause,
      resume,
      cancel,
      retry,
      isPausing,
      isResuming,
      isCanceling,
      isRetrying,
      connectionError,
      actionError,
    }),
    [
      job,
      events,
      pause,
      resume,
      cancel,
      retry,
      isPausing,
      isResuming,
      isCanceling,
      isRetrying,
      connectionError,
      actionError,
    ],
  );
}
