import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type { KnowledgeBaseIndexStatus } from "@shared/schema";
import type { StartIndexingWithConfigRequest } from "@shared/knowledge-base-indexing";

export type StartKnowledgeBaseIndexingMode = "full" | "changed";

export type StartKnowledgeBaseIndexingResponse = {
  jobCount: number;
  actionId?: string;
  status?: KnowledgeBaseIndexStatus;
  documentIds?: string[];
};

export function useStartKnowledgeBaseIndexing() {
  const queryClient = useQueryClient();

  return useMutation<
    StartKnowledgeBaseIndexingResponse,
    Error,
    StartIndexingWithConfigRequest & { baseId: string }
  >({
    mutationFn: async ({ baseId, mode, config }) => {
      const res = await apiRequest("POST", `/api/knowledge/bases/${baseId}/index`, {
        mode,
        config,
      });
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

