import { useQuery, type UseQueryOptions } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type { WorkspaceMemberRole } from "@shared/schema";

// =============================================================================
// Types
// =============================================================================

export type DashboardSummaryResponse = {
  resources: {
    skills: {
      count: number;
      recentCount: number;
    };
    actions: {
      count: number;
      activeCount: number;
    };
    chats: {
      totalCount: number;
      todayCount: number;
      recent: Array<{
        id: string;
        title: string | null;
        skillId: string | null;
        skillName: string | null;
        updatedAt: string;
      }>;
    };
    knowledgeBases: {
      count: number;
      indexingCount: number;
    };
    members: {
      count: number;
    };
  };
  credits?: {
    balance: number;
    usedPercent: number;
    nextTopUpAt: string | null;
    planIncludedCredits: number;
  };
  usage?: {
    llmTokens: number;
    asrMinutes: number;
    embeddingsTokens: number;
    storageBytes: number;
  };
  systemStatus?: {
    indexingTasks: Array<{
      knowledgeBaseId: string;
      knowledgeBaseName: string;
      progress?: number;
      status: string;
    }>;
    llmErrorsLast24h: number;
    providerIssues: string[];
    allHealthy: boolean;
  };
  generatedAt: string;
  workspaceId: string;
  userRole: WorkspaceMemberRole;
};

// =============================================================================
// Hook
// =============================================================================

type UseDashboardSummaryOptions = {
  enabled?: boolean;
  refetchInterval?: number;
};

/**
 * Hook для получения сводки Dashboard через единый оптимизированный endpoint
 * 
 * @param workspaceId - ID workspace
 * @param options - Опции запроса
 * @returns Query result с полными данными для Dashboard
 */
export function useDashboardSummary(
  workspaceId: string | null,
  options?: UseDashboardSummaryOptions
) {
  return useQuery<DashboardSummaryResponse>({
    queryKey: ["dashboard-summary", workspaceId],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/workspaces/${workspaceId}/dashboard-summary`);
      return res.json();
    },
    enabled: options?.enabled !== false && Boolean(workspaceId),
    staleTime: 30 * 1000, // 30 секунд - соответствует Cache-Control
    refetchInterval: options?.refetchInterval ?? 60 * 1000, // По умолчанию обновлять каждую минуту
  });
}
