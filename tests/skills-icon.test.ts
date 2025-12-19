import { beforeAll, describe, expect, it, vi } from "vitest";
import bcrypt from "bcryptjs";
import { storage } from "../server/storage";
import { workspaces } from "@shared/schema";
import { createSkill, getSkillById, updateSkill } from "../server/skills";
import { workspaceOperationGuard } from "../server/guards/workspace-operation-guard";

async function createUser(email: string) {
  const passwordHash = await bcrypt.hash("Password123!", 10);
  const user = await storage.createUser({
    email,
    fullName: "Skill Icon User",
    firstName: "Skill",
    lastName: "Icon",
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
      name: `Skill Icon Workspace ${id}`,
      ownerId: userId,
    })
    .returning();

  await storage.addWorkspaceMember(id, userId, "owner");
  return workspace;
}

describe("skills icon persistence", () => {
  let workspaceId: string;

  beforeAll(async () => {
    vi.spyOn(workspaceOperationGuard, "check").mockResolvedValue({ allowed: true } as any);
    const user = await createUser(`skills-icon-${Date.now()}@example.com`);
    workspaceId = `skills-icon-ws-${Date.now()}`;
    await createWorkspaceForUser(user.id, workspaceId);
  });

  it("returns icon on create, update, and reload", async () => {
    const created = await createSkill(workspaceId, {
      name: "Icon Skill",
      mode: "llm",
      icon: "Zap",
    });

    expect(created.icon).toBe("Zap");

    const updated = await updateSkill(workspaceId, created.id, { icon: "Brain" });
    expect(updated.icon).toBe("Brain");

    const reloaded = await getSkillById(workspaceId, created.id);
    expect(reloaded?.icon).toBe("Brain");
  });
});
