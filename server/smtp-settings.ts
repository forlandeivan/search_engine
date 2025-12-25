import { eq, sql } from "drizzle-orm";

import { db } from "./db";
import { smtpSettings, type SmtpSettings as StoredSmtpSettings } from "@shared/schema";
import type { SmtpSettingsDto, UpdateSmtpSettingsDto } from "@shared/smtp";

export class SmtpSettingsError extends Error {
  status = 400;
  constructor(message: string) {
    super(message);
    this.name = "SmtpSettingsError";
  }
}

type SmtpSettingsRepository = {
  get(): Promise<StoredSmtpSettings | null>;
  upsert(settings: StoredSmtpSettings): Promise<StoredSmtpSettings>;
};

const SMTP_SINGLETON_ID = "smtp_singleton";

class DbSmtpSettingsRepository implements SmtpSettingsRepository {
  async get(): Promise<StoredSmtpSettings | null> {
    const [row] = await db.select().from(smtpSettings).where(eq(smtpSettings.id, SMTP_SINGLETON_ID)).limit(1);
    return row ?? null;
  }

  async upsert(settings: StoredSmtpSettings): Promise<StoredSmtpSettings> {
    const [row] = await db
      .insert(smtpSettings)
      .values(settings)
      .onConflictDoUpdate({
        target: smtpSettings.id,
        set: {
          host: settings.host,
          port: settings.port,
          useTls: settings.useTls,
          useSsl: settings.useSsl,
          username: settings.username,
          fromEmail: settings.fromEmail,
          fromName: settings.fromName,
          updatedByAdminId: settings.updatedByAdminId ?? null,
          updatedAt: sql`CURRENT_TIMESTAMP`,
          ...(settings.password !== undefined ? { password: settings.password } : {}),
        },
      })
      .returning();

    return row;
  }
}

function validateEmail(value: string): void {
  const trimmed = value.trim();
  // Простая проверка формата
  const basicPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!basicPattern.test(trimmed)) {
    throw new SmtpSettingsError("Invalid from email");
  }
}

function ensureLength(field: string, value: string | null | undefined, max = 255): string | null {
  if (value === undefined || value === null) return null;
  const trimmed = value.trim();
  if (trimmed.length > max) {
    throw new SmtpSettingsError(`Field '${field}' is too long`);
  }
  return trimmed;
}

function mapToDto(row: StoredSmtpSettings | null): SmtpSettingsDto {
  if (!row) {
    return {
      host: "",
      port: 587,
      useTls: true,
      useSsl: false,
      username: null,
      fromEmail: "",
      fromName: null,
      hasPassword: false,
    };
  }

  return {
    host: row.host,
    port: row.port,
    useTls: row.useTls,
    useSsl: row.useSsl,
    username: row.username ?? null,
    fromEmail: row.fromEmail,
    fromName: row.fromName ?? null,
    hasPassword: Boolean(row.password),
  };
}

export class SmtpSettingsService {
  constructor(private readonly repo: SmtpSettingsRepository = new DbSmtpSettingsRepository()) {}

  async getSettings(): Promise<SmtpSettingsDto> {
    const row = await this.repo.get();
    return mapToDto(row);
  }

  async getSettingsWithSecret(): Promise<StoredSmtpSettings | null> {
    return await this.repo.get();
  }

  async updateSettings(input: UpdateSmtpSettingsDto & { updatedByAdminId?: string | null }): Promise<SmtpSettingsDto> {
    const host = ensureLength("host", input.host, 255);
    if (!host) {
      throw new SmtpSettingsError("Invalid SMTP host");
    }

    const port = input.port;
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new SmtpSettingsError("Invalid SMTP port");
    }

    if (input.useTls && input.useSsl) {
      throw new SmtpSettingsError("TLS and SSL cannot be enabled at the same time");
    }

    const username = ensureLength("username", input.username, 255);
    const fromEmail = ensureLength("fromEmail", input.fromEmail, 255);
    if (!fromEmail) {
      throw new SmtpSettingsError("Invalid from email");
    }
    validateEmail(fromEmail);

    const fromName = ensureLength("fromName", input.fromName, 255);

    const existing = await this.repo.get();
    const shouldUpdatePassword = typeof input.password === "string" && input.password.trim().length > 0;
    const nextPassword = shouldUpdatePassword ? ensureLength("password", input.password, 255) : existing?.password ?? null;

    const record: StoredSmtpSettings = {
      id: existing?.id ?? SMTP_SINGLETON_ID,
      host,
      port,
      useTls: input.useTls,
      useSsl: input.useSsl,
      username,
      password: nextPassword ?? null,
      fromEmail,
      fromName,
      updatedByAdminId: input.updatedByAdminId ?? null,
      createdAt: existing?.createdAt ?? new Date(),
      updatedAt: new Date(),
    };

    const saved = await this.repo.upsert(record);
    return mapToDto(saved);
  }
}

export const smtpSettingsService = new SmtpSettingsService();
