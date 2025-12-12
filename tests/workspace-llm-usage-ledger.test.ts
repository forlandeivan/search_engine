import { beforeAll, describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";
import { and, eq } from "drizzle-orm";
import { storage } from "../server/storage";
import { workspaceLlmUsageLedger, workspaceUsageMonth, workspaces } from "@shared/schema";
import { formatUsagePeriodCode } from "../server/usage/usage-types";
import { recordLlmUsageEvent, getWorkspaceLlmUsageSummary } from "../server/usage/usage-service";

async function createUser(email: string) {
  const passwordHash = await bcrypt.hash("Password123!", 10);
  const user = await storage.createUser({
    email,
    fullName: "LLM Ledger User",
    firstName: "LLM",
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
      name: `LLM Ledger Workspace ${id}`,
      ownerId: userId,
    })
    .returning();

  await storage.addWorkspaceMember(id, userId, "owner");
  return workspace;
}

describe("workspace_llm_usage_ledger", () => {
  let workspaceId: string;
  const executionId = `exec-${Date.now()}`;
  const now = new Date(Date.UTC(2025, 1, 15));
  const periodCode = formatUsagePeriodCode(now.getUTCFullYear(), now.getUTCMonth() + 1);

  beforeAll(async () => {
    const user = await createUser(`llm-ledger-${Date.now()}@example.com`);
    workspaceId = `llm-ledger-ws-${Date.now()}`;
    await createWorkspaceForUser(user.id, workspaceId);
  });

  it("inserts ledger record", async () => {
    const [inserted] = await (storage as any).db
      .insert(workspaceLlmUsageLedger)
      .values({
        workspaceId,
        periodYear: now.getUTCFullYear(),
        periodMonth: now.getUTCMonth() + 1,
        periodCode,
        executionId,
        provider: "gigachat",
        model: "GigaChat-2",
        tokensTotal: 123,
        tokensPrompt: 100,
        tokensCompletion: 23,
        occurredAt: now,
      })
      .returning();

    expect(inserted.workspaceId).toBe(workspaceId);
    expect(inserted.tokensTotal).toBe(123);
  });

  it("rejects duplicate execution_id within workspace", async () => {
    const insertDuplicate = () =>
      (storage as any).db.insert(workspaceLlmUsageLedger).values({
        workspaceId,
        periodYear: now.getUTCFullYear(),
        periodMonth: now.getUTCMonth() + 1,
        periodCode,
        executionId,
        provider: "gigachat",
        model: "GigaChat-2",
        tokensTotal: 50,
        occurredAt: now,
      });

    await expect(insertDuplicate()).rejects.toThrow();

    const rows = await (storage as any).db
      .select()
      .from(workspaceLlmUsageLedger)
      .where(and(eq(workspaceLlmUsageLedger.workspaceId, workspaceId), eq(workspaceLlmUsageLedger.executionId, executionId)));
    expect(rows).toHaveLength(1);
  });

  it("increments aggregate only once per execution", async () => {
    const user = await createUser(`llm-ledger-agg-${Date.now()}@example.com`);
    const aggWorkspaceId = `llm-ledger-agg-ws-${Date.now()}`;
    await createWorkspaceForUser(user.id, aggWorkspaceId);
    const execId = `agg-${Date.now()}`;
    const tokens = 77;

    await recordLlmUsageEvent({
      workspaceId: aggWorkspaceId,
      executionId: execId,
      provider: "gigachat",
      model: "GigaChat-2",
      tokensTotal: tokens,
      occurredAt: now,
    });

    const [row] = await (storage as any).db
      .select()
      .from(workspaceUsageMonth)
      .where(and(eq(workspaceUsageMonth.workspaceId, aggWorkspaceId), eq(workspaceUsageMonth.periodCode, periodCode)));
    expect(Number(row.llmTokensTotal)).toBe(tokens);

    await recordLlmUsageEvent({
      workspaceId: aggWorkspaceId,
      executionId: execId,
      provider: "gigachat",
      model: "GigaChat-2",
      tokensTotal: 10,
      occurredAt: now,
    });

    const [rowAfterDuplicate] = await (storage as any).db
      .select()
      .from(workspaceUsageMonth)
      .where(and(eq(workspaceUsageMonth.workspaceId, aggWorkspaceId), eq(workspaceUsageMonth.periodCode, periodCode)));
    expect(Number(rowAfterDuplicate.llmTokensTotal)).toBe(tokens);
  });

  it("returns summary with totals and timeseries", async () => {
    const summary = await getWorkspaceLlmUsageSummary(workspaceId, periodCode);
    expect(summary.workspaceId).toBe(workspaceId);
    expect(summary.totalTokens).toBeGreaterThanOrEqual(123);
    expect(summary.byModelTotal.length).toBeGreaterThan(0);
    expect(summary.timeseries.length).toBeGreaterThan(0);
  });
});
