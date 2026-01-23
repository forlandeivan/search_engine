/**
 * Dashboard Service
 * 
 * Helper functions for dashboard-summary API endpoint
 */

import { db } from './db';
import { skills, actions, chatSessions, knowledgeBases, workspaceMembers } from '../shared/schema';
import { eq, and, gt, desc, sql } from 'drizzle-orm';
import { storage } from './storage';
import type { WorkspaceMemberRole } from '../shared/schema';

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

/**
 * Get skills summary
 */
export async function getSkillsSummary(workspaceId: string) {
  const skillsList = await storage.listSkills(workspaceId);
  
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const recentCount = skillsList.filter(s => new Date(s.createdAt) > weekAgo).length;
  
  return {
    count: skillsList.length,
    recentCount,
  };
}

/**
 * Get actions summary
 */
export async function getActionsSummary(workspaceId: string) {
  const actionsList = await storage.listWorkspaceActions(workspaceId, { includeSystem: true });
  const activeCount = actionsList.filter(a => a.status === 'active').length;
  
  return {
    count: actionsList.length,
    activeCount,
  };
}

/**
 * Get chats summary
 */
export async function getChatsSummary(workspaceId: string, userId: string) {
  const chatsList = await storage.listChatSessions(workspaceId, userId, { includeArchived: false });
  
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayChats = chatsList.filter(c => new Date(c.createdAt) >= today);
  
  // Get skill names for recent chats
  const recent = chatsList
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, 5);
  
  // Fetch skill names
  const skillIds = recent.map(c => c.skillId).filter((id): id is string => id !== null);
  const skillsMap = new Map<string, string>();
  
  if (skillIds.length > 0) {
    const skillsList = await storage.listSkills(workspaceId);
    skillsList.forEach(skill => {
      skillsMap.set(skill.id, skill.name);
    });
  }
  
  return {
    totalCount: chatsList.length,
    todayCount: todayChats.length,
    recent: recent.map(c => ({
      id: c.id,
      title: c.title,
      skillId: c.skillId,
      skillName: c.skillId ? skillsMap.get(c.skillId) ?? null : null,
      updatedAt: c.updatedAt instanceof Date ? c.updatedAt.toISOString() : String(c.updatedAt),
    })),
  };
}

/**
 * Get knowledge bases summary
 */
export async function getKnowledgeBasesSummary(workspaceId: string) {
  const bases = await storage.listKnowledgeBases(workspaceId);
  const indexingCount = bases.filter(b => b.indexingStatus === 'indexing' || b.indexingStatus === 'processing').length;
  
  return {
    count: bases.length,
    indexingCount,
  };
}

/**
 * Get members summary
 */
export async function getMembersSummary(workspaceId: string) {
  const members = await storage.listWorkspaceMembers(workspaceId);
  
  return {
    count: members.length,
  };
}

/**
 * Get credits summary (owner/manager only)
 */
export async function getCreditsSummary(workspaceId: string) {
  try {
    const { getWorkspaceCreditSummary } = await import('./credit-summary-service');
    const summary = await getWorkspaceCreditSummary(workspaceId);
    
    const usedPercent = Math.round(
      ((summary.planLimit.amount - summary.currentBalance) / summary.planLimit.amount) * 100
    );
    
    return {
      balance: summary.currentBalance,
      usedPercent,
      nextTopUpAt: summary.nextRefreshAt ? summary.nextRefreshAt.toISOString() : null,
      planIncludedCredits: summary.planLimit.amount,
    };
  } catch (error) {
    console.error('[dashboard-service] Failed to get credits summary:', error);
    return null;
  }
}

/**
 * Get usage summary (owner/manager only)
 */
export async function getUsageSummary(workspaceId: string) {
  try {
    const {
      getWorkspaceLlmUsageSummary,
      getWorkspaceAsrUsageSummary,
      getWorkspaceEmbeddingUsageSummary,
      getWorkspaceStorageUsageSummary,
    } = await import('./usage/usage-service');
    
    const [llmUsage, asrUsage, embeddingsUsage, storageUsage] = await Promise.all([
      getWorkspaceLlmUsageSummary(workspaceId).catch(() => ({ totalTokens: 0 })),
      getWorkspaceAsrUsageSummary(workspaceId).catch(() => ({ totalMinutes: 0, totalDuration: 0 })),
      getWorkspaceEmbeddingUsageSummary(workspaceId).catch(() => ({ totalTokens: 0 })),
      getWorkspaceStorageUsageSummary(workspaceId).catch(() => ({ totalBytes: 0 })),
    ]);
    
    return {
      llmTokens: llmUsage.totalTokens ?? 0,
      asrMinutes: asrUsage.totalMinutes ?? asrUsage.totalDuration ?? 0,
      embeddingsTokens: embeddingsUsage.totalTokens ?? 0,
      storageBytes: storageUsage.totalBytes ?? 0,
    };
  } catch (error) {
    console.error('[dashboard-service] Failed to get usage summary:', error);
    return null;
  }
}

/**
 * Get system status (owner/manager only)
 */
export async function getSystemStatus(workspaceId: string) {
  try {
    // For now, return a simplified status
    // TODO: Implement actual indexing tasks tracking
    const indexingTasks: Array<{
      knowledgeBaseId: string;
      knowledgeBaseName: string;
      progress?: number;
      status: string;
    }> = [];
    
    // Get LLM errors count for last 24 hours
    let llmErrorsCount = 0;
    try {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const executions = await storage.listLlmExecutions?.({
        workspaceId,
        status: 'error',
        since,
        limit: 1,
      });
      llmErrorsCount = executions?.pagination?.total ?? 0;
    } catch {
      // If method doesn't exist or fails, default to 0
      llmErrorsCount = 0;
    }
    
    const providerIssues: string[] = [];
    
    return {
      indexingTasks,
      llmErrorsLast24h: llmErrorsCount,
      providerIssues,
      allHealthy: indexingTasks.length === 0 && llmErrorsCount === 0 && providerIssues.length === 0,
    };
  } catch (error) {
    console.error('[dashboard-service] Failed to get system status:', error);
    return null;
  }
}

/**
 * Get complete dashboard summary
 */
export async function getDashboardSummary(
  workspaceId: string,
  userId: string,
  userRole: WorkspaceMemberRole
): Promise<DashboardSummaryResponse> {
  const isAdminOrManager = userRole === 'owner' || userRole === 'manager';
  
  // Fetch all data in parallel
  const [
    skillsData,
    actionsData,
    chatsData,
    knowledgeBasesData,
    membersData,
    creditsData,
    usageData,
    systemStatusData,
  ] = await Promise.all([
    getSkillsSummary(workspaceId),
    getActionsSummary(workspaceId),
    getChatsSummary(workspaceId, userId),
    getKnowledgeBasesSummary(workspaceId),
    getMembersSummary(workspaceId),
    isAdminOrManager ? getCreditsSummary(workspaceId) : Promise.resolve(null),
    isAdminOrManager ? getUsageSummary(workspaceId) : Promise.resolve(null),
    isAdminOrManager ? getSystemStatus(workspaceId) : Promise.resolve(null),
  ]);
  
  return {
    resources: {
      skills: skillsData,
      actions: actionsData,
      chats: chatsData,
      knowledgeBases: knowledgeBasesData,
      members: membersData,
    },
    credits: creditsData ?? undefined,
    usage: usageData ?? undefined,
    systemStatus: systemStatusData ?? undefined,
    generatedAt: new Date().toISOString(),
    workspaceId,
    userRole,
  };
}
