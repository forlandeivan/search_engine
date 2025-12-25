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

export function useEmbeddingProviderModels(providerId: string | null | undefined, options?: { enabled?: boolean }) {
  const isEnabled = Boolean(providerId) && (options?.enabled ?? true);
  return useQuery<EmbeddingProviderModelsResponse>({
    queryKey: ["/api/admin/embeddings/providers", providerId, "models"],
    enabled: isEnabled,
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/admin/embeddings/providers/${encodeURIComponent(providerId!)}/models`);
      return (await res.json()) as EmbeddingProviderModelsResponse;
    },
  });
}
