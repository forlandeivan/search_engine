import { beforeAll, describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";
import { and, eq } from "drizzle-orm";
import { storage } from "../server/storage";
import { workspaces, workspaceUsageMonth } from "@shared/schema";
import { actionsRepository } from "../server/actions";
import { formatUsagePeriodCode } from "../server/usage/usage-types";

async function createUser(email: string) {
  const passwordHash = await bcrypt.hash("Password123!", 10);
  const user = await storage.createUser({
    email,
    fullName: "Actions Usage User",
    firstName: "Actions",
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
      name: `Actions Usage Workspace ${id}`,
      ownerId: userId,
    })
    .returning();

  await storage.addWorkspaceMember(id, userId, "owner");
  return workspace;
}

describe("actions usage counters", () => {
  let workspaceId: string;

  beforeAll(async () => {
    const user = await createUser(`actions-usage-${Date.now()}@example.com`);
    workspaceId = `actions-usage-ws-${Date.now()}`;
    await createWorkspaceForUser(user.id, workspaceId);
  });

  it("increments on create and decrements on soft delete with idempotency", async () => {
    const created = await actionsRepository.createWorkspaceAction(workspaceId, {
      label: "Test action",
      description: "Action for usage counters",
      target: "message",
      placements: ["chat_message"],
      promptTemplate: "Do something with {{input}}",
      inputType: "message_text",
      outputMode: "new_message",
      llmConfigId: null,
    });

    const createdAt = new Date(created.createdAt);
    const periodCode = formatUsagePeriodCode(createdAt.getUTCFullYear(), createdAt.getUTCMonth() + 1);

    const [afterCreate] = await (storage as any).db
      .select()
      .from(workspaceUsageMonth)
      .where(and(eq(workspaceUsageMonth.workspaceId, workspaceId), eq(workspaceUsageMonth.periodCode, periodCode)));

    expect(afterCreate.actionsCount).toBe(1);

    await actionsRepository.softDeleteWorkspaceAction(workspaceId, created.id);

    const [afterDelete] = await (storage as any).db
      .select()
      .from(workspaceUsageMonth)
      .where(and(eq(workspaceUsageMonth.workspaceId, workspaceId), eq(workspaceUsageMonth.periodCode, periodCode)));
    expect(afterDelete.actionsCount).toBe(0);

    // Idempotent: repeated delete should not change the counter
    await actionsRepository.softDeleteWorkspaceAction(workspaceId, created.id);

    const [afterSecondDelete] = await (storage as any).db
      .select()
      .from(workspaceUsageMonth)
      .where(and(eq(workspaceUsageMonth.workspaceId, workspaceId), eq(workspaceUsageMonth.periodCode, periodCode)));
    expect(afterSecondDelete.actionsCount).toBe(0);
  });
});
