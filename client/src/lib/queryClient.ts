import { QueryClient, QueryFunction } from "@tanstack/react-query";
import type { SessionResponse } from "@/types/session";

export class ApiError extends Error {
  code?: string;
  status?: number;
  details?: unknown;
  constructor(message: string, opts?: { code?: string; status?: number; details?: unknown }) {
    super(message);
    this.name = "ApiError";
    this.code = opts?.code;
    this.status = opts?.status;
    this.details = opts?.details;
  }
}

// Инициализируем queryClient ПЕРЕД использованием в функциях
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: 60 * 1000, // 1 minute by default
      gcTime: 5 * 60 * 1000, // 5 minutes in cache (previously cacheTime)
      retry: 1, // Allow 1 retry for transient errors
    },
    mutations: {
      retry: false,
    },
  },
});

function resolveWorkspaceIdFromCache(): string | null {
  try {
    // Проверяем, что queryClient инициализирован
    if (!queryClient) {
      return null;
    }
    const session = queryClient.getQueryData<SessionResponse>(["/api/auth/session"]);
    return session?.workspace?.active?.id ?? session?.activeWorkspaceId ?? null;
  } catch (error) {
    // Если queryClient еще не инициализирован, возвращаем null
    return null;
  }
}

export async function throwIfResNotOk(res: Response) {
  if (res.ok) {
    return;
  }

  const rawText = await res.text();
  const text = rawText.trim();
  let errorMessage = text || res.statusText;
  let errorCode: string | undefined;
  let details: unknown;

  if (text.startsWith("{") || text.startsWith("[")) {
    try {
      const parsed = JSON.parse(text);

      if (parsed && typeof parsed === "object") {
        const asRecord = parsed as Record<string, unknown>;
        const messageParts: string[] = [];

        if (typeof asRecord.error === "string" && asRecord.error.trim().length > 0) {
          messageParts.push(asRecord.error.trim());
        }

        if (typeof asRecord.message === "string" && asRecord.message.trim().length > 0) {
          messageParts.push(asRecord.message.trim());
        }

        if (typeof asRecord.details === "string" && asRecord.details.trim().length > 0) {
          messageParts.push(asRecord.details.trim());
        }

        if (typeof asRecord.errorCode === "string" && asRecord.errorCode.trim().length > 0) {
          errorCode = asRecord.errorCode;
        }

        if (asRecord.details !== undefined) {
          details = asRecord.details;
        }

        if (messageParts.length > 0) {
          errorMessage = messageParts.join(" — ");
        }
      }
    } catch {
      // Игнорируем ошибки парсинга и используем исходный текст
    }
  } else if (text.startsWith("<")) {
    // HTML-ответы от прокси не информативны, используем статус
    errorMessage = res.statusText || "Неизвестная ошибка";
  }

  throw new ApiError(errorMessage ? `${errorMessage}` : `${res.status}: ${errorMessage}`, {
    code: errorCode,
    status: res.status,
    details,
  });
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
  headers?: Record<string, string>,
  options?: { signal?: AbortSignal; workspaceId?: string },
): Promise<Response> {
  const resolvedWorkspaceId = options?.workspaceId ?? resolveWorkspaceIdFromCache();
  const isFormData = typeof FormData !== "undefined" && data instanceof FormData;
  const resolvedHeaders: Record<string, string> = {
    "Content-Type": isFormData ? undefined! : "application/json",
    ...headers,
  };

  if (isFormData) {
    // Let the browser set correct multipart boundaries
    delete resolvedHeaders["Content-Type"];
  }

  // Set workspace header if we have a valid workspace ID (not empty string)
  if (
    resolvedWorkspaceId &&
    resolvedWorkspaceId.trim() !== "" &&
    !("X-Workspace-Id" in resolvedHeaders) &&
    !("x-workspace-id" in resolvedHeaders)
  ) {
    resolvedHeaders["X-Workspace-Id"] = resolvedWorkspaceId;
  }

  const res = await fetch(url, {
    method,
    headers: resolvedHeaders,
    body: data
      ? isFormData
        ? (data as BodyInit)
        : JSON.stringify(data)
      : undefined,
    credentials: "include",
    signal: options?.signal,
  });

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const workspaceId = resolveWorkspaceIdFromCache();
    const res = await fetch(queryKey.join("/") as string, {
      credentials: "include",
      headers: workspaceId ? { "X-Workspace-Id": workspaceId } : undefined,
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

// Обновляем queryClient с queryFn после его создания
// Используем setDefaultOptions для установки queryFn
const currentOptions = queryClient.getDefaultOptions();
queryClient.setDefaultOptions({
  queries: {
    ...currentOptions.queries,
    queryFn: getQueryFn({ on401: "throw" }),
  },
});

// Specific staleTime options for different query types
export const queryOptions = {
  chatMessages: { staleTime: 10 * 1000 },     // 10 seconds
  chatList: { staleTime: 30 * 1000 },         // 30 seconds
  workspaceSettings: { staleTime: 5 * 60 * 1000 }, // 5 minutes
  skillsList: { staleTime: 2 * 60 * 1000 },   // 2 minutes
  modelsCatalog: { staleTime: 10 * 60 * 1000 }, // 10 minutes
};
