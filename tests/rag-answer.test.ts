import { Readable } from "node:stream";
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
    getQdrantClient: vi.fn(() => ({
      search: vi.fn(async () => []),
      getCollection: vi.fn(() => ({ config: { params: { vectors: { size: 3 } } } })),
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

function getHeader(container: unknown, name: string): string | null {
  if (!container) {
    return null;
  }

  const headers = (container as { headers?: unknown }).headers ?? container;

  if (!headers) {
    return null;
  }

  if (typeof (headers as { get?: unknown }).get === "function") {
    const headersLike = headers as { get: (value: string) => string | null };
    const headerValue = headersLike.get(name);
    if (headerValue) {
      return headerValue;
    }
    return headersLike.get(name.toLowerCase());
  }

  const entries = Object.entries(headers as Record<string, unknown>);
  const target = name.toLowerCase();
  for (const [key, value] of entries) {
    if (key.toLowerCase() === target && typeof value === "string") {
      return value;
    }
  }

  return null;
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
    const mockFetch = vi.fn(async (input: any, init?: any) => {
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
        const acceptHeader = getHeader(init, "Accept");
        expect(acceptHeader?.toLowerCase()).toContain("text/event-stream");
        const sseStream = Readable.from([
          Buffer.from(
            "event: message\ndata: {\"choices\":[{\"delta\":{\"content\":\"От\"}}]}\n\n",
            "utf8",
          ),
          Buffer.from(
            "event: message\ndata: {\"choices\":[{\"delta\":{\"content\":\"вет\"}}]}\n\n",
            "utf8",
          ),
          Buffer.from(
            "event: message\ndata: {\"usage\":{\"total_tokens\":42}}\n\n",
            "utf8",
          ),
          Buffer.from("event: message\ndata: [DONE]\n\n", "utf8"),
        ]);

        return new actualNodeFetch.Response(sseStream as any, {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        });
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
      requestConfig: { additionalBodyFields: { stream: true } },
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

  it("стримит SSE-ответ при запросе text/event-stream", async () => {
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
    const mockFetch = vi.fn(async (input: any, init?: any) => {
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
        const acceptHeader = getHeader(init, "Accept");
        expect(acceptHeader?.toLowerCase()).toContain("text/event-stream");
        const sseStream = Readable.from([
          Buffer.from(
            "event: message\ndata: {\"choices\":[{\"delta\":{\"content\":\"Ответ\"}}]}\n\n",
            "utf8",
          ),
          Buffer.from("event: message\ndata: [DONE]\n\n", "utf8"),
        ]);

        return new actualNodeFetch.Response(sseStream as any, {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        });
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
      requestConfig: { additionalBodyFields: { stream: true } },
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
        headers: {
          "content-type": "application/json",
          Accept: "text/event-stream",
        },
        body: JSON.stringify({
          q: "Что такое тест?",
          kb_id: "kb-1",
          top_k: 3,
          hybrid: { bm25: { weight: 1, limit: 3 }, vector: { weight: 0 } },
          llm: { provider: "llm-1", model: "test-model" },
        }),
      });

      expect(response.headers.get("content-type")).toContain("text/event-stream");

      const reader = response.body?.getReader();
      expect(reader).toBeDefined();
      let payload = "";
      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }
          payload += new TextDecoder().decode(value);
        }
      }

      expect(response.status, payload).toBe(200);
      expect(payload).toContain("event: status");
      expect(payload).toContain("event: source");
      expect(payload).toContain("event: delta");
      expect(payload).toContain("event: done");
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

describe("POST /api/public/collections/search/rag", () => {
  it("использует гибридный пайплайн, когда передан kb_id", async () => {
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
    const mockFetch = vi.fn(async (input: any, init?: any) => {
      const url = typeof input === "string" ? input : input?.url ?? "";

      if (url.includes("/api/public/collections/search/vector")) {
        return new actualNodeFetch.Response(
          JSON.stringify({
            results: [
              {
                id: "vec-1",
                score: 0.75,
                payload: {
                  chunk_id: "chunk-1",
                  chunk: {
                    id: "chunk-1",
                    metadata: { sourceUrl: "https://docs.example/article" },
                  },
                  document: { id: "doc-1" },
                },
              },
            ],
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        );
      }

      if (url === "https://embedding.example/token") {
        return new actualNodeFetch.Response(
          JSON.stringify({ access_token: "embedding-token" }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        );
      }

      if (url === "https://embedding.example/embeddings") {
        return new actualNodeFetch.Response(
          JSON.stringify({
            data: [
              {
                id: "embed-1",
                embedding: [0.1, 0.2, 0.3],
              },
            ],
            usage: { total_tokens: 12 },
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        );
      }

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
        const acceptHeader = getHeader(init, "Accept");
        expect(acceptHeader?.toLowerCase()).toContain("text/event-stream");
        const sseStream = Readable.from([
          Buffer.from(
            "event: message\ndata: {\"choices\":[{\"delta\":{\"content\":\"Ответ\"}}]}\n\n",
            "utf8",
          ),
          Buffer.from(
            "event: message\ndata: {\"usage\":{\"total_tokens\":42}}\n\n",
            "utf8",
          ),
          Buffer.from("event: message\ndata: [DONE]\n\n", "utf8"),
        ]);

        return new actualNodeFetch.Response(sseStream as any, {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        });
      }

      throw new Error(`Unexpected fetch call to ${url}`);
    });

    vi.doMock("node-fetch", () => ({
      ...actualNodeFetch,
      default: mockFetch,
    }));

    const expressModule = await import("express");
    const { storage } = await import("../server/storage");
    const qdrantModule = await import("../server/qdrant");

    const vectorClient = {
      search: vi.fn(),
      getCollection: vi.fn(async () => ({ config: { params: { vectors: { size: 3 } } } })),
    };
    (qdrantModule.getQdrantClient as unknown as Mock).mockImplementation(() => vectorClient);

    (storage.getSiteByPublicApiKey as unknown as Mock).mockResolvedValue(null);
    (storage.getWorkspaceEmbedKeyByPublicKey as unknown as Mock).mockResolvedValue({
      id: "embed-1",
      workspaceId: "workspace-1",
      knowledgeBaseId: "kb-1",
      publicKey: "public-key",
      collection: "collection-1",
    });
    (storage.listWorkspaceEmbedKeyDomains as unknown as Mock).mockResolvedValue([]);
    (storage.isWorkspaceMember as unknown as Mock).mockResolvedValue(true);
    (storage.getCollectionWorkspace as unknown as Mock).mockResolvedValue("workspace-1");
    (storage.getKnowledgeBase as unknown as Mock).mockResolvedValue({
      id: "kb-1",
      workspaceId: "workspace-1",
    });
    (storage.searchKnowledgeBaseSuggestions as unknown as Mock).mockResolvedValue({
      normalizedQuery: "что такое тест",
      sections: [
        {
          chunkId: "chunk-1",
          documentId: "doc-1",
          docTitle: "Документ",
          sectionTitle: "Раздел",
          text: "Полный текст",
          snippet: "Сниппет",
          score: 1,
          source: "content",
          nodeId: "node-1",
          nodeSlug: "node-slug",
        },
      ],
    });
    (storage.getKnowledgeChunksByIds as unknown as Mock).mockResolvedValue([
      {
        chunkId: "chunk-1",
        documentId: "doc-1",
        docTitle: "Документ",
        sectionTitle: "Раздел",
        text: "Полный текст",
        nodeId: "node-1",
        nodeSlug: "node-slug",
      },
    ]);
    (storage.getKnowledgeChunksByVectorRecords as unknown as Mock).mockResolvedValue([
      {
        chunkId: "chunk-1",
        documentId: "doc-1",
        docTitle: "Документ",
        sectionTitle: "Раздел",
        text: "Полный текст",
        nodeId: "node-1",
        nodeSlug: "node-slug",
        vectorRecordId: "vec-1",
      },
    ]);
    (storage.getEmbeddingProvider as unknown as Mock).mockResolvedValue({
      id: "embedding-1",
      name: "Embedding",
      providerType: "gigachat",
      description: null,
      isActive: true,
      tokenUrl: "https://embedding.example/token",
      embeddingsUrl: "https://embedding.example/embeddings",
      authorizationKey: "Basic embedding",
      scope: "scope",
      model: "embedding-model",
      allowSelfSignedCertificate: true,
      requestHeaders: {},
      requestConfig: { additionalBodyFields: { stream: true } },
      responseConfig: {},
      qdrantConfig: { vectorFieldName: "content_vector" },
      workspaceId: "workspace-1",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    (storage.getOrCreateWorkspaceEmbedKey as unknown as Mock).mockResolvedValue({
      id: "embed-1",
      workspaceId: "workspace-1",
      knowledgeBaseId: "kb-1",
      publicKey: "public-key",
      collection: "collection-1",
    });
    (storage.recordKnowledgeBaseAskAiRun as unknown as Mock).mockResolvedValue(undefined);
    (storage.recordKnowledgeBaseRagRequest as unknown as Mock).mockResolvedValue(undefined);
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
      availableModels: [{ value: "test-model", label: "Test" }],
      allowSelfSignedCertificate: true,
      requestHeaders: {},
      requestConfig: { additionalBodyFields: { stream: true } },
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
      const response = await fetch(`http://127.0.0.1:${address.port}/api/public/collections/search/rag`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": "public-key",
        },
        body: JSON.stringify({
          collection: "collection-1",
          query: "Что такое тест?",
          embeddingProviderId: "embedding-1",
          llmProviderId: "llm-1",
          kbId: "kb-1",
        }),
      });

      const body = await response.json();

      expect(response.status, JSON.stringify(body)).toBe(200);

      expect(body).toMatchObject({
        answer: "Ответ",
        citations: [
          expect.objectContaining({ node_id: "node-1", node_slug: "node-slug" }),
        ],
        chunks: [
          expect.objectContaining({ node_id: "node-1", node_slug: "node-slug" }),
        ],
        provider: expect.objectContaining({ id: "llm-1" }),
        embeddingProvider: expect.objectContaining({ id: "embedding-1" }),
      });

      expect(mockFetch.mock.calls.some(([input]) => {
        const url = typeof input === "string" ? input : input?.url;
        return typeof url === "string" && url.includes("/api/public/collections/search/vector");
      })).toBe(true);

      expect((storage.recordKnowledgeBaseRagRequest as unknown as Mock)).toHaveBeenCalled();
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

  it("сохраняет обратную совместимость, когда kb_id не передан", async () => {
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
    const mockFetch = vi.fn(async (input: any, init?: any) => {
      const url = typeof input === "string" ? input : input?.url ?? "";

      if (url === "https://embedding.example/token") {
        return new actualNodeFetch.Response(
          JSON.stringify({ access_token: "embedding-token" }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        );
      }

      if (url === "https://embedding.example/embeddings") {
        return new actualNodeFetch.Response(
          JSON.stringify({
            data: [
              {
                id: "embed-1",
                embedding: [0.1, 0.2, 0.3],
              },
            ],
            usage: { total_tokens: 10 },
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        );
      }

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
        const acceptHeader = getHeader(init, "Accept");
        expect(acceptHeader?.toLowerCase()).toContain("text/event-stream");
        const sseStream = Readable.from([
          Buffer.from(
            "event: message\ndata: {\"choices\":[{\"delta\":{\"content\":\"От\"}}]}\n\n",
            "utf8",
          ),
          Buffer.from(
            "event: message\ndata: {\"choices\":[{\"delta\":{\"content\":\"вет\"}}]}\n\n",
            "utf8",
          ),
          Buffer.from(
            "event: message\ndata: {\"usage\":{\"total_tokens\":21}}\n\n",
            "utf8",
          ),
          Buffer.from("event: message\ndata: [DONE]\n\n", "utf8"),
        ]);

        return new actualNodeFetch.Response(sseStream as any, {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        });
      }

      throw new Error(`Unexpected fetch call to ${url}`);
    });

    vi.doMock("node-fetch", () => ({
      ...actualNodeFetch,
      default: mockFetch,
    }));

    const expressModule = await import("express");
    const { storage } = await import("../server/storage");
    const qdrantModule = await import("../server/qdrant");

    const searchResults = [
      {
        id: "chunk-1",
        score: 0.6,
        payload: {
          chunk: {
            id: "chunk-1",
            text: "Полный текст",
            metadata: { sourceUrl: "https://docs.example/article" },
          },
          document: { id: "doc-1", title: "Документ" },
        },
      },
    ];

    const qdrantClient = {
      getCollection: vi.fn(async () => ({ config: { params: { vectors: { size: 3 } } } })),
      search: vi.fn(async () => searchResults),
    };
    (qdrantModule.getQdrantClient as unknown as Mock).mockImplementation(() => qdrantClient);

    const resolvedClient = qdrantModule.getQdrantClient();
    expect(resolvedClient).toBe(qdrantClient);

    (storage.isWorkspaceMember as unknown as Mock).mockResolvedValue(true);
    (storage.getSiteByPublicApiKey as unknown as Mock).mockResolvedValue({
      id: "site-1",
      workspaceId: "workspace-1",
      publicApiKey: "api-key",
      url: "https://docs.example",
      startUrls: [],
    });
    (storage.getCollectionWorkspace as unknown as Mock).mockResolvedValue("workspace-1");
    const recordRagRequestMock = vi.fn();
    (storage.recordKnowledgeBaseRagRequest as unknown as Mock).mockImplementation(recordRagRequestMock);
    (storage.getEmbeddingProvider as unknown as Mock).mockResolvedValue({
      id: "embedding-1",
      name: "Embedding",
      providerType: "gigachat",
      description: null,
      isActive: true,
      tokenUrl: "https://embedding.example/token",
      embeddingsUrl: "https://embedding.example/embeddings",
      authorizationKey: "Basic embedding",
      scope: "scope",
      model: "embedding-model",
      allowSelfSignedCertificate: true,
      requestHeaders: {},
      requestConfig: { additionalBodyFields: { stream: true } },
      responseConfig: {},
      qdrantConfig: { vectorFieldName: "content_vector", vectorSize: 3 },
      workspaceId: "workspace-1",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
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
      availableModels: [{ value: "test-model", label: "Test" }],
      allowSelfSignedCertificate: true,
      requestHeaders: {},
      requestConfig: { additionalBodyFields: { stream: true } },
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
      const response = await fetch(`http://127.0.0.1:${address.port}/api/public/collections/search/rag`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": "api-key",
        },
        body: JSON.stringify({
          collection: "collection-1",
          query: "Что такое тест?",
          embeddingProviderId: "embedding-1",
          llmProviderId: "llm-1",
        }),
      });

      const body = await response.json();

      expect(response.status, JSON.stringify(body)).toBe(200);

      expect(body).toMatchObject({
        answer: "Ответ",
        sources: [
          expect.objectContaining({ url: "https://docs.example/article" }),
        ],
        provider: expect.objectContaining({ id: "llm-1" }),
      });

      expect(recordRagRequestMock).not.toHaveBeenCalled();
      expect(mockFetch.mock.calls.some(([input]) => {
        const url = typeof input === "string" ? input : input?.url;
        return typeof url === "string" && url.includes("/api/public/collections/search/vector");
      })).toBe(false);
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

describe("POST /api/public/collections/:publicId/search/rag", () => {
  it("пробрасывает SSE-события для Gigachat", async () => {
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
    const mockFetch = vi.fn(async (input: any, init?: any) => {
      const url = typeof input === "string" ? input : input?.url ?? "";

      if (url === "https://embedding.example/token") {
        return new actualNodeFetch.Response(
          JSON.stringify({ access_token: "embedding-token" }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        );
      }

      if (url === "https://embedding.example/embeddings") {
        return new actualNodeFetch.Response(
          JSON.stringify({
            data: [
              {
                id: "embed-1",
                embedding: [0.1, 0.2, 0.3],
              },
            ],
            usage: { total_tokens: 10 },
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        );
      }

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
        const acceptHeader = getHeader(init, "Accept");
        expect(acceptHeader?.toLowerCase()).toContain("text/event-stream");
        const sseStream = Readable.from([
          Buffer.from(
            "event: message\ndata: {\"choices\":[{\"delta\":{\"content\":\"Привет\"}}]}\n\n",
            "utf8",
          ),
          Buffer.from(
            "event: message\ndata: {\"usage\":{\"total_tokens\":33}}\n\n",
            "utf8",
          ),
          Buffer.from("event: message\ndata: [DONE]\n\n", "utf8"),
        ]);

        return new actualNodeFetch.Response(sseStream as any, {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        });
      }

      throw new Error(`Unexpected fetch call to ${url}`);
    });

    vi.doMock("node-fetch", () => ({
      ...actualNodeFetch,
      default: mockFetch,
    }));

    const expressModule = await import("express");
    const { storage } = await import("../server/storage");
    const qdrantModule = await import("../server/qdrant");

    const qdrantClient = {
      getCollection: vi.fn(async () => ({ config: { params: { vectors: { size: 3 } } } })),
      search: vi.fn(async () => [
        {
          id: "chunk-1",
          score: 0.9,
          payload: {
            chunk: {
              id: "chunk-1",
              text: "Полный текст",
              metadata: { sourceUrl: "https://docs.example/article" },
            },
            document: { id: "doc-1", title: "Документ" },
          },
        },
      ]),
    };
    (qdrantModule.getQdrantClient as unknown as Mock).mockImplementation(() => qdrantClient);

    const resolvedClient = qdrantModule.getQdrantClient();
    expect(resolvedClient).toBe(qdrantClient);

    (storage.isWorkspaceMember as unknown as Mock).mockResolvedValue(true);
    (storage.getSiteByPublicId as unknown as Mock).mockResolvedValue({
      id: "site-1",
      workspaceId: "workspace-1",
      publicApiKey: "api-key",
      url: "https://docs.example",
      startUrls: [],
    });
    (storage.getCollectionWorkspace as unknown as Mock).mockResolvedValue("workspace-1");
    (storage.getEmbeddingProvider as unknown as Mock).mockResolvedValue({
      id: "embedding-1",
      name: "Embedding",
      providerType: "gigachat",
      description: null,
      isActive: true,
      tokenUrl: "https://embedding.example/token",
      embeddingsUrl: "https://embedding.example/embeddings",
      authorizationKey: "Basic embedding",
      scope: "scope",
      model: "embedding-model",
      allowSelfSignedCertificate: true,
      requestHeaders: {},
      requestConfig: { additionalBodyFields: { stream: true } },
      responseConfig: {},
      qdrantConfig: { vectorFieldName: "content_vector", vectorSize: 3 },
      workspaceId: "workspace-1",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
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
      availableModels: [{ value: "test-model", label: "Test" }],
      allowSelfSignedCertificate: true,
      requestHeaders: {},
      requestConfig: { additionalBodyFields: { stream: true } },
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
      const response = await fetch(
        `http://127.0.0.1:${address.port}/api/public/collections/test-collection/search/rag`,
        {
          method: "POST",
          headers: {
            Accept: "text/event-stream",
            "content-type": "application/json",
            "x-api-key": "api-key",
          },
          body: JSON.stringify({
            workspace_id: "workspace-1",
            collection: "collection-1",
            query: "Что такое тест?",
            embeddingProviderId: "embedding-1",
            llmProviderId: "llm-1",
          }),
        },
      );

      expect(response.headers.get("content-type")).toContain("text/event-stream");

      const reader = response.body?.getReader();
      expect(reader).toBeDefined();
      let payload = "";
      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }
          payload += new TextDecoder().decode(value);
        }
      }

      expect(response.status, payload).toBe(200);
      expect(payload).toContain("event: status");
      expect(payload).toContain("event: delta");
      expect(payload).toContain("Привет");
      expect(payload).toContain("event: done");
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
