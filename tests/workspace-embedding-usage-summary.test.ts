import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "../server/db";
import { workspaceEmbeddingUsageLedger, users, workspaces } from "@shared/schema";
import { getUsagePeriodForDate } from "../server/usage/usage-types";
import { getWorkspaceEmbeddingUsageSummary } from "../server/usage/usage-service";

const TEST_WORKSPACE_ID = "workspace-embedding-summary";
const TEST_USER_ID = "workspace-embedding-summary-user";
const TEST_USER_EMAIL = "workspace-embedding-summary@example.com";

async function cleanup() {
  await db.execute(sql`delete from "workspace_embedding_usage_ledger" where "workspace_id" = ${TEST_WORKSPACE_ID}`);
  await db.execute(sql`delete from "workspaces" where "id" = ${TEST_WORKSPACE_ID}`);
  await db.execute(sql`delete from "users" where "id" = ${TEST_USER_ID}`);
}

async function ensureWorkspace(): Promise<void> {
  await db
    .insert(users)
    .values({
      id: TEST_USER_ID,
      email: TEST_USER_EMAIL,
      fullName: "Embedding Summary User",
      firstName: "Embedding",
      lastName: "Summary",
      phone: "",
    })
    .onConflictDoNothing();

  await db
    .insert(workspaces)
    .values({
      id: TEST_WORKSPACE_ID,
      name: "Embedding Summary Workspace",
      ownerId: TEST_USER_ID,
    })
    .onConflictDoNothing();
}

describe("workspace embedding usage summary", () => {
  beforeEach(async () => {
    await cleanup();
    await ensureWorkspace();
  });

  afterAll(async () => {
    await cleanup();
  });

  it("aggregates totals, by model, and timeseries for embeddings", async () => {
    const period = getUsagePeriodForDate();

    await db.insert(workspaceEmbeddingUsageLedger).values([
      {
        workspaceId: TEST_WORKSPACE_ID,
        periodYear: period.periodYear,
        periodMonth: period.periodMonth,
        periodCode: period.periodCode,
        operationId: "op1",
        provider: "provA",
        model: "modelA",
        tokensTotal: 50,
        contentBytes: 100,
        occurredAt: new Date(`${period.periodYear}-${String(period.periodMonth).padStart(2, "0")}-05T10:00:00Z`),
      },
      {
        workspaceId: TEST_WORKSPACE_ID,
        periodYear: period.periodYear,
        periodMonth: period.periodMonth,
        periodCode: period.periodCode,
        operationId: "op2",
        provider: "provA",
        model: "modelA",
        tokensTotal: 20,
        contentBytes: 40,
        occurredAt: new Date(`${period.periodYear}-${String(period.periodMonth).padStart(2, "0")}-05T12:00:00Z`),
      },
      {
        workspaceId: TEST_WORKSPACE_ID,
        periodYear: period.periodYear,
        periodMonth: period.periodMonth,
        periodCode: period.periodCode,
        operationId: "op3",
        provider: "provB",
        model: "modelB",
        tokensTotal: 30,
        contentBytes: 60,
        occurredAt: new Date(`${period.periodYear}-${String(period.periodMonth).padStart(2, "0")}-06T09:00:00Z`),
      },
    ]);

    const summary = await getWorkspaceEmbeddingUsageSummary(TEST_WORKSPACE_ID, period.periodCode);

    expect(summary.totalTokens).toBe(100);
    expect(summary.byModelTotal).toEqual(
      expect.arrayContaining([
        { provider: "provA", model: "modelA", tokens: 70 },
        { provider: "provB", model: "modelB", tokens: 30 },
      ]),
    );

    const provATimeseries = summary.timeseries.find((t) => t.provider === "provA" && t.model === "modelA");
    const provBTimeseries = summary.timeseries.find((t) => t.provider === "provB" && t.model === "modelB");

    expect(provATimeseries).toBeDefined();
    expect(provATimeseries?.points).toEqual(
      expect.arrayContaining([
        { date: `${period.periodYear}-${String(period.periodMonth).padStart(2, "0")}-05`, tokens: 70 },
      ]),
    );

    expect(provBTimeseries).toBeDefined();
    expect(provBTimeseries?.points).toEqual(
      expect.arrayContaining([
        { date: `${period.periodYear}-${String(period.periodMonth).padStart(2, "0")}-06`, tokens: 30 },
      ]),
    );
  });
});
