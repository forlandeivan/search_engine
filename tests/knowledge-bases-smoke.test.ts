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

function setupStorageMock(): void {
  const storageMethods = new Map<PropertyKey, ReturnType<typeof vi.fn>>();
  const storageProxy = new Proxy<Record<string, unknown>>({}, {
    get: (_target, prop) => {
      if (prop === "then") {
        return undefined;
      }
      if (!storageMethods.has(prop)) {
        storageMethods.set(prop, vi.fn().mockResolvedValue(undefined));
      }
      return storageMethods.get(prop);
    },
  });

  vi.doMock("../server/storage", () => ({
    storage: storageProxy,
    ensureKnowledgeBaseTables: vi.fn(),
    isKnowledgeBasePathLtreeEnabled: () => false,
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
      ensureWorkspaceContext: vi.fn((_req: any, _res: any, next: () => void) => next()),
      buildSessionResponse: vi.fn(() => ({ user: { id: "user-1" }, workspaces: [] })),
      getRequestWorkspace: () => ({ id: "workspace-1" }),
      getRequestWorkspaceMemberships: () => [],
      resolveOptionalUser: () => ({ id: "user-1" }),
      WorkspaceContextError: class extends Error {},
    };
  });
}

function setupCrawlerMock(): void {
  vi.doMock("../server/crawler", () => ({
    crawler: {
      onLog: vi.fn(),
    },
  }));
}

function setupKBCrawlerMock(): void {
  const asyncStub = vi.fn(async () => ({}));
  vi.doMock("../server/kb-crawler", () => ({
    startKnowledgeBaseCrawl: asyncStub,
    getKnowledgeBaseCrawlJob: vi.fn(() => undefined),
    getKnowledgeBaseCrawlJobStateForBase: vi.fn(() => undefined),
    subscribeKnowledgeBaseCrawlJob: vi.fn(),
    pauseKnowledgeBaseCrawl: asyncStub,
    resumeKnowledgeBaseCrawl: asyncStub,
    cancelKnowledgeBaseCrawl: asyncStub,
    retryKnowledgeBaseCrawl: asyncStub,
    crawlKnowledgeDocumentPage: asyncStub,
  }));
}

function setupCorsCacheMock(): void {
  vi.doMock("../server/cors-cache", () => ({
    invalidateCorsCache: vi.fn(),
  }));
}

function setupQdrantMock(): void {
  class QdrantConfigurationError extends Error {}
  vi.doMock("../server/qdrant", () => ({
    getQdrantClient: vi.fn(async () => ({
      collections: {
        get: vi.fn(async () => ({})),
        create: vi.fn(async () => ({})),
        list: vi.fn(async () => ({ collections: [] })),
      },
      points: {
        upsert: vi.fn(async () => ({})),
        delete: vi.fn(async () => ({})),
      },
    })),
    QdrantConfigurationError,
  }));
}

function setupKnowledgeChunksMock(): void {
  const asyncStub = vi.fn(async () => ({ chunks: [] }));
  vi.doMock("../server/knowledge-chunks", () => ({
    previewKnowledgeDocumentChunks: asyncStub,
    createKnowledgeDocumentChunkSet: asyncStub,
    updateKnowledgeDocumentChunkVectorRecords: asyncStub,
  }));
}

function setupKnowledgeBaseMock(): void {
  vi.doMock("../server/knowledge-base", () => {
    const listKnowledgeBases = vi.fn(async () => []);
    const asyncStub = vi.fn(async () => ({}));

    class KnowledgeBaseError extends Error {
      status: number;
      constructor(message: string, status = 400) {
        super(message);
        this.status = status;
      }
    }

    return {
      listKnowledgeBases,
      getKnowledgeNodeDetail: asyncStub,
      deleteKnowledgeNode: asyncStub,
      updateKnowledgeNodeParent: asyncStub,
      createKnowledgeBase: asyncStub,
      deleteKnowledgeBase: asyncStub,
      createKnowledgeFolder: asyncStub,
      createKnowledgeDocument: asyncStub,
      updateKnowledgeDocument: asyncStub,
      KnowledgeBaseError,
    };
  });
}

beforeEach(() => {
  vi.resetModules();
  executeMock.mockReset();
  executeMock.mockResolvedValue({ rows: [] });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/knowledge/bases", () => {
  it("возвращает 200 при пустом списке баз знаний", async () => {
    setupDbMock();
    setupStorageMock();
    setupAuthMock();
    setupCrawlerMock();
    setupKBCrawlerMock();
    setupCorsCacheMock();
    setupQdrantMock();
    setupKnowledgeChunksMock();
    setupKnowledgeBaseMock();

    const expressModule = await import("express");
    const app = expressModule.default();
    app.use(expressModule.json());

    const { registerRoutes } = await import("../server/routes");
    const httpServer = await registerRoutes(app);

    await new Promise<void>((resolve) => {
      httpServer.listen(0, resolve);
    });

    try {
      const address = httpServer.address() as AddressInfo;
      const response = await fetch(`http://127.0.0.1:${address.port}/api/knowledge/bases`);

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(Array.isArray(body)).toBe(true);
    } finally {
      await new Promise<void>((resolve, reject) => {
        httpServer.close((error) => {
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        });
      });
    }
  });
});
