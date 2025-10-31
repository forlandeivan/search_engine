import { useCallback, useEffect, useRef, useState } from "react";

import type { SuggestResponsePayload } from "@/types/search";

const CACHE_LIMIT = 20;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 минут

type SuggestStatus = "idle" | "loading" | "success" | "error";

interface UseSuggestSearchOptions {
  knowledgeBaseId: string;
  limit: number;
}

interface SuggestState {
  status: SuggestStatus;
  data: SuggestResponsePayload | null;
  error: string | null;
}

interface UseSuggestSearchResult extends SuggestState {
  search: (query: string) => void;
  prefetch: (query: string) => void;
  reset: () => void;
}

interface CacheEntry {
  timestamp: number;
  payload: SuggestResponsePayload;
}

export function useSuggestSearch({ knowledgeBaseId, limit }: UseSuggestSearchOptions): UseSuggestSearchResult {
  const abortRef = useRef<AbortController | null>(null);
  const cacheRef = useRef<Map<string, CacheEntry>>(new Map());
  const [state, setState] = useState<SuggestState>({ status: "idle", data: null, error: null });
  const paramsRef = useRef({ knowledgeBaseId, limit });

  useEffect(() => {
    paramsRef.current = { knowledgeBaseId, limit };
    setState((prev) => ({ ...prev, data: null, error: null, status: "idle" }));
    abortRef.current?.abort();
  }, [knowledgeBaseId, limit]);

  const buildCacheKey = useCallback((query: string) => {
    const trimmed = query.trim();
    return JSON.stringify({
      q: trimmed,
      kb: paramsRef.current.knowledgeBaseId,
      limit: paramsRef.current.limit,
    });
  }, []);

  const readCache = useCallback((key: string) => {
    const cache = cacheRef.current.get(key);
    if (!cache) {
      return null;
    }

    if (Date.now() - cache.timestamp > CACHE_TTL_MS) {
      cacheRef.current.delete(key);
      return null;
    }

    return cache.payload;
  }, []);

  const writeCache = useCallback((key: string, payload: SuggestResponsePayload) => {
    cacheRef.current.set(key, { payload, timestamp: Date.now() });
    if (cacheRef.current.size > CACHE_LIMIT) {
      const oldestKey = cacheRef.current.keys().next().value as string | undefined;
      if (oldestKey) {
        cacheRef.current.delete(oldestKey);
      }
    }
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    setState({ status: "idle", data: null, error: null });
  }, []);

  const requestSuggest = useCallback(
    async (query: string, { silent }: { silent?: boolean } = {}) => {
      const { knowledgeBaseId: kbId, limit: currentLimit } = paramsRef.current;
      const trimmedQuery = query.trim();

      if (!kbId || !trimmedQuery) {
        if (!silent) {
          setState((prev) => ({ ...prev, data: null, error: null, status: "idle" }));
        }
        return;
      }

      const cacheKey = buildCacheKey(trimmedQuery);
      const cached = readCache(cacheKey);
      if (cached) {
        if (!silent) {
          setState({ status: "success", data: cached, error: null });
        }
        return;
      }

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      if (!silent) {
        setState({ status: "loading", data: null, error: null });
      }

      try {
        const params = new URLSearchParams({ q: trimmedQuery, kb_id: kbId, limit: String(currentLimit) });
        const response = await fetch(`/public/search/suggest?${params.toString()}`, {
          signal: controller.signal,
        });

        if (!response.ok) {
          const fallbackMessage =
            response.status === 404
              ? "База знаний не найдена или недоступна."
              : "Не удалось получить подсказки.";
          const errorText = await response
            .clone()
            .text()
            .catch(() => "");
          const payload = errorText?.trim() ? `${fallbackMessage} ${errorText}` : fallbackMessage;
          throw new Error(`${payload} (код ${response.status})`);
        }

        const json = (await response.json()) as SuggestResponsePayload;
        writeCache(cacheKey, json);

        if (!silent) {
          setState({ status: "success", data: json, error: null });
        }
      } catch (error) {
        if ((error as Error).name === "AbortError") {
          return;
        }

        console.error("Suggest request failed", error);
        if (!silent) {
          const message = error instanceof Error && error.message ? error.message : "Не удалось получить подсказки.";
          setState({ status: "error", data: null, error: message });
        }
      }
    },
    [buildCacheKey, readCache, writeCache],
  );

  const search = useCallback(
    (query: string) => {
      void requestSuggest(query, { silent: false });
    },
    [requestSuggest],
  );

  const prefetch = useCallback(
    (query: string) => {
      void requestSuggest(query, { silent: true });
    },
    [requestSuggest],
  );

  return {
    status: state.status,
    data: state.data,
    error: state.error,
    search,
    prefetch,
    reset,
  };
}
