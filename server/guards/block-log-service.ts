import { db } from "../db";
import { guardBlockEvents, workspaces, type GuardBlockEvent } from "@shared/schema";
import type { GuardDecision, OperationContext } from "./types";
import type { UsageSnapshot } from "./usage-snapshot-provider";
import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import { mapDecisionToPayload } from "./errors";
import type { JsonValue } from "../json-types";

export type BlockLogFilters = {
  workspaceId?: string;
  operationType?: string;
  resourceType?: string;
  reasonCode?: string;
  dateFrom?: Date;
  dateTo?: Date;
  limit?: number;
  offset?: number;
};

type BlockLogOptions = {
  requestId?: string | null;
  actor?: { actorType?: string | null; actorId?: string | null };
  isSoft?: boolean;
};

export async function logGuardBlockEvent(
  decision: GuardDecision,
  context?: Partial<OperationContext>,
  snapshot?: UsageSnapshot | null,
  options?: BlockLogOptions,
): Promise<GuardBlockEvent | null> {
  const payload = mapDecisionToPayload(decision, context);
  const workspaceId = context?.workspaceId;
  const operationType = context?.operationType;
  if (!workspaceId || !operationType) {
    console.error("[guard-block-log] cannot persist block event without workspace/operation type");
    return null;
  }

  try {
    const [row] = await db
      .insert(guardBlockEvents)
      .values({
        workspaceId,
        operationType,
        resourceType: payload.resourceType ?? "other",
        reasonCode: payload.reasonCode,
        message: payload.message,
        upgradeAvailable: payload.upgradeAvailable ?? false,
        limitKey: payload.limitKey ?? null,
        limitCurrent: payload.limitsHint?.current ?? null,
        limitValue: payload.limitsHint?.limit ?? null,
        limitUnit: payload.limitsHint?.unit ?? null,
        expectedCost: context?.expectedCost ? (context.expectedCost as JsonValue) : null,
        usageSnapshot: snapshot ? (snapshot as JsonValue) : null,
        meta: context?.meta ? (context.meta as JsonValue) : null,
        requestId:
          options?.requestId ??
          (context && typeof context === "object" && "correlationId" in context
            ? (context as Partial<OperationContext> & { correlationId?: string }).correlationId ?? null
            : null),
        actorType: options?.actor?.actorType ?? null,
        actorId: options?.actor?.actorId ?? null,
        isSoft: Boolean(options?.isSoft),
      })
      .returning();
    return row ?? null;
  } catch (error) {
    console.error("[guard-block-log] failed to persist block event:", error);
    return null;
  }
}

export type GuardBlockEventWithWorkspace = GuardBlockEvent & { workspaceName: string | null };

export async function listGuardBlockEvents(
  filters: BlockLogFilters,
): Promise<{ items: GuardBlockEventWithWorkspace[]; total: number }> {
  const limit = Math.min(Math.max(filters.limit ?? 50, 1), 200);
  const offset = Math.max(filters.offset ?? 0, 0);

  const conditions = [];
  if (filters.workspaceId) {
    conditions.push(eq(guardBlockEvents.workspaceId, filters.workspaceId));
  }
  if (filters.operationType) {
    conditions.push(eq(guardBlockEvents.operationType, filters.operationType));
  }
  if (filters.resourceType) {
    conditions.push(eq(guardBlockEvents.resourceType, filters.resourceType));
  }
  if (filters.reasonCode) {
    conditions.push(eq(guardBlockEvents.reasonCode, filters.reasonCode));
  }
  if (filters.dateFrom) {
    conditions.push(gte(guardBlockEvents.createdAt, filters.dateFrom));
  }
  if (filters.dateTo) {
    conditions.push(lte(guardBlockEvents.createdAt, filters.dateTo));
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [rows, countRows] = await Promise.all([
    db
      .select({
        event: guardBlockEvents,
        workspaceName: workspaces.name,
      })
      .from(guardBlockEvents)
      .leftJoin(workspaces, eq(workspaces.id, guardBlockEvents.workspaceId))
      .where(where)
      .orderBy(desc(guardBlockEvents.createdAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)` })
      .from(guardBlockEvents)
      .where(where),
  ]);

  const total = Number(countRows[0]?.count ?? 0);
  const items: GuardBlockEventWithWorkspace[] = rows.map((row) => ({
    ...row.event,
    workspaceName: row.workspaceName ?? null,
  }));
  return { items, total };
}
