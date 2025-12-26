import { beforeAll, describe, expect, it, vi } from "vitest";
import bcrypt from "bcryptjs";
import { storage } from "../server/storage";
import { workspaces } from "@shared/schema";
import { reconcileWorkspaceQdrantUsage } from "../server/usage/qdrant-reconcile";
import type { QdrantClient } from "@qdrant/js-client-rest";

vi.mock("../server/qdrant", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("../server/qdrant");
  let mockClient: Partial<QdrantClient> | null = null;
  return {
    ...(actual as Record<string, unknown>),
    getQdrantClient: () => {
      if (!mockClient) {
        throw new Error("Mock Qdrant client not set");
      }
      return mockClient as QdrantClient;
    },
    __setMockQdrantClient: (client: Partial<QdrantClient>) => {
      mockClient = client;
    },
  };
});

// @ts-expect-error mock helper is injected by vi.mock
import { __setMockQdrantClient } from "../server/qdrant";

async function createUser(email: string) {
  const passwordHash = await bcrypt.hash("Password123!", 10);
  const user = await storage.createUser({
    email,
    fullName: "Qdrant Reconcile User",
    firstName: "Qdrant",
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
      name: `Qdrant Reconcile Workspace ${id}`,
      ownerId: userId,
    })
    .returning();

  await storage.addWorkspaceMember(id, userId, "owner");
  return workspace;
}

describe("qdrant reconcile", () => {
  let workspaceId: string;

  beforeAll(async () => {
    const user = await createUser(`qdrant-reconcile-${Date.now()}@example.com`);
    workspaceId = `qdrant-reconcile-ws-${Date.now()}`;
    await createWorkspaceForUser(user.id, workspaceId);
    await storage.upsertCollectionWorkspace("col-a", workspaceId);
    await storage.upsertCollectionWorkspace("col-b", workspaceId);
  });

  it("reconciles counts from Qdrant collection info", async () => {
    __setMockQdrantClient({
      getCollection: vi.fn().mockImplementation((name: string) => {
        if (name === "col-a") {
          return Promise.resolve({ points_count: 10, disk_data_size: 2000 });
        }
        if (name === "col-b") {
          return Promise.resolve({ points_count: 5, disk_data_size: 1000 });
        }
        return Promise.resolve({ points_count: 0, disk_data_size: 0 });
      }),
    });

    const result = await reconcileWorkspaceQdrantUsage(workspaceId);
    expect(result.updated).toBe(true);
    expect(result.collectionsCount).toBe(2);
    expect(result.pointsCount).toBe(15);
    expect(result.storageBytes).toBe(3000);
  });
});
