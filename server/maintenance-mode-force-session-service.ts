import { desc, eq, isNull, sql } from "drizzle-orm";

import { db } from "./db";
import { maintenanceModeForceSessions, type MaintenanceModeForceSession, users } from "@shared/schema";
import {
  type MaintenanceModeForceSessionDto,
  type MaintenanceModeForceSessionListItemDto,
} from "@shared/maintenance-mode";

export class MaintenanceModeForceSessionError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
    this.name = "MaintenanceModeForceSessionError";
  }
}

function toIso(value: Date | string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function resolveAdminName(admin: typeof users.$inferSelect | null): string | null {
  if (!admin) return null;
  const fullName = `${admin.firstName ?? ""} ${admin.lastName ?? ""}`.trim();
  if (fullName) return fullName;
  return admin.fullName?.trim() || null;
}

function mapToDto(row: MaintenanceModeForceSession): MaintenanceModeForceSessionDto {
  const startedAt = toIso(row.startedAt);
  const endedAt = toIso(row.endedAt);
  const createdAt = toIso(row.createdAt);
  const updatedAt = toIso(row.updatedAt);

  if (!startedAt || !createdAt || !updatedAt) {
    throw new MaintenanceModeForceSessionError("Invalid force session data");
  }

  return {
    id: row.id,
    startedAt,
    endedAt,
    createdByAdminId: row.createdByAdminId ?? null,
    endedByAdminId: row.endedByAdminId ?? null,
    messageTitle: row.messageTitle ?? "",
    messageBody: row.messageBody ?? "",
    publicEta: row.publicEta ?? null,
    createdAt,
    updatedAt,
  };
}

export class MaintenanceModeForceSessionService {
  async listWithInitiator(): Promise<MaintenanceModeForceSessionListItemDto[]> {
    const rows = await db
      .select({
        session: maintenanceModeForceSessions,
        admin: users,
      })
      .from(maintenanceModeForceSessions)
      .leftJoin(users, eq(maintenanceModeForceSessions.createdByAdminId, users.id))
      .orderBy(desc(maintenanceModeForceSessions.startedAt));

    return rows.map(({ session, admin }) => ({
      ...mapToDto(session),
      initiatorName: resolveAdminName(admin),
    }));
  }

  async startSession(input: {
    actorAdminId?: string | null;
    messageTitle: string;
    messageBody: string;
    publicEta: string | null;
  }): Promise<MaintenanceModeForceSessionDto> {
    const [row] = await db
      .insert(maintenanceModeForceSessions)
      .values({
        startedAt: new Date(),
        endedAt: null,
        createdByAdminId: input.actorAdminId ?? null,
        endedByAdminId: null,
        messageTitle: input.messageTitle,
        messageBody: input.messageBody,
        publicEta: input.publicEta,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    return mapToDto(row);
  }

  async endActiveSession(actorAdminId?: string | null): Promise<void> {
    const [active] = await db
      .select()
      .from(maintenanceModeForceSessions)
      .where(isNull(maintenanceModeForceSessions.endedAt))
      .orderBy(desc(maintenanceModeForceSessions.startedAt))
      .limit(1);

    if (!active) {
      return;
    }

    await db
      .update(maintenanceModeForceSessions)
      .set({
        endedAt: new Date(),
        endedByAdminId: actorAdminId ?? null,
        updatedAt: sql`CURRENT_TIMESTAMP`,
      })
      .where(eq(maintenanceModeForceSessions.id, active.id));
  }

  async updateActiveSessionMessages(input: {
    messageTitle: string;
    messageBody: string;
    publicEta: string | null;
  }): Promise<void> {
    const [active] = await db
      .select()
      .from(maintenanceModeForceSessions)
      .where(isNull(maintenanceModeForceSessions.endedAt))
      .orderBy(desc(maintenanceModeForceSessions.startedAt))
      .limit(1);

    if (!active) {
      return;
    }

    await db
      .update(maintenanceModeForceSessions)
      .set({
        messageTitle: input.messageTitle,
        messageBody: input.messageBody,
        publicEta: input.publicEta,
        updatedAt: sql`CURRENT_TIMESTAMP`,
      })
      .where(eq(maintenanceModeForceSessions.id, active.id));
  }
}

export const maintenanceModeForceSessionService = new MaintenanceModeForceSessionService();
