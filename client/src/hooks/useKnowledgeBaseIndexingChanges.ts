import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type { KnowledgeBaseIndexingChangesResponse } from "@shared/knowledge-base";

export function useKnowledgeBaseIndexingChanges(
  workspaceId: string | null,
  baseId: string | null,
  options?: { limit?: number; offset?: number; enabled?: boolean },
) {
  const limit = options?.limit;
  const offset = options?.offset;

  return useQuery<KnowledgeBaseIndexingChangesResponse | null>({
    queryKey: ["/api/knowledge/bases", baseId, "indexing", "changes", limit ?? 50, offset ?? 0],
    queryFn: async () => {
      if (!workspaceId || !baseId) {
        return null;
      }

      const url = new URL(`/api/knowledge/bases/${baseId}/indexing/changes`, window.location.origin);
      if (typeof limit === "number") {
        url.searchParams.set("limit", String(limit));
      }
      if (typeof offset === "number") {
        url.searchParams.set("offset", String(offset));
      }

      const res = await apiRequest("GET", url.pathname + url.search);
      if (!res.ok) {
        if (res.status === 404) {
          return null;
        }
        throw new Error("Не удалось получить список изменений индексации");
      }

      return (await res.json()) as KnowledgeBaseIndexingChangesResponse;
    },
    enabled: Boolean(workspaceId && baseId && (options?.enabled !== false)),
  });
}
