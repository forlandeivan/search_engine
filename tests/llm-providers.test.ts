import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AddressInfo } from "net";

import {
  DEFAULT_LLM_REQUEST_CONFIG,
  DEFAULT_LLM_RESPONSE_CONFIG,
  type LlmProvider,
} from "@shared/schema";

const executeMock = vi.fn<(query: unknown) => Promise<{ rows: Record<string, unknown>[] }>>();

function setupDbMock(): void {
  vi.doMock("../server/db", () => ({
    db: {
      execute: (...args: [unknown]) => executeMock(...args),
    },
    pool: null,
    isDatabaseConfigured: true,
  }));
}

function setupAuthMock(): void {
  vi.doMock("../server/auth", () => {
    const requireAuth = (_req: any, _res: any, next: () => void) => next();

    return {
      requireAuth,
      requireAdmin: requireAuth,
      getSessionUser: () => ({ id: "user-1" }),
      toPublicUser: (user: unknown) => user,
      reloadGoogleAuth: vi.fn(),
      reloadYandexAuth: vi.fn(),
      ensureWorkspaceContext: vi.fn((_req: any, _user: any) => ({
        active: { id: "workspace-1", role: "owner" },
        memberships: [{ id: "workspace-1", role: "owner" }],
      })),
      buildSessionResponse: vi.fn(() => ({ user: { id: "user-1" }, workspaces: [] })),
      getRequestWorkspace: () => ({ id: "workspace-1" }),
      getRequestWorkspaceMemberships: () => [],
      resolveOptionalUser: () => ({ id: "user-1" }),
      WorkspaceContextError: class extends Error {},
    };
  });
}

function setupStorageMock() {
  const baseProvider: LlmProvider = {
    id: "llm-1",
    name: "GigaChat",
    providerType: "gigachat",
    description: null,
    isActive: true,
    tokenUrl: "https://llm.example/token",
    completionUrl: "https://llm.example/completions",
    authorizationKey: "",
    scope: "GIGACHAT_API_PERS",
    model: "GigaChat-Lite",
    availableModels: [
      { label: "Lite", value: "GigaChat-Lite" },
      { label: "Pro", value: "GigaChat-Pro" },
    ],
    allowSelfSignedCertificate: false,
    requestHeaders: {},
    requestConfig: { ...DEFAULT_LLM_REQUEST_CONFIG },
    responseConfig: { ...DEFAULT_LLM_RESPONSE_CONFIG },
    workspaceId: "workspace-1",
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const updateLlmProvider = vi.fn(async (_id: string, updates: Record<string, unknown>) => ({
    ...baseProvider,
    model: (updates.model as string | undefined) ?? baseProvider.model,
    availableModels: (updates.availableModels as LlmProvider["availableModels"]) ?? baseProvider.availableModels,
    requestHeaders: (updates.requestHeaders as Record<string, string> | undefined) ?? baseProvider.requestHeaders,
    requestConfig: (updates.requestConfig as LlmProvider["requestConfig"] | undefined) ?? baseProvider.requestConfig,
    responseConfig: (updates.responseConfig as LlmProvider["responseConfig"] | undefined) ?? baseProvider.responseConfig,
    updatedAt: new Date(),
  }));

  const storageProxy = {
    updateLlmProvider,
  };

  vi.doMock("../server/storage", () => ({
    storage: storageProxy,
    ensureKnowledgeBaseTables: vi.fn(),
    ensureKnowledgeBaseSearchSettingsTable: vi.fn(),
    isKnowledgeBasePathLtreeEnabled: () => false,
  }));

  return storageProxy;
}

function setupOtherMocks(): void {
  vi.doMock("../server/cors-cache", () => ({ invalidateCorsCache: vi.fn() }));
  vi.doMock("../server/kb-crawler", () => ({
    startKnowledgeBaseCrawl: vi.fn(),
    getKnowledgeBaseCrawlJob: vi.fn(),
    getKnowledgeBaseCrawlJobStateForBase: vi.fn(() => ({ active: null, latest: null })),
    subscribeKnowledgeBaseCrawlJob: vi.fn(),
    pauseKnowledgeBaseCrawl: vi.fn(),
    resumeKnowledgeBaseCrawl: vi.fn(),
    cancelKnowledgeBaseCrawl: vi.fn(),
    retryKnowledgeBaseCrawl: vi.fn(),
    crawlKnowledgeDocumentPage: vi.fn(),
  }));
  vi.doMock("../server/knowledge-base", () => {
    class KnowledgeBaseError extends Error {
      status: number;

      constructor(message: string, status = 400) {
        super(message);
        this.status = status;
      }
    }

    return {
      listKnowledgeBases: vi.fn(async () => []),
      getKnowledgeNodeDetail: vi.fn(),
      deleteKnowledgeNode: vi.fn(),
      updateKnowledgeNodeParent: vi.fn(),
      KnowledgeBaseError,
      createKnowledgeBase: vi.fn(),
      deleteKnowledgeBase: vi.fn(),
      createKnowledgeFolder: vi.fn(),
      createKnowledgeDocument: vi.fn(),
      updateKnowledgeDocument: vi.fn(),
    };
  });
  vi.doMock("../server/knowledge-chunks", () => ({
    previewKnowledgeDocumentChunks: vi.fn(),
    createKnowledgeDocumentChunkSet: vi.fn(),
    updateKnowledgeDocumentChunkVectorRecords: vi.fn(),
  }));
  vi.doMock("../server/qdrant", () => ({
    getQdrantClient: vi.fn(),
    QdrantConfigurationError: class extends Error {},
  }));
}

async function createTestServer() {
  const expressModule = await import("express");
  const app = expressModule.default();
  app.use(expressModule.json());
  const { registerRoutes } = await import("../server/routes");
  const httpServer = await registerRoutes(app);
  await new Promise<void>((resolve) => {
    httpServer.listen(0, resolve);
  });
  return { httpServer };
}

describe("LLM providers API", () => {
  beforeEach(() => {
    vi.resetModules();
    executeMock.mockReset();
    executeMock.mockResolvedValue({ rows: [] });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("saves updated model identifiers on the backend", async () => {
    setupDbMock();
    setupAuthMock();
    const storageProxy = setupStorageMock();
    setupOtherMocks();

    const { httpServer } = await createTestServer();
    try {
      const address = httpServer.address() as AddressInfo;
      const response = await fetch(`http://127.0.0.1:${address.port}/api/llm/providers/llm-1`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "  GigaChat-2  ",
          availableModels: [
            { label: " Lite  ", value: "  GigaChat-2  " },
            { label: "Pro", value: "GigaChat-Pro" },
          ],
        }),
      });

      expect(response.status).toBe(200);
      const payload = (await response.json()) as {
        provider: { availableModels: Array<{ label: string; value: string }>; model: string };
      };

      expect(payload.provider.model).toBe("GigaChat-2");
      expect(payload.provider.availableModels).toEqual([
        { label: "Lite", value: "GigaChat-2" },
        { label: "Pro", value: "GigaChat-Pro" },
      ]);

      expect(storageProxy.updateLlmProvider).toHaveBeenCalledWith(
        "llm-1",
        expect.objectContaining({
          availableModels: [
            { label: "Lite", value: "GigaChat-2" },
            { label: "Pro", value: "GigaChat-Pro" },
          ],
          model: "GigaChat-2",
        }),
        "workspace-1",
      );
    } finally {
      await new Promise<void>((resolve, reject) => {
        httpServer.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });
});
