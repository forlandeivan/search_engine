import { describe, it, expect, beforeEach } from "vitest";
import { systemNotificationLogService } from "../server/system-notification-log-service";
import { db } from "../server/db";
import { systemNotificationLogs } from "@shared/schema";
import { sql, eq } from "drizzle-orm";

const longBody = "A".repeat(150 * 1024);
const longPreview = "B".repeat(600);

describe("SystemNotificationLogService", () => {
  beforeEach(async () => {
    await db.execute(sql`DELETE FROM system_notification_logs`);
  });

  it("creates log with truncated body and preview", async () => {
    const log = await systemNotificationLogService.createLog({
      type: "smtp_test",
      toEmail: "user@example.com",
      subject: "Test",
      body: longBody,
      bodyPreview: longPreview,
    });

    expect(log.id).toBeTruthy();
    expect(Buffer.byteLength(log.body ?? "", "utf8")).toBeLessThanOrEqual(100 * 1024);
    expect((log.bodyPreview ?? "").length).toBeLessThanOrEqual(601);
    expect(log.status).toBe("queued");
  });

  it("marks sent", async () => {
    const log = await systemNotificationLogService.createLog({
      type: "registration_confirmation",
      toEmail: "user@example.com",
      subject: "Test",
    });

    await systemNotificationLogService.markSent(log.id, { smtpResponse: "250 OK" });

    const [row] = await db.select().from(systemNotificationLogs).where(eq(systemNotificationLogs.id, log.id));
    expect(row?.status).toBe("sent");
    expect(row?.sentAt).toBeTruthy();
  });

  it("marks failed", async () => {
    const log = await systemNotificationLogService.createLog({
      type: "registration_confirmation",
      toEmail: "user@example.com",
      subject: "Test",
    });

    await systemNotificationLogService.markFailed(log.id, { errorMessage: "SMTP error" });

    const [row] = await db.select().from(systemNotificationLogs).where(eq(systemNotificationLogs.id, log.id));
    expect(row?.status).toBe("failed");
    expect(row?.errorMessage).toBe("SMTP error");
  });
});
