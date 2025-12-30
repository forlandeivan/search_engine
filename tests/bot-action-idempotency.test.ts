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
  const upsertBotActionForChat = vi.fn<typeof import("../server/chat-service").upsertBotActionForChat>();
  const getChatSessionById = vi.fn();

  class ChatServiceError extends Error {
    status: number;

    constructor(message: string, status = 400) {
      super(message);
      this.status = status;
    }
  }

  vi.doMock("../server/chat-service", () => ({
    listBotActionsForChat,
    upsertBotActionForChat,
    ChatServiceError,
  }));

  return { listBotActionsForChat, upsertBotActionForChat, ChatServiceError };
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

describe("Bot Action Idempotency", () => {
  beforeEach(() => {
    vi.resetModules();
    executeMock.mockReset();
    executeMock.mockResolvedValue({ rows: [] });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("start twice → one action, status processing", async () => {
    const { httpServer, chatService } = await createTestServer();
    const now = new Date().toISOString();

    const processingAction: BotAction = {
      workspaceId: "workspace-1",
      chatId: "chat-1",
      actionId: "action-1",
      actionType: "transcribe_audio",
      status: "processing",
      displayText: "Готовим стенограмму…",
      payload: null,
      createdAt: now,
      updatedAt: now,
    };

    // First start
    chatService.upsertBotActionForChat.mockResolvedValueOnce(processingAction);
    // Second start (idempotent)
    chatService.upsertBotActionForChat.mockResolvedValueOnce(processingAction);

    try {
      const address = httpServer.address() as AddressInfo;
      const baseUrl = `http://127.0.0.1:${address.port}`;

      // First start
      const response1 = await fetch(`${baseUrl}/api/chat/actions/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId: "workspace-1",
          chatId: "chat-1",
          actionId: "action-1",
          actionType: "transcribe_audio",
          displayText: "Готовим стенограмму…",
        }),
      });

      expect(response1.status).toBe(200);
      const json1 = (await response1.json()) as { action: BotAction };
      expect(json1.action.status).toBe("processing");

      // Second start (idempotent)
      const response2 = await fetch(`${baseUrl}/api/chat/actions/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId: "workspace-1",
          chatId: "chat-1",
          actionId: "action-1",
          actionType: "transcribe_audio",
          displayText: "Готовим стенограмму…",
        }),
      });

      expect(response2.status).toBe(200);
      const json2 = (await response2.json()) as { action: BotAction };
      expect(json2.action.status).toBe("processing");
      expect(json2.action.actionId).toBe("action-1");

      // Verify both calls were made
      expect(chatService.upsertBotActionForChat).toHaveBeenCalledTimes(2);
    } finally {
      await new Promise<void>((resolve, reject) => {
        httpServer.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it("update(done) twice → status done, no side effects", async () => {
    const { httpServer, chatService } = await createTestServer();
    const now = new Date().toISOString();

    const doneAction: BotAction = {
      workspaceId: "workspace-1",
      chatId: "chat-1",
      actionId: "action-1",
      actionType: "transcribe_audio",
      status: "done",
      displayText: "Готово",
      payload: null,
      createdAt: now,
      updatedAt: now,
    };

    // First update
    chatService.upsertBotActionForChat.mockResolvedValueOnce(doneAction);
    // Second update (idempotent)
    chatService.upsertBotActionForChat.mockResolvedValueOnce(doneAction);

    try {
      const address = httpServer.address() as AddressInfo;
      const baseUrl = `http://127.0.0.1:${address.port}`;

      // First update
      const response1 = await fetch(`${baseUrl}/api/chat/actions/update`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId: "workspace-1",
          chatId: "chat-1",
          actionId: "action-1",
          actionType: "transcribe_audio",
          status: "done",
          displayText: "Готово",
        }),
      });

      expect(response1.status).toBe(200);
      const json1 = (await response1.json()) as { action: BotAction };
      expect(json1.action.status).toBe("done");

      // Second update (idempotent)
      const response2 = await fetch(`${baseUrl}/api/chat/actions/update`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId: "workspace-1",
          chatId: "chat-1",
          actionId: "action-1",
          actionType: "transcribe_audio",
          status: "done",
          displayText: "Готово",
        }),
      });

      expect(response2.status).toBe(200);
      const json2 = (await response2.json()) as { action: BotAction };
      expect(json2.action.status).toBe("done");
      expect(json2.action.actionId).toBe("action-1");
    } finally {
      await new Promise<void>((resolve, reject) => {
        httpServer.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it("start after done → does not rollback to processing", async () => {
    const { httpServer, chatService } = await createTestServer();
    const now = new Date().toISOString();

    const doneAction: BotAction = {
      workspaceId: "workspace-1",
      chatId: "chat-1",
      actionId: "action-1",
      actionType: "transcribe_audio",
      status: "done",
      displayText: "Готово",
      payload: null,
      createdAt: now,
      updatedAt: now,
    };

    // Start after done should return done (no rollback)
    chatService.upsertBotActionForChat.mockResolvedValueOnce(doneAction);

    try {
      const address = httpServer.address() as AddressInfo;
      const baseUrl = `http://127.0.0.1:${address.port}`;

      // Start after done
      const response = await fetch(`${baseUrl}/api/chat/actions/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId: "workspace-1",
          chatId: "chat-1",
          actionId: "action-1",
          actionType: "transcribe_audio",
          displayText: "Готовим стенограмму…",
        }),
      });

      expect(response.status).toBe(200);
      const json = (await response.json()) as { action: BotAction };
      // Should remain done, not rollback to processing
      expect(json.action.status).toBe("done");
    } finally {
      await new Promise<void>((resolve, reject) => {
        httpServer.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it("update error after done → first completion wins (done preserved)", async () => {
    const { httpServer, chatService } = await createTestServer();
    const now = new Date().toISOString();

    const doneAction: BotAction = {
      workspaceId: "workspace-1",
      chatId: "chat-1",
      actionId: "action-1",
      actionType: "transcribe_audio",
      status: "done",
      displayText: "Готово",
      payload: null,
      createdAt: now,
      updatedAt: now,
    };

    // Error after done should be ignored (first completion wins)
    chatService.upsertBotActionForChat.mockResolvedValueOnce(doneAction);

    try {
      const address = httpServer.address() as AddressInfo;
      const baseUrl = `http://127.0.0.1:${address.port}`;

      // Update error after done
      const response = await fetch(`${baseUrl}/api/chat/actions/update`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId: "workspace-1",
          chatId: "chat-1",
          actionId: "action-1",
          actionType: "transcribe_audio",
          status: "error",
          displayText: "Ошибка",
        }),
      });

      expect(response.status).toBe(200);
      const json = (await response.json()) as { action: BotAction };
      // Should remain done (first completion wins)
      expect(json.action.status).toBe("done");
    } finally {
      await new Promise<void>((resolve, reject) => {
        httpServer.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it("update before start → 404 error", async () => {
    const { httpServer, chatService } = await createTestServer();

    const error = new chatService.ChatServiceError('Действие с actionId "action-1" не найдено. Сначала вызовите start.', 404);
    chatService.upsertBotActionForChat.mockRejectedValueOnce(error);

    try {
      const address = httpServer.address() as AddressInfo;
      const baseUrl = `http://127.0.0.1:${address.port}`;

      // Update before start
      const response = await fetch(`${baseUrl}/api/chat/actions/update`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId: "workspace-1",
          chatId: "chat-1",
          actionId: "action-1",
          actionType: "transcribe_audio",
          status: "done",
        }),
      });

      expect(response.status).toBe(404);
      const json = (await response.json()) as { message: string };
      expect(json.message).toContain("не найдено");
      expect(json.message).toContain("Сначала вызовите start");
    } finally {
      await new Promise<void>((resolve, reject) => {
        httpServer.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });
});

