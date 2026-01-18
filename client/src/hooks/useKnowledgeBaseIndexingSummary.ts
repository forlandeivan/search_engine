import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type { KnowledgeBaseIndexingSummary } from "@shared/knowledge-base";

export function useKnowledgeBaseIndexingSummary(
  workspaceId: string | null,
  baseId: string | null,
  options?: { enabled?: boolean },
) {
  return useQuery<KnowledgeBaseIndexingSummary | null>({
    queryKey: ["/api/knowledge/bases", baseId, "indexing", "summary"],
    queryFn: async () => {
      if (!workspaceId || !baseId) {
        return null;
      }

      const res = await apiRequest("GET", `/api/knowledge/bases/${baseId}/indexing/summary`, undefined, undefined, { workspaceId });
      if (!res.ok) {
        if (res.status === 404) {
          return null;
        }
        throw new Error("Не удалось получить сводку индексации");
      }

      return (await res.json()) as KnowledgeBaseIndexingSummary;
    },
    enabled: Boolean(workspaceId && baseId && (options?.enabled !== false)),
  });
}
