import { QueryClient, QueryFunction } from "@tanstack/react-query";
import type { SessionResponse } from "@/types/session";

function resolveWorkspaceIdFromCache(): string | null {
  const session = queryClient.getQueryData<SessionResponse>(["/api/auth/session"]);
  return session?.workspace?.active?.id ?? session?.activeWorkspaceId ?? null;
}

async function throwIfResNotOk(res: Response) {
  if (res.ok) {
    return;
  }

  const rawText = await res.text();
  const text = rawText.trim();
  let errorMessage = text || res.statusText;

  if (text.startsWith("{") || text.startsWith("[")) {
    try {
      const parsed = JSON.parse(text);

      if (parsed && typeof parsed === "object") {
        const asRecord = parsed as Record<string, unknown>;
        const messageParts: string[] = [];

        if (typeof asRecord.error === "string" && asRecord.error.trim().length > 0) {
          messageParts.push(asRecord.error.trim());
        }

        if (typeof asRecord.details === "string" && asRecord.details.trim().length > 0) {
          messageParts.push(asRecord.details.trim());
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

  throw new Error(`${res.status}: ${errorMessage}`);
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
  headers?: Record<string, string>,
  options?: { signal?: AbortSignal; workspaceId?: string },
): Promise<Response> {
  const resolvedWorkspaceId = options?.workspaceId ?? resolveWorkspaceIdFromCache();
  const resolvedHeaders: Record<string, string> = {
    "Content-Type": "application/json",
    ...headers,
  };

  if (
    resolvedWorkspaceId &&
    !("X-Workspace-Id" in resolvedHeaders) &&
    !("x-workspace-id" in resolvedHeaders)
  ) {
    resolvedHeaders["X-Workspace-Id"] = resolvedWorkspaceId;
  }

  const res = await fetch(url, {
    method,
    headers: resolvedHeaders,
    body: data ? JSON.stringify(data) : undefined,
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

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
