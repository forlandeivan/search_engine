import { and, desc, eq, gte, lte, sql } from "drizzle-orm";

import { db } from "./db";
import { maintenanceModeAuditLog, type MaintenanceModeAuditLog } from "@shared/schema";

export type MaintenanceAuditLogEventType =
  | "enabled"
  | "disabled"
  | "schedule_updated"
  | "message_updated";

type CreateAuditLogInput = {
  eventType: MaintenanceAuditLogEventType;
  actorAdminId?: string | null;
  occurredAt?: Date;
  payload?: unknown;
};

type ListAuditLogParams = {
  page: number;
  pageSize: number;
  eventType?: MaintenanceAuditLogEventType;
  dateFrom?: Date;
  dateTo?: Date;
};

export class MaintenanceModeAuditLogService {
  async createLog(input: CreateAuditLogInput): Promise<MaintenanceModeAuditLog> {
    const [row] = await db
      .insert(maintenanceModeAuditLog)
      .values({
        eventType: input.eventType,
        actorAdminId: input.actorAdminId ?? null,
        occurredAt: input.occurredAt ?? new Date(),
        payload: (input.payload ?? {}) as any,
      })
      .returning();

    return row;
  }

  async list(params: ListAuditLogParams): Promise<{ items: MaintenanceModeAuditLog[]; total: number }> {
    const { page, pageSize, eventType, dateFrom, dateTo } = params;
    const conditions = [];

    if (eventType) {
      conditions.push(eq(maintenanceModeAuditLog.eventType, eventType));
    }
    if (dateFrom) {
      conditions.push(gte(maintenanceModeAuditLog.occurredAt, dateFrom));
    }
    if (dateTo) {
      conditions.push(lte(maintenanceModeAuditLog.occurredAt, dateTo));
    }

    const whereClause = conditions.length ? and(...conditions) : undefined;

    const [totalRow] = await db
      .select({ count: sql<number>`count(*)` })
      .from(maintenanceModeAuditLog)
      .where(whereClause ?? sql`true`);
    const total = Number(totalRow?.count ?? 0);

    const items = await db
      .select()
      .from(maintenanceModeAuditLog)
      .where(whereClause ?? sql`true`)
      .orderBy(desc(maintenanceModeAuditLog.occurredAt))
      .offset((page - 1) * pageSize)
      .limit(pageSize);

    return { items, total };
  }
}

export const maintenanceModeAuditLogService = new MaintenanceModeAuditLogService();
