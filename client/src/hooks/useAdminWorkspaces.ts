import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

interface AdminWorkspaceSummary {
  id: string;
  name: string | null;
}

interface AdminWorkspacesResponse {
  workspaces: Array<{
    id: string;
    name: string | null;
  }>;
}

const ADMIN_WORKSPACES_QUERY_KEY = ["admin", "workspaces", "summary"] as const;

async function fetchAdminWorkspaces(): Promise<AdminWorkspaceSummary[]> {
  const response = await apiRequest("GET", "/api/admin/workspaces");
  const payload = (await response.json()) as AdminWorkspacesResponse;
  return payload.workspaces?.map((workspace) => ({
    id: workspace.id,
    name: workspace.name ?? null,
  })) ?? [];
}

export function useAdminWorkspaces(options: { enabled?: boolean } = {}) {
  const { enabled = true } = options;
  const query = useQuery<AdminWorkspaceSummary[], Error>({
    queryKey: ADMIN_WORKSPACES_QUERY_KEY,
    queryFn: fetchAdminWorkspaces,
    enabled,
    staleTime: 5 * 60 * 1000,
  });

  return {
    workspaces: query.data ?? [],
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
}
