import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type { KnowledgeBaseIndexingPolicyDto } from "@shared/knowledge-base-indexing-policy";

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

/**
 * Хук для получения политики индексации конкретной базы знаний
 */
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

/**
 * Хук для получения глобальной политики индексации (для админки)
 */
export function useGlobalKnowledgeBaseIndexingPolicy() {
  return useQuery<KnowledgeBaseIndexingPolicyDto>({
    queryKey: ["global-knowledge-base-indexing-policy"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/admin/knowledge-base-indexing-policy");
      if (!res.ok) {
        throw new Error("Не удалось загрузить политику индексации");
      }
      return (await res.json()) as KnowledgeBaseIndexingPolicyDto;
    },
  });
}

/**
 * Хук для обновления глобальной политики индексации (для админки)
 */
export function useUpdateKnowledgeBaseIndexingPolicy() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: KnowledgeBaseIndexingPolicyDto) => {
      const res = await apiRequest("PUT", "/api/admin/knowledge-base-indexing-policy", payload);
      if (!res.ok) {
        const error = await res.json().catch(() => ({ message: "Не удалось обновить политику индексации" }));
        throw new Error(error.message || "Не удалось обновить политику индексации");
      }
      return (await res.json()) as KnowledgeBaseIndexingPolicyDto;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["global-knowledge-base-indexing-policy"], data);
    },
  });
}
