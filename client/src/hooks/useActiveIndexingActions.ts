import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type { KnowledgeBaseIndexingAction } from "@shared/schema";

export type ActiveIndexingAction = KnowledgeBaseIndexingAction & {
  baseName: string;
};

export function useActiveIndexingActions(workspaceId: string | null) {
  return useQuery<ActiveIndexingAction[]>({
    queryKey: ["/api/knowledge/indexing/active", workspaceId],
    queryFn: async () => {
      if (!workspaceId) {
        return [];
      }

      const res = await apiRequest("GET", "/api/knowledge/indexing/active");
      if (!res.ok) {
        if (res.status === 404) {
          return [];
        }
        throw new Error("Не удалось получить активные индексации");
      }
      const data = (await res.json()) as { actions: ActiveIndexingAction[] };
      return data.actions;
    },
    enabled: Boolean(workspaceId),
    refetchInterval: 2000, // Опрашиваем каждые 2 секунды, если есть workspaceId
  });
}
