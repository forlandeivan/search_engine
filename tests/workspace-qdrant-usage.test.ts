import { beforeAll, describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";
import { storage } from "../server/storage";
import { workspaces } from "@shared/schema";
import { updateWorkspaceQdrantUsage } from "../server/usage/usage-service";

async function createUser(email: string) {
  const passwordHash = await bcrypt.hash("Password123!", 10);
  const user = await storage.createUser({
    email,
    fullName: "Qdrant Usage User",
    firstName: "Qdrant",
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
      name: `Qdrant Usage Workspace ${id}`,
      ownerId: userId,
    })
    .returning();

  await storage.addWorkspaceMember(id, userId, "owner");
  return workspace;
}

describe("workspace qdrant usage (persistent)", () => {
  let workspaceId: string;

  beforeAll(async () => {
    const user = await createUser(`qdrant-usage-${Date.now()}@example.com`);
    workspaceId = `qdrant-usage-ws-${Date.now()}`;
    await createWorkspaceForUser(user.id, workspaceId);
  });

  it("sets values and keeps them across updates without monthly reset", async () => {
    const first = await updateWorkspaceQdrantUsage(workspaceId, {
      collectionsCount: 2,
      pointsCount: 1500,
      storageBytes: 2048,
    });

    expect(first.collectionsCount).toBe(2);
    expect(first.pointsCount).toBe(1500);
    expect(first.storageBytes).toBe(2048);

    const second = await updateWorkspaceQdrantUsage(workspaceId, {
      collectionsCount: 3,
      pointsCount: 3000,
      storageBytes: 4096,
    });

    expect(second.collectionsCount).toBe(3);
    expect(second.pointsCount).toBe(3000);
    expect(second.storageBytes).toBe(4096);
  });

  it("clamps negative values to zero", async () => {
    const updated = await updateWorkspaceQdrantUsage(workspaceId, {
      collectionsCount: -5,
      pointsCount: -10,
      storageBytes: -20,
    });

    expect(updated.collectionsCount).toBe(0);
    expect(updated.pointsCount).toBe(0);
    expect(updated.storageBytes).toBe(0);
  });
});
