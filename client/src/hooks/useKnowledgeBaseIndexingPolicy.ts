import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type { KnowledgeBaseIndexingPolicyDto, UpdateKnowledgeBaseIndexingPolicyDto } from "@shared/knowledge-base-indexing-policy";

export function useKnowledgeBaseIndexingPolicy() {
  return useQuery({
    queryKey: ["knowledge-base-indexing-policy"],
    queryFn: async (): Promise<KnowledgeBaseIndexingPolicyDto> => {
      const res = await apiRequest("GET", "/api/admin/knowledge-base-indexing-policy");
      return (await res.json()) as KnowledgeBaseIndexingPolicyDto;
    },
  });
}

export function useUpdateKnowledgeBaseIndexingPolicy() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: UpdateKnowledgeBaseIndexingPolicyDto): Promise<KnowledgeBaseIndexingPolicyDto> => {
      const res = await apiRequest("PUT", "/api/admin/knowledge-base-indexing-policy", data);
      return (await res.json()) as KnowledgeBaseIndexingPolicyDto;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["knowledge-base-indexing-policy"] });
    },
  });
}

