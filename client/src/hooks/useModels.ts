import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

export type PublicModel = {
  id: string;
  key: string;
  displayName: string;
  description?: string | null;
  modelType: "LLM" | "EMBEDDINGS" | "ASR";
  consumptionUnit: "TOKENS_1K" | "MINUTES";
  costLevel: "FREE" | "LOW" | "MEDIUM" | "HIGH" | "VERY_HIGH";
};

type ModelsResponse = {
  models: PublicModel[];
};

export function useModels(modelType?: PublicModel["modelType"] | null) {
  return useQuery<PublicModel[]>({
    queryKey: ["/api/models", modelType ?? "all"],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (modelType) params.set("type", modelType);
      const res = await apiRequest("GET", `/api/models${params.toString() ? `?${params.toString()}` : ""}`);
      const data = (await res.json()) as ModelsResponse;
      return data.models ?? [];
    },
  });
}

export function useModelByKey(modelKey?: string | null, modelType?: PublicModel["modelType"] | null) {
  const { data } = useModels(modelType);
  if (!modelKey || !data) return null;
  return data.find((m) => m.key === modelKey) ?? null;
}
