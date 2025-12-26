/* @vitest-environment node */

import { describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";
import { storage } from "../server/storage";
import { users, workspaces, skills, skillFiles } from "@shared/schema";

async function seedWorkspace() {
  const passwordHash = await bcrypt.hash("Password123!", 10);
  const email = `ready-skill-${Date.now()}@example.com`;

  const [user] = await (storage as any).db
    .insert(users)
    .values({
      email,
      fullName: "Ready Skill User",
      firstName: "Ready",
      lastName: "User",
      phone: "",
      passwordHash,
      isEmailConfirmed: true,
    })
    .returning();

  const workspaceId = `ws-ready-${Date.now()}`;
  const [workspace] = await (storage as any).db
    .insert(workspaces)
    .values({
      id: workspaceId,
      name: `Workspace ${workspaceId}`,
      ownerId: user.id,
      plan: "free",
    })
    .returning();

  const [skill] = await (storage as any).db
    .insert(skills)
    .values({
      workspaceId: workspace.id,
      name: "Skill with files",
      mode: "rag",
      ragTopK: 5,
      ragMinScore: 0.5,
      ragMaxContextTokens: 2000,
      ragShowSources: true,
      ragMode: "all_collections",
      ragCollectionIds: [],
      ragVectorLimit: 8,
      ragVectorWeight: 0.5,
      ragBm25Limit: 6,
      ragBm25Weight: 0.5,
      executionMode: "standard",
      status: "active",
      ragEmbeddingProviderId: null,
    })
    .returning();

  return { userId: user.id, workspaceId: workspace.id, skillId: skill.id };
}

describe("skill files ready flags", () => {
  it("возвращает false/true в зависимости от наличия READY файлов", async () => {
    const { workspaceId, skillId } = await seedWorkspace();

    let hasReady = await storage.hasReadySkillFiles(workspaceId, skillId);
    expect(hasReady).toBe(false);

    await (storage as any).db.insert(skillFiles).values({
      workspaceId,
      skillId,
      storageKey: "s1",
      originalName: "doc.txt",
      status: "uploaded",
      processingStatus: "processing",
      version: 1,
      createdAt: new Date(),
    });

    hasReady = await storage.hasReadySkillFiles(workspaceId, skillId);
    expect(hasReady).toBe(false);

    await (storage as any).db.insert(skillFiles).values({
      workspaceId,
      skillId,
      storageKey: "s2",
      originalName: "doc2.txt",
      status: "uploaded",
      processingStatus: "ready",
      version: 1,
      createdAt: new Date(),
    });

    hasReady = await storage.hasReadySkillFiles(workspaceId, skillId);
    expect(hasReady).toBe(true);

    const readyIds = await storage.listReadySkillFileIds(workspaceId, skillId);
    expect(readyIds.length).toBe(1);
  });
});
