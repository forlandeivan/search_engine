import { beforeAll, describe, expect, it, vi } from "vitest";
import bcrypt from "bcryptjs";
import { storage } from "../server/storage";
import { workspaces } from "@shared/schema";
import { createSkill, getSkillById, updateSkill } from "../server/skills";
import { updateSkillSchema } from "@shared/skills";
import { workspaceOperationGuard } from "../server/guards/workspace-operation-guard";

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

async function createWorkspaceForUser(userId: string, id: string) {
  const [workspace] = await (storage as any).db
    .insert(workspaces)
    .values({
      id,
      name: `Skill Execution Workspace ${id}`,
      ownerId: userId,
    })
    .returning();

  await storage.addWorkspaceMember(id, userId, "owner");
  return workspace;
}

describe("skill execution mode", () => {
  let workspaceId: string;

  beforeAll(async () => {
    vi.spyOn(workspaceOperationGuard, "check").mockResolvedValue({ allowed: true } as any);
    const user = await createUser(`skills-exec-${Date.now()}@example.com`);
    workspaceId = `skills-exec-ws-${Date.now()}`;
    await createWorkspaceForUser(user.id, workspaceId);
  });

  it("defaults to standard execution mode on create", async () => {
    const created = await createSkill(workspaceId, {
      name: "Execution Mode Skill",
      mode: "llm",
    });

    expect(created.executionMode).toBe("standard");

    const reloaded = await getSkillById(workspaceId, created.id);
    expect(reloaded?.executionMode).toBe("standard");
  });

  it("updates execution mode", async () => {
    const created = await createSkill(workspaceId, {
      name: "Execution Mode Update Skill",
      mode: "llm",
    });

    const updated = await updateSkill(workspaceId, created.id, { executionMode: "no_code" });
    expect(updated.executionMode).toBe("no_code");

    const reloaded = await getSkillById(workspaceId, created.id);
    expect(reloaded?.executionMode).toBe("no_code");
  });

  it("rejects unknown execution mode values in schema", () => {
    const result = updateSkillSchema.safeParse({ executionMode: "unknown" });
    expect(result.success).toBe(false);
  });
});
