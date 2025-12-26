/* @vitest-environment node */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import bcrypt from "bcryptjs";
import type { QdrantClient } from "@qdrant/js-client-rest";

import { storage, WorkspaceVectorInitError } from "../server/storage";
import { users, workspaces } from "@shared/schema";

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

async function createUserAndWorkspace(): Promise<{ userId: string; workspaceId: string }> {
  const passwordHash = await bcrypt.hash("Password123!", 10);
  const email = `workspace-vector-${Date.now()}@example.com`;

  const [user] = await (storage as any).db
    .insert(users)
    .values({
      email,
      fullName: "Workspace Vector User",
      firstName: "Workspace",
      lastName: "Vector",
      phone: "",
      passwordHash,
      isEmailConfirmed: true,
    })
    .returning();

  const workspaceId = `ws-vector-${Date.now()}`;
  const [workspace] = await (storage as any).db
    .insert(workspaces)
    .values({
      id: workspaceId,
      name: `Vector Workspace ${workspaceId}`,
      ownerId: user.id,
      plan: "free",
    })
    .returning();

  await storage.addWorkspaceMember(workspace.id, user.id, "owner");

  return { userId: user.id, workspaceId: workspace.id };
}

async function seedEmbeddingProvider(workspaceId: string) {
  const providerId = `openai-${workspaceId}`;
  await storage.createEmbeddingProvider({
    id: providerId,
    name: "OpenAI Embeddings",
    providerType: "openai",
    description: "Test provider",
    isActive: true,
    isGlobal: true,
    tokenUrl: "https://example.com/token",
    embeddingsUrl: "https://example.com/embeddings",
    authorizationKey: "Authorization",
    scope: "test-scope",
    model: "text-embedding-3-small",
    allowSelfSignedCertificate: true,
    requestHeaders: {},
    requestConfig: {},
    responseConfig: {},
    qdrantConfig: { vectorSize: 1536 },
    workspaceId,
  });
  return providerId;
}

describe("ensureWorkspaceVectorCollection", () => {
  const originalEnvFlag = process.env.ENFORCE_WORKSPACE_VECTOR_BOOTSTRAP;

  beforeEach(() => {
    process.env.ENFORCE_WORKSPACE_VECTOR_BOOTSTRAP = "true";
    process.env.QDRANT_URL = "http://localhost:6333";
    __setMockQdrantClient(null);
  });

  it("создаёт коллекцию и сохраняет привязку, если коллекции нет", async () => {
    const { workspaceId } = await createUserAndWorkspace();
    await seedEmbeddingProvider(workspaceId);

    const getCollection = vi.fn().mockRejectedValue(Object.assign(new Error("not found"), { status: 404 }));
    const createCollection = vi.fn().mockResolvedValue({});
    __setMockQdrantClient({
      getCollection,
      createCollection,
    });

    const collectionName = await storage.ensureWorkspaceVectorCollection(workspaceId);
    expect(collectionName).toContain("ws_");
    expect(getCollection).toHaveBeenCalledTimes(1);
    expect(createCollection).toHaveBeenCalledTimes(1);
    const mappedWorkspaceId = await storage.getCollectionWorkspace(collectionName);
    expect(mappedWorkspaceId).toBe(workspaceId);
  });

  it("не вызывает создание коллекции повторно, если она существует", async () => {
    const { workspaceId } = await createUserAndWorkspace();
    await seedEmbeddingProvider(workspaceId);

    const getCollection = vi.fn().mockResolvedValue({});
    const createCollection = vi.fn();
    __setMockQdrantClient({
      getCollection,
      createCollection,
    });

    const collectionName = await storage.ensureWorkspaceVectorCollection(workspaceId);
    expect(collectionName).toContain(workspaceId);
    expect(getCollection).toHaveBeenCalledTimes(1);
    expect(createCollection).not.toHaveBeenCalled();
  });

  it("пробрасывает инфраструктурную ошибку при падении createCollection", async () => {
    const { workspaceId } = await createUserAndWorkspace();
    await seedEmbeddingProvider(workspaceId);

    __setMockQdrantClient({
      getCollection: vi.fn().mockRejectedValue(Object.assign(new Error("not found"), { status: 404 })),
      createCollection: vi.fn().mockRejectedValue(Object.assign(new Error("unavailable"), { status: 500 })),
    });

    await expect(storage.ensureWorkspaceVectorCollection(workspaceId)).rejects.toBeInstanceOf(
      WorkspaceVectorInitError,
    );
  });

  afterEach(() => {
    if (originalEnvFlag === undefined) {
      delete process.env.ENFORCE_WORKSPACE_VECTOR_BOOTSTRAP;
    } else {
      process.env.ENFORCE_WORKSPACE_VECTOR_BOOTSTRAP = originalEnvFlag;
    }
  });
});
