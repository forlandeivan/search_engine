import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type { KnowledgeBaseIndexStatus } from "@shared/schema";

export type StartKnowledgeBaseIndexingMode = "full" | "changed";

export type StartKnowledgeBaseIndexingResponse = {
  jobCount: number;
  actionId?: string;
  status?: KnowledgeBaseIndexStatus;
};

export function useStartKnowledgeBaseIndexing() {
  const queryClient = useQueryClient();

  return useMutation<
    StartKnowledgeBaseIndexingResponse,
    Error,
    { baseId: string; mode?: StartKnowledgeBaseIndexingMode }
  >({
    mutationFn: async ({ baseId, mode }) => {
      const url = new URL(`/api/knowledge/bases/${baseId}/index`, window.location.origin);
      if (mode) {
        url.searchParams.set("mode", mode);
      }
      const res = await apiRequest("POST", url.pathname + url.search);
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

