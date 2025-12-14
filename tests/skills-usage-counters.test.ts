import { beforeAll, describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";
import { and, eq } from "drizzle-orm";
import { storage } from "../server/storage";
import { workspaces, workspaceUsageMonth } from "@shared/schema";
import { createSkill, archiveSkill } from "../server/skills";
import { formatUsagePeriodCode } from "../server/usage/usage-types";

async function createUser(email: string) {
  const passwordHash = await bcrypt.hash("Password123!", 10);
  const user = await storage.createUser({
    email,
    fullName: "Skill Usage User",
    firstName: "Skill",
    lastName: "Usage",
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
      name: `Skill Usage Workspace ${id}`,
      ownerId: userId,
    })
    .returning();

  await storage.addWorkspaceMember(id, userId, "owner");
  return workspace;
}

describe("skills usage counters", () => {
  let workspaceId: string;
  const now = new Date(Date.UTC(2025, 11, 15));
  const periodCode = formatUsagePeriodCode(now.getUTCFullYear(), now.getUTCMonth() + 1);

  beforeAll(async () => {
    const user = await createUser(`skills-usage-${Date.now()}@example.com`);
    workspaceId = `skills-usage-ws-${Date.now()}`;
    await createWorkspaceForUser(user.id, workspaceId);
  });

  it("increments on create and decrements on archive with idempotency", async () => {
    const skill = await createSkill(workspaceId, {
      name: "Test Skill",
      description: "desc",
      mode: "llm",
    });

    const [afterCreate] = await (storage as any).db
      .select()
      .from(workspaceUsageMonth)
      .where(and(eq(workspaceUsageMonth.workspaceId, workspaceId), eq(workspaceUsageMonth.periodCode, periodCode)));

    expect(afterCreate.skillsCount).toBe(1);

    await archiveSkill(workspaceId, skill.id);
    const [afterArchive] = await (storage as any).db
      .select()
      .from(workspaceUsageMonth)
      .where(and(eq(workspaceUsageMonth.workspaceId, workspaceId), eq(workspaceUsageMonth.periodCode, periodCode)));

    expect(afterArchive.skillsCount).toBe(0);

    // Re-archiving should not double-decrement
    await archiveSkill(workspaceId, skill.id);
    const [afterSecondArchive] = await (storage as any).db
      .select()
      .from(workspaceUsageMonth)
      .where(and(eq(workspaceUsageMonth.workspaceId, workspaceId), eq(workspaceUsageMonth.periodCode, periodCode)));
    expect(afterSecondArchive.skillsCount).toBe(0);
  });
});
