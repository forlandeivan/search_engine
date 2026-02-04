import { eq, sql } from "drizzle-orm";

import { db } from "./db";
import { getCache, cacheKeys } from "./cache";
import { maintenanceModeSettings, type MaintenanceModeSettings as StoredMaintenanceModeSettings } from "@shared/schema";
import {
  maintenanceModeSettingsSchema,
  updateMaintenanceModeSettingsSchema,
  type MaintenanceModeSettingsDto,
  type MaintenanceModeStatusDto,
  type UpdateMaintenanceModeSettingsDto,
} from "@shared/maintenance-mode";
import { maintenanceModeAuditLogService, type MaintenanceAuditLogEventType } from "./maintenance-mode-audit-log-service";
import {
  maintenanceModeScheduleService,
  type MaintenanceModeScheduleService,
} from "./maintenance-mode-schedule-service";
import {
  maintenanceModeForceSessionService,
  type MaintenanceModeForceSessionService,
} from "./maintenance-mode-force-session-service";

export class MaintenanceModeSettingsError extends Error {
  status = 400;
  constructor(message: string) {
    super(message);
    this.name = "MaintenanceModeSettingsError";
  }
}

type MaintenanceModeSettingsRepository = {
  get(): Promise<StoredMaintenanceModeSettings | null>;
  upsert(settings: StoredMaintenanceModeSettings): Promise<StoredMaintenanceModeSettings>;
};

const MAINTENANCE_MODE_SINGLETON_ID = "maintenance_mode_singleton";
const MAINTENANCE_SETTINGS_CACHE_TTL_MS = 60_000;

const DEFAULT_SETTINGS: MaintenanceModeSettingsDto = {
  forceEnabled: false,
  messageTitle: "",
  messageBody: "",
  publicEta: null,
};

class DbMaintenanceModeSettingsRepository implements MaintenanceModeSettingsRepository {
  async get(): Promise<StoredMaintenanceModeSettings | null> {
    const [row] = await db
      .select()
      .from(maintenanceModeSettings)
      .where(eq(maintenanceModeSettings.id, MAINTENANCE_MODE_SINGLETON_ID))
      .limit(1);
    return row ?? null;
  }

  async upsert(settings: StoredMaintenanceModeSettings): Promise<StoredMaintenanceModeSettings> {
    const [row] = await db
      .insert(maintenanceModeSettings)
      .values(settings)
      .onConflictDoUpdate({
        target: maintenanceModeSettings.id,
        set: {
          scheduledStartAt: settings.scheduledStartAt,
          scheduledEndAt: settings.scheduledEndAt,
          forceEnabled: settings.forceEnabled,
          messageTitle: settings.messageTitle,
          messageBody: settings.messageBody,
          publicEta: settings.publicEta,
          updatedByAdminId: settings.updatedByAdminId ?? null,
          updatedAt: sql`CURRENT_TIMESTAMP`,
        },
      })
      .returning();

    return row;
  }
}

function mapToDto(row: StoredMaintenanceModeSettings | null): MaintenanceModeSettingsDto {
  if (!row) {
    return { ...DEFAULT_SETTINGS };
  }

  const dto: MaintenanceModeSettingsDto = {
    forceEnabled: row.forceEnabled,
    messageTitle: row.messageTitle ?? "",
    messageBody: row.messageBody ?? "",
    publicEta: row.publicEta ?? null,
  };

  const parsed = maintenanceModeSettingsSchema.safeParse(dto);
  if (!parsed.success) {
    return { ...DEFAULT_SETTINGS };
  }
  return parsed.data;
}

function normalizeString(value: string | null | undefined, maxLength: number): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed.length > maxLength) {
    throw new MaintenanceModeSettingsError(`Field exceeds ${maxLength} chars`);
  }
  return trimmed;
}

export class MaintenanceModeSettingsService {
  constructor(
    private readonly repo: MaintenanceModeSettingsRepository = new DbMaintenanceModeSettingsRepository(),
    private readonly scheduleService: MaintenanceModeScheduleService = maintenanceModeScheduleService,
    private readonly forceSessionService: MaintenanceModeForceSessionService = maintenanceModeForceSessionService,
  ) {}

  async getSettings(): Promise<MaintenanceModeSettingsDto> {
    const cache = getCache();
    const cacheKey = cacheKeys.maintenanceModeSettings();
    const cached = await cache.get<MaintenanceModeSettingsDto>(cacheKey);
    if (cached) {
      return cached;
    }

    const row = await this.repo.get();
    const dto = mapToDto(row);
    await cache.set(cacheKey, dto, MAINTENANCE_SETTINGS_CACHE_TTL_MS);
    return dto;
  }

  async updateSettings(
    input: UpdateMaintenanceModeSettingsDto & { updatedByAdminId?: string | null },
  ): Promise<MaintenanceModeSettingsDto> {
    const parsed = updateMaintenanceModeSettingsSchema.parse(input);

    const existing = await this.repo.get();
    const before = mapToDto(existing);

    const record: StoredMaintenanceModeSettings = {
      id: existing?.id ?? MAINTENANCE_MODE_SINGLETON_ID,
      scheduledStartAt: null,
      scheduledEndAt: null,
      forceEnabled: parsed.forceEnabled,
      messageTitle: normalizeString(parsed.messageTitle, 120) ?? "",
      messageBody: normalizeString(parsed.messageBody, 2000) ?? "",
      publicEta: normalizeString(parsed.publicEta, 255),
      updatedByAdminId: input.updatedByAdminId ?? existing?.updatedByAdminId ?? null,
      createdAt: existing?.createdAt ?? new Date(),
      updatedAt: new Date(),
    };

    const saved = await this.repo.upsert(record);
    const dto = mapToDto(saved);

    const cache = getCache();
    await cache.set(cacheKeys.maintenanceModeSettings(), dto, MAINTENANCE_SETTINGS_CACHE_TTL_MS);

    await this.logChanges(before, dto, input.updatedByAdminId ?? null);
    await this.syncForceSessions(before, dto, input.updatedByAdminId ?? null);

    return dto;
  }

  private async logChanges(
    before: MaintenanceModeSettingsDto,
    after: MaintenanceModeSettingsDto,
    actorAdminId: string | null,
  ): Promise<void> {
    const events: Array<{ type: MaintenanceAuditLogEventType; payload: unknown }> = [];

    if (before.forceEnabled !== after.forceEnabled) {
      events.push({
        type: after.forceEnabled ? "enabled" : "disabled",
        payload: {
          before: { forceEnabled: before.forceEnabled },
          after: { forceEnabled: after.forceEnabled },
        },
      });
    }

    if (
      before.messageTitle !== after.messageTitle ||
      before.messageBody !== after.messageBody ||
      before.publicEta !== after.publicEta
    ) {
      events.push({
        type: "message_updated",
        payload: {
          before: {
            messageTitle: before.messageTitle,
            messageBody: before.messageBody,
            publicEta: before.publicEta,
          },
          after: {
            messageTitle: after.messageTitle,
            messageBody: after.messageBody,
            publicEta: after.publicEta,
          },
        },
      });
    }

    if (events.length === 0) {
      return;
    }

    await Promise.all(
      events.map((event) =>
        maintenanceModeAuditLogService.createLog({
          eventType: event.type,
          actorAdminId,
          payload: event.payload,
        }),
      ),
    );
  }

  private async syncForceSessions(
    before: MaintenanceModeSettingsDto,
    after: MaintenanceModeSettingsDto,
    actorAdminId: string | null,
  ): Promise<void> {
    if (!before.forceEnabled && after.forceEnabled) {
      await this.forceSessionService.startSession({
        actorAdminId,
        messageTitle: after.messageTitle ?? "",
        messageBody: after.messageBody ?? "",
        publicEta: after.publicEta ?? null,
      });
      return;
    }

    if (before.forceEnabled && !after.forceEnabled) {
      await this.forceSessionService.endActiveSession(actorAdminId);
      return;
    }

    if (
      before.forceEnabled &&
      after.forceEnabled &&
      (before.messageTitle !== after.messageTitle ||
        before.messageBody !== after.messageBody ||
        before.publicEta !== after.publicEta)
    ) {
      await this.forceSessionService.updateActiveSessionMessages({
        messageTitle: after.messageTitle ?? "",
        messageBody: after.messageBody ?? "",
        publicEta: after.publicEta ?? null,
      });
    }
  }

  async getEffectiveStatus(): Promise<MaintenanceModeStatusDto> {
    const settings = await this.getSettings();
    const now = new Date();

    let status: MaintenanceModeStatusDto["status"] = "off";
    let scheduledStartAt: string | null = null;
    let scheduledEndAt: string | null = null;
    let messageTitle = settings.messageTitle ?? "";
    let messageBody = settings.messageBody ?? "";
    let publicEta = settings.publicEta ?? null;

    if (settings.forceEnabled) {
      status = "active";
    } else {
      const nearest = await this.scheduleService.findNearestSchedule(now);
      if (nearest) {
        const start = new Date(nearest.scheduledStartAt);
        const end = new Date(nearest.scheduledEndAt);
        if (!Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime())) {
          if (now >= start && now <= end) {
            scheduledStartAt = nearest.scheduledStartAt;
            scheduledEndAt = nearest.scheduledEndAt;
            status = "active";
            messageTitle = nearest.messageTitle ?? "";
            messageBody = nearest.messageBody ?? "";
            publicEta = nearest.publicEta ?? null;
          } else if (now < start) {
            scheduledStartAt = nearest.scheduledStartAt;
            scheduledEndAt = nearest.scheduledEndAt;
            status = "scheduled";
            messageTitle = nearest.messageTitle ?? "";
            messageBody = nearest.messageBody ?? "";
            publicEta = nearest.publicEta ?? null;
          }
        }
      }
    }

    return {
      ...settings,
      status,
      scheduledStartAt,
      scheduledEndAt,
      messageTitle,
      messageBody,
      publicEta,
      serverTime: now.toISOString(),
    };
  }
}

export const maintenanceModeSettingsService = new MaintenanceModeSettingsService();
