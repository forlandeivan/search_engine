import { useQuery } from "@tanstack/react-query";

import { apiRequest } from "@/lib/queryClient";
import type { MaintenanceModeStatusDto } from "@shared/maintenance-mode";

const DEFAULT_REFETCH_INTERVAL_MS = 60_000;
const MAINTENANCE_STATUS_QUERY_KEY = ["/api/maintenance/status"];

export type MaintenanceStatusState = {
  data?: MaintenanceModeStatusDto;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  status: MaintenanceModeStatusDto["status"] | "unknown";
};

export function useMaintenanceStatus(options?: {
  enabled?: boolean;
  refetchIntervalMs?: number;
}): MaintenanceStatusState {
  const query = useQuery<MaintenanceModeStatusDto, Error>({
    queryKey: MAINTENANCE_STATUS_QUERY_KEY,
    enabled: options?.enabled ?? true,
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/maintenance/status");
      return (await res.json()) as MaintenanceModeStatusDto;
    },
    refetchInterval: options?.refetchIntervalMs ?? DEFAULT_REFETCH_INTERVAL_MS,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: true,
    retry: 1,
  });

  return {
    data: query.data,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    status: query.data?.status ?? (query.isError ? "unknown" : "off"),
  };
}
