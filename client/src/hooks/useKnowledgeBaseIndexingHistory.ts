import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type { IndexingHistoryResponse } from "@shared/schema";

const DEFAULT_LIMIT = 25;

async function fetchIndexingHistory(
  baseId: string,
  limit: number = DEFAULT_LIMIT,
): Promise<IndexingHistoryResponse> {
  const params = new URLSearchParams();
  params.set("limit", String(limit));

  const response = await apiRequest("GET", `/api/knowledge/bases/${baseId}/indexing/actions/history?${params}`);
  if (!response.ok) {
    throw new Error("Не удалось загрузить историю индексаций");
  }

  return (await response.json()) as IndexingHistoryResponse;
}

export function useKnowledgeBaseIndexingHistory(
  baseId: string | null,
  limit: number = DEFAULT_LIMIT,
  options?: { enabled?: boolean },
) {
  return useQuery<IndexingHistoryResponse, Error>({
    queryKey: ["/api/knowledge/bases", baseId, "indexing/actions/history", limit],
    queryFn: () => fetchIndexingHistory(baseId!, limit),
    enabled: Boolean(baseId) && (options?.enabled !== false),
  });
}
