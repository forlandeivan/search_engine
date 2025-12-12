import { beforeAll, describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";
import { storage } from "../server/storage";
import { workspaces } from "@shared/schema";
import { adjustWorkspaceStorageUsageBytes, getWorkspaceStorageUsageSummary } from "../server/usage/usage-service";
import { formatUsagePeriodCode } from "../server/usage/usage-types";

async function createUser(email: string) {
  const passwordHash = await bcrypt.hash("Password123!", 10);
  const user = await storage.createUser({
    email,
    fullName: "Storage Usage User",
    firstName: "Storage",
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
      name: `Storage Usage Workspace ${id}`,
      ownerId: userId,
    })
    .returning();

  await storage.addWorkspaceMember(id, userId, "owner");
  return workspace;
}

describe("workspace storage usage summary", () => {
  let workspaceId: string;
  const now = new Date(Date.UTC(2025, 1, 15));
  const periodCode = formatUsagePeriodCode(now.getUTCFullYear(), now.getUTCMonth() + 1);

  beforeAll(async () => {
    const user = await createUser(`storage-summary-${Date.now()}@example.com`);
    workspaceId = `storage-summary-ws-${Date.now()}`;
    await createWorkspaceForUser(user.id, workspaceId);
  });

  it("returns storage aggregate for period", async () => {
    await adjustWorkspaceStorageUsageBytes(workspaceId, 1024, {
      periodCode,
      periodYear: now.getUTCFullYear(),
      periodMonth: now.getUTCMonth() + 1,
      start: now,
      end: now,
    });

    const summary = await getWorkspaceStorageUsageSummary(workspaceId, periodCode);
    expect(summary.workspaceId).toBe(workspaceId);
    expect(summary.storageBytes).toBe(1024);
    expect(summary.period.periodCode).toBe(periodCode);
  });
});
