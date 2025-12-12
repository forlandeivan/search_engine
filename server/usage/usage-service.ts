import { and, eq, sql } from "drizzle-orm";
import { db } from "../db";
import {
  workspaceUsageMonth,
  workspaceLlmUsageLedger,
  type WorkspaceUsageMonth,
  type WorkspaceUsageMonthInsert,
} from "@shared/schema";
import {
  WORKSPACE_USAGE_METRICS,
  type WorkspaceUsageMetric,
  type UsagePeriod,
  getUsagePeriodForDate,
  parseUsagePeriodCode,
  getUsagePeriodBounds,
} from "./usage-types";

export type UsageCountersDelta = Partial<Record<WorkspaceUsageMetric, number>>;

type DbClient = typeof db;

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

function getClient(client?: DbClient): DbClient {
  return client ?? db;
}

export async function getWorkspaceUsage(
  workspaceId: string,
  period: UsagePeriod = getUsagePeriodForDate(),
  client?: DbClient,
): Promise<WorkspaceUsageMonth | undefined> {
  const dbClient = getClient(client);
  const { periodCode } = period;
  const rows = await dbClient
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
  return ensureWorkspaceUsageWithClient(workspaceId, target);
}

async function ensureWorkspaceUsageWithClient(
  workspaceId: string,
  period: UsagePeriod,
  client?: DbClient,
): Promise<WorkspaceUsageMonth> {
  const dbClient = getClient(client);

  const insertPayload: WorkspaceUsageMonthInsert = {
    workspaceId,
    periodYear: period.periodYear,
    periodMonth: period.periodMonth,
    periodCode: period.periodCode,
  };

  const inserted = await dbClient
    .insert(workspaceUsageMonth)
    .values(insertPayload)
    .onConflictDoNothing()
    .returning();

  if (inserted.length > 0) {
    return inserted[0];
  }

  const existing = await getWorkspaceUsage(workspaceId, period, dbClient);
  if (existing) {
    return existing;
  }

  throw new Error(`Failed to ensure usage record for workspace ${workspaceId} and period ${period.periodCode}`);
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

type LlmUsageRecord = {
  workspaceId: string;
  executionId: string;
  provider: string;
  model: string;
  tokensTotal: number;
  tokensPrompt?: number | null;
  tokensCompletion?: number | null;
  occurredAt?: Date;
  period?: UsagePeriod;
};

export async function recordLlmUsageEvent(params: LlmUsageRecord): Promise<void> {
  if (!params.workspaceId || !params.executionId) {
    throw new Error("workspaceId and executionId are required to record LLM usage");
  }
  if (params.tokensTotal === null || params.tokensTotal === undefined) {
    return;
  }

  const normalizedTokensTotal = Math.max(0, Math.floor(params.tokensTotal));
  if (!Number.isFinite(normalizedTokensTotal) || normalizedTokensTotal <= 0) {
    return;
  }

  const occurredAt = params.occurredAt ?? new Date();
  const period = buildPeriod(params.period ?? getUsagePeriodForDate(occurredAt));

  await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(workspaceLlmUsageLedger)
      .values({
        workspaceId: params.workspaceId,
        periodYear: period.periodYear,
        periodMonth: period.periodMonth,
        periodCode: period.periodCode,
        executionId: params.executionId,
        provider: params.provider,
        model: params.model,
        tokensTotal: normalizedTokensTotal,
        tokensPrompt:
          params.tokensPrompt === undefined || params.tokensPrompt === null
            ? null
            : Math.max(0, Math.floor(params.tokensPrompt)),
        tokensCompletion:
          params.tokensCompletion === undefined || params.tokensCompletion === null
            ? null
            : Math.max(0, Math.floor(params.tokensCompletion)),
        occurredAt,
      })
      .onConflictDoNothing()
      .returning({ id: workspaceLlmUsageLedger.id });

    if (inserted.length === 0) {
      // Duplicate execution within workspace — already accounted.
      return;
    }

    const usage = await ensureWorkspaceUsageWithClient(params.workspaceId, period, tx);
    assertNotClosed(usage);

    const [updated] = await tx
      .update(workspaceUsageMonth)
      .set({
        ...buildDeltaUpdate({ llm_tokens_total: normalizedTokensTotal }),
        updatedAt: sql`CURRENT_TIMESTAMP`,
      })
      .where(and(eq(workspaceUsageMonth.workspaceId, params.workspaceId), eq(workspaceUsageMonth.periodCode, period.periodCode)))
      .returning();

    if (!updated) {
      throw new Error(
        `Failed to update usage for workspace ${params.workspaceId} and period ${period.periodCode} (LLM ledger)`,
      );
    }
  });
}

export type WorkspaceLlmUsageSummary = {
  workspaceId: string;
  period: UsagePeriod & { start: string; end: string };
  totalTokens: number;
  byModelTotal: Array<{ provider: string; model: string; tokens: number }>;
  timeseries: Array<{ provider: string; model: string; points: Array<{ date: string; tokens: number }> }>;
};

export async function getWorkspaceLlmUsageSummary(
  workspaceId: string,
  periodCode?: string,
): Promise<WorkspaceLlmUsageSummary> {
  const period = parseUsagePeriodCode(periodCode ?? "") ?? getUsagePeriodForDate();
  const { start, end } = getUsagePeriodBounds(period);

  const totalsRows = await db
    .select({
      tokens: sql<number>`coalesce(sum(${workspaceLlmUsageLedger.tokensTotal}), 0)`,
    })
    .from(workspaceLlmUsageLedger)
    .where(
      and(eq(workspaceLlmUsageLedger.workspaceId, workspaceId), eq(workspaceLlmUsageLedger.periodCode, period.periodCode)),
    );

  const byModelRows = await db
    .select({
      provider: workspaceLlmUsageLedger.provider,
      model: workspaceLlmUsageLedger.model,
      tokens: sql<number>`coalesce(sum(${workspaceLlmUsageLedger.tokensTotal}), 0)`,
    })
    .from(workspaceLlmUsageLedger)
    .where(
      and(eq(workspaceLlmUsageLedger.workspaceId, workspaceId), eq(workspaceLlmUsageLedger.periodCode, period.periodCode)),
    )
    .groupBy(workspaceLlmUsageLedger.provider, workspaceLlmUsageLedger.model);

  const timeseriesRows = await db
    .select({
      provider: workspaceLlmUsageLedger.provider,
      model: workspaceLlmUsageLedger.model,
      day: sql<string>`date_trunc('day', ${workspaceLlmUsageLedger.occurredAt})`,
      tokens: sql<number>`coalesce(sum(${workspaceLlmUsageLedger.tokensTotal}), 0)`,
    })
    .from(workspaceLlmUsageLedger)
    .where(
      and(eq(workspaceLlmUsageLedger.workspaceId, workspaceId), eq(workspaceLlmUsageLedger.periodCode, period.periodCode)),
    )
    .groupBy(workspaceLlmUsageLedger.provider, workspaceLlmUsageLedger.model, sql`date_trunc('day', ${workspaceLlmUsageLedger.occurredAt})`);

  const timeseriesMap = new Map<string, { provider: string; model: string; points: Array<{ date: string; tokens: number }> }>();
  for (const row of timeseriesRows) {
    const key = `${row.provider}::${row.model}`;
    if (!timeseriesMap.has(key)) {
      timeseriesMap.set(key, { provider: row.provider, model: row.model, points: [] });
    }
    const entry = timeseriesMap.get(key)!;
    const dateString = new Date(row.day).toISOString().slice(0, 10);
    entry.points.push({ date: dateString, tokens: Number(row.tokens) });
  }

  return {
    workspaceId,
    period: {
      ...period,
      start: start.toISOString(),
      end: end.toISOString(),
    },
    totalTokens: Number(totalsRows[0]?.tokens ?? 0),
    byModelTotal: byModelRows.map((row) => ({
      provider: row.provider,
      model: row.model,
      tokens: Number(row.tokens),
    })),
    timeseries: Array.from(timeseriesMap.values()),
  };
}
