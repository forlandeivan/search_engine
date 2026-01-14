import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

export type StartKnowledgeBaseIndexingResponse = {
  message: string;
  jobCount: number;
};

export function useStartKnowledgeBaseIndexing() {
  const queryClient = useQueryClient();

  return useMutation<StartKnowledgeBaseIndexingResponse, Error, { baseId: string }>({
    mutationFn: async ({ baseId }) => {
      const res = await apiRequest("POST", `/api/knowledge/bases/${baseId}/index`);
      if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        throw new Error(error.message ?? "Не удалось запустить индексацию");
      }
      return (await res.json()) as StartKnowledgeBaseIndexingResponse;
    },
    onSuccess: () => {
      // Invalidate queries to refresh the base data
      void queryClient.invalidateQueries({ queryKey: ["knowledge-bases"] });
    },
  });
}

