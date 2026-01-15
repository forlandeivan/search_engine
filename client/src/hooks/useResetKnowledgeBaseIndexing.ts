import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

export type ResetKnowledgeBaseIndexingResponse = {
  collectionName: string;
  deletedCollection: boolean;
  jobCount: number;
  actionId?: string;
};

type ResetKnowledgeBaseIndexingPayload = {
  baseId: string;
  deleteCollection?: boolean;
  reindex?: boolean;
};

export function useResetKnowledgeBaseIndexing() {
  const queryClient = useQueryClient();

  return useMutation<ResetKnowledgeBaseIndexingResponse, Error, ResetKnowledgeBaseIndexingPayload>({
    mutationFn: async ({ baseId, deleteCollection, reindex }) => {
      const res = await apiRequest("POST", `/api/knowledge/bases/${baseId}/indexing/reset`, {
        deleteCollection,
        reindex,
      });
      if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        throw new Error(error.message ?? "Не удалось сбросить индекс");
      }
      return (await res.json()) as ResetKnowledgeBaseIndexingResponse;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["knowledge-bases"] });
    },
  });
}
