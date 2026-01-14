import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type { KnowledgeBaseIndexingAction } from "@shared/schema";

export function useKnowledgeBaseIndexingStatus(
  workspaceId: string | null,
  baseId: string | null,
  actionId?: string | null,
  options?: { enabled?: boolean; refetchInterval?: number },
) {
  return useQuery<KnowledgeBaseIndexingAction | null>({
    queryKey: ["/api/knowledge/bases", baseId, "indexing/actions/status", actionId],
    queryFn: async () => {
      if (!workspaceId || !baseId) {
        return null;
      }

      const url = new URL(`/api/knowledge/bases/${baseId}/indexing/actions/status`, window.location.origin);
      if (actionId) {
        url.searchParams.set("actionId", actionId);
      }

      const res = await apiRequest("GET", url.pathname + url.search);
      if (!res.ok) {
        if (res.status === 404) {
          return null;
        }
        throw new Error("Не удалось получить статус индексации");
      }
      return (await res.json()) as KnowledgeBaseIndexingAction;
    },
    enabled: Boolean(workspaceId && baseId && (options?.enabled !== false)),
    refetchInterval: options?.refetchInterval ?? (query => {
      const data = query.state.data;
      // Если статус processing, опрашиваем каждые 2 секунды
      if (data?.status === "processing") {
        return 2000;
      }
      // Если завершено или ошибка, не опрашиваем
      return false;
    }),
  });
}

