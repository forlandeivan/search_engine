import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import type { AddressInfo } from "net";
import { DEFAULT_LLM_REQUEST_CONFIG } from "@shared/schema";

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
  const storageProxy = new Proxy<Record<string, unknown>>(
    {},
    {
      get: (_target, prop) => {
        if (prop === "then") {
          return undefined;
        }
        if (!storageMethods.has(prop)) {
          storageMethods.set(prop, vi.fn().mockResolvedValue(undefined));
        }
        return storageMethods.get(prop);
      },
    },
  );

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
      search: vi.fn(async () => []),
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

describe("POST /public/rag/answer", () => {
  it("возвращает node_id в цитатах", async () => {
    setupDbMock();
    setupStorageMock();
    setupAuthMock();
    setupCrawlerMock();
    setupKBCrawlerMock();
    setupCorsCacheMock();
    setupQdrantMock();
    setupKnowledgeChunksMock();
    setupKnowledgeBaseMock();

    const actualNodeFetch = await vi.importActual<typeof import("node-fetch")>("node-fetch");
    const mockFetch = vi.fn(async (input: any) => {
      const url = typeof input === "string" ? input : input.url;

      if (url === "https://llm.example/token") {
        return new actualNodeFetch.Response(
          JSON.stringify({ access_token: "llm-token" }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        );
      }

      if (url === "https://llm.example/completions") {
        return new actualNodeFetch.Response(
          JSON.stringify({
            choices: [
              {
                message: { content: "Ответ" },
              },
            ],
            usage: { total_tokens: 42 },
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        );
      }

      throw new Error(`Unexpected fetch call to ${url}`);
    });

    vi.doMock("node-fetch", () => ({
      ...actualNodeFetch,
      default: mockFetch,
    }));

    const expressModule = await import("express");
    const { storage } = await import("../server/storage");

    (storage.getKnowledgeBase as unknown as Mock).mockResolvedValue({
      id: "kb-1",
      workspaceId: "workspace-1",
    });

    (storage.searchKnowledgeBaseSuggestions as unknown as Mock).mockResolvedValue({
      normalizedQuery: "вопрос",
      sections: [
        {
          chunkId: "chunk-1",
          documentId: "doc-1",
          docTitle: "Документ",
          sectionTitle: "Раздел",
          snippet: "Фрагмент",
          text: "Полный текст",
          score: 1,
          source: "content",
          nodeId: "node-1",
          nodeSlug: "node-slug",
        },
      ],
    });

    (storage.getKnowledgeChunksByIds as unknown as Mock).mockResolvedValue([]);
    (storage.getKnowledgeChunksByVectorRecords as unknown as Mock).mockResolvedValue([]);

    (storage.getLlmProvider as unknown as Mock).mockResolvedValue({
      id: "llm-1",
      name: "LLM",
      providerType: "gigachat",
      description: null,
      isActive: true,
      tokenUrl: "https://llm.example/token",
      completionUrl: "https://llm.example/completions",
      authorizationKey: "Basic test",
      scope: "scope",
      model: "test-model",
      availableModels: [],
      allowSelfSignedCertificate: true,
      requestHeaders: {},
      requestConfig: {},
      responseConfig: {},
      workspaceId: "workspace-1",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const app = expressModule.default();
    app.use(expressModule.json());

    const routesModule = await import("../server/routes");
    const httpServer = await routesModule.registerRoutes(app);

    await new Promise<void>((resolve) => {
      httpServer.listen(0, resolve);
    });

    try {
      const address = httpServer.address() as AddressInfo;
      const response = await fetch(`http://127.0.0.1:${address.port}/public/rag/answer`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          q: "Что такое тест?",
          kb_id: "kb-1",
          top_k: 3,
          hybrid: { bm25: { weight: 1, limit: 3 }, vector: { weight: 0 } },
          llm: { provider: "llm-1", model: "test-model" },
        }),
      });

      expect(response.status).toBe(200);
      const body = await response.json();

      expect(Array.isArray(body.citations)).toBe(true);
      expect(body.citations[0]).toMatchObject({ node_id: "node-1", node_slug: "node-slug" });
      expect(Array.isArray(body.chunks)).toBe(true);
      expect(body.chunks[0]).toMatchObject({ node_id: "node-1", node_slug: "node-slug" });

      const completionCall = mockFetch.mock.calls.find(([input]) => {
        const url = typeof input === "string" ? input : input?.url;
        return url === "https://llm.example/completions";
      });

      expect(completionCall).toBeDefined();

      const completionInit = completionCall?.[1] as { body?: string } | undefined;
      expect(completionInit).toBeDefined();

      const parsedRequest = JSON.parse(String(completionInit?.body ?? "{}"));
      const messagesField = DEFAULT_LLM_REQUEST_CONFIG.messagesField;
      const messages = parsedRequest[messagesField];
      expect(Array.isArray(messages)).toBe(true);
      const lastMessage = Array.isArray(messages) ? messages[messages.length - 1] : null;
      expect(typeof lastMessage?.content).toBe("string");
      expect(lastMessage?.content).toContain("node-1");
      expect(lastMessage?.content).toContain("node-slug");
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
