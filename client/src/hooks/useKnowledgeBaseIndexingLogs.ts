import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type { IndexingLogResponse } from "@shared/schema";

async function fetchIndexingLogs(
  baseId: string,
  actionId: string,
): Promise<IndexingLogResponse> {
  const response = await apiRequest("GET", `/api/knowledge/bases/${baseId}/indexing/actions/${actionId}/logs`);
  if (!response.ok) {
    throw new Error("Не удалось загрузить лог индексации");
  }

  return (await response.json()) as IndexingLogResponse;
}

export function useKnowledgeBaseIndexingLogs(
  baseId: string | null,
  actionId: string | null,
  options?: { enabled?: boolean },
) {
  return useQuery<IndexingLogResponse, Error>({
    queryKey: ["/api/knowledge/bases", baseId, "indexing/actions", actionId, "logs"],
    queryFn: () => fetchIndexingLogs(baseId!, actionId!),
    enabled: Boolean(baseId && actionId) && (options?.enabled !== false),
  });
}
