import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type { KnowledgeBaseIndexingPolicyDto, UpdateKnowledgeBaseIndexingPolicyDto } from "@shared/knowledge-base-indexing-policy";

export function useKnowledgeBaseIndexingPolicy() {
  return useQuery({
    queryKey: ["knowledge-base-indexing-policy"],
    queryFn: async (): Promise<KnowledgeBaseIndexingPolicyDto> => {
      const response = await apiRequest<KnowledgeBaseIndexingPolicyDto>(
        "/api/admin/knowledge-base-indexing-policy",
        { method: "GET" },
      );
      return response;
    },
  });
}

export function useUpdateKnowledgeBaseIndexingPolicy() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: UpdateKnowledgeBaseIndexingPolicyDto): Promise<KnowledgeBaseIndexingPolicyDto> => {
      const response = await apiRequest<KnowledgeBaseIndexingPolicyDto>(
        "/api/admin/knowledge-base-indexing-policy",
        {
          method: "PUT",
          body: JSON.stringify(data),
        },
      );
      return response;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["knowledge-base-indexing-policy"] });
    },
  });
}

