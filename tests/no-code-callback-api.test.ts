import { beforeEach, describe, expect, it, vi } from "vitest";
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
    const ensureWorkspaceContextMiddleware = (_options: any = {}) => (req: any, _res: any, next: () => void) => {
      Object.assign(req, {
        workspaceContext: { workspaceId: "workspace-1" },
        workspaceId: "workspace-1",
        workspaceRole: "owner",
      });
      return next();
    };
    return {
      requireAuth,
      requireAdmin: requireAuth,
      ensureWorkspaceContextMiddleware,
      getSessionUser: () => ({ id: "user-1", email: "user@example.com" }),
      toPublicUser: (user: unknown) => user,
      reloadGoogleAuth: vi.fn(),
      reloadYandexAuth: vi.fn(),
      ensureWorkspaceContext: vi.fn(),
      buildSessionResponse: vi.fn(() => ({})),
      getRequestWorkspace: () => ({ id: "workspace-1" }),
      getRequestWorkspaceMemberships: () => [],
      resolveOptionalUser: () => ({ id: "user-1" }),
      WorkspaceContextError: class extends Error {},
    };
  });
}

function setupStorageMock() {
  const methodMocks: Record<string | symbol, ReturnType<typeof vi.fn>> = {};
  const storageProxy = new Proxy(
    {},
    {
      get(_target, prop: string | symbol) {
        if (!methodMocks[prop]) {
          methodMocks[prop] = vi.fn();
        }
        return methodMocks[prop]!;
      },
    },
  );

  vi.doMock("../server/storage", () => ({
    storage: storageProxy,
  }));

  return storageProxy as Record<string | symbol, ReturnType<typeof vi.fn>>;
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
  vi.doMock("../server/knowledge-base", () => ({
    listKnowledgeBases: vi.fn(async () => []),
    getKnowledgeNodeDetail: vi.fn(),
    deleteKnowledgeNode: vi.fn(),
    updateKnowledgeNodeParent: vi.fn(),
    KnowledgeBaseError: class extends Error {},
    createKnowledgeBase: vi.fn(),
    deleteKnowledgeBase: vi.fn(),
    createKnowledgeFolder: vi.fn(),
    createKnowledgeDocument: vi.fn(),
    updateKnowledgeDocument: vi.fn(),
  }));
  vi.doMock("../server/knowledge-chunks", () => ({
    previewKnowledgeDocumentChunks: vi.fn(),
    createKnowledgeDocumentChunkSet: vi.fn(),
    updateKnowledgeDocumentChunkVectorRecords: vi.fn(),
  }));
  vi.doMock("../server/qdrant", () => ({
    getQdrantClient: () => ({
      upsert: vi.fn(),
      scroll: vi.fn(),
      delete: vi.fn(),
      search: vi.fn(),
    }),
    QdrantConfigurationError: class extends Error {},
  }));
}

function setupChatServiceMock() {
  const ChatServiceError = class extends Error {
    status: number;
    code?: string;
    details?: unknown;
    constructor(message: string, status = 400, code?: string, details?: unknown) {
      super(message);
      this.name = "ChatServiceError";
      this.status = status;
      this.code = code;
      this.details = details;
    }
  };

  const chatService = {
    listUserChats: vi.fn(),
    createChat: vi.fn(),
    renameChat: vi.fn(),
    deleteChat: vi.fn(),
    getChatMessages: vi.fn(),
    addUserMessage: vi.fn(),
    buildChatLlmContext: vi.fn(),
    buildChatCompletionRequestBody: vi.fn(),
    addAssistantMessage: vi.fn(),
    getChatById: vi.fn(),
    addNoCodeCallbackMessage: vi.fn(),
    ChatServiceError,
  };

  vi.doMock("../server/chat-service", () => chatService);
  return chatService;
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

describe("No-code callback API", () => {
  beforeEach(() => {
    vi.resetModules();
    executeMock.mockReset();
    executeMock.mockResolvedValue({ rows: [] });
    fetchMock.mockReset();
  });

  const fetchMock = vi.fn(async () => ({
    ok: true,
    text: async () => "ok",
    headers: new (await import("node-fetch")).Headers(),
  }));

  vi.doMock("node-fetch", async () => {
    const actual = await vi.importActual<typeof import("node-fetch")>("node-fetch");
    return { ...actual, default: fetchMock, Headers: actual.Headers };
  });

  it("creates message via callback endpoint", async () => {
    setupDbMock();
    setupAuthMock();
    setupStorageMock();
    setupOtherMocks();
    const chatService = setupChatServiceMock();

    chatService.addNoCodeCallbackMessage.mockResolvedValueOnce({
      id: "msg-1",
      chatId: "chat-1",
      role: "assistant",
      content: "Ответ",
      metadata: {},
      createdAt: new Date().toISOString(),
    });

    const { httpServer } = await createTestServer();
    try {
      const address = httpServer.address() as AddressInfo;
      const response = await fetch(`http://127.0.0.1:${address.port}/api/no-code/callback/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId: "workspace-1",
          chatId: "chat-1",
          role: "assistant",
          text: "Ответ",
          triggerMessageId: "user-msg-1",
        }),
      });

      expect(response.status).toBe(201);
      const json = await response.json();
      expect(json.message?.id).toBe("msg-1");
      expect(chatService.addNoCodeCallbackMessage).toHaveBeenCalledWith(
        expect.objectContaining({ workspaceId: "workspace-1", chatId: "chat-1", role: "assistant" }),
      );
    } finally {
      await new Promise<void>((resolve, reject) => {
        httpServer.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it("rejects invalid role with 400", async () => {
    setupDbMock();
    setupAuthMock();
    setupStorageMock();
    setupOtherMocks();
    setupChatServiceMock();

    const { httpServer } = await createTestServer();
    try {
      const address = httpServer.address() as AddressInfo;
      const response = await fetch(`http://127.0.0.1:${address.port}/api/no-code/callback/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId: "workspace-1",
          chatId: "chat-1",
          role: "admin",
          text: "hi",
        }),
      });

      expect(response.status).toBe(400);
    } finally {
      await new Promise<void>((resolve, reject) => {
        httpServer.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });
});

