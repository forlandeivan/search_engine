import { and, eq, sql } from "drizzle-orm";
import { db } from "../db";
import {
  workspaceUsageMonth,
  type WorkspaceUsageMonth,
  type WorkspaceUsageMonthInsert,
} from "@shared/schema";
import {
  WORKSPACE_USAGE_METRICS,
  type WorkspaceUsageMetric,
  type UsagePeriod,
  getUsagePeriodForDate,
} from "./usage-types";

export type UsageCountersDelta = Partial<Record<WorkspaceUsageMetric, number>>;

const METRIC_COLUMNS: Record<WorkspaceUsageMetric, any> = {
  llm_tokens_total: workspaceUsageMonth.llmTokensTotal,
  embeddings_tokens_total: workspaceUsageMonth.embeddingsTokensTotal,
  asr_minutes_total: workspaceUsageMonth.asrMinutesTotal,
  storage_bytes_total: workspaceUsageMonth.storageBytesTotal,
  skills_count: workspaceUsageMonth.skillsCount,
  knowledge_bases_count: workspaceUsageMonth.knowledgeBasesCount,
  members_count: workspaceUsageMonth.membersCount,
};
const METRIC_COLUMN_KEYS: Record<WorkspaceUsageMetric, keyof typeof workspaceUsageMonth> = {
  llm_tokens_total: "llmTokensTotal",
  embeddings_tokens_total: "embeddingsTokensTotal",
  asr_minutes_total: "asrMinutesTotal",
  storage_bytes_total: "storageBytesTotal",
  skills_count: "skillsCount",
  knowledge_bases_count: "knowledgeBasesCount",
  members_count: "membersCount",
};

function buildPeriod(period?: UsagePeriod): UsagePeriod {
  return period ?? getUsagePeriodForDate();
}

export async function getWorkspaceUsage(
  workspaceId: string,
  period: UsagePeriod = getUsagePeriodForDate(),
): Promise<WorkspaceUsageMonth | undefined> {
  const { periodCode } = period;
  const rows = await db
    .select()
    .from(workspaceUsageMonth)
    .where(and(eq(workspaceUsageMonth.workspaceId, workspaceId), eq(workspaceUsageMonth.periodCode, periodCode)))
    .limit(1);

  return rows[0];
}

export async function ensureWorkspaceUsage(
  workspaceId: string,
  period?: UsagePeriod,
): Promise<WorkspaceUsageMonth> {
  const target = buildPeriod(period);

  const insertPayload: WorkspaceUsageMonthInsert = {
    workspaceId,
    periodYear: target.periodYear,
    periodMonth: target.periodMonth,
    periodCode: target.periodCode,
  };

  const inserted = await db
    .insert(workspaceUsageMonth)
    .values(insertPayload)
    .onConflictDoNothing()
    .returning();

  if (inserted.length > 0) {
    return inserted[0];
  }

  const existing = await getWorkspaceUsage(workspaceId, target);
  if (existing) {
    return existing;
  }

  throw new Error(`Failed to ensure usage record for workspace ${workspaceId} and period ${target.periodCode}`);
}

export async function closeWorkspaceUsage(
  workspaceId: string,
  period?: UsagePeriod,
  closedAt: Date = new Date(),
): Promise<WorkspaceUsageMonth> {
  const target = buildPeriod(period);
  const usage = await ensureWorkspaceUsage(workspaceId, target);
  if (usage.isClosed) {
    return usage;
  }

  const [updated] = await db
    .update(workspaceUsageMonth)
    .set({
      isClosed: true,
      closedAt,
      updatedAt: sql`CURRENT_TIMESTAMP`,
    })
    .where(and(eq(workspaceUsageMonth.workspaceId, workspaceId), eq(workspaceUsageMonth.periodCode, target.periodCode)))
    .returning();

  if (!updated) {
    throw new Error(`Failed to close usage period ${target.periodCode} for workspace ${workspaceId}`);
  }

  return updated;
}

function assertNotClosed(usage: WorkspaceUsageMonth): void {
  if (usage.isClosed) {
    throw new Error(`Usage period ${usage.periodCode} for workspace ${usage.workspaceId} is closed`);
  }
}

function buildDeltaUpdate(
  deltas: UsageCountersDelta,
): Partial<Record<keyof typeof workspaceUsageMonth, ReturnType<typeof sql>>> {
  const updates: Partial<Record<keyof typeof workspaceUsageMonth, ReturnType<typeof sql>>> = {};
  for (const metric of WORKSPACE_USAGE_METRICS) {
    const delta = deltas[metric];
    if (delta === undefined || delta === null) {
      continue;
    }
    if (delta < 0) {
      throw new Error(`Negative delta is not allowed for usage metric ${metric}`);
    }
    const column = METRIC_COLUMNS[metric];
    const columnKey = METRIC_COLUMN_KEYS[metric];
    updates[columnKey] = sql`${column} + ${delta}`;
  }
  return updates;
}

export async function incrementWorkspaceUsage(
  workspaceId: string,
  deltas: UsageCountersDelta,
  period?: UsagePeriod,
): Promise<WorkspaceUsageMonth> {
  const target = buildPeriod(period);
  const usage = await ensureWorkspaceUsage(workspaceId, target);
  assertNotClosed(usage);

  const updatePayload = buildDeltaUpdate(deltas);
  if (Object.keys(updatePayload).length === 0) {
    return usage;
  }

  const [updated] = await db
    .update(workspaceUsageMonth)
    .set({
      ...updatePayload,
      updatedAt: sql`CURRENT_TIMESTAMP`,
    })
    .where(and(eq(workspaceUsageMonth.workspaceId, workspaceId), eq(workspaceUsageMonth.periodCode, target.periodCode)))
    .returning();

  if (!updated) {
    throw new Error(`Failed to update usage for workspace ${workspaceId} and period ${target.periodCode}`);
  }

  return updated;
}
