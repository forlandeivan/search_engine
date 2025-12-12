import { describe, it, expect, beforeAll } from "vitest";
import bcrypt from "bcryptjs";
import { and, eq } from "drizzle-orm";
import { storage } from "../server/storage";
import { workspaceAsrUsageLedger, workspaces } from "@shared/schema";
import { formatUsagePeriodCode } from "../server/usage/usage-types";

async function ensureAsrLedgerTable() {
  await (storage as any).db.execute(`
    CREATE TABLE IF NOT EXISTS "workspace_asr_usage_ledger" (
      "id" varchar PRIMARY KEY DEFAULT gen_random_uuid()::text,
      "workspace_id" varchar NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
      "period_year" integer NOT NULL,
      "period_month" integer NOT NULL,
      "period_code" varchar(7) NOT NULL,
      "asr_job_id" varchar NOT NULL,
      "provider" text,
      "model" text,
      "duration_seconds" integer NOT NULL,
      "occurred_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "created_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE UNIQUE INDEX IF NOT EXISTS workspace_asr_usage_ledger_job_idx
      ON "workspace_asr_usage_ledger" ("workspace_id", "asr_job_id");
    CREATE INDEX IF NOT EXISTS workspace_asr_usage_ledger_period_idx
      ON "workspace_asr_usage_ledger" ("workspace_id", "period_code");
    CREATE INDEX IF NOT EXISTS workspace_asr_usage_ledger_occurred_idx
      ON "workspace_asr_usage_ledger" ("workspace_id", "occurred_at");
    CREATE INDEX IF NOT EXISTS workspace_asr_usage_ledger_provider_model_idx
      ON "workspace_asr_usage_ledger" ("workspace_id", "period_code", "provider", "model");
  `);
}

async function createUser(email: string) {
  const passwordHash = await bcrypt.hash("Password123!", 10);
  const user = await storage.createUser({
    email,
    fullName: "ASR Ledger User",
    firstName: "ASR",
    lastName: "Ledger",
    phone: "",
    passwordHash,
    isEmailConfirmed: true,
  });

  return {
    ...user,
    hasPersonalApiToken: false,
    personalApiTokenLastFour: null,
  };
}

async function createWorkspaceForUser(userId: string, id: string) {
  const [workspace] = await (storage as any).db
    .insert(workspaces)
    .values({
      id,
      name: `ASR Ledger Workspace ${id}`,
      ownerId: userId,
    })
    .returning();

  await storage.addWorkspaceMember(id, userId, "owner");
  return workspace;
}

describe("workspace_asr_usage_ledger", () => {
  let workspaceId: string;
  const asrJobId = `asr-${Date.now()}`;
  const now = new Date(Date.UTC(2025, 1, 20));
  const periodCode = formatUsagePeriodCode(now.getUTCFullYear(), now.getUTCMonth() + 1);

  beforeAll(async () => {
    await ensureAsrLedgerTable();
    const user = await createUser(`asr-ledger-${Date.now()}@example.com`);
    workspaceId = `asr-ledger-ws-${Date.now()}`;
    await createWorkspaceForUser(user.id, workspaceId);
  });

  it("inserts asr ledger record", async () => {
    const [inserted] = await (storage as any).db
      .insert(workspaceAsrUsageLedger)
      .values({
        workspaceId,
        periodYear: now.getUTCFullYear(),
        periodMonth: now.getUTCMonth() + 1,
        periodCode,
        asrJobId,
        provider: "yandex_speechkit",
        model: "default",
        durationSeconds: 120,
        occurredAt: now,
      })
      .returning();

    expect(inserted.workspaceId).toBe(workspaceId);
    expect(inserted.durationSeconds).toBe(120);
  });

  it("rejects duplicate asr_job_id within workspace", async () => {
    const insertDuplicate = () =>
      (storage as any).db.insert(workspaceAsrUsageLedger).values({
        workspaceId,
        periodYear: now.getUTCFullYear(),
        periodMonth: now.getUTCMonth() + 1,
        periodCode,
        asrJobId,
        provider: "yandex_speechkit",
        model: "default",
        durationSeconds: 60,
        occurredAt: now,
      });

    await expect(insertDuplicate()).rejects.toThrow();

    const rows = await (storage as any).db
      .select()
      .from(workspaceAsrUsageLedger)
      .where(
        and(
          eq(workspaceAsrUsageLedger.workspaceId, workspaceId),
          eq(workspaceAsrUsageLedger.asrJobId, asrJobId),
        ),
      );
    expect(rows).toHaveLength(1);
  });
});
