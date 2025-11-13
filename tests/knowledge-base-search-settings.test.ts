import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AddressInfo } from "net";

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

function setupStorageMock(options: {
  knowledgeBaseExists?: boolean;
  searchSettings?: Record<string, unknown> | null;
} = {}): void {
  const {
    knowledgeBaseExists = true,
    searchSettings = null,
  } = options;

  const knowledgeBaseRecord = knowledgeBaseExists
    ? { id: "kb-1", workspaceId: "workspace-1", name: "KB" }
    : null;

  const storageProxy = {
    getKnowledgeBase: vi.fn(async () => knowledgeBaseRecord),
    getKnowledgeBaseSearchSettings: vi.fn(async () => searchSettings),
    upsertKnowledgeBaseSearchSettings: vi.fn(async (_workspaceId: string, _baseId: string, settings: any) => ({
      workspaceId: "workspace-1",
      knowledgeBaseId: "kb-1",
      chunkSettings: settings.chunkSettings,
      ragSettings: settings.ragSettings,
      updatedAt: new Date().toISOString(),
    })),
  };

  vi.doMock("../server/storage", () => ({
    storage: storageProxy,
    ensureKnowledgeBaseTables: vi.fn(),
    ensureKnowledgeBaseSearchSettingsTable: vi.fn(),
    isKnowledgeBasePathLtreeEnabled: () => false,
  }));
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

beforeEach(() => {
  vi.resetModules();
  executeMock.mockReset();
  executeMock.mockResolvedValue({ rows: [] });
});

afterEach(() => {
  vi.clearAllMocks();
});

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

describe("Knowledge base search settings API", () => {
  it("returns default settings when record is missing", async () => {
    setupDbMock();
    setupAuthMock();
    setupStorageMock({ searchSettings: null });
    setupOtherMocks();

    const { httpServer } = await createTestServer();
    try {
      const address = httpServer.address() as AddressInfo;
      const response = await fetch(`http://127.0.0.1:${address.port}/api/knowledge/bases/kb-1/search/settings`);
      expect(response.status).toBe(200);
      const payload = await response.json();
      expect(payload).toHaveProperty("chunkSettings");
      expect(payload).toHaveProperty("ragSettings");
      expect(payload.chunkSettings.topK).toBeGreaterThan(0);
    } finally {
      await new Promise<void>((resolve, reject) => {
        httpServer.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it("returns 404 when base does not belong to workspace", async () => {
    setupDbMock();
    setupAuthMock();
    setupStorageMock({ knowledgeBaseExists: false });
    setupOtherMocks();

    const { httpServer } = await createTestServer();
    try {
      const address = httpServer.address() as AddressInfo;
      const response = await fetch(`http://127.0.0.1:${address.port}/api/knowledge/bases/kb-1/search/settings`);
      expect(response.status).toBe(404);
      const payload = await response.json();
      expect(payload.error).toBeDefined();
    } finally {
      await new Promise<void>((resolve, reject) => {
        httpServer.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });
});
