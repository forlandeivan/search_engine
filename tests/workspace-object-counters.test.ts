import { beforeAll, describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";
import { and, eq } from "drizzle-orm";
import { storage } from "../server/storage";
import { workspaces, workspaceUsageMonth } from "@shared/schema";
import { adjustWorkspaceObjectCounters } from "../server/usage/usage-service";
import { formatUsagePeriodCode, getUsagePeriodForDate } from "../server/usage/usage-types";

async function createUser(email: string) {
  const passwordHash = await bcrypt.hash("Password123!", 10);
  const user = await storage.createUser({
    email,
    fullName: "Object Counters User",
    firstName: "Object",
    lastName: "Counter",
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
      name: `Object Counters Workspace ${id}`,
      ownerId: userId,
    })
    .returning();

  await storage.addWorkspaceMember(id, userId, "owner");
  return workspace;
}

describe("workspace object counters", () => {
  let workspaceId: string;
  const now = new Date(Date.UTC(2025, 11, 15)); // December 2025
  const periodCode = formatUsagePeriodCode(now.getUTCFullYear(), now.getUTCMonth() + 1);
  const period = {
    periodYear: now.getUTCFullYear(),
    periodMonth: now.getUTCMonth() + 1,
    periodCode,
    start: now,
    end: now,
  };

  beforeAll(async () => {
    const user = await createUser(`object-counters-${Date.now()}@example.com`);
    workspaceId = `object-counters-ws-${Date.now()}`;
    await createWorkspaceForUser(user.id, workspaceId);
  });

  it("increments and decrements counters with clamp to zero", async () => {
    await adjustWorkspaceObjectCounters(
      workspaceId,
      { skillsDelta: 2, knowledgeBasesDelta: 1, membersDelta: 3, actionsDelta: 4 },
      period,
    );

    const [afterIncrease] = await (storage as any).db
      .select()
      .from(workspaceUsageMonth)
      .where(and(eq(workspaceUsageMonth.workspaceId, workspaceId), eq(workspaceUsageMonth.periodCode, periodCode)));

    expect(afterIncrease.skillsCount).toBe(2);
    expect(afterIncrease.knowledgeBasesCount).toBe(1);
    expect(afterIncrease.membersCount).toBe(3);
    expect((afterIncrease as any).actionsCount ?? 0).toBe(4);

    await adjustWorkspaceObjectCounters(
      workspaceId,
      { skillsDelta: -5, actionsDelta: -10, knowledgeBasesDelta: -1, membersDelta: -2 },
      period,
    );

    const [afterDecrease] = await (storage as any).db
      .select()
      .from(workspaceUsageMonth)
      .where(and(eq(workspaceUsageMonth.workspaceId, workspaceId), eq(workspaceUsageMonth.periodCode, periodCode)));

    expect(afterDecrease.skillsCount).toBe(0); // clamped
    expect(afterDecrease.knowledgeBasesCount).toBe(0);
    expect(afterDecrease.membersCount).toBe(1);
    expect((afterDecrease as any).actionsCount ?? 0).toBe(0); // clamped
  });

  it("creates usage row once and reuses it", async () => {
    const otherWorkspaceId = `object-counters-ws-${Date.now()}-reuse`;
    const user = await createUser(`object-counters-reuse-${Date.now()}@example.com`);
    await createWorkspaceForUser(user.id, otherWorkspaceId);
    const defaultPeriod = getUsagePeriodForDate(now);

    await adjustWorkspaceObjectCounters(otherWorkspaceId, { skillsDelta: 1 }, defaultPeriod);
    await adjustWorkspaceObjectCounters(otherWorkspaceId, { skillsDelta: 1 }, defaultPeriod);

    const rows = await (storage as any).db
      .select()
      .from(workspaceUsageMonth)
      .where(and(eq(workspaceUsageMonth.workspaceId, otherWorkspaceId), eq(workspaceUsageMonth.periodCode, defaultPeriod.periodCode)));

    expect(rows).toHaveLength(1);
    expect(rows[0].skillsCount).toBe(2);
  });
});
