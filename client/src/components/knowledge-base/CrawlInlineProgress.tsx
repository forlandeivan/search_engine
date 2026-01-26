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
  const [lastRun, setLastRun] = useState<KnowledgeBaseCrawlJobStatus | null>(null); // Завершённая джоба для отображения
  const [events, setEvents] = useState<CrawlActivityEvent[]>([]);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isInitialLoad, setIsInitialLoad] = useState(true); // Флаг первой загрузки
  const [isPausing, setIsPausing] = useState(false);
  const [isResuming, setIsResuming] = useState(false);
  const [isCanceling, setIsCanceling] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);

  const previousJobRef = useRef<KnowledgeBaseCrawlJobStatus | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideCanceledTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const canceledJobIdRef = useRef<string | null>(null); // ID отмененной джобы, которую нужно скрыть
  
  // Используем sessionStorage для сохранения информации о скрытых джобах между переключениями баз
  const getHiddenCanceledJobIds = useCallback((): Set<string> => {
    try {
      const stored = sessionStorage.getItem('hiddenCanceledCrawlJobIds');
      if (stored) {
        return new Set(JSON.parse(stored));
      }
    } catch (e) {
      // Игнорируем ошибки парсинга
    }
    return new Set<string>();
  }, []);
  
  const addHiddenCanceledJobId = useCallback((jobId: string) => {
    try {
      const current = getHiddenCanceledJobIds();
      current.add(jobId);
      sessionStorage.setItem('hiddenCanceledCrawlJobIds', JSON.stringify(Array.from(current)));
    } catch (e) {
      // Игнорируем ошибки записи
    }
  }, [getHiddenCanceledJobIds]);
  
  const isJobHidden = useCallback((jobId: string | null | undefined): boolean => {
    if (!jobId) return false;
    return getHiddenCanceledJobIds().has(jobId);
  }, [getHiddenCanceledJobIds]);
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
      if (hideCanceledTimerRef.current) {
        clearTimeout(hideCanceledTimerRef.current);
        hideCanceledTimerRef.current = null;
      }
    canceledJobIdRef.current = null;
    // НЕ очищаем sessionStorage при размонтировании - информация должна сохраняться в рамках сессии
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
        setLastRun(incoming); // Сохраняем завершённую джобу для отображения
        setEvents([]);
        setConnectionError(null);
        setActionError(null);
        if (baseId) {
          updateKnowledgeBaseCrawlJob(baseId, null);
        }
        onStateChangeRef.current?.({ running: false, job: null, lastRun: incoming });
        
        // Если джоба ТОЛЬКО ЧТО отменена (статус изменился на "canceled"), скрываем виджет через 2 секунды
        // Проверяем, что:
        // 1. Предыдущий статус был не "canceled" (значит пользователь нажал "Отмена" сейчас)
        // 2. И есть предыдущее состояние (normalizedPrevious !== null) - значит это не первая загрузка
        // Это гарантирует, что таймер запускается только при реальном нажатии "Отмена", а не при загрузке уже отмененной джобы
        if (incoming.status === "canceled" && normalizedPrevious && normalizedPrevious.status !== "canceled") {
          canceledJobIdRef.current = incoming.jobId;
          // Сохраняем ID джобы в sessionStorage СРАЗУ, чтобы при переключении баз виджет не появлялся снова
          if (incoming.jobId) {
            addHiddenCanceledJobId(incoming.jobId);
          }
          if (hideCanceledTimerRef.current) {
            clearTimeout(hideCanceledTimerRef.current);
          }
          hideCanceledTimerRef.current = setTimeout(() => {
            setLastRun(null);
            hideCanceledTimerRef.current = null;
            canceledJobIdRef.current = null;
          }, 2000);
        }
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
    if (!baseId || !initialJob) return;
    
    // Проверяем, что initialJob относится к текущей базе
    if (initialJob.baseId !== baseId) return;
    
    // Если уже есть job или previousJobRef для этой джобы, не инициализируем повторно
    const isSameJob = previousJobRef.current?.jobId === initialJob.jobId;
    if (job && isSameJob) return;
    if (previousJobRef.current && isSameJob) return;
    
      // Если джоба уже завершена, сохраняем её как lastRun
      if (TERMINAL_STATUSES.includes(initialJob.status)) {
        // Если джоба отменена, не показываем её - она была отменена ДО загрузки страницы
        // Таймер запускается только когда пользователь нажимает "Отмена" сейчас (в handleJobUpdate)
        if (initialJob.status === "canceled") {
          // Не показываем отмененные джобы при инициализации
          return;
        }
        
        setLastRun(initialJob);
        previousJobRef.current = initialJob;
        onStateChangeRef.current?.({ running: false, job: null, lastRun: initialJob });
      } else {
      // Для активной джобы инициализируем состояние и начинаем отслеживание
      handleJobUpdate(initialJob);
    }
  }, [initialJob, baseId, job, handleJobUpdate]);

  useEffect(() => {
    if (!baseId) {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      if (hideCanceledTimerRef.current) {
        clearTimeout(hideCanceledTimerRef.current);
        hideCanceledTimerRef.current = null;
      }
      canceledJobIdRef.current = null;
      // НЕ очищаем sessionStorage при отсутствии baseId - информация должна сохраняться в рамках сессии
      abortControllerRef.current?.abort();
      abortControllerRef.current = null;
      setJob(null);
      setLastRun(null);
      setEvents([]);
      setConnectionError(null);
      setActionError(null);
      setIsInitialLoad(true);
      previousJobRef.current = null;
      onStateChangeRef.current?.({ running: false, job: null });
      return;
    }

    // Сбрасываем состояние при смене baseId
    setIsInitialLoad(true);
    
    // Очищаем таймер скрытия при смене baseId (но НЕ очищаем hiddenCanceledJobIdsRef - это глобальная информация)
    if (hideCanceledTimerRef.current) {
      clearTimeout(hideCanceledTimerRef.current);
      hideCanceledTimerRef.current = null;
    }
    canceledJobIdRef.current = null;
    // НЕ очищаем hiddenCanceledJobIdsRef при смене baseId - информация о скрытых джобах должна сохраняться
    
    // Сбрасываем lastRun при смене baseId, только если нет initialJob для этого baseId
    // Это нужно, чтобы не сбрасывать lastRun, если initialJob еще не обработан
    if (!initialJob || initialJob.baseId !== baseId) {
      setLastRun(null);
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
        setIsInitialLoad(false); // Первая загрузка завершена
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
          const lastRunJob = payload.lastRun?.job ?? previousJobRef.current ?? null;
          
          // Если это отмененная джоба, которую мы уже скрыли, не устанавливаем её снова
          // Проверяем ДО установки lastRun, чтобы предотвратить повторное появление виджета
          if (lastRunJob?.status === "canceled") {
            // Если джоба уже была скрыта ранее (пользователь нажал "Отмена" ранее), не показываем её снова
            if (isJobHidden(lastRunJob.jobId)) {
              // Джоба уже была скрыта, не показываем её снова
              return;
            }
            // Если таймер уже запущен для этой джобы (пользователь только что нажал "Отмена"), не обновляем lastRun
            if (canceledJobIdRef.current === lastRunJob.jobId) {
              // Таймер уже запущен, не обновляем lastRun - виджет должен быть скрыт
              return;
            }
            // Если джоба отменена, но таймер не запущен - значит она была отменена ДО загрузки страницы
            // Не показываем такие джобы, они не должны быть видны
            // Таймер запускается только когда пользователь нажимает "Отмена" сейчас (в handleJobUpdate)
            return;
          }
          
          // Для неотмененных джоб устанавливаем lastRun как обычно
          previousJobRef.current = lastRunJob;
          setJob(null);
          setLastRun(lastRunJob);
          setEvents([]);
          setConnectionError(null);
          if (baseId && lastRunJob) {
            updateKnowledgeBaseCrawlJob(baseId, lastRunJob);
          } else if (baseId) {
            updateKnowledgeBaseCrawlJob(baseId, null);
          }
          onStateChangeRef.current?.({
            running: false,
            job: null,
            lastRun: lastRunJob ?? undefined,
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
        setIsInitialLoad(false); // Первая загрузка завершена даже при ошибке
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
      if (hideCanceledTimerRef.current) {
        clearTimeout(hideCanceledTimerRef.current);
        hideCanceledTimerRef.current = null;
      }
      canceledJobIdRef.current = null;
      // НЕ очищаем sessionStorage при смене baseId - информация должна сохраняться
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
    // Для завершённой джобы используем jobId из lastRun
    const jobToRetry = job || lastRun;
    if (!jobToRetry) {
      return;
    }

    setIsRetrying(true);
    setActionError(null);
    try {
      const response = await apiRequest(
        "POST",
        `/api/jobs/${encodeURIComponent(jobToRetry.jobId)}/retry`,
      );
      const payload = (await response.json()) as { job: KnowledgeBaseCrawlJobStatus };
      handleJobUpdate(payload.job);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsRetrying(false);
    }
  }, [job, lastRun, handleJobUpdate]);

  // Отображаем активную джобу или последнюю завершённую джобу
  // Если есть initialJob, используем его как fallback, чтобы показать прогресс сразу
  // Также показываем виджет во время первой загрузки или если есть ошибка подключения
  // НО: не показываем initialJob, если это отмененная джоба, которую мы уже скрыли
  const initialJobToDisplay = initialJob && initialJob.baseId === baseId 
    && !(initialJob.status === "canceled" && (
      canceledJobIdRef.current === initialJob.jobId || 
      isJobHidden(initialJob.jobId)
    ))
    ? initialJob 
    : null;
  const jobToDisplay = job || lastRun || initialJobToDisplay;
  
  // Показываем виджет если:
  // 1. Есть джоба для отображения
  // 2. Идет первая загрузка (чтобы не мигать при обновлении страницы)
  // 3. Есть ошибка подключения (чтобы пользователь видел проблему)
  if (!jobToDisplay && !isInitialLoad && !connectionError) {
    return null;
  }
  
  // Если нет джобы, но есть ошибка или идет загрузка, показываем виджет с placeholder
  if (!jobToDisplay) {
    // Создаем placeholder джобу для отображения во время загрузки или при ошибке
    const placeholderJob: KnowledgeBaseCrawlJobStatus = {
      jobId: 'loading',
      baseId: baseId || '',
      status: connectionError ? 'failed' : 'running',
      percent: 0,
      discovered: 0,
      fetched: 0,
      saved: 0,
      errors: 0,
      failed: 0,
      etaSec: null,
      lastUrl: null,
      lastError: connectionError || null,
      pagesNew: null,
      extracted: null,
      queued: null,
    };
    
    return (
      <KnowledgeBaseCrawlProgress
        job={placeholderJob}
        events={[]}
        connectionError={connectionError}
        actionError={actionError}
      />
    );
  }

  // Для завершённой джобы не показываем кнопки управления
  const isTerminal = TERMINAL_STATUSES.includes(jobToDisplay.status);
  const canControl = !isTerminal && job !== null;

  return (
    <KnowledgeBaseCrawlProgress
      job={jobToDisplay}
      events={events}
      onPause={canControl ? pause : undefined}
      onResume={canControl ? resume : undefined}
      onCancel={canControl ? cancel : undefined}
      onRetry={isTerminal ? retry : undefined}
      isPausing={isPausing}
      isResuming={isResuming}
      isCanceling={isCanceling}
      isRetrying={isRetrying}
      connectionError={connectionError}
      actionError={actionError}
    />
  );
}
