import { beforeAll, describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";
import { and, eq } from "drizzle-orm";
import { storage } from "../server/storage";
import {
  ensureWorkspaceUsage,
  getWorkspaceUsage,
  incrementWorkspaceUsage,
  closeWorkspaceUsage,
} from "../server/usage/usage-service";
import { getUsagePeriodForDate } from "../server/usage/usage-types";
import { workspaces, workspaceUsageMonth } from "@shared/schema";

async function createUser(email: string) {
  const passwordHash = await bcrypt.hash("Password123!", 10);
  const user = await storage.createUser({
    email,
    fullName: "Usage Service User",
    firstName: "Usage",
    lastName: "Service",
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
      name: `Usage Workspace ${id}`,
      ownerId: userId,
    })
    .returning();

  await storage.addWorkspaceMember(id, userId, "owner");
  return workspace;
}

describe("workspace usage service", () => {
  let workspaceId: string;
  const fixedDate = new Date(Date.UTC(2025, 1, 15)); // 2025-02-15 UTC
  const fixedPeriod = getUsagePeriodForDate(fixedDate);

  beforeAll(async () => {
    const user = await createUser(`usage-${Date.now()}@example.com`);
    workspaceId = `usage-ws-${Date.now()}`;
    await createWorkspaceForUser(user.id, workspaceId);
  });

  it("creates a usage record for the period and returns the same on subsequent calls", async () => {
    const first = await ensureWorkspaceUsage(workspaceId, fixedPeriod);
    const second = await ensureWorkspaceUsage(workspaceId, fixedPeriod);
    expect(first.id).toBe(second.id);

    const rows = await (storage as any).db
      .select()
      .from(workspaceUsageMonth)
      .where(and(eq(workspaceUsageMonth.workspaceId, workspaceId), eq(workspaceUsageMonth.periodCode, fixedPeriod.periodCode)));
    expect(rows).toHaveLength(1);
  });

  it("increments counters for the current period", async () => {
    const updated = await incrementWorkspaceUsage(
      workspaceId,
      { llm_tokens_total: 120, embeddings_tokens_total: 55, asr_minutes_total: 1.5 },
      fixedPeriod,
    );

    expect(Number(updated.llmTokensTotal)).toBeGreaterThanOrEqual(120);
    expect(Number(updated.embeddingsTokensTotal)).toBeGreaterThanOrEqual(55);
    expect(updated.asrMinutesTotal).toBeGreaterThanOrEqual(1.5);
  });

  it("prevents updates once the period is closed", async () => {
    const closed = await closeWorkspaceUsage(workspaceId, fixedPeriod, new Date(Date.UTC(2025, 2, 1)));
    expect(closed.isClosed).toBe(true);
    expect(closed.closedAt).not.toBeNull();

    await expect(
      incrementWorkspaceUsage(workspaceId, { llm_tokens_total: 1 }, fixedPeriod),
    ).rejects.toThrow(/is closed/);
  });

  it("can fetch usage for the period", async () => {
    const usage = await getWorkspaceUsage(workspaceId, fixedPeriod);
    expect(usage?.periodCode).toBe(fixedPeriod.periodCode);
    expect(usage?.workspaceId).toBe(workspaceId);
  });
});
