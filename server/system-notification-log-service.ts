import { db } from "./db";
import { systemNotificationLogs, type SystemNotificationLog } from "@shared/schema";
import { and, desc, eq, gte, ilike, lt, lte, sql } from "drizzle-orm";

type CreateLogInput = {
  type: string;
  toEmail: string;
  subject: string;
  body?: string | null;
  bodyPreview?: string | null;
  status?: string;
  errorMessage?: string | null;
  smtpResponse?: string | null;
  correlationId?: string | null;
  triggeredByUserId?: string | null;
};

const BODY_MAX_BYTES = 100 * 1024; // 100 KB
const PREVIEW_MAX_CHARS = 500;
const DEFAULT_RETENTION_DAYS = 90;

function truncateByBytes(value: string, maxBytes: number): string {
  const buf = Buffer.from(value ?? "", "utf8");
  if (buf.length <= maxBytes) return value;
  const truncated = buf.subarray(0, maxBytes).toString("utf8");
  return truncated;
}

function truncatePreview(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return value.slice(0, maxChars) + "…";
}

export class SystemNotificationLogService {
  async createLog(input: CreateLogInput): Promise<SystemNotificationLog> {
    const bodyPreview = input.bodyPreview
      ? truncatePreview(input.bodyPreview, PREVIEW_MAX_CHARS)
      : input.body
        ? truncatePreview(input.body, PREVIEW_MAX_CHARS)
        : null;

    const body =
      typeof input.body === "string"
        ? truncateByBytes(input.body, BODY_MAX_BYTES)
        : input.body ?? null;

    const [row] = await db
      .insert(systemNotificationLogs)
      .values({
        type: input.type,
        toEmail: input.toEmail,
        subject: input.subject,
        bodyPreview,
        body,
        status: input.status ?? "queued",
        errorMessage: input.errorMessage ?? null,
        smtpResponse: input.smtpResponse ?? null,
        correlationId: input.correlationId ?? null,
        triggeredByUserId: input.triggeredByUserId ?? null,
      })
      .returning();

    return row;
  }

  async markSent(
    id: string,
    options?: { sentAt?: Date; smtpResponse?: string | null },
  ): Promise<void> {
    const sentAt = options?.sentAt ?? new Date();
    await db
      .update(systemNotificationLogs)
      .set({
        status: "sent",
        sentAt,
        smtpResponse: options?.smtpResponse ?? null,
        errorMessage: null,
      })
      .where(eq(systemNotificationLogs.id, id));
  }

  async markFailed(
    id: string,
    options: { errorMessage?: string | null; smtpResponse?: string | null },
  ): Promise<void> {
    const errorMessage = options.errorMessage ? truncateByBytes(options.errorMessage, BODY_MAX_BYTES) : null;
    await db
      .update(systemNotificationLogs)
      .set({
        status: "failed",
        errorMessage,
        smtpResponse: options.smtpResponse ?? null,
        sentAt: null,
      })
      .where(eq(systemNotificationLogs.id, id));
  }

  async cleanupOldLogs(retentionDays: number = DEFAULT_RETENTION_DAYS): Promise<number> {
    const thresholdDate = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
    // Для устранения ошибок биндинга в prepared statement (08P01) используем raw-запрос без параметров
    // Значение рассчитывается в коде и подставляется явно.
    const thresholdIso = thresholdDate.toISOString();
    const result = await db.execute(
      sql.raw(`delete from "system_notification_logs" where "created_at" < '${thresholdIso}' returning "id"`),
    );
    const rows = ((result as any)?.rows ?? []) as Array<{ id: string }>;
    return rows.length;
  }

  async getById(id: string): Promise<SystemNotificationLog | null> {
    const [row] = await db.select().from(systemNotificationLogs).where(eq(systemNotificationLogs.id, id)).limit(1);
    return row ?? null;
  }

  async list(params: {
    email?: string;
    type?: string;
    status?: string;
    dateFrom?: Date;
    dateTo?: Date;
    page: number;
    pageSize: number;
  }): Promise<{ items: SystemNotificationLog[]; total: number }> {
    const { email, type, status, dateFrom, dateTo, page, pageSize } = params;
    const conditions = [];
    if (email) {
      conditions.push(ilike(systemNotificationLogs.toEmail, `%${email}%`));
    }
    if (type) {
      conditions.push(eq(systemNotificationLogs.type, type));
    }
    if (status) {
      conditions.push(eq(systemNotificationLogs.status, status));
    }
    if (dateFrom) {
      conditions.push(gte(systemNotificationLogs.createdAt, dateFrom));
    }
    if (dateTo) {
      conditions.push(lte(systemNotificationLogs.createdAt, dateTo));
    }

    const whereClause = conditions.length ? and(...conditions) : undefined;

    const [totalRow] = await db
      .select({ count: sql<number>`count(*)` })
      .from(systemNotificationLogs)
      .where(whereClause ?? sql`true`);
    const total = Number(totalRow?.count ?? 0);

    const items = await db
      .select()
      .from(systemNotificationLogs)
      .where(whereClause ?? sql`true`)
      .orderBy(desc(systemNotificationLogs.createdAt))
      .offset((page - 1) * pageSize)
      .limit(pageSize);

    return { items, total };
  }
}

export const systemNotificationLogService = new SystemNotificationLogService();
