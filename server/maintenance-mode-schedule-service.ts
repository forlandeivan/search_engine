import { and, asc, desc, eq, gt, gte, lte, sql } from "drizzle-orm";

import { db } from "./db";
import { maintenanceModeSchedules, type MaintenanceModeSchedule, users } from "@shared/schema";
import {
  maintenanceModeScheduleInputSchema,
  type MaintenanceModeScheduleDto,
  type MaintenanceModeScheduleInputDto,
  type MaintenanceModeScheduleListItemDto,
} from "@shared/maintenance-mode";
import { maintenanceModeAuditLogService } from "./maintenance-mode-audit-log-service";

export class MaintenanceModeScheduleError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
    this.name = "MaintenanceModeScheduleError";
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

function parseRequiredDate(value: string): Date {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new MaintenanceModeScheduleError("Invalid schedule datetime");
  }
  return parsed;
}

function normalizeText(value: string, maxLength: number): string {
  const trimmed = value.trim();
  if (trimmed.length > maxLength) {
    throw new MaintenanceModeScheduleError(`Field exceeds ${maxLength} chars`);
  }
  return trimmed;
}

function resolveAdminName(admin: typeof users.$inferSelect | null): string | null {
  if (!admin) return null;
  const fullName = `${admin.firstName ?? ""} ${admin.lastName ?? ""}`.trim();
  if (fullName) return fullName;
  return admin.fullName?.trim() || null;
}

function mapToDto(row: MaintenanceModeSchedule): MaintenanceModeScheduleDto {
  const scheduledStartAt = toIso(row.scheduledStartAt);
  const scheduledEndAt = toIso(row.scheduledEndAt);
  const createdAt = toIso(row.createdAt);
  const updatedAt = toIso(row.updatedAt);

  if (!scheduledStartAt || !scheduledEndAt || !createdAt || !updatedAt) {
    throw new MaintenanceModeScheduleError("Invalid schedule data");
  }

  return {
    id: row.id,
    scheduledStartAt,
    scheduledEndAt,
    messageTitle: row.messageTitle ?? "",
    messageBody: row.messageBody ?? "",
    publicEta: row.publicEta ?? null,
    createdByAdminId: row.createdByAdminId ?? null,
    updatedByAdminId: row.updatedByAdminId ?? null,
    createdAt,
    updatedAt,
  };
}

export class MaintenanceModeScheduleService {
  async list(): Promise<MaintenanceModeScheduleDto[]> {
    const rows = await db
      .select()
      .from(maintenanceModeSchedules)
      .orderBy(asc(maintenanceModeSchedules.scheduledStartAt));
    return rows.map(mapToDto);
  }

  async listWithInitiator(): Promise<MaintenanceModeScheduleListItemDto[]> {
    const rows = await db
      .select({
        schedule: maintenanceModeSchedules,
        admin: users,
      })
      .from(maintenanceModeSchedules)
      .leftJoin(users, eq(maintenanceModeSchedules.createdByAdminId, users.id))
      .orderBy(asc(maintenanceModeSchedules.scheduledStartAt));

    return rows.map(({ schedule, admin }) => ({
      ...mapToDto(schedule),
      initiatorName: resolveAdminName(admin),
    }));
  }

  async findNearestSchedule(now: Date): Promise<MaintenanceModeScheduleDto | null> {
    const [active] = await db
      .select()
      .from(maintenanceModeSchedules)
      .where(
        and(
          lte(maintenanceModeSchedules.scheduledStartAt, now),
          gte(maintenanceModeSchedules.scheduledEndAt, now),
        ),
      )
      .orderBy(desc(maintenanceModeSchedules.scheduledStartAt))
      .limit(1);

    if (active) {
      return mapToDto(active);
    }

    const [upcoming] = await db
      .select()
      .from(maintenanceModeSchedules)
      .where(gt(maintenanceModeSchedules.scheduledStartAt, now))
      .orderBy(asc(maintenanceModeSchedules.scheduledStartAt))
      .limit(1);

    return upcoming ? mapToDto(upcoming) : null;
  }

  async create(
    input: MaintenanceModeScheduleInputDto & { updatedByAdminId?: string | null },
  ): Promise<MaintenanceModeScheduleDto> {
    const parsed = maintenanceModeScheduleInputSchema.parse(input);
    const scheduledStartAt = parseRequiredDate(parsed.scheduledStartAt);
    const scheduledEndAt = parseRequiredDate(parsed.scheduledEndAt);
    const messageTitle = normalizeText(parsed.messageTitle ?? "", 120);
    const messageBody = normalizeText(parsed.messageBody ?? "", 2000);
    const publicEta = parsed.publicEta ? normalizeText(parsed.publicEta, 255) : null;

    const [row] = await db
      .insert(maintenanceModeSchedules)
      .values({
        scheduledStartAt,
        scheduledEndAt,
        messageTitle,
        messageBody,
        publicEta,
        createdByAdminId: input.updatedByAdminId ?? null,
        updatedByAdminId: input.updatedByAdminId ?? null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    const dto = mapToDto(row);

    await maintenanceModeAuditLogService.createLog({
      eventType: "schedule_created",
      actorAdminId: input.updatedByAdminId ?? null,
      payload: {
        scheduleId: dto.id,
        after: {
          scheduledStartAt: dto.scheduledStartAt,
          scheduledEndAt: dto.scheduledEndAt,
        },
      },
    });

    return dto;
  }

  async update(
    id: string,
    input: MaintenanceModeScheduleInputDto & { updatedByAdminId?: string | null },
  ): Promise<MaintenanceModeScheduleDto> {
    const parsed = maintenanceModeScheduleInputSchema.parse(input);
    const scheduledStartAt = parseRequiredDate(parsed.scheduledStartAt);
    const scheduledEndAt = parseRequiredDate(parsed.scheduledEndAt);
    const messageTitle = normalizeText(parsed.messageTitle ?? "", 120);
    const messageBody = normalizeText(parsed.messageBody ?? "", 2000);
    const publicEta = parsed.publicEta ? normalizeText(parsed.publicEta, 255) : null;

    const [beforeRow] = await db
      .select()
      .from(maintenanceModeSchedules)
      .where(eq(maintenanceModeSchedules.id, id))
      .limit(1);

    if (!beforeRow) {
      throw new MaintenanceModeScheduleError("Schedule not found", 404);
    }

    const [row] = await db
      .update(maintenanceModeSchedules)
      .set({
        scheduledStartAt,
        scheduledEndAt,
        messageTitle,
        messageBody,
        publicEta,
        updatedByAdminId: input.updatedByAdminId ?? null,
        updatedAt: sql`CURRENT_TIMESTAMP`,
      })
      .where(eq(maintenanceModeSchedules.id, id))
      .returning();

    const dto = mapToDto(row);
    const before = mapToDto(beforeRow);

    await maintenanceModeAuditLogService.createLog({
      eventType: "schedule_updated",
      actorAdminId: input.updatedByAdminId ?? null,
      payload: {
        scheduleId: dto.id,
        before: {
          scheduledStartAt: before.scheduledStartAt,
          scheduledEndAt: before.scheduledEndAt,
        },
        after: {
          scheduledStartAt: dto.scheduledStartAt,
          scheduledEndAt: dto.scheduledEndAt,
        },
      },
    });

    return dto;
  }

  async remove(id: string, actorAdminId?: string | null): Promise<void> {
    const [row] = await db
      .select()
      .from(maintenanceModeSchedules)
      .where(eq(maintenanceModeSchedules.id, id))
      .limit(1);

    if (!row) {
      throw new MaintenanceModeScheduleError("Schedule not found", 404);
    }

    await db.delete(maintenanceModeSchedules).where(eq(maintenanceModeSchedules.id, id));

    const before = mapToDto(row);

    await maintenanceModeAuditLogService.createLog({
      eventType: "schedule_deleted",
      actorAdminId: actorAdminId ?? null,
      payload: {
        scheduleId: before.id,
        before: {
          scheduledStartAt: before.scheduledStartAt,
          scheduledEndAt: before.scheduledEndAt,
        },
      },
    });
  }
}

export const maintenanceModeScheduleService = new MaintenanceModeScheduleService();
