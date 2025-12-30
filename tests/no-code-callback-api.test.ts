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
    addNoCodeSyncFinalResults: vi.fn(),
    addNoCodeStreamChunk: vi.fn(),
    setNoCodeAssistantAction: vi.fn(),
    ChatServiceError,
  };

  vi.doMock("../server/chat-service", () => chatService);
  return chatService;
}

function setupSkillsMock() {
  const SkillServiceError = class extends Error {
    status: number;
    code?: string;
    constructor(message: string, status = 400, code?: string) {
      super(message);
      this.name = "SkillServiceError";
      this.status = status;
      this.code = code;
    }
  };

  const skillsMock = {
    listSkills: vi.fn().mockResolvedValue([]),
    createSkill: vi.fn(),
    updateSkill: vi.fn(),
    archiveSkill: vi.fn(),
    getSkillById: vi.fn(),
    createUnicaChatSkillForWorkspace: vi.fn(),
    generateNoCodeCallbackToken: vi.fn(),
    verifyNoCodeCallbackToken: vi.fn(async () => ({ skillId: "skill-1" })),
    verifyNoCodeCallbackKey: vi.fn(async () => ({ skillId: "skill-1" })),
    SkillServiceError,
    UNICA_CHAT_SYSTEM_KEY: "UNICA_CHAT",
  };

  vi.doMock("../server/skills", () => skillsMock);
  return skillsMock;
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
  let skillsMock: ReturnType<typeof setupSkillsMock>;

  beforeEach(() => {
    vi.resetModules();
    executeMock.mockReset();
    executeMock.mockResolvedValue({ rows: [] });
    fetchMock.mockReset();
    skillsMock = setupSkillsMock();
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
    skillsMock.verifyNoCodeCallbackToken.mockResolvedValueOnce({ skillId: "skill-1" });

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
        headers: { "Content-Type": "application/json", Authorization: "Bearer callback-token" },
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
      expect(skillsMock.verifyNoCodeCallbackToken).toHaveBeenCalledWith(
        expect.objectContaining({ workspaceId: "workspace-1", chatId: "chat-1", token: "callback-token" }),
      );
      expect(skillsMock.verifyNoCodeCallbackKey).not.toHaveBeenCalled();
      expect(chatService.addNoCodeCallbackMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId: "workspace-1",
          chatId: "chat-1",
          role: "assistant",
          expectedSkillId: "skill-1",
        }),
      );
      } finally {
        await new Promise<void>((resolve, reject) => {
          httpServer.close((error) => (error ? reject(error) : resolve()));
        });
      }
    }, 15000);
  
  it("creates message via callback link", async () => {
    setupDbMock();
    setupAuthMock();
    const storage = setupStorageMock();
    setupOtherMocks();
    const chatService = setupChatServiceMock();
    skillsMock.verifyNoCodeCallbackKey.mockResolvedValueOnce({ skillId: "skill-2" });

    storage.getTranscriptById.mockResolvedValueOnce({
      id: "t-1",
      workspaceId: "workspace-1",
      chatId: "chat-1",
      status: "ready",
      title: null,
      previewText: "Кратко",
      fullText: "Полный текст",
      createdAt: "2025-01-01T00:00:00.000Z",
      updatedAt: "2025-01-01T00:00:00.000Z",
      sourceFileId: null,
      defaultViewId: null,
      defaultViewActionId: null,
      lastEditedByUserId: null,
    });
    storage.createChatCard.mockResolvedValueOnce({
      id: "card-1",
      workspaceId: "workspace-1",
      chatId: "chat-1",
      type: "transcript",
      title: "Стенограмма",
      previewText: "Кратко",
      transcriptId: "t-1",
      createdAt: "2025-01-01T00:00:00.000Z",
    });

    const { httpServer } = await createTestServer();
    try {
      const address = httpServer.address() as AddressInfo;
      const response = await fetch(
        `http://127.0.0.1:${address.port}/api/no-code/callback/messages?callbackKey=unique-key`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            workspaceId: "workspace-1",
            chatId: "chat-1",
            role: "assistant",
            text: "Ответ",
            card: {
              type: "transcript",
              transcriptId: "t-1",
            },
          }),
        },
      );

      expect(response.status).toBe(201);
      expect(skillsMock.verifyNoCodeCallbackKey).toHaveBeenCalledWith(
        expect.objectContaining({ workspaceId: "workspace-1", callbackKey: "unique-key" }),
      );
      expect(skillsMock.verifyNoCodeCallbackToken).not.toHaveBeenCalled();
      expect(chatService.addNoCodeCallbackMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId: "workspace-1",
          chatId: "chat-1",
          role: "assistant",
          expectedSkillId: "skill-2",
        }),
      );
      expect(storage.createChatCard).toHaveBeenCalledWith(
        expect.objectContaining({ transcriptId: "t-1", chatId: "chat-1" }),
      );
    } finally {
      await new Promise<void>((resolve, reject) => {
        httpServer.close((error) => (error ? reject(error) : resolve()));
      });
    }
  }, 15000);

  it("creates transcript via callback token", async () => {
    setupDbMock();
    setupAuthMock();
    const storage = setupStorageMock();
    setupOtherMocks();
    setupChatServiceMock();
    skillsMock.verifyNoCodeCallbackToken.mockResolvedValueOnce({ skillId: "skill-1" });
    storage.getChatSessionById.mockResolvedValueOnce({ id: "chat-1", workspaceId: "workspace-1" });
    storage.createTranscript.mockResolvedValueOnce({
      id: "t-1",
      workspaceId: "workspace-1",
      chatId: "chat-1",
      status: "ready",
      title: "Стенограмма",
      previewText: "Привет мир",
      fullText: "Привет мир",
      createdAt: "2025-01-01T00:00:00.000Z",
      updatedAt: "2025-01-01T00:00:00.000Z",
      sourceFileId: null,
      defaultViewId: null,
      defaultViewActionId: null,
      lastEditedByUserId: null,
    });

    const { httpServer } = await createTestServer();
    try {
      const address = httpServer.address() as AddressInfo;
      const response = await fetch(`http://127.0.0.1:${address.port}/api/no-code/callback/transcripts`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer callback-token" },
        body: JSON.stringify({
          workspaceId: "workspace-1",
          chatId: "chat-1",
          title: "Стенограмма",
          fullText: "Привет мир",
        }),
      });

      expect(response.status).toBe(201);
      const json = await response.json();
      expect(json.transcript?.id).toBe("t-1");
      expect(skillsMock.verifyNoCodeCallbackToken).toHaveBeenCalledWith(
        expect.objectContaining({ workspaceId: "workspace-1", chatId: "chat-1", token: "callback-token" }),
      );
      expect(storage.createTranscript).toHaveBeenCalledWith(
        expect.objectContaining({ chatId: "chat-1", status: "ready", fullText: "Привет мир" }),
      );
    } finally {
      await new Promise<void>((resolve, reject) => {
        httpServer.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it("updates transcript via callback token", async () => {
    setupDbMock();
    setupAuthMock();
    const storage = setupStorageMock();
    setupOtherMocks();
    setupChatServiceMock();
    skillsMock.verifyNoCodeCallbackToken.mockResolvedValueOnce({ skillId: "skill-1" });
    storage.getTranscriptById.mockResolvedValueOnce({
      id: "t-1",
      workspaceId: "workspace-1",
      chatId: "chat-1",
      status: "processing",
      title: null,
      previewText: null,
      fullText: "old",
      createdAt: "2025-01-01T00:00:00.000Z",
      updatedAt: "2025-01-01T00:00:00.000Z",
      sourceFileId: null,
      defaultViewId: null,
      defaultViewActionId: null,
      lastEditedByUserId: null,
    });
    storage.updateTranscript.mockResolvedValueOnce({
      id: "t-1",
      workspaceId: "workspace-1",
      chatId: "chat-1",
      status: "ready",
      title: "Новая",
      previewText: "Новый текст",
      fullText: "Новый текст",
      createdAt: "2025-01-01T00:00:00.000Z",
      updatedAt: "2025-01-01T00:00:00.000Z",
      sourceFileId: null,
      defaultViewId: null,
      defaultViewActionId: null,
      lastEditedByUserId: null,
    });

    const { httpServer } = await createTestServer();
    try {
      const address = httpServer.address() as AddressInfo;
      const response = await fetch(
        `http://127.0.0.1:${address.port}/api/no-code/callback/transcripts/t-1`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json", Authorization: "Bearer callback-token" },
          body: JSON.stringify({
            workspaceId: "workspace-1",
            chatId: "chat-1",
            title: "Новая",
            fullText: "Новый текст",
            status: "ready",
          }),
        },
      );

      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json.transcript?.status).toBe("ready");
      expect(storage.updateTranscript).toHaveBeenCalledWith(
        "t-1",
        expect.objectContaining({ fullText: "Новый текст", previewText: "Новый текст", title: "Новая" }),
      );
    } finally {
      await new Promise<void>((resolve, reject) => {
        httpServer.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it("rejects card with unknown transcriptId", async () => {
    setupDbMock();
    setupAuthMock();
    const storage = setupStorageMock();
    setupOtherMocks();
    setupChatServiceMock();
    skillsMock.verifyNoCodeCallbackToken.mockResolvedValueOnce({ skillId: "skill-1" });
    storage.getTranscriptById.mockResolvedValueOnce(undefined as any);

    const { httpServer } = await createTestServer();
    try {
      const address = httpServer.address() as AddressInfo;
      const response = await fetch(`http://127.0.0.1:${address.port}/api/no-code/callback/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer callback-token" },
        body: JSON.stringify({
          workspaceId: "workspace-1",
          chatId: "chat-1",
          role: "assistant",
          card: {
            type: "transcript",
            transcriptId: "missing",
          },
        }),
      });

      expect(response.status).toBe(400);
      expect(storage.createChatCard).not.toHaveBeenCalled();
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
    skillsMock.verifyNoCodeCallbackToken.mockResolvedValueOnce({ skillId: "skill-1" });

    const { httpServer } = await createTestServer();
    try {
      const address = httpServer.address() as AddressInfo;
      const response = await fetch(`http://127.0.0.1:${address.port}/api/no-code/callback/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer callback-token" },
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

  it("rejects callback without token", async () => {
    setupDbMock();
    setupAuthMock();
    setupStorageMock();
    setupOtherMocks();
    setupChatServiceMock();
    skillsMock.verifyNoCodeCallbackToken.mockRejectedValueOnce(
      new skillsMock.SkillServiceError("Нет токена", 401, "CALLBACK_UNAUTHORIZED"),
    );

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
        }),
      });

      expect(response.status).toBe(401);
    } finally {
      await new Promise<void>((resolve, reject) => {
        httpServer.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it("rejects callback with invalid token", async () => {
    setupDbMock();
    setupAuthMock();
    setupStorageMock();
    setupOtherMocks();
    setupChatServiceMock();
    skillsMock.verifyNoCodeCallbackToken.mockRejectedValueOnce(
      new skillsMock.SkillServiceError("bad token", 401, "CALLBACK_UNAUTHORIZED"),
    );

    const { httpServer } = await createTestServer();
    try {
      const address = httpServer.address() as AddressInfo;
      const response = await fetch(`http://127.0.0.1:${address.port}/api/no-code/callback/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer invalid" },
        body: JSON.stringify({
          workspaceId: "workspace-1",
          chatId: "chat-1",
          role: "assistant",
          text: "Ответ",
        }),
      });

      expect(response.status).toBe(401);
    } finally {
      await new Promise<void>((resolve, reject) => {
        httpServer.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it("generates callback token via skill endpoint", async () => {
    setupDbMock();
    setupAuthMock();
    setupStorageMock();
    setupOtherMocks();
    setupChatServiceMock();
    skillsMock.generateNoCodeCallbackToken.mockResolvedValueOnce({
      token: "new-token",
      lastFour: "wxyz",
      rotatedAt: "2025-01-01T00:00:00.000Z",
      skill: { id: "skill-1" },
    });

    const { httpServer } = await createTestServer();
    try {
      const address = httpServer.address() as AddressInfo;
      const response = await fetch(
        `http://127.0.0.1:${address.port}/api/skills/skill-1/no-code/callback-token`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ workspaceId: "workspace-1" }),
        },
      );

      expect(response.status).toBe(201);
      const json = await response.json();
      expect(json.token).toBe("new-token");
      expect(json.lastFour).toBe("wxyz");
      expect(skillsMock.generateNoCodeCallbackToken).toHaveBeenCalledWith(
        expect.objectContaining({ workspaceId: "workspace-1", skillId: "skill-1" }),
      );
    } finally {
      await new Promise<void>((resolve, reject) => {
        httpServer.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it("sets assistant action via callback endpoint", async () => {
    setupDbMock();
    setupAuthMock();
    setupStorageMock();
    setupOtherMocks();
    const chatService = setupChatServiceMock();
    skillsMock.verifyNoCodeCallbackToken.mockResolvedValueOnce({ skillId: "skill-1" });
    chatService.setNoCodeAssistantAction.mockResolvedValueOnce({
      id: "chat-1",
      currentAssistantAction: {
        type: "ANALYZING",
        text: "Пишу",
        triggerMessageId: "msg-1",
        updatedAt: new Date("2025-01-01T00:00:00.000Z").toISOString(),
      },
    });

    const { httpServer } = await createTestServer();
    try {
      const address = httpServer.address() as AddressInfo;
      const response = await fetch(`http://127.0.0.1:${address.port}/api/no-code/callback/assistant-action`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer callback-token" },
        body: JSON.stringify({
          workspaceId: "workspace-1",
          chatId: "chat-1",
          actionType: "ANALYZING",
          actionText: "Пишу",
          triggerMessageId: "msg-1",
        }),
      });

      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json.currentAssistantAction?.type).toBe("ANALYZING");
      expect(chatService.setNoCodeAssistantAction).toHaveBeenCalledWith(
        expect.objectContaining({ chatId: "chat-1", actionType: "ANALYZING" }),
      );
    } finally {
      await new Promise<void>((resolve, reject) => {
        httpServer.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it("rejects assistant action without token", async () => {
    setupDbMock();
    setupAuthMock();
    setupStorageMock();
    setupOtherMocks();
    setupChatServiceMock();
    skillsMock.verifyNoCodeCallbackToken.mockRejectedValueOnce(
      new skillsMock.SkillServiceError("Нет токена", 401, "CALLBACK_UNAUTHORIZED"),
    );

    const { httpServer } = await createTestServer();
    try {
      const address = httpServer.address() as AddressInfo;
      const response = await fetch(`http://127.0.0.1:${address.port}/api/no-code/callback/assistant-action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId: "workspace-1",
          chatId: "chat-1",
          actionType: "TYPING",
        }),
      });

      expect(response.status).toBe(401);
    } finally {
      await new Promise<void>((resolve, reject) => {
        httpServer.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it("rejects assistant action with invalid actionType", async () => {
    setupDbMock();
    setupAuthMock();
    setupStorageMock();
    setupOtherMocks();
    setupChatServiceMock();
    skillsMock.verifyNoCodeCallbackToken.mockResolvedValueOnce({ skillId: "skill-1" });

    const { httpServer } = await createTestServer();
    try {
      const address = httpServer.address() as AddressInfo;
      const response = await fetch(`http://127.0.0.1:${address.port}/api/no-code/callback/assistant-action`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer token" },
        body: JSON.stringify({
          workspaceId: "workspace-1",
          chatId: "chat-1",
          actionType: "unknown",
        }),
      });

      expect(response.status).toBe(400);
    } finally {
      await new Promise<void>((resolve, reject) => {
        httpServer.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it("exposes currentAssistantAction in chat list response", async () => {
    setupDbMock();
    setupAuthMock();
    setupStorageMock();
    setupOtherMocks();
    const chatService = setupChatServiceMock();
    const now = new Date("2025-01-01T00:00:00.000Z").toISOString();
    chatService.listUserChats.mockResolvedValueOnce([
      {
        id: "chat-1",
        workspaceId: "workspace-1",
        userId: "user-1",
        skillId: "skill-1",
        status: "active",
        title: "Чат",
        skillName: "Навык",
        skillStatus: "active",
        skillIsSystem: false,
        skillSystemKey: null,
        currentAssistantAction: {
          type: "ANALYZING",
          text: "Готовлю ответ",
          triggerMessageId: "msg-1",
          updatedAt: now,
        },
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      },
    ]);

    const { httpServer } = await createTestServer();
    try {
      const address = httpServer.address() as AddressInfo;
      const response = await fetch(
        `http://127.0.0.1:${address.port}/api/chat/sessions?workspaceId=workspace-1`,
        {
          method: "GET",
          headers: { "Content-Type": "application/json" },
        },
      );

      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json.chats?.[0]?.currentAssistantAction?.type).toBe("ANALYZING");
      expect(chatService.listUserChats).toHaveBeenCalledWith("workspace-1", "user-1", undefined, {
        includeArchived: false,
      });
    } finally {
      await new Promise<void>((resolve, reject) => {
        httpServer.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it("accepts streaming chunk via callback endpoint", async () => {
    setupDbMock();
    setupAuthMock();
    setupStorageMock();
    setupOtherMocks();
    const chatService = setupChatServiceMock();
    skillsMock.verifyNoCodeCallbackToken.mockResolvedValueOnce({ skillId: "skill-1" });
    chatService.addNoCodeStreamChunk.mockResolvedValueOnce({ id: "m-stream", chatId: "chat-1" });

    const { httpServer } = await createTestServer();
    try {
      const address = httpServer.address() as AddressInfo;
      const response = await fetch(`http://127.0.0.1:${address.port}/api/no-code/callback/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer token" },
        body: JSON.stringify({
          workspaceId: "workspace-1",
          chatId: "chat-1",
          triggerMessageId: "msg-1",
          streamId: "stream-1",
          chunkId: "chunk-1",
          delta: "Привет",
          isFinal: false,
        }),
      });

      expect(response.status).toBe(200);
      expect(chatService.addNoCodeStreamChunk).toHaveBeenCalledWith(
        expect.objectContaining({
          chatId: "chat-1",
          streamId: "stream-1",
          chunkId: "chunk-1",
          delta: "Привет",
        }),
      );
    } finally {
      await new Promise<void>((resolve, reject) => {
        httpServer.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });
});
