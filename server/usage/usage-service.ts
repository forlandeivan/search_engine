import { and, eq, sql } from "drizzle-orm";
import { db } from "../db";
import {
  workspaceUsageMonth,
  workspaceLlmUsageLedger,
  workspaceEmbeddingUsageLedger,
  workspaceAsrUsageLedger,
  workspaces,
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
  actions_count: workspaceUsageMonth.actionsCount,
  knowledge_bases_count: workspaceUsageMonth.knowledgeBasesCount,
  members_count: workspaceUsageMonth.membersCount,
};
const METRIC_COLUMN_KEYS: Record<WorkspaceUsageMetric, keyof typeof workspaceUsageMonth> = {
  llm_tokens_total: "llmTokensTotal",
  embeddings_tokens_total: "embeddingsTokensTotal",
  asr_minutes_total: "asrMinutesTotal",
  storage_bytes_total: "storageBytesTotal",
  skills_count: "skillsCount",
  actions_count: "actionsCount",
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

/**
 * Adjust storage usage (bytes) for a workspace. Supports положительные и отрицательные дельты.
 * Значение не опускается ниже нуля, при попытке уйти в минус логируем предупреждение.
 */
export async function adjustWorkspaceStorageUsageBytes(
  workspaceId: string,
  deltaBytes: number,
  period?: UsagePeriod,
): Promise<WorkspaceUsageMonth> {
  if (!Number.isFinite(deltaBytes) || deltaBytes === 0) {
    return ensureWorkspaceUsage(workspaceId, period);
  }

  const target = buildPeriod(period);
  const usage = await ensureWorkspaceUsage(workspaceId, target);
  assertNotClosed(usage);

  const currentBytes = Number(usage.storageBytesTotal ?? 0);
  const nextBytes = currentBytes + deltaBytes;
  const clampedBytes = nextBytes < 0 ? 0 : nextBytes;
  if (nextBytes < 0) {
    console.warn(
      `[usage] storage bytes would become negative for workspace ${workspaceId} in period ${target.periodCode}; clamping to 0`,
    );
  }

  const [updated] = await db
    .update(workspaceUsageMonth)
    .set({
      storageBytesTotal: clampedBytes,
      updatedAt: sql`CURRENT_TIMESTAMP`,
    })
    .where(and(eq(workspaceUsageMonth.workspaceId, workspaceId), eq(workspaceUsageMonth.periodCode, target.periodCode)))
    .returning();

  if (!updated) {
    throw new Error(
      `Failed to update storage usage for workspace ${workspaceId} and period ${target.periodCode}`,
    );
  }

  return updated;
}

export type WorkspaceObjectCountersDelta = {
  skillsDelta?: number;
  actionsDelta?: number;
  knowledgeBasesDelta?: number;
  membersDelta?: number;
};

function clampCounter(current: number, delta: number, label: string, workspaceId: string, periodCode: string): number {
  const next = current + delta;
  if (next < 0) {
    console.warn(
      `[usage] ${label} would become negative for workspace ${workspaceId} in period ${periodCode}; clamping to 0`,
    );
    return 0;
  }
  return next;
}

export async function adjustWorkspaceObjectCounters(
  workspaceId: string,
  deltas: WorkspaceObjectCountersDelta,
  period?: UsagePeriod,
): Promise<WorkspaceUsageMonth> {
  const target = buildPeriod(period);
  const usage = await ensureWorkspaceUsage(workspaceId, target);
  assertNotClosed(usage);

  const {
    skillsDelta = 0,
    actionsDelta = 0,
    knowledgeBasesDelta = 0,
    membersDelta = 0,
  } = deltas;

  if (skillsDelta === 0 && actionsDelta === 0 && knowledgeBasesDelta === 0 && membersDelta === 0) {
    return usage;
  }

  const updates: Partial<typeof workspaceUsageMonth> = {};

  if (skillsDelta !== 0) {
    const current = Number(usage.skillsCount ?? 0);
    updates.skillsCount = clampCounter(current, skillsDelta, "skills_count", workspaceId, target.periodCode);
  }
  if (actionsDelta !== 0) {
    const current = Number((usage as any).actionsCount ?? 0);
    updates.actionsCount = clampCounter(current, actionsDelta, "actions_count", workspaceId, target.periodCode);
  }
  if (knowledgeBasesDelta !== 0) {
    const current = Number(usage.knowledgeBasesCount ?? 0);
    updates.knowledgeBasesCount = clampCounter(
      current,
      knowledgeBasesDelta,
      "knowledge_bases_count",
      workspaceId,
      target.periodCode,
    );
  }
  if (membersDelta !== 0) {
    const current = Number(usage.membersCount ?? 0);
    updates.membersCount = clampCounter(current, membersDelta, "members_count", workspaceId, target.periodCode);
  }

  if (Object.keys(updates).length === 0) {
    return usage;
  }

  const [updated] = await db
    .update(workspaceUsageMonth)
    .set({
      ...updates,
      updatedAt: sql`CURRENT_TIMESTAMP`,
    })
    .where(and(eq(workspaceUsageMonth.workspaceId, workspaceId), eq(workspaceUsageMonth.periodCode, target.periodCode)))
    .returning();

  if (!updated) {
    throw new Error(
      `Failed to update object counters for workspace ${workspaceId} and period ${target.periodCode}`,
    );
  }

  return updated;
}

type LlmUsageRecord = {
  workspaceId: string;
  executionId: string;
  provider: string;
  model: string;
  modelId?: string | null;
  tokensTotal: number;
  tokensPrompt?: number | null;
  tokensCompletion?: number | null;
  occurredAt?: Date;
  period?: UsagePeriod;
  appliedCreditsPerUnit?: number | null;
  creditsCharged?: number | null;
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
        modelId: params.modelId ?? null,
        tokensTotal: normalizedTokensTotal,
        tokensPrompt:
          params.tokensPrompt === undefined || params.tokensPrompt === null
            ? null
            : Math.max(0, Math.floor(params.tokensPrompt)),
        tokensCompletion:
          params.tokensCompletion === undefined || params.tokensCompletion === null
            ? null
            : Math.max(0, Math.floor(params.tokensCompletion)),
        appliedCreditsPerUnit: Math.max(0, Math.floor(params.appliedCreditsPerUnit ?? 0)),
        creditsCharged: Math.max(0, Math.floor(params.creditsCharged ?? 0)),
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
  byModelTotal: Array<{ provider: string; model: string; modelId: string | null; tokens: number }>;
  timeseries: Array<{
    provider: string;
    model: string;
    modelId: string | null;
    points: Array<{ date: string; tokens: number }>;
  }>;
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
      modelId: workspaceLlmUsageLedger.modelId,
      tokens: sql<number>`coalesce(sum(${workspaceLlmUsageLedger.tokensTotal}), 0)`,
    })
    .from(workspaceLlmUsageLedger)
    .where(
      and(eq(workspaceLlmUsageLedger.workspaceId, workspaceId), eq(workspaceLlmUsageLedger.periodCode, period.periodCode)),
    )
    .groupBy(workspaceLlmUsageLedger.provider, workspaceLlmUsageLedger.model, workspaceLlmUsageLedger.modelId);

  const timeseriesRows = await db
    .select({
      provider: workspaceLlmUsageLedger.provider,
      model: workspaceLlmUsageLedger.model,
      modelId: workspaceLlmUsageLedger.modelId,
      day: sql<string>`date_trunc('day', ${workspaceLlmUsageLedger.occurredAt})`,
      tokens: sql<number>`coalesce(sum(${workspaceLlmUsageLedger.tokensTotal}), 0)`,
    })
    .from(workspaceLlmUsageLedger)
    .where(
      and(eq(workspaceLlmUsageLedger.workspaceId, workspaceId), eq(workspaceLlmUsageLedger.periodCode, period.periodCode)),
    )
    .groupBy(
      workspaceLlmUsageLedger.provider,
      workspaceLlmUsageLedger.model,
      workspaceLlmUsageLedger.modelId,
      sql`date_trunc('day', ${workspaceLlmUsageLedger.occurredAt})`,
    );

  const timeseriesMap = new Map<
    string,
    { provider: string; model: string; modelId: string | null; points: Array<{ date: string; tokens: number }> }
  >();
  for (const row of timeseriesRows) {
    const key = `${row.provider}::${row.modelId ?? row.model}`;
    if (!timeseriesMap.has(key)) {
      timeseriesMap.set(key, { provider: row.provider, model: row.model, modelId: row.modelId ?? null, points: [] });
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
      modelId: row.modelId ?? null,
      tokens: Number(row.tokens),
    })),
    timeseries: Array.from(timeseriesMap.values()),
  };
}

export type WorkspaceEmbeddingUsageSummary = {
  workspaceId: string;
  period: UsagePeriod & { start: string; end: string };
  totalTokens: number;
  byModelTotal: Array<{ provider: string; model: string; modelId: string | null; tokens: number }>;
  timeseries: Array<{
    provider: string;
    model: string;
    modelId: string | null;
    points: Array<{ date: string; tokens: number }>;
  }>;
};

export async function getWorkspaceEmbeddingUsageSummary(
  workspaceId: string,
  periodCode?: string,
): Promise<WorkspaceEmbeddingUsageSummary> {
  const period = parseUsagePeriodCode(periodCode ?? "") ?? getUsagePeriodForDate();
  const { start, end } = getUsagePeriodBounds(period);

  const totalsRows = await db
    .select({
      tokens: sql<number>`coalesce(sum(${workspaceEmbeddingUsageLedger.tokensTotal}), 0)`,
    })
    .from(workspaceEmbeddingUsageLedger)
    .where(
      and(
        eq(workspaceEmbeddingUsageLedger.workspaceId, workspaceId),
        eq(workspaceEmbeddingUsageLedger.periodCode, period.periodCode),
      ),
    );

  const byModelRows = await db
    .select({
      provider: workspaceEmbeddingUsageLedger.provider,
      model: workspaceEmbeddingUsageLedger.model,
      modelId: workspaceEmbeddingUsageLedger.modelId,
      tokens: sql<number>`coalesce(sum(${workspaceEmbeddingUsageLedger.tokensTotal}), 0)`,
    })
    .from(workspaceEmbeddingUsageLedger)
    .where(
      and(
        eq(workspaceEmbeddingUsageLedger.workspaceId, workspaceId),
        eq(workspaceEmbeddingUsageLedger.periodCode, period.periodCode),
      ),
    )
    .groupBy(
      workspaceEmbeddingUsageLedger.provider,
      workspaceEmbeddingUsageLedger.model,
      workspaceEmbeddingUsageLedger.modelId,
    );

  const timeseriesRows = await db
    .select({
      provider: workspaceEmbeddingUsageLedger.provider,
      model: workspaceEmbeddingUsageLedger.model,
      modelId: workspaceEmbeddingUsageLedger.modelId,
      day: sql<string>`date_trunc('day', ${workspaceEmbeddingUsageLedger.occurredAt})`,
      tokens: sql<number>`coalesce(sum(${workspaceEmbeddingUsageLedger.tokensTotal}), 0)`,
    })
    .from(workspaceEmbeddingUsageLedger)
    .where(
      and(
        eq(workspaceEmbeddingUsageLedger.workspaceId, workspaceId),
        eq(workspaceEmbeddingUsageLedger.periodCode, period.periodCode),
      ),
    )
    .groupBy(
      workspaceEmbeddingUsageLedger.provider,
      workspaceEmbeddingUsageLedger.model,
      workspaceEmbeddingUsageLedger.modelId,
      sql`date_trunc('day', ${workspaceEmbeddingUsageLedger.occurredAt})`,
    );

  const timeseriesMap = new Map<
    string,
    { provider: string; model: string; modelId: string | null; points: Array<{ date: string; tokens: number }> }
  >();
  for (const row of timeseriesRows) {
    const key = `${row.provider}::${row.modelId ?? row.model}`;
    if (!timeseriesMap.has(key)) {
      timeseriesMap.set(key, {
        provider: row.provider,
        model: row.model,
        modelId: row.modelId ?? null,
        points: [],
      });
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
      modelId: row.modelId ?? null,
      tokens: Number(row.tokens),
    })),
    timeseries: Array.from(timeseriesMap.values()),
  };
}

export type WorkspaceAsrUsageSummary = {
  workspaceId: string;
  period: UsagePeriod & { start: string; end: string };
  totalMinutes: number;
  byProviderModelTotal: Array<{ provider: string | null; model: string | null; modelId: string | null; minutes: number }>;
  timeseries: Array<{ date: string; minutes: number }>;
  timeseriesByProviderModel: Array<{
    provider: string | null;
    model: string | null;
    modelId: string | null;
    points: Array<{ date: string; minutes: number }>;
  }>;
};

function secondsToMinutesRoundedUp(totalSeconds: number): number {
  return totalSeconds <= 0 ? 0 : Math.ceil(totalSeconds / 60);
}

export async function getWorkspaceAsrUsageSummary(
  workspaceId: string,
  periodCode?: string,
): Promise<WorkspaceAsrUsageSummary> {
  const period = parseUsagePeriodCode(periodCode ?? "") ?? getUsagePeriodForDate();
  const { start, end } = getUsagePeriodBounds(period);

  const totalsRows = await db
    .select({
      durationSeconds: sql<number>`coalesce(sum(${workspaceAsrUsageLedger.durationSeconds}), 0)`,
    })
    .from(workspaceAsrUsageLedger)
    .where(and(eq(workspaceAsrUsageLedger.workspaceId, workspaceId), eq(workspaceAsrUsageLedger.periodCode, period.periodCode)));

  const byProviderModelRows = await db
    .select({
      provider: workspaceAsrUsageLedger.provider,
      model: workspaceAsrUsageLedger.model,
      modelId: workspaceAsrUsageLedger.modelId,
      durationSeconds: sql<number>`coalesce(sum(${workspaceAsrUsageLedger.durationSeconds}), 0)`,
    })
    .from(workspaceAsrUsageLedger)
    .where(and(eq(workspaceAsrUsageLedger.workspaceId, workspaceId), eq(workspaceAsrUsageLedger.periodCode, period.periodCode)))
    .groupBy(workspaceAsrUsageLedger.provider, workspaceAsrUsageLedger.model, workspaceAsrUsageLedger.modelId);

  const timeseriesRows = await db
    .select({
      day: sql<string>`date_trunc('day', ${workspaceAsrUsageLedger.occurredAt})`,
      durationSeconds: sql<number>`coalesce(sum(${workspaceAsrUsageLedger.durationSeconds}), 0)`,
    })
    .from(workspaceAsrUsageLedger)
    .where(and(eq(workspaceAsrUsageLedger.workspaceId, workspaceId), eq(workspaceAsrUsageLedger.periodCode, period.periodCode)))
    .groupBy(sql`date_trunc('day', ${workspaceAsrUsageLedger.occurredAt})`);

  const timeseriesByProviderRows = await db
    .select({
      provider: workspaceAsrUsageLedger.provider,
      model: workspaceAsrUsageLedger.model,
      modelId: workspaceAsrUsageLedger.modelId,
      day: sql<string>`date_trunc('day', ${workspaceAsrUsageLedger.occurredAt})`,
      durationSeconds: sql<number>`coalesce(sum(${workspaceAsrUsageLedger.durationSeconds}), 0)`,
    })
    .from(workspaceAsrUsageLedger)
    .where(and(eq(workspaceAsrUsageLedger.workspaceId, workspaceId), eq(workspaceAsrUsageLedger.periodCode, period.periodCode)))
    .groupBy(
      workspaceAsrUsageLedger.provider,
      workspaceAsrUsageLedger.model,
      workspaceAsrUsageLedger.modelId,
      sql`date_trunc('day', ${workspaceAsrUsageLedger.occurredAt})`,
    );

  const timeseriesByProviderModel = new Map<
    string,
    { provider: string | null; model: string | null; modelId: string | null; points: Array<{ date: string; minutes: number }> }
  >();
  for (const row of timeseriesByProviderRows) {
    const key = `${row.provider ?? "null"}::${row.modelId ?? row.model ?? "null"}`;
    if (!timeseriesByProviderModel.has(key)) {
      timeseriesByProviderModel.set(key, {
        provider: row.provider ?? null,
        model: row.model ?? null,
        modelId: row.modelId ?? null,
        points: [],
      });
    }
    const entry = timeseriesByProviderModel.get(key)!;
    const dateString = new Date(row.day).toISOString().slice(0, 10);
    entry.points.push({ date: dateString, minutes: secondsToMinutesRoundedUp(Number(row.durationSeconds)) });
  }

  return {
    workspaceId,
    period: {
      ...period,
      start: start.toISOString(),
      end: end.toISOString(),
    },
    totalMinutes: secondsToMinutesRoundedUp(Number(totalsRows[0]?.durationSeconds ?? 0)),
    byProviderModelTotal: byProviderModelRows.map((row) => ({
      provider: row.provider ?? null,
      model: row.model ?? null,
      modelId: row.modelId ?? null,
      minutes: secondsToMinutesRoundedUp(Number(row.durationSeconds)),
    })),
    timeseries: timeseriesRows.map((row) => ({
      date: new Date(row.day).toISOString().slice(0, 10),
      minutes: secondsToMinutesRoundedUp(Number(row.durationSeconds)),
    })),
    timeseriesByProviderModel: Array.from(timeseriesByProviderModel.values()),
  };
}

export type WorkspaceStorageUsageSummary = {
  workspaceId: string;
  period: UsagePeriod & { start: string; end: string };
  storageBytes: number;
};

export type WorkspaceQdrantUsage = {
  workspaceId: string;
  collectionsCount: number;
  pointsCount: number;
  storageBytes: number;
};

export type UsageSnapshot = {
  workspaceId: string;
  periodCode: string;
  llmTokensTotal: number;
  embeddingsTokensTotal: number;
  asrMinutesTotal: number;
  storageBytesTotal: number;
  skillsCount: number;
  actionsCount: number;
  knowledgeBasesCount: number;
  membersCount: number;
  qdrantCollectionsCount: number;
  qdrantPointsCount: number;
  qdrantStorageBytes: number;
};

export type WorkspaceObjectsUsageSummary = {
  workspaceId: string;
  period: UsagePeriod & { start: string; end: string };
  skillsCount: number;
  actionsCount: number;
  knowledgeBasesCount: number;
  membersCount: number;
};

export async function getWorkspaceStorageUsageSummary(
  workspaceId: string,
  periodCode?: string,
): Promise<WorkspaceStorageUsageSummary> {
  const period = parseUsagePeriodCode(periodCode ?? "") ?? getUsagePeriodForDate();
  const { start, end } = getUsagePeriodBounds(period);

  const rows = await db
    .select({ storageBytes: workspaceUsageMonth.storageBytesTotal })
    .from(workspaceUsageMonth)
    .where(and(eq(workspaceUsageMonth.workspaceId, workspaceId), eq(workspaceUsageMonth.periodCode, period.periodCode)))
    .limit(1);

  const storageBytes = rows.length > 0 ? Number(rows[0]?.storageBytes ?? 0) : 0;

  return {
    workspaceId,
    period: {
      ...period,
      start: start.toISOString(),
      end: end.toISOString(),
    },
    storageBytes,
  };
}

export async function getWorkspaceObjectsUsageSummary(
  workspaceId: string,
  periodCode?: string,
): Promise<WorkspaceObjectsUsageSummary> {
  const period = parseUsagePeriodCode(periodCode ?? "") ?? getUsagePeriodForDate();
  const { start, end } = getUsagePeriodBounds(period);

  const rows = await db
    .select({
      skillsCount: workspaceUsageMonth.skillsCount,
      actionsCount: workspaceUsageMonth.actionsCount,
      knowledgeBasesCount: workspaceUsageMonth.knowledgeBasesCount,
      membersCount: workspaceUsageMonth.membersCount,
    })
    .from(workspaceUsageMonth)
    .where(and(eq(workspaceUsageMonth.workspaceId, workspaceId), eq(workspaceUsageMonth.periodCode, period.periodCode)))
    .limit(1);

  const counters = rows[0] ?? {
    skillsCount: 0,
    actionsCount: 0,
    knowledgeBasesCount: 0,
    membersCount: 0,
  };

  return {
    workspaceId,
    period: {
      ...period,
      start: start.toISOString(),
      end: end.toISOString(),
    },
    skillsCount: Number(counters.skillsCount ?? 0),
    actionsCount: Number((counters as any).actionsCount ?? 0),
    knowledgeBasesCount: Number(counters.knowledgeBasesCount ?? 0),
    membersCount: Number(counters.membersCount ?? 0),
  };
}

export async function updateWorkspaceQdrantUsage(
  workspaceId: string,
  values: Partial<Pick<WorkspaceQdrantUsage, "collectionsCount" | "pointsCount" | "storageBytes">>,
): Promise<WorkspaceQdrantUsage> {
  const normalized: WorkspaceQdrantUsage = {
    workspaceId,
    collectionsCount: Math.max(0, Number(values.collectionsCount ?? 0)),
    pointsCount: Math.max(0, Number(values.pointsCount ?? 0)),
    storageBytes: Math.max(0, Number(values.storageBytes ?? 0)),
  };

  const [updated] = await db
    .update(workspaces)
    .set({
      qdrantCollectionsCount: normalized.collectionsCount,
      qdrantPointsCount: normalized.pointsCount,
      qdrantStorageBytes: normalized.storageBytes,
      updatedAt: sql`CURRENT_TIMESTAMP`,
    })
    .where(eq(workspaces.id, workspaceId))
    .returning({
      workspaceId: workspaces.id,
      collectionsCount: workspaces.qdrantCollectionsCount,
      pointsCount: workspaces.qdrantPointsCount,
      storageBytes: workspaces.qdrantStorageBytes,
    });

  if (!updated) {
    throw new Error(`Failed to update Qdrant usage for workspace ${workspaceId}`);
  }

  return {
    workspaceId: updated.workspaceId,
    collectionsCount: Number(updated.collectionsCount ?? 0),
    pointsCount: Number(updated.pointsCount ?? 0),
    storageBytes: Number(updated.storageBytes ?? 0),
  };
}

export async function adjustWorkspaceQdrantUsage(
  workspaceId: string,
  deltas: Partial<Pick<WorkspaceQdrantUsage, "collectionsCount" | "pointsCount" | "storageBytes">>,
): Promise<WorkspaceQdrantUsage> {
  const collectionsDelta = Number(deltas.collectionsCount ?? 0);
  const pointsDelta = Number(deltas.pointsCount ?? 0);
  const storageDelta = Number(deltas.storageBytes ?? 0);

  if (collectionsDelta === 0 && pointsDelta === 0 && storageDelta === 0) {
    const [row] = await db
      .select({
        workspaceId: workspaces.id,
        collectionsCount: workspaces.qdrantCollectionsCount,
        pointsCount: workspaces.qdrantPointsCount,
        storageBytes: workspaces.qdrantStorageBytes,
      })
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId))
      .limit(1);

    if (!row) {
      throw new Error(`Workspace ${workspaceId} not found`);
    }

    return {
      workspaceId: row.workspaceId,
      collectionsCount: Number(row.collectionsCount ?? 0),
      pointsCount: Number(row.pointsCount ?? 0),
      storageBytes: Number(row.storageBytes ?? 0),
    };
  }

  const updates: Partial<typeof workspaces> = {};

  if (collectionsDelta !== 0) {
    updates.qdrantCollectionsCount = sql`GREATEST(0, ${workspaces.qdrantCollectionsCount} + ${collectionsDelta})`;
  }
  if (pointsDelta !== 0) {
    updates.qdrantPointsCount = sql`GREATEST(0, ${workspaces.qdrantPointsCount} + ${pointsDelta})`;
  }
  if (storageDelta !== 0) {
    updates.qdrantStorageBytes = sql`GREATEST(0, ${workspaces.qdrantStorageBytes} + ${storageDelta})`;
  }

  const [updated] = await db
    .update(workspaces)
    .set({
      ...updates,
      updatedAt: sql`CURRENT_TIMESTAMP`,
    })
    .where(eq(workspaces.id, workspaceId))
    .returning({
      workspaceId: workspaces.id,
      collectionsCount: workspaces.qdrantCollectionsCount,
      pointsCount: workspaces.qdrantPointsCount,
      storageBytes: workspaces.qdrantStorageBytes,
    });

  if (!updated) {
    throw new Error(`Failed to adjust Qdrant usage for workspace ${workspaceId}`);
  }

  return {
    workspaceId: updated.workspaceId,
    collectionsCount: Number(updated.collectionsCount ?? 0),
    pointsCount: Number(updated.pointsCount ?? 0),
    storageBytes: Number(updated.storageBytes ?? 0),
  };
}

export async function getWorkspaceQdrantUsage(workspaceId: string): Promise<WorkspaceQdrantUsage> {
  const [row] = await db
    .select({
      workspaceId: workspaces.id,
      collectionsCount: workspaces.qdrantCollectionsCount,
      pointsCount: workspaces.qdrantPointsCount,
      storageBytes: workspaces.qdrantStorageBytes,
    })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .limit(1);

  if (!row) {
    throw new Error(`Workspace ${workspaceId} not found`);
  }

  return {
    workspaceId: row.workspaceId,
    collectionsCount: Number(row.collectionsCount ?? 0),
    pointsCount: Number(row.pointsCount ?? 0),
    storageBytes: Number(row.storageBytes ?? 0),
  };
}

export async function getWorkspaceUsageSnapshot(workspaceId: string): Promise<UsageSnapshot> {
  const period = getUsagePeriodForDate();
  const usage = await ensureWorkspaceUsage(workspaceId, period);

  const [workspaceRow] = await db
    .select({
      qdrantCollectionsCount: workspaces.qdrantCollectionsCount,
      qdrantPointsCount: workspaces.qdrantPointsCount,
      qdrantStorageBytes: workspaces.qdrantStorageBytes,
    })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .limit(1);

  return {
    workspaceId,
    periodCode: period.periodCode,
    llmTokensTotal: Number(usage.llmTokensTotal ?? 0),
    embeddingsTokensTotal: Number(usage.embeddingsTokensTotal ?? 0),
    asrMinutesTotal: Number(usage.asrMinutesTotal ?? 0),
    storageBytesTotal: Number(usage.storageBytesTotal ?? 0),
    skillsCount: Number(usage.skillsCount ?? 0),
    actionsCount: Number((usage as any).actionsCount ?? 0),
    knowledgeBasesCount: Number(usage.knowledgeBasesCount ?? 0),
    membersCount: Number(usage.membersCount ?? 0),
    qdrantCollectionsCount: Number(workspaceRow?.qdrantCollectionsCount ?? 0),
    qdrantPointsCount: Number(workspaceRow?.qdrantPointsCount ?? 0),
    qdrantStorageBytes: Number(workspaceRow?.qdrantStorageBytes ?? 0),
  };
}

type AsrUsageRecord = {
  workspaceId: string;
  asrJobId: string;
  durationSeconds: number;
  provider?: string | null;
  model?: string | null;
  modelId?: string | null;
  occurredAt?: Date;
  period?: UsagePeriod;
  appliedCreditsPerUnit?: number | null;
  creditsCharged?: number | null;
};

export async function recordAsrUsageEvent(params: AsrUsageRecord): Promise<void> {
  if (!params.workspaceId || !params.asrJobId) {
    throw new Error("workspaceId and asrJobId are required to record ASR usage");
  }
  if (params.durationSeconds === null || params.durationSeconds === undefined) {
    return;
  }

  const normalizedDurationSeconds = Math.max(0, Math.floor(params.durationSeconds));
  if (!Number.isFinite(normalizedDurationSeconds) || normalizedDurationSeconds <= 0) {
    return;
  }

  // Начатая минута считается: округляем вверх.
  const minutes = Math.max(1, Math.ceil(normalizedDurationSeconds / 60));

  const occurredAt = params.occurredAt ?? new Date();
  const period = buildPeriod(params.period ?? getUsagePeriodForDate(occurredAt));

  await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(workspaceAsrUsageLedger)
      .values({
        workspaceId: params.workspaceId,
        periodYear: period.periodYear,
        periodMonth: period.periodMonth,
        periodCode: period.periodCode,
        asrJobId: params.asrJobId,
        provider: params.provider ?? null,
        model: params.model ?? null,
        modelId: params.modelId ?? null,
        durationSeconds: normalizedDurationSeconds,
        appliedCreditsPerUnit: Math.max(0, Math.floor(params.appliedCreditsPerUnit ?? 0)),
        creditsCharged: Math.max(0, Math.floor(params.creditsCharged ?? 0)),
        occurredAt,
      })
      .onConflictDoNothing()
      .returning({ id: workspaceAsrUsageLedger.id });

    if (inserted.length === 0) {
      // Duplicate job — уже учли.
      return;
    }

    const usage = await ensureWorkspaceUsageWithClient(params.workspaceId, period, tx);
    assertNotClosed(usage);

    const [updated] = await tx
      .update(workspaceUsageMonth)
      .set({
        ...buildDeltaUpdate({ asr_minutes_total: minutes }),
        updatedAt: sql`CURRENT_TIMESTAMP`,
      })
      .where(and(eq(workspaceUsageMonth.workspaceId, params.workspaceId), eq(workspaceUsageMonth.periodCode, period.periodCode)))
      .returning();

    if (!updated) {
      throw new Error(
        `Failed to update usage for workspace ${params.workspaceId} and period ${period.periodCode} (ASR ledger)`,
      );
    }
  });
}

type EmbeddingUsageRecord = {
  workspaceId: string;
  operationId: string;
  provider: string;
  model: string;
  modelId?: string | null;
  tokensTotal: number;
  contentBytes?: number | null;
  occurredAt?: Date;
  period?: UsagePeriod;
  appliedCreditsPerUnit?: number | null;
  creditsCharged?: number | null;
};

export async function recordEmbeddingUsageEvent(params: EmbeddingUsageRecord): Promise<void> {
  if (!params.workspaceId || !params.operationId) {
    throw new Error("workspaceId and operationId are required to record embedding usage");
  }
  if (params.tokensTotal === null || params.tokensTotal === undefined) {
    return;
  }

  const normalizedTokensTotal = Math.max(0, Math.floor(params.tokensTotal));
  if (!Number.isFinite(normalizedTokensTotal) || normalizedTokensTotal <= 0) {
    return;
  }

  const normalizedContentBytes =
    params.contentBytes === undefined || params.contentBytes === null
      ? null
      : Math.max(0, Math.floor(params.contentBytes));

  const occurredAt = params.occurredAt ?? new Date();
  const period = buildPeriod(params.period ?? getUsagePeriodForDate(occurredAt));

  await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(workspaceEmbeddingUsageLedger)
      .values({
        workspaceId: params.workspaceId,
        periodYear: period.periodYear,
        periodMonth: period.periodMonth,
        periodCode: period.periodCode,
        operationId: params.operationId,
        provider: params.provider,
        model: params.model,
        modelId: params.modelId ?? null,
        tokensTotal: normalizedTokensTotal,
        contentBytes: normalizedContentBytes,
        appliedCreditsPerUnit: Math.max(0, Math.floor(params.appliedCreditsPerUnit ?? 0)),
        creditsCharged: Math.max(0, Math.floor(params.creditsCharged ?? 0)),
        occurredAt,
      })
      .onConflictDoNothing()
      .returning({ id: workspaceEmbeddingUsageLedger.id });

    if (inserted.length === 0) {
      // Duplicate operation within workspace — already accounted.
      return;
    }

    const usage = await ensureWorkspaceUsageWithClient(params.workspaceId, period, tx);
    assertNotClosed(usage);

    const [updated] = await tx
      .update(workspaceUsageMonth)
      .set({
        ...buildDeltaUpdate({ embeddings_tokens_total: normalizedTokensTotal }),
        updatedAt: sql`CURRENT_TIMESTAMP`,
      })
      .where(and(eq(workspaceUsageMonth.workspaceId, params.workspaceId), eq(workspaceUsageMonth.periodCode, period.periodCode)))
      .returning();

    if (!updated) {
      throw new Error(
        `Failed to update usage for workspace ${params.workspaceId} and period ${period.periodCode} (Embedding ledger)`,
      );
    }
  });
}
