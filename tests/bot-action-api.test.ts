/* @vitest-environment node */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AddressInfo } from "net";
import type { BotAction, BotActionStatus } from "@shared/schema";

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
      const context = {
        workspaceId: "workspace-1",
        userId: "user-1",
        role: "owner",
        status: "active",
        membershipKey: "workspace-1:user-1",
        workspace: { id: "workspace-1", name: "Workspace", ownerId: "user-1", status: "active" },
        membership: { id: "membership-1", workspaceId: "workspace-1", userId: "user-1", role: "owner", status: "active" },
      };
      Object.assign(req, {
        workspaceContext: context,
        workspaceId: context.workspaceId,
        workspaceRole: context.role,
      });
      return next();
    };

    return {
      requireAuth,
      requireAdmin: requireAuth,
      ensureWorkspaceContextMiddleware,
      getAuthorizedUser: () => ({ id: "user-1", email: "user@example.com" }),
      getSessionUser: () => ({ id: "user-1", email: "user@example.com" }),
      toPublicUser: (user: unknown) => user,
      reloadGoogleAuth: vi.fn(),
      reloadYandexAuth: vi.fn(),
      ensureWorkspaceContext: vi.fn(),
      buildSessionResponse: vi.fn(),
      getRequestWorkspace: () => ({ id: "workspace-1" }),
      getRequestWorkspaceMemberships: () => [],
      resolveOptionalUser: () => ({ id: "user-1" }),
      resolveWorkspaceIdForRequest: (_req: any, fallback: string | null) => fallback ?? "workspace-1",
      WorkspaceContextError: class extends Error {},
    };
  });
}

function setupStorageMock() {
  type MockInstance = ReturnType<typeof vi.fn>;
  const methodMocks: Record<string | symbol, MockInstance> = {};
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

  return storageProxy as Record<string | symbol, MockInstance>;
}

function setupChatServiceMock() {
  const listBotActionsForChat = vi.fn<typeof import("../server/chat-service").listBotActionsForChat>();

  class ChatServiceError extends Error {
    status: number;

    constructor(message: string, status = 400) {
      super(message);
      this.status = status;
    }
  }

  vi.doMock("../server/chat-service", () => ({
    listBotActionsForChat,
    ChatServiceError,
  }));

  return { listBotActionsForChat, ChatServiceError };
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
  vi.doMock("../server/chat-events", () => ({
    emitBotAction: vi.fn(),
  }));
}

async function createTestServer() {
  setupDbMock();
  setupAuthMock();
  const storageMock = setupStorageMock();
  setupOtherMocks();
  const chatService = setupChatServiceMock();

  const expressModule = await import("express");
  const app = expressModule.default();
  app.use(expressModule.json());
  const { registerRoutes } = await import("../server/routes");
  const httpServer = await registerRoutes(app);
  await new Promise<void>((resolve) => {
    httpServer.listen(0, resolve);
  });
  return { httpServer, storageMock, chatService };
}

describe("Bot Action API - GET /api/chat/actions", () => {
  beforeEach(() => {
    vi.resetModules();
    executeMock.mockReset();
    executeMock.mockResolvedValue({ rows: [] });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns processing actions after start", async () => {
    const { httpServer, chatService } = await createTestServer();
    const now = new Date().toISOString();

    const processingAction: BotAction = {
      workspaceId: "workspace-1",
      chatId: "chat-1",
      actionId: "action-1",
      actionType: "transcribe_audio",
      status: "processing",
      displayText: "Готовим стенограмму…",
      payload: { fileName: "audio.mp3" },
      createdAt: now,
      updatedAt: now,
    };

    chatService.listBotActionsForChat.mockResolvedValueOnce([processingAction]);

    try {
      const address = httpServer.address() as AddressInfo;
      const response = await fetch(
        `http://127.0.0.1:${address.port}/api/chat/actions?workspaceId=workspace-1&chatId=chat-1`,
        {
          method: "GET",
          headers: { "Content-Type": "application/json" },
        },
      );

      expect(response.status).toBe(200);
      const json = (await response.json()) as { actions: BotAction[] };
      expect(json.actions).toHaveLength(1);
      expect(json.actions[0]?.status).toBe("processing");
      expect(json.actions[0]?.actionId).toBe("action-1");
      expect(json.actions[0]?.displayText).toBe("Готовим стенограмму…");
      expect(chatService.listBotActionsForChat).toHaveBeenCalledWith({
        workspaceId: "workspace-1",
        chatId: "chat-1",
        userId: "user-1",
        status: "processing",
      });
    } finally {
      await new Promise<void>((resolve, reject) => {
        httpServer.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it("does not return done/error actions as active", async () => {
    const { httpServer, chatService } = await createTestServer();
    const now = new Date().toISOString();

    const doneAction: BotAction = {
      workspaceId: "workspace-1",
      chatId: "chat-1",
      actionId: "action-1",
      actionType: "transcribe_audio",
      status: "done",
      displayText: "Готовим стенограмму…",
      payload: null,
      createdAt: now,
      updatedAt: now,
    };

    // When status is "processing" (default), done actions should not be returned
    chatService.listBotActionsForChat.mockResolvedValueOnce([]);

    try {
      const address = httpServer.address() as AddressInfo;
      const response = await fetch(
        `http://127.0.0.1:${address.port}/api/chat/actions?workspaceId=workspace-1&chatId=chat-1`,
        {
          method: "GET",
          headers: { "Content-Type": "application/json" },
        },
      );

      expect(response.status).toBe(200);
      const json = (await response.json()) as { actions: BotAction[] };
      expect(json.actions).toHaveLength(0);
      expect(chatService.listBotActionsForChat).toHaveBeenCalledWith({
        workspaceId: "workspace-1",
        chatId: "chat-1",
        userId: "user-1",
        status: "processing",
      });
    } finally {
      await new Promise<void>((resolve, reject) => {
        httpServer.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it("returns empty array when no active actions", async () => {
    const { httpServer, chatService } = await createTestServer();

    chatService.listBotActionsForChat.mockResolvedValueOnce([]);

    try {
      const address = httpServer.address() as AddressInfo;
      const response = await fetch(
        `http://127.0.0.1:${address.port}/api/chat/actions?workspaceId=workspace-1&chatId=chat-1`,
        {
          method: "GET",
          headers: { "Content-Type": "application/json" },
        },
      );

      expect(response.status).toBe(200);
      const json = (await response.json()) as { actions: BotAction[] };
      expect(json.actions).toHaveLength(0);
    } finally {
      await new Promise<void>((resolve, reject) => {
        httpServer.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it("requires chatId parameter", async () => {
    const { httpServer } = await createTestServer();

    try {
      const address = httpServer.address() as AddressInfo;
      const response = await fetch(
        `http://127.0.0.1:${address.port}/api/chat/actions?workspaceId=workspace-1`,
        {
          method: "GET",
          headers: { "Content-Type": "application/json" },
        },
      );

      expect(response.status).toBe(400);
      const json = (await response.json()) as { message: string };
      expect(json.message).toContain("chatId");
    } finally {
      await new Promise<void>((resolve, reject) => {
        httpServer.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it("enforces access control - cannot access other user's chat", async () => {
    const { httpServer, chatService } = await createTestServer();

    const error = new chatService.ChatServiceError("Чат не найден", 404);
    chatService.listBotActionsForChat.mockRejectedValueOnce(error);

    try {
      const address = httpServer.address() as AddressInfo;
      const response = await fetch(
        `http://127.0.0.1:${address.port}/api/chat/actions?workspaceId=workspace-1&chatId=other-chat`,
        {
          method: "GET",
          headers: { "Content-Type": "application/json" },
        },
      );

      expect(response.status).toBe(404);
      expect(chatService.listBotActionsForChat).toHaveBeenCalledWith({
        workspaceId: "workspace-1",
        chatId: "other-chat",
        userId: "user-1",
        status: "processing",
      });
    } finally {
      await new Promise<void>((resolve, reject) => {
        httpServer.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it("returns actions sorted by updatedAt desc", async () => {
    const { httpServer, chatService } = await createTestServer();
    const baseTime = new Date("2025-01-01T00:00:00.000Z").getTime();

    const actions: BotAction[] = [
      {
        workspaceId: "workspace-1",
        chatId: "chat-1",
        actionId: "action-1",
        actionType: "transcribe_audio",
        status: "processing",
        displayText: "Action 1",
        payload: null,
        createdAt: new Date(baseTime).toISOString(),
        updatedAt: new Date(baseTime + 1000).toISOString(),
      },
      {
        workspaceId: "workspace-1",
        chatId: "chat-1",
        actionId: "action-2",
        actionType: "summarize",
        status: "processing",
        displayText: "Action 2",
        payload: null,
        createdAt: new Date(baseTime).toISOString(),
        updatedAt: new Date(baseTime + 2000).toISOString(),
      },
    ];

    // Storage should return sorted by updatedAt desc (newest first)
    chatService.listBotActionsForChat.mockResolvedValueOnce([actions[1], actions[0]]);

    try {
      const address = httpServer.address() as AddressInfo;
      const response = await fetch(
        `http://127.0.0.1:${address.port}/api/chat/actions?workspaceId=workspace-1&chatId=chat-1`,
        {
          method: "GET",
          headers: { "Content-Type": "application/json" },
        },
      );

      expect(response.status).toBe(200);
      const json = (await response.json()) as { actions: BotAction[] };
      expect(json.actions).toHaveLength(2);
      // First action should be the newest (action-2)
      expect(json.actions[0]?.actionId).toBe("action-2");
      expect(json.actions[1]?.actionId).toBe("action-1");
    } finally {
      await new Promise<void>((resolve, reject) => {
        httpServer.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it("returns all required fields in response", async () => {
    const { httpServer, chatService } = await createTestServer();
    const now = new Date().toISOString();

    const action: BotAction = {
      workspaceId: "workspace-1",
      chatId: "chat-1",
      actionId: "action-1",
      actionType: "transcribe_audio",
      status: "processing",
      displayText: "Готовим стенограмму…",
      payload: { fileName: "audio.mp3", progressPercent: 50 },
      createdAt: now,
      updatedAt: now,
    };

    chatService.listBotActionsForChat.mockResolvedValueOnce([action]);

    try {
      const address = httpServer.address() as AddressInfo;
      const response = await fetch(
        `http://127.0.0.1:${address.port}/api/chat/actions?workspaceId=workspace-1&chatId=chat-1`,
        {
          method: "GET",
          headers: { "Content-Type": "application/json" },
        },
      );

      expect(response.status).toBe(200);
      const json = (await response.json()) as { actions: BotAction[] };
      expect(json.actions).toHaveLength(1);
      const returnedAction = json.actions[0]!;
      expect(returnedAction).toHaveProperty("workspaceId");
      expect(returnedAction).toHaveProperty("chatId");
      expect(returnedAction).toHaveProperty("actionId");
      expect(returnedAction).toHaveProperty("actionType");
      expect(returnedAction).toHaveProperty("status");
      expect(returnedAction).toHaveProperty("displayText");
      expect(returnedAction).toHaveProperty("payload");
      expect(returnedAction).toHaveProperty("updatedAt");
      expect(returnedAction.workspaceId).toBe("workspace-1");
      expect(returnedAction.chatId).toBe("chat-1");
      expect(returnedAction.actionId).toBe("action-1");
      expect(returnedAction.actionType).toBe("transcribe_audio");
      expect(returnedAction.status).toBe("processing");
      expect(returnedAction.displayText).toBe("Готовим стенограмму…");
      expect(returnedAction.payload).toEqual({ fileName: "audio.mp3", progressPercent: 50 });
    } finally {
      await new Promise<void>((resolve, reject) => {
        httpServer.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it("allows filtering by status parameter", async () => {
    const { httpServer, chatService } = await createTestServer();
    const now = new Date().toISOString();

    const doneAction: BotAction = {
      workspaceId: "workspace-1",
      chatId: "chat-1",
      actionId: "action-1",
      actionType: "transcribe_audio",
      status: "done",
      displayText: "Готовим стенограмму…",
      payload: null,
      createdAt: now,
      updatedAt: now,
    };

    chatService.listBotActionsForChat.mockResolvedValueOnce([doneAction]);

    try {
      const address = httpServer.address() as AddressInfo;
      const response = await fetch(
        `http://127.0.0.1:${address.port}/api/chat/actions?workspaceId=workspace-1&chatId=chat-1&status=done`,
        {
          method: "GET",
          headers: { "Content-Type": "application/json" },
        },
      );

      expect(response.status).toBe(200);
      const json = (await response.json()) as { actions: BotAction[] };
      expect(json.actions).toHaveLength(1);
      expect(json.actions[0]?.status).toBe("done");
      expect(chatService.listBotActionsForChat).toHaveBeenCalledWith({
        workspaceId: "workspace-1",
        chatId: "chat-1",
        userId: "user-1",
        status: "done",
      });
    } finally {
      await new Promise<void>((resolve, reject) => {
        httpServer.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });
});

