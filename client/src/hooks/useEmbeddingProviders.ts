import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

export type EmbeddingProviderOption = {
  id: string;
  displayName: string;
  providerType: string;
  model: string;
  isActive: boolean;
  isConfigured: boolean;
  statusReason?: string;
};

type ProvidersResponse = {
  providers: EmbeddingProviderOption[];
};

export function useEmbeddingProviders() {
  return useQuery<EmbeddingProviderOption[]>({
    queryKey: ["/api/admin/embeddings/providers"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/admin/embeddings/providers");
      const data = (await res.json()) as ProvidersResponse;
      return data.providers ?? [];
    },
  });
}
