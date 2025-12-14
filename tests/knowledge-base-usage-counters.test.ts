import { beforeAll, describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";
import { and, eq } from "drizzle-orm";
import { storage } from "../server/storage";
import { workspaces, workspaceUsageMonth } from "@shared/schema";
import { createKnowledgeBase, deleteKnowledgeBase } from "../server/knowledge-base";
import { formatUsagePeriodCode } from "../server/usage/usage-types";

async function createUser(email: string) {
  const passwordHash = await bcrypt.hash("Password123!", 10);
  const user = await storage.createUser({
    email,
    fullName: "KB Usage User",
    firstName: "KB",
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
      name: `KB Usage Workspace ${id}`,
      ownerId: userId,
    })
    .returning();

  await storage.addWorkspaceMember(id, userId, "owner");
  return workspace;
}

describe("knowledge bases usage counters", () => {
  let workspaceId: string;
  const now = new Date(Date.UTC(2025, 11, 15));
  const periodCode = formatUsagePeriodCode(now.getUTCFullYear(), now.getUTCMonth() + 1);

  beforeAll(async () => {
    const user = await createUser(`kb-usage-${Date.now()}@example.com`);
    workspaceId = `kb-usage-ws-${Date.now()}`;
    await createWorkspaceForUser(user.id, workspaceId);
  });

  it("increments on create and decrements on delete", async () => {
    const kb = await createKnowledgeBase(workspaceId, { name: "KB", description: "desc" });

    const [afterCreate] = await (storage as any).db
      .select()
      .from(workspaceUsageMonth)
      .where(and(eq(workspaceUsageMonth.workspaceId, workspaceId), eq(workspaceUsageMonth.periodCode, periodCode)));
    expect(afterCreate.knowledgeBasesCount).toBe(1);

    await deleteKnowledgeBase(workspaceId, kb.id, { confirmation: "KB" });
    const [afterDelete] = await (storage as any).db
      .select()
      .from(workspaceUsageMonth)
      .where(and(eq(workspaceUsageMonth.workspaceId, workspaceId), eq(workspaceUsageMonth.periodCode, periodCode)));
    expect(afterDelete.knowledgeBasesCount).toBe(0);
  });
});
