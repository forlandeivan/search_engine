import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

interface IndexingPolicyResponse {
  policy: {
    embeddingsProvider: string;
    embeddingsModel: string;
    chunkSize: number;
    chunkOverlap: number;
    defaultSchema: Array<{
      name: string;
      type: string;
      isArray: boolean;
      template: string;
    }>;
    policyHash: string | null;
    updatedAt: string;
  };
  hasCustomPolicy: boolean;
}

export function useKnowledgeBaseIndexingPolicy(baseId: string | null, workspaceId: string) {
  return useQuery<IndexingPolicyResponse>({
    queryKey: ["knowledge-base-indexing-policy", baseId, workspaceId],
    queryFn: async () => {
      if (!baseId) {
        throw new Error("baseId is required");
      }
      const res = await apiRequest("GET", `/api/knowledge/bases/${baseId}/indexing-policy`, undefined, undefined, {
        workspaceId,
      });
      if (!res.ok) {
        // Если политика не найдена, возвращаем hasCustomPolicy: false
        if (res.status === 404) {
          return { policy: null as any, hasCustomPolicy: false };
        }
        throw new Error("Не удалось загрузить политику индексации");
      }
      return (await res.json()) as IndexingPolicyResponse;
    },
    enabled: !!baseId && !!workspaceId,
  });
}
