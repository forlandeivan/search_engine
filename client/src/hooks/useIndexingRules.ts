import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type { IndexingRulesDto, UpdateIndexingRulesDto } from "@shared/indexing-rules";

export const INDEXING_RULES_QUERY_KEY = ["/api/admin/indexing-rules"];

export function useIndexingRules() {
  return useQuery<IndexingRulesDto>({
    queryKey: INDEXING_RULES_QUERY_KEY,
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/admin/indexing-rules");
      return (await res.json()) as IndexingRulesDto;
    },
  });
}

export function useUpdateIndexingRules() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: UpdateIndexingRulesDto | IndexingRulesDto) => {
      const res = await apiRequest("PUT", "/api/admin/indexing-rules", payload);
      return (await res.json()) as IndexingRulesDto;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(INDEXING_RULES_QUERY_KEY, data);
    },
  });
}
