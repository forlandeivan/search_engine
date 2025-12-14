import { beforeAll, describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";
import { and, eq } from "drizzle-orm";
import { storage } from "../server/storage";
import { workspaces, workspaceUsageMonth } from "@shared/schema";
import { createSkill } from "../server/skills";
import { createKnowledgeBase } from "../server/knowledge-base";
import { actionsRepository } from "../server/actions";
import { reconcileWorkspaceObjectCounters } from "../server/usage/object-counters-reconcile";
import { formatUsagePeriodCode } from "../server/usage/usage-types";

async function createUser(email: string) {
  const passwordHash = await bcrypt.hash("Password123!", 10);
  const user = await storage.createUser({
    email,
    fullName: "Object Reconcile User",
    firstName: "Object",
    lastName: "Reconcile",
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
      name: `Object Reconcile Workspace ${id}`,
      ownerId: userId,
    })
    .returning();

  await storage.addWorkspaceMember(id, userId, "owner");
  return workspace;
}

describe("workspace object counters reconcile", () => {
  let workspaceId: string;
  let periodCode: string;

  beforeAll(async () => {
    const now = new Date(Date.UTC(2025, 11, 15));
    periodCode = formatUsagePeriodCode(now.getUTCFullYear(), now.getUTCMonth() + 1);
    const user = await createUser(`object-reconcile-${Date.now()}@example.com`);
    workspaceId = `object-reconcile-ws-${Date.now()}`;
    await createWorkspaceForUser(user.id, workspaceId);

    await createSkill(workspaceId, {
      name: "Skill for reconcile",
      description: "desc",
      mode: "llm",
    });

    await actionsRepository.createWorkspaceAction(workspaceId, {
      label: "Action for reconcile",
      description: null,
      target: "message",
      placements: ["chat_message"],
      promptTemplate: "Hello",
      inputType: "message_text",
      outputMode: "new_message",
      llmConfigId: null,
    });

    await createKnowledgeBase(workspaceId, { name: "KB for reconcile", description: "desc" });
  });

  it("sets counters to actual values when usage is out of sync", async () => {
    // Ухудшаем агрегат вручную, чтобы проверить пересчёт.
    await (storage as any).db
      .update(workspaceUsageMonth)
      .set({
        skillsCount: 0,
        actionsCount: 0,
        knowledgeBasesCount: 0,
        membersCount: 0,
      })
      .where(and(eq(workspaceUsageMonth.workspaceId, workspaceId), eq(workspaceUsageMonth.periodCode, periodCode)));

    const result = await reconcileWorkspaceObjectCounters(workspaceId);
    expect(result.updated).toBe(true);

    const [row] = await (storage as any).db
      .select()
      .from(workspaceUsageMonth)
      .where(and(eq(workspaceUsageMonth.workspaceId, workspaceId), eq(workspaceUsageMonth.periodCode, periodCode)));

    expect(row.skillsCount).toBeGreaterThanOrEqual(1);
    expect((row as any).actionsCount ?? 0).toBeGreaterThanOrEqual(1);
    expect(row.knowledgeBasesCount).toBeGreaterThanOrEqual(1);
    expect(row.membersCount).toBeGreaterThanOrEqual(1);
  });
});
