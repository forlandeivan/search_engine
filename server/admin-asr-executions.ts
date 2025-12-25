import { z } from "zod";
import type { JsonValue } from "./json-types";
import { storage } from "./storage";
import { getSkillById } from "./skills";
import { asrExecutionLogService } from "./asr-execution-log-context";
import type { AsrExecutionEvent, AsrExecutionRecord, AsrExecutionStatus } from "./asr-execution-log";
import { workspaceCreditLedger } from "@shared/schema";
import { db } from "./db";
import { and, eq, inArray, sql } from "drizzle-orm";

const DEFAULT_PAGE_SIZE = 20;

export const adminAsrExecutionsQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(200).default(DEFAULT_PAGE_SIZE),
  status: z
    .enum(["pending", "processing", "success", "failed"])
    .optional()
    .or(z.literal("").transform(() => undefined)),
  provider: z.string().optional(),
  workspaceId: z.string().optional(),
  chatId: z.string().optional(),
  skillId: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
});

export interface AdminAsrExecutionSummary {
  id: string;
  workspaceId: string | null;
  workspaceName: string | null;
  skillId: string | null;
  skillName: string | null;
  chatId: string | null;
  userMessageId: string | null;
  transcriptMessageId: string | null;
  transcriptId: string | null;
  provider: string | null;
  status: AsrExecutionStatus;
  language: string | null;
  fileName: string | null;
  fileSizeBytes: number | null;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  creditsChargedCents: number | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AdminAsrExecutionDetail {
  execution: AdminAsrExecutionSummary & { pipelineEvents?: AsrExecutionEvent[] };
}

export async function listAdminAsrExecutions(filters: {
  page: number;
  pageSize: number;
  status?: AsrExecutionStatus;
  provider?: string;
  workspaceId?: string;
  chatId?: string;
  skillId?: string;
  from?: Date;
  to?: Date;
}) {
  const all = await asrExecutionLogService.listExecutions();
  const filtered = all.filter((item) => matchesFilters(item, filters));
  filtered.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  const total = filtered.length;
  const page = filters.page;
  const pageSize = filters.pageSize;
  const offset = (page - 1) * pageSize;
  const slice = filtered.slice(offset, offset + pageSize);
  const summaries = await enrichExecutions(slice);

  return {
    items: summaries,
    total,
    page,
    pageSize,
  };
}

export async function getAdminAsrExecutionDetail(id: string): Promise<AdminAsrExecutionDetail | null> {
  const record = await asrExecutionLogService.getExecutionById(id);
  if (!record) return null;
  const [summary] = await enrichExecutions([record]);
  return { execution: { ...summary, pipelineEvents: record.pipelineEvents } };
}

function matchesFilters(
  execution: AsrExecutionRecord,
  filters: {
    status?: AsrExecutionStatus;
    provider?: string;
    workspaceId?: string;
    chatId?: string;
    skillId?: string;
    from?: Date;
    to?: Date;
  },
) {
  if (filters.status && execution.status !== filters.status) return false;
  if (filters.provider && execution.provider !== filters.provider) return false;
  if (filters.workspaceId && execution.workspaceId !== filters.workspaceId) return false;
  if (filters.chatId && execution.chatId !== filters.chatId) return false;
  if (filters.skillId && execution.skillId !== filters.skillId) return false;
  if (filters.from && execution.createdAt < filters.from) return false;
  if (filters.to && execution.createdAt > filters.to) return false;
  return true;
}

async function enrichExecutions(executions: AsrExecutionRecord[]): Promise<AdminAsrExecutionSummary[]> {
  if (executions.length === 0) return [];

  const workspaceIds = new Set<string>();
  const skillPairs = new Set<string>();
  const messageIds = new Set<string>();
  const executionIds = new Set<string>();

  for (const ex of executions) {
    executionIds.add(ex.id);
    if (ex.workspaceId) workspaceIds.add(ex.workspaceId);
    if (ex.skillId && ex.workspaceId) skillPairs.add(`${ex.workspaceId}:${ex.skillId}`);
    if (ex.userMessageId) messageIds.add(ex.userMessageId);
    if (ex.transcriptMessageId) messageIds.add(ex.transcriptMessageId);
  }

  const [workspaces, skills, messages] = await Promise.all([
    fetchWorkspaces(workspaceIds),
    fetchSkills(skillPairs),
    fetchMessages(messageIds),
  ]);
  const creditsByExecution = await fetchCreditsByExecution(executionIds);

  return executions.map((ex) => {
    const workspace = ex.workspaceId ? workspaces.get(ex.workspaceId) : null;
    const skill = ex.skillId && ex.workspaceId ? skills.get(`${ex.workspaceId}:${ex.skillId}`) : null;
    const start = ex.startedAt ? ex.startedAt.getTime() : null;
    const finish = ex.finishedAt ? ex.finishedAt.getTime() : null;
    const duration = start && finish ? finish - start : ex.durationMs ?? null;
    const creditsCharged = creditsByExecution.get(ex.id) ?? null;

    return {
      id: ex.id,
      workspaceId: ex.workspaceId,
      workspaceName: workspace?.name ?? null,
      skillId: ex.skillId,
      skillName: skill?.name ?? null,
      chatId: ex.chatId,
      userMessageId: ex.userMessageId,
      transcriptMessageId: ex.transcriptMessageId,
      transcriptId: ex.transcriptId,
      provider: ex.provider,
      status: ex.status,
      language: ex.language,
      fileName: ex.fileName,
      fileSizeBytes: ex.fileSizeBytes,
      startedAt: ex.startedAt ? ex.startedAt.toISOString() : null,
      finishedAt: ex.finishedAt ? ex.finishedAt.toISOString() : null,
      durationMs: duration,
      creditsChargedCents: creditsCharged,
      errorCode: ex.errorCode,
      errorMessage: ex.errorMessage,
      createdAt: ex.createdAt.toISOString(),
      updatedAt: ex.updatedAt.toISOString(),
    };
  });
}

async function fetchWorkspaces(ids: Set<string>) {
  const entries = await Promise.all(
    Array.from(ids).map(async (id) => {
      try {
        const ws = await storage.getWorkspace(id);
        return [id, { id, name: ws?.name ?? null }] as const;
      } catch {
        return [id, { id, name: null }] as const;
      }
    }),
  );
  return new Map(entries);
}

async function fetchSkills(keys: Set<string>) {
  const entries = await Promise.all(
    Array.from(keys).map(async (key) => {
      const [workspaceId, skillId] = key.split(":");
      try {
        const skill = await getSkillById(workspaceId, skillId);
        return [key, { key, name: skill?.name ?? null }] as const;
      } catch {
        return [key, { key, name: null }] as const;
      }
    }),
  );
  return new Map(entries);
}

async function fetchMessages(keys: Set<string>) {
  const entries = await Promise.all(
    Array.from(keys).map(async (id) => {
      try {
        const msg = await storage.getChatMessage(id);
        return [id, msg?.content ?? null] as const;
      } catch {
        return [id, null] as const;
      }
    }),
  );
  return new Map(entries);
}

async function fetchCreditsByExecution(ids: Set<string>): Promise<Map<string, number>> {
  if (ids.size === 0) return new Map();
  const rows = await db
    .select({
      sourceRef: workspaceCreditLedger.sourceRef,
      total: sql<number>`coalesce(sum(${workspaceCreditLedger.amountDelta}), 0)`,
    })
    .from(workspaceCreditLedger)
    .where(
      and(
        eq(workspaceCreditLedger.entryType, "usage_charge"),
        inArray(workspaceCreditLedger.sourceRef, Array.from(ids)),
      ),
    )
    .groupBy(workspaceCreditLedger.sourceRef);

  const map = new Map<string, number>();
  for (const row of rows) {
    const debited = -Number(row.total ?? 0);
    if (debited > 0) {
      map.set(row.sourceRef, debited);
    } else {
      map.set(row.sourceRef, 0);
    }
  }
  return map;
}
