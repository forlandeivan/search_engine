import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

export type AsrProvider = {
  id: string;
  displayName: string;
  asrProviderType: string;
  isEnabled: boolean;
  status: string;
};

export function useAsrProviders() {
  return useQuery({
    queryKey: ["asr-providers"],
    queryFn: async () => {
      const response = await apiRequest("GET", "/api/chat/transcribe/asr-providers");
      const data = await response.json();
      return data as AsrProvider[];
    },
  });
}
