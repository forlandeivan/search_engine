import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

export type EmbeddingProviderModelsResponse = {
  providerId: string;
  providerName: string;
  supportsModelSelection: boolean;
  defaultModel: string | null;
  models: string[];
  isConfigured: boolean;
  statusReason?: string;
};

export function useEmbeddingProviderModels(
  providerId: string | null | undefined,
  options?: { enabled?: boolean; workspaceId?: string },
) {
  const isEnabled = Boolean(providerId) && (options?.enabled ?? true);
  return useQuery<EmbeddingProviderModelsResponse>({
    queryKey: ["/api/admin/embeddings/providers", providerId, "models", options?.workspaceId],
    enabled: isEnabled,
    queryFn: async () => {
      const res = await apiRequest(
        "GET",
        `/api/admin/embeddings/providers/${encodeURIComponent(providerId!)}/models`,
        undefined,
        undefined,
        options?.workspaceId ? { workspaceId: options.workspaceId } : undefined,
      );
      if (!res.ok) {
        throw new Error(`Не удалось загрузить модели: ${res.status}`);
      }
      return (await res.json()) as EmbeddingProviderModelsResponse;
    },
  });
}
