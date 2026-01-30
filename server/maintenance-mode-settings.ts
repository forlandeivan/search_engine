import { eq, sql } from "drizzle-orm";

import { db } from "./db";
import { getCache, cacheKeys } from "./cache";
import { maintenanceModeSettings, type MaintenanceModeSettings as StoredMaintenanceModeSettings } from "@shared/schema";
import {
  maintenanceModeSettingsSchema,
  updateMaintenanceModeSettingsSchema,
  type MaintenanceModeSettingsDto,
  type MaintenanceModeStatusDto,
} from "@shared/maintenance-mode";
import { maintenanceModeAuditLogService, type MaintenanceAuditLogEventType } from "./maintenance-mode-audit-log-service";

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
  scheduledStartAt: null,
  scheduledEndAt: null,
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

function parseDate(value: string | null): Date | null {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed;
}

function mapToDto(row: StoredMaintenanceModeSettings | null): MaintenanceModeSettingsDto {
  if (!row) {
    return { ...DEFAULT_SETTINGS };
  }

  const dto: MaintenanceModeSettingsDto = {
    scheduledStartAt: toIso(row.scheduledStartAt),
    scheduledEndAt: toIso(row.scheduledEndAt),
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
  constructor(private readonly repo: MaintenanceModeSettingsRepository = new DbMaintenanceModeSettingsRepository()) {}

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
    const scheduledStartAt = parseDate(parsed.scheduledStartAt);
    const scheduledEndAt = parseDate(parsed.scheduledEndAt);

    const record: StoredMaintenanceModeSettings = {
      id: existing?.id ?? MAINTENANCE_MODE_SINGLETON_ID,
      scheduledStartAt,
      scheduledEndAt,
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

    if (before.scheduledStartAt !== after.scheduledStartAt || before.scheduledEndAt !== after.scheduledEndAt) {
      events.push({
        type: "schedule_updated",
        payload: {
          before: {
            scheduledStartAt: before.scheduledStartAt,
            scheduledEndAt: before.scheduledEndAt,
          },
          after: {
            scheduledStartAt: after.scheduledStartAt,
            scheduledEndAt: after.scheduledEndAt,
          },
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

  async getEffectiveStatus(): Promise<MaintenanceModeStatusDto> {
    const settings = await this.getSettings();
    const now = new Date();
    const start = parseDate(settings.scheduledStartAt);
    const end = parseDate(settings.scheduledEndAt);

    let status: MaintenanceModeStatusDto["status"] = "off";
    if (settings.forceEnabled) {
      status = "active";
    } else if (start && end) {
      if (now >= start && now <= end) {
        status = "active";
      } else if (now < start) {
        status = "scheduled";
      } else {
        status = "off";
      }
    }

    return {
      ...settings,
      status,
      serverTime: now.toISOString(),
    };
  }
}

export const maintenanceModeSettingsService = new MaintenanceModeSettingsService();
