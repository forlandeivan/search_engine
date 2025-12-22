import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import bcrypt from "bcryptjs";
import { storage } from "../server/storage";
import { tariffPlans, workspaces } from "@shared/schema";
import { createSkill, getSkillById, updateSkill } from "../server/skills";
import { updateSkillSchema } from "@shared/skills";
import { workspaceOperationGuard } from "../server/guards/workspace-operation-guard";
import { db } from "../server/db";
import { eq } from "drizzle-orm";

async function createUser(email: string) {
  const passwordHash = await bcrypt.hash("Password123!", 10);
  const user = await storage.createUser({
    email,
    fullName: "Skill Execution User",
    firstName: "Skill",
    lastName: "Execution",
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

async function createWorkspaceForUser(userId: string, id: string, planId?: string | null) {
  const [workspace] = await (storage as any).db
    .insert(workspaces)
    .values({
      id,
      name: `Skill Execution Workspace ${id}`,
      ownerId: userId,
      tariffPlanId: planId ?? null,
    })
    .returning();

  await storage.addWorkspaceMember(id, userId, "owner");
  return workspace;
}

describe("skill execution mode", () => {
  let workspaceIdAllowed: string;
  let workspaceIdBlocked: string;
  let planCodeAllowed: string;
  let planCodeBlocked: string;

  beforeAll(async () => {
    vi.spyOn(workspaceOperationGuard, "check").mockResolvedValue({ allowed: true } as any);
    const runId = Date.now();
    const user = await createUser(`skills-exec-${runId}@example.com`);

    planCodeAllowed = `TEST_NO_CODE_ON_${runId}`;
    planCodeBlocked = `TEST_NO_CODE_OFF_${runId}`;

    const [allowedPlan] = await db
      .insert(tariffPlans)
      .values({ code: planCodeAllowed, name: "No-code allowed", isActive: true, noCodeFlowEnabled: true })
      .returning({ id: tariffPlans.id });
    const [blockedPlan] = await db
      .insert(tariffPlans)
      .values({ code: planCodeBlocked, name: "No-code blocked", isActive: true, noCodeFlowEnabled: false })
      .returning({ id: tariffPlans.id });

    workspaceIdAllowed = `skills-exec-ws-allowed-${runId}`;
    workspaceIdBlocked = `skills-exec-ws-blocked-${runId}`;
    await createWorkspaceForUser(user.id, workspaceIdAllowed, allowedPlan.id);
    await createWorkspaceForUser(user.id, workspaceIdBlocked, blockedPlan.id);
  });

  afterAll(async () => {
    await db.delete(workspaces).where(eq(workspaces.id, workspaceIdAllowed));
    await db.delete(workspaces).where(eq(workspaces.id, workspaceIdBlocked));
    await db.delete(tariffPlans).where(eq(tariffPlans.code, planCodeAllowed));
    await db.delete(tariffPlans).where(eq(tariffPlans.code, planCodeBlocked));
  });

  it("defaults to standard execution mode on create", async () => {
    const created = await createSkill(workspaceIdBlocked, {
      name: "Execution Mode Skill",
      mode: "llm",
    });

    expect(created.executionMode).toBe("standard");

    const reloaded = await getSkillById(workspaceIdBlocked, created.id);
    expect(reloaded?.executionMode).toBe("standard");
  });

  it("updates execution mode when allowed", async () => {
    const created = await createSkill(workspaceIdAllowed, {
      name: "Execution Mode Update Skill",
      mode: "llm",
    });

    const updated = await updateSkill(workspaceIdAllowed, created.id, { executionMode: "no_code" });
    expect(updated.executionMode).toBe("no_code");

    const reloaded = await getSkillById(workspaceIdAllowed, created.id);
    expect(reloaded?.executionMode).toBe("no_code");
  });

  it("rejects no-code execution mode when blocked", async () => {
    const created = await createSkill(workspaceIdBlocked, {
      name: "Execution Mode Blocked Skill",
      mode: "llm",
    });

    await expect(updateSkill(workspaceIdBlocked, created.id, { executionMode: "no_code" })).rejects.toThrow(
      "No-code режим недоступен",
    );
  });

  it("allows switching to standard when blocked", async () => {
    const created = await createSkill(workspaceIdBlocked, {
      name: "Execution Mode Standard Skill",
      mode: "llm",
    });

    const updated = await updateSkill(workspaceIdBlocked, created.id, { executionMode: "standard" });
    expect(updated.executionMode).toBe("standard");
  });

  it("rejects unknown execution mode values in schema", () => {
    const result = updateSkillSchema.safeParse({ executionMode: "unknown" });
    expect(result.success).toBe(false);
  });
});
