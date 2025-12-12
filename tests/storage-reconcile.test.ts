import { beforeAll, afterEach, describe, expect, it, vi } from "vitest";
import bcrypt from "bcryptjs";
import { ListObjectsV2Command } from "@aws-sdk/client-s3";
import { minioClient } from "../server/minio-client";
import { storage } from "../server/storage";
import { workspaces } from "@shared/schema";
import { calculateWorkspaceStorageBytes, reconcileWorkspaceStorageUsage } from "../server/usage/storage-reconcile";
import { getWorkspaceUsage } from "../server/usage/usage-service";

async function createUser(email: string) {
  const passwordHash = await bcrypt.hash("Password123!", 10);
  const user = await storage.createUser({
    email,
    fullName: "Storage Reconcile User",
    firstName: "Storage",
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
      name: `Storage Reconcile Workspace ${id}`,
      ownerId: userId,
    })
    .returning();

  await storage.addWorkspaceMember(id, userId, "owner");
  return workspace;
}

describe("storage reconcile", () => {
  let workspaceId: string;
  let sendSpy: ReturnType<typeof vi.spyOn>;

  beforeAll(async () => {
    const user = await createUser(`storage-reconcile-${Date.now()}@example.com`);
    workspaceId = `storage-reconcile-ws-${Date.now()}`;
    await createWorkspaceForUser(user.id, workspaceId);
  });

  afterEach(() => {
    sendSpy?.mockRestore();
  });

  it("calculates storage bytes via paginated list", async () => {
    sendSpy = vi.spyOn(minioClient, "send").mockImplementation((command: any) => {
      if (command instanceof ListObjectsV2Command) {
        if (command.input.ContinuationToken) {
          return Promise.resolve({
            Contents: [{ Key: "icons/icon.png", Size: 300 }],
            IsTruncated: false,
          } as any);
        }

        return Promise.resolve({
          Contents: [
            { Key: "icons/icon.png", Size: 100 },
            { Key: "files/doc.txt", Size: 200 },
          ],
          IsTruncated: true,
          NextContinuationToken: "next",
        } as any);
      }

      return Promise.reject(new Error("unexpected command"));
    });

    const total = await calculateWorkspaceStorageBytes(workspaceId);
    expect(total).toBe(600);
    expect(sendSpy).toHaveBeenCalledTimes(2);
  });

  it("reconciles storage usage aggregate", async () => {
    sendSpy = vi.spyOn(minioClient, "send").mockImplementation((command: any) => {
      if (command instanceof ListObjectsV2Command) {
        return Promise.resolve({
          Contents: [{ Key: "icons/icon.png", Size: 400 }],
          IsTruncated: false,
        } as any);
      }
      return Promise.reject(new Error("unexpected command"));
    });

    const result = await reconcileWorkspaceStorageUsage(workspaceId);
    expect(result.updated).toBe(true);
    expect(result.nextBytes).toBe(400);

    const usage = await getWorkspaceUsage(workspaceId);
    expect(Number(usage?.storageBytesTotal ?? 0)).toBe(400);
  });
});
