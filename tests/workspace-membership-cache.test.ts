import { beforeAll, describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";
import { storage } from "../server/storage";
import { workspaces, workspaceMembers } from "@shared/schema";
import { and, eq } from "drizzle-orm";

async function createUser(email: string) {
  const passwordHash = await bcrypt.hash("Password123!", 10);
  const user = await storage.createUser({
    email,
    fullName: "Membership User",
    firstName: "Membership",
    lastName: "User",
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
      name: `Workspace ${id}`,
      ownerId: userId,
    })
    .returning();

  await storage.addWorkspaceMember(id, userId, "owner");
  return workspace;
}

describe("workspace membership storage", () => {
  let userId: string;
  let otherUserId: string;
  let workspaceId: string;

  beforeAll(async () => {
    const user = await createUser(`membership-${Date.now()}@example.com`);
    userId = user.id;
    const other = await createUser(`membership-other-${Date.now()}@example.com`);
    otherUserId = other.id;
    workspaceId = `membership-ws-${Date.now()}`;
    await createWorkspaceForUser(userId, workspaceId);
  });

  it("returns membership with role and default status", async () => {
    const membership = await storage.getWorkspaceMember(userId, workspaceId);
    expect(membership?.userId).toBe(userId);
    expect(membership?.workspaceId).toBe(workspaceId);
    expect(membership?.role).toBe("owner");
    expect(membership?.status).toBe("active");
  });

  it("returns undefined when membership is missing", async () => {
    const missing = await storage.getWorkspaceMember(otherUserId, workspaceId);
    expect(missing).toBeUndefined();
  });

  it("serves cached membership until invalidated", async () => {
    await storage.getWorkspaceMember(userId, workspaceId);

    // Удаляем напрямую из БД, не вызывая публичный метод (который инвалидирует кэш).
    await (storage as any).db
      .delete(workspaceMembers)
      .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)));

    const cached = await storage.getWorkspaceMember(userId, workspaceId);
    expect(cached?.userId).toBe(userId);

    storage.invalidateWorkspaceMembershipCache(userId, workspaceId);
    const afterInvalidation = await storage.getWorkspaceMember(userId, workspaceId);
    expect(afterInvalidation).toBeUndefined();
  });
});
