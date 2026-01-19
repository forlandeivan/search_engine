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
    refetchInterval: (query) => {
      const data = query.state.data;
      // Если есть активные индексации (processing или paused), опрашиваем каждые 2 секунды
      if (data && data.length > 0) {
        const hasActive = data.some(
          (action) => action.status === "processing" || action.status === "paused",
        );
        return hasActive ? 2000 : false;
      }
      return false;
    },
  });
}
