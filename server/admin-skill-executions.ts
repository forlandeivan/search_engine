import type { JsonValue } from "./json-types";
import { storage } from "./storage";
import { getSkillById } from "./skills";
import { skillExecutionLogService } from "./skill-execution-log-context";
import type {
  SkillExecutionRecord,
  SkillExecutionSource,
  SkillExecutionStatus,
  SkillExecutionStepRecord,
  SkillExecutionStepStatus,
  SkillExecutionStepType,
} from "./skill-execution-log";

/**
 * Manual verification checklist:
 * 1. Enable skill execution logging and trigger several chats (success + error).
 * 2. Call GET /api/admin/llm-executions with different filters (status, hasError, workspace).
 * 3. Call GET /api/admin/llm-executions/:id and ensure steps + payloads look correct.
 * 4. Verify preview text, workspace/user/skill labels and pagination metadata.
 */

const USER_MESSAGE_PREVIEW_LIMIT = 160;

export interface AdminSkillExecutionListFilters {
  from?: Date;
  to?: Date;
  workspaceId?: string;
  skillId?: string;
  userId?: string;
  status?: SkillExecutionStatus;
  hasError?: boolean;
  page: number;
  pageSize: number;
}

export interface AdminSkillExecutionSummary {
  id: string;
  workspaceId: string;
  workspaceName: string | null;
  userId: string | null;
  userEmail: string | null;
  userName: string | null;
  skillId: string;
  skillName: string | null;
  skillIsSystem: boolean;
  chatId: string | null;
  status: SkillExecutionStatus;
  hasError: boolean;
  source: SkillExecutionSource;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  userMessageId: string | null;
  userMessagePreview: string | null;
}

export interface AdminSkillExecutionDetail {
  execution: AdminSkillExecutionSummary & { metadata?: JsonValue };
  steps: Array<{
    id: string;
    type: SkillExecutionStepType;
    status: SkillExecutionStepStatus;
    startedAt: string;
    finishedAt: string | null;
    errorCode?: string | null;
    errorMessage?: string | null;
    diagnosticInfo?: string | null;
    input: JsonValue;
    output: JsonValue;
  }>;
}

type WorkspaceMeta = { id: string; name: string | null };
type UserMeta = { id: string; name: string | null; email: string | null };
type SkillMeta = { key: string; name: string | null; isSystem: boolean };

export async function listAdminSkillExecutions(filters: AdminSkillExecutionListFilters) {
  const allExecutions = await skillExecutionLogService.listExecutions();
  const filtered = allExecutions.filter((execution) => matchesFilters(execution, filters));
  filtered.sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());

  const total = filtered.length;
  const page = filters.page;
  const pageSize = filters.pageSize;
  const offset = (page - 1) * pageSize;
  const pageSlice = filtered.slice(offset, offset + pageSize);

  const summaries = await enrichExecutions(pageSlice);

  return {
    items: summaries,
    page,
    pageSize,
    total,
  };
}

export async function getAdminSkillExecutionDetail(
  executionId: string,
): Promise<AdminSkillExecutionDetail | null> {
  const execution = await skillExecutionLogService.getExecutionById(executionId);
  if (!execution) {
    return null;
  }
  const [summary] = await enrichExecutions([execution]);
  const steps = await skillExecutionLogService.listExecutionSteps(executionId);

  return {
    execution: { ...summary, metadata: execution.metadata },
    steps: steps.map((step) => ({
      id: step.id,
      type: step.type,
      status: step.status,
      startedAt: step.startedAt.toISOString(),
      finishedAt: step.finishedAt ? step.finishedAt.toISOString() : null,
      errorCode: step.errorCode ?? null,
      errorMessage: step.errorMessage ?? null,
      diagnosticInfo: step.diagnosticInfo ?? null,
      input: step.inputPayload ?? null,
      output: step.outputPayload ?? null,
    })),
  };
}

function matchesFilters(execution: SkillExecutionRecord, filters: AdminSkillExecutionListFilters) {
  if (filters.from && execution.startedAt < filters.from) {
    return false;
  }
  if (filters.to && execution.startedAt > filters.to) {
    return false;
  }
  if (filters.workspaceId && execution.workspaceId !== filters.workspaceId) {
    return false;
  }
  if (filters.skillId && execution.skillId !== filters.skillId) {
    return false;
  }
  if (filters.userId && execution.userId !== filters.userId) {
    return false;
  }
  if (filters.status && execution.status !== filters.status) {
    return false;
  }
  if (typeof filters.hasError === "boolean" && execution.hasStepErrors !== filters.hasError) {
    return false;
  }
  return true;
}

async function enrichExecutions(executions: SkillExecutionRecord[]): Promise<AdminSkillExecutionSummary[]> {
  if (executions.length === 0) {
    return [];
  }

  const workspaceIds = new Set<string>();
  const userIds = new Set<string>();
  const skillPairs = new Set<string>();
  const messageIds = new Set<string>();

  for (const execution of executions) {
    workspaceIds.add(execution.workspaceId);
    if (execution.userId) {
      userIds.add(execution.userId);
    }
    skillPairs.add(`${execution.workspaceId}:${execution.skillId}`);
    if (execution.userMessageId) {
      messageIds.add(execution.userMessageId);
    }
  }

  const [workspaces, users, skills, messages] = await Promise.all([
    fetchWorkspaces(workspaceIds),
    fetchUsers(userIds),
    fetchSkills(skillPairs),
    fetchChatMessages(messageIds),
  ]);

  return executions.map((execution) => {
    const workspace = workspaces.get(execution.workspaceId);
    const user = execution.userId ? users.get(execution.userId) : null;
    const skill = skills.get(`${execution.workspaceId}:${execution.skillId}`);
    const userMessagePreview = execution.userMessageId
      ? messages.get(execution.userMessageId) ?? null
      : null;

    return {
      id: execution.id,
      workspaceId: execution.workspaceId,
      workspaceName: workspace?.name ?? null,
      userId: execution.userId ?? null,
      userEmail: user?.email ?? null,
      userName: user?.name ?? null,
      skillId: execution.skillId,
      skillName: skill?.name ?? null,
      skillIsSystem: skill?.isSystem ?? false,
      chatId: execution.chatId ?? null,
      status: execution.status,
      hasError: execution.hasStepErrors,
      source: execution.source,
      startedAt: execution.startedAt.toISOString(),
      finishedAt: execution.finishedAt ? execution.finishedAt.toISOString() : null,
      durationMs: execution.finishedAt ? execution.finishedAt.getTime() - execution.startedAt.getTime() : null,
      userMessageId: execution.userMessageId ?? null,
      userMessagePreview,
    };
  });
}

async function fetchWorkspaces(ids: Set<string>): Promise<Map<string, WorkspaceMeta>> {
  const entries = await Promise.all(
    Array.from(ids).map(async (id) => {
      try {
        const workspace = await storage.getWorkspace(id);
        return [id, { id, name: workspace?.name ?? null }] as const;
      } catch {
        return [id, { id, name: null }] as const;
      }
    }),
  );
  return new Map(entries);
}

async function fetchUsers(ids: Set<string>): Promise<Map<string, UserMeta>> {
  const entries = await Promise.all(
    Array.from(ids).map(async (id) => {
      try {
        const user = await storage.getUser(id);
        const displayName =
          user?.fullName?.trim() ||
          [user?.firstName ?? "", user?.lastName ?? ""].filter(Boolean).join(" ").trim() ||
          null;
        return [
          id,
          { id, name: displayName, email: user?.email ?? null },
        ] as const;
      } catch {
        return [id, { id, name: null, email: null }] as const;
      }
    }),
  );
  return new Map(entries);
}

async function fetchSkills(keys: Set<string>): Promise<Map<string, SkillMeta>> {
  const entries = await Promise.all(
    Array.from(keys).map(async (key) => {
      const [workspaceId, skillId] = key.split(":");
      try {
        const skill = await getSkillById(workspaceId, skillId);
        return [
          key,
          {
            key,
            name: skill?.name ?? null,
            isSystem: Boolean(skill?.isSystem),
          },
        ] as const;
      } catch {
        return [key, { key, name: null, isSystem: false }] as const;
      }
    }),
  );
  return new Map(entries);
}

async function fetchChatMessages(ids: Set<string>): Promise<Map<string, string | null>> {
  const entries = await Promise.all(
    Array.from(ids).map(async (id) => {
      try {
        const message = await storage.getChatMessage(id);
        const preview = message?.content
          ? message.content.slice(0, USER_MESSAGE_PREVIEW_LIMIT)
          : null;
        return [id, preview ?? null] as const;
      } catch {
        return [id, null] as const;
      }
    }),
  );
  return new Map(entries);
}
