import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "../server/db";
import { workspaceAsrUsageLedger } from "@shared/schema";
import { getUsagePeriodForDate } from "../server/usage/usage-types";
import { getWorkspaceAsrUsageSummary, recordAsrUsageEvent } from "../server/usage/usage-service";

const TEST_WORKSPACE_ID = "workspace-asr-summary";
const TEST_USER_ID = "workspace-asr-summary-user";
const TEST_USER_EMAIL = "workspace-asr-summary@example.com";

async function cleanup() {
  await db.execute(sql`delete from "workspace_asr_usage_ledger" where "workspace_id" = ${TEST_WORKSPACE_ID}`);
  await db.execute(sql`delete from "workspace_usage_month" where "workspace_id" = ${TEST_WORKSPACE_ID}`);
  await db.execute(sql`delete from "workspaces" where "id" = ${TEST_WORKSPACE_ID}`);
  await db.execute(sql`delete from "users" where "id" = ${TEST_USER_ID}`);
}

async function ensureWorkspace(): Promise<void> {
  await db.execute(sql`
    INSERT INTO "users" (id, email, full_name, first_name, last_name, phone, password_hash, role, last_active_at, created_at, updated_at, is_email_confirmed)
    VALUES (${TEST_USER_ID}, ${TEST_USER_EMAIL}, 'ASR Summary User', 'ASR', 'Summary', '', null, 'user', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, true)
    ON CONFLICT (id) DO NOTHING
  `);

  await db.execute(sql`
    INSERT INTO "workspaces" (id, name, owner_id, plan, settings, created_at, updated_at)
    VALUES (${TEST_WORKSPACE_ID}, 'ASR Summary Workspace', ${TEST_USER_ID}, 'free', '{}'::jsonb, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT (id) DO NOTHING
  `);
}

describe("workspace asr usage summary", () => {
  beforeEach(async () => {
    await cleanup();
    await ensureWorkspace();
  });

  afterAll(async () => {
    await cleanup();
  });

  it("aggregates totals and timeseries for ASR", async () => {
    const period = getUsagePeriodForDate();

    await db.insert(workspaceAsrUsageLedger).values([
      {
        workspaceId: TEST_WORKSPACE_ID,
        periodYear: period.periodYear,
        periodMonth: period.periodMonth,
        periodCode: period.periodCode,
        asrJobId: "job1",
        provider: "yandex_speechkit",
        model: "default",
        durationSeconds: 90,
        occurredAt: new Date(`${period.periodYear}-${String(period.periodMonth).padStart(2, "0")}-05T10:00:00Z`),
      },
      {
        workspaceId: TEST_WORKSPACE_ID,
        periodYear: period.periodYear,
        periodMonth: period.periodMonth,
        periodCode: period.periodCode,
        asrJobId: "job2",
        provider: "yandex_speechkit",
        model: "default",
        durationSeconds: 30,
        occurredAt: new Date(`${period.periodYear}-${String(period.periodMonth).padStart(2, "0")}-05T11:00:00Z`),
      },
      {
        workspaceId: TEST_WORKSPACE_ID,
        periodYear: period.periodYear,
        periodMonth: period.periodMonth,
        periodCode: period.periodCode,
        asrJobId: "job3",
        provider: "gigachat_speech",
        model: "gigachat-asr",
        durationSeconds: 120,
        occurredAt: new Date(`${period.periodYear}-${String(period.periodMonth).padStart(2, "0")}-06T09:00:00Z`),
      },
    ]);

    const summary = await getWorkspaceAsrUsageSummary(TEST_WORKSPACE_ID, period.periodCode);

    expect(summary.totalMinutes).toBe(4); // суммарно 240s => ceil(240/60)=4 (агрегирование по сумме секунд)
    expect(summary.byProviderModelTotal).toEqual(
      expect.arrayContaining([
        { provider: "yandex_speechkit", model: "default", minutes: 2 }, // 90+30 =120s => ceil=2
        { provider: "gigachat_speech", model: "gigachat-asr", minutes: 2 },
      ]),
    );

    const day05 = summary.timeseries.find((t) => t.date.endsWith("-05"));
    const day06 = summary.timeseries.find((t) => t.date.endsWith("-06"));
    expect(day05?.minutes).toBe(2); // 90+30s = 120s => ceil=2
    expect(day06?.minutes).toBe(2);

    const providerSeries = summary.timeseriesByProviderModel.find(
      (s) => s.provider === "yandex_speechkit" && s.model === "default",
    );
    expect(providerSeries?.points).toEqual(
      expect.arrayContaining([
        { date: `${period.periodYear}-${String(period.periodMonth).padStart(2, "0")}-05`, minutes: 2 },
      ]),
    );
  });

  it("respects minute rounding and idempotency via recordAsrUsageEvent", async () => {
    const period = getUsagePeriodForDate();
    const now = new Date();
    const jobId = "job-round";

    await recordAsrUsageEvent({
      workspaceId: TEST_WORKSPACE_ID,
      asrJobId: jobId,
      durationSeconds: 10, // rounds to 1
      provider: "yandex_speechkit",
      model: "default",
      occurredAt: now,
      period,
    });

    await recordAsrUsageEvent({
      workspaceId: TEST_WORKSPACE_ID,
      asrJobId: jobId,
      durationSeconds: 50,
      provider: "yandex_speechkit",
      model: "default",
      occurredAt: now,
      period,
    });

    const summary = await getWorkspaceAsrUsageSummary(TEST_WORKSPACE_ID, period.periodCode);
    expect(summary.totalMinutes).toBe(1);
  });
});
