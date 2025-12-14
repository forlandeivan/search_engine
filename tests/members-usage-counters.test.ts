import { beforeAll, describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";
import { and, eq } from "drizzle-orm";
import { storage } from "../server/storage";
import { workspaces, workspaceUsageMonth } from "@shared/schema";
import { formatUsagePeriodCode } from "../server/usage/usage-types";

async function createUser(email: string) {
  const passwordHash = await bcrypt.hash("Password123!", 10);
  const user = await storage.createUser({
    email,
    fullName: "Member Usage User",
    firstName: "Member",
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
      name: `Members Usage Workspace ${id}`,
      ownerId: userId,
    })
    .returning();

  await storage.addWorkspaceMember(id, userId, "owner");
  return workspace;
}

describe("workspace members usage counters", () => {
  let workspaceId: string;
  const now = new Date(Date.UTC(2025, 11, 15));
  const periodCode = formatUsagePeriodCode(now.getUTCFullYear(), now.getUTCMonth() + 1);

  beforeAll(async () => {
    const user = await createUser(`members-usage-${Date.now()}@example.com`);
    workspaceId = `members-usage-ws-${Date.now()}`;
    await createWorkspaceForUser(user.id, workspaceId);
  });

  it("increments on add and decrements on remove; idempotent when member exists", async () => {
    const member = await createUser(`member-${Date.now()}@example.com`);

    await storage.addWorkspaceMember(workspaceId, member.id, "user");

    const [afterAdd] = await (storage as any).db
      .select()
      .from(workspaceUsageMonth)
      .where(and(eq(workspaceUsageMonth.workspaceId, workspaceId), eq(workspaceUsageMonth.periodCode, periodCode)));
    expect(afterAdd.membersCount).toBe(2); // owner + new member

    // adding again should not increment
    await storage.addWorkspaceMember(workspaceId, member.id, "user");
    const [afterSecondAdd] = await (storage as any).db
      .select()
      .from(workspaceUsageMonth)
      .where(and(eq(workspaceUsageMonth.workspaceId, workspaceId), eq(workspaceUsageMonth.periodCode, periodCode)));
    expect(afterSecondAdd.membersCount).toBe(2);

    await storage.removeWorkspaceMember(workspaceId, member.id);
    const [afterRemove] = await (storage as any).db
      .select()
      .from(workspaceUsageMonth)
      .where(and(eq(workspaceUsageMonth.workspaceId, workspaceId), eq(workspaceUsageMonth.periodCode, periodCode)));
    expect(afterRemove.membersCount).toBe(1);

    // removing again should not decrement
    await storage.removeWorkspaceMember(workspaceId, member.id);
    const [afterSecondRemove] = await (storage as any).db
      .select()
      .from(workspaceUsageMonth)
      .where(and(eq(workspaceUsageMonth.workspaceId, workspaceId), eq(workspaceUsageMonth.periodCode, periodCode)));
    expect(afterSecondRemove.membersCount).toBe(1);
  });
});
