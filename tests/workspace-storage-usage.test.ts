import { beforeAll, describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";
import { and, eq } from "drizzle-orm";
import { storage } from "../server/storage";
import { workspaceUsageMonth, workspaces } from "@shared/schema";
import { adjustWorkspaceStorageUsageBytes } from "../server/usage/usage-service";
import { formatUsagePeriodCode } from "../server/usage/usage-types";

async function createUser(email: string) {
  const passwordHash = await bcrypt.hash("Password123!", 10);
  const user = await storage.createUser({
    email,
    fullName: "Storage User",
    firstName: "Storage",
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
      name: `Storage Workspace ${id}`,
      ownerId: userId,
    })
    .returning();

  await storage.addWorkspaceMember(id, userId, "owner");
  return workspace;
}

describe("workspace storage usage adjustments", () => {
  let workspaceId: string;
  const now = new Date(Date.UTC(2025, 1, 15));
  const periodCode = formatUsagePeriodCode(now.getUTCFullYear(), now.getUTCMonth() + 1);

  beforeAll(async () => {
    const user = await createUser(`storage-${Date.now()}@example.com`);
    workspaceId = `storage-ws-${Date.now()}`;
    await createWorkspaceForUser(user.id, workspaceId);
  });

  it("increments and decrements storage bytes with clamp to zero", async () => {
    await adjustWorkspaceStorageUsageBytes(workspaceId, 500, {
      periodCode,
      periodYear: now.getUTCFullYear(),
      periodMonth: now.getUTCMonth() + 1,
      start: now,
      end: now,
    });

    const [afterIncrease] = await (storage as any).db
      .select()
      .from(workspaceUsageMonth)
      .where(and(eq(workspaceUsageMonth.workspaceId, workspaceId), eq(workspaceUsageMonth.periodCode, periodCode)));
    expect(Number(afterIncrease.storageBytesTotal)).toBe(500);

    await adjustWorkspaceStorageUsageBytes(workspaceId, -200, {
      periodCode,
      periodYear: now.getUTCFullYear(),
      periodMonth: now.getUTCMonth() + 1,
      start: now,
      end: now,
    });

    const [afterDecrease] = await (storage as any).db
      .select()
      .from(workspaceUsageMonth)
      .where(and(eq(workspaceUsageMonth.workspaceId, workspaceId), eq(workspaceUsageMonth.periodCode, periodCode)));
    expect(Number(afterDecrease.storageBytesTotal)).toBe(300);

    await adjustWorkspaceStorageUsageBytes(workspaceId, -1000, {
      periodCode,
      periodYear: now.getUTCFullYear(),
      periodMonth: now.getUTCMonth() + 1,
      start: now,
      end: now,
    });

    const [afterClamp] = await (storage as any).db
      .select()
      .from(workspaceUsageMonth)
      .where(and(eq(workspaceUsageMonth.workspaceId, workspaceId), eq(workspaceUsageMonth.periodCode, periodCode)));
    expect(Number(afterClamp.storageBytesTotal)).toBe(0);
  });
});
