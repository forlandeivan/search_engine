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

    const memberships = [
      { id: "workspace-1", role: "owner" },
      { id: "workspace-2", role: "member" },
    ];

    return {
      requireAuth,
      requireAdmin: requireAuth,
      getSessionUser: () => ({ id: "user-1", email: "user@example.com" }),
      toPublicUser: (user: unknown) => user,
      reloadGoogleAuth: vi.fn(),
      reloadYandexAuth: vi.fn(),
      ensureWorkspaceContext: vi.fn(() => ({
        active: memberships[0],
        memberships,
      })),
      buildSessionResponse: vi.fn(() => ({
        user: { id: "user-1" },
        workspace: { active: memberships[0], memberships },
      })),
      getRequestWorkspace: () => ({ id: "workspace-1" }),
      getRequestWorkspaceMemberships: () => memberships,
      resolveOptionalUser: () => ({ id: "user-1" }),
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
    getQdrantClient: () => ({
      upsert: vi.fn(),
      scroll: vi.fn(),
      delete: vi.fn(),
      search: vi.fn(),
    }),
    QdrantConfigurationError: class extends Error {},
  }));
}

async function setupFetchMock() {
  const actual = await vi.importActual<typeof import("node-fetch")>("node-fetch");
  const fetchMock = vi.fn(async () => ({
    ok: true,
    text: async () => '{"access_token":"token"}',
    headers: new actual.Headers(),
  }));

  vi.doMock("node-fetch", () => ({
    ...actual,
    default: fetchMock,
    Headers: actual.Headers,
  }));

  return fetchMock;
}

function setupChatServiceMock() {
  const chatService = {
    listUserChats: vi.fn(),
    createChat: vi.fn(),
    renameChat: vi.fn(),
    deleteChat: vi.fn(),
    getChatMessages: vi.fn(),
    getChatById: vi.fn(),
    addUserMessage: vi.fn(),
    buildChatLlmContext: vi.fn(),
    buildChatCompletionRequestBody: vi.fn(),
    addAssistantMessage: vi.fn(),
  };

  class ChatServiceError extends Error {
    status: number;

    constructor(message: string, status = 400) {
      super(message);
      this.status = status;
    }
  }

  vi.doMock("../server/chat-service", () => ({
    ...chatService,
    ChatServiceError,
  }));

  return Object.assign(chatService, { ChatServiceError });
}

function setupSkillExecutionLogMock() {
  const startExecution = vi.fn(async (context: any) => ({
    id: "execution-1",
    workspaceId: context.workspaceId,
    userId: context.userId ?? null,
    skillId: context.skillId,
    chatId: context.chatId ?? null,
    userMessageId: context.userMessageId ?? null,
    source: context.source,
    status: "running",
    hasStepErrors: false,
    startedAt: new Date(),
    finishedAt: null,
  }));
  const logStep = vi.fn();
  const logStepSuccess = vi.fn();
  const logStepError = vi.fn();
  const finishExecution = vi.fn();
  const markExecutionSuccess = vi.fn();
  const markExecutionFailed = vi.fn();

  vi.doMock("../server/skill-execution-log-context", () => ({
    skillExecutionLogService: {
      startExecution,
      logStep,
      logStepSuccess,
      logStepError,
      finishExecution,
      markExecutionSuccess,
      markExecutionFailed,
    },
  }));

  return {
    startExecution,
    logStep,
    logStepSuccess,
    logStepError,
    finishExecution,
    markExecutionSuccess,
    markExecutionFailed,
  };
}

function setupLlmClientMock() {
  const executeLlmCompletion = vi.fn(() => {
    const promise = Promise.resolve({
      answer: "LLM response",
      usageTokens: 42,
      rawResponse: {},
      request: { url: "https://llm.example/completions", headers: {}, body: {} },
    });
    return Object.assign(promise, { streamIterator: undefined });
  });

  const fetchLlmCompletion = vi.fn(() => {
    const promise = Promise.resolve({
      answer: "fallback",
      usageTokens: null,
      rawResponse: {},
      request: { url: "", headers: {}, body: {} },
    });
    return Object.assign(promise, { streamIterator: undefined });
  });

  vi.doMock("../server/llm-client", () => ({
    executeLlmCompletion,
    fetchLlmCompletion,
  }));

  return { executeLlmCompletion, fetchLlmCompletion };
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

describe("Chat API", () => {
  beforeEach(() => {
    vi.resetModules();
    executeMock.mockReset();
    executeMock.mockResolvedValue({ rows: [] });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns chat sessions for the current user", async () => {
    setupDbMock();
    setupAuthMock();
    setupStorageMock();
    setupOtherMocks();
    const chatService = setupChatServiceMock();
    chatService.listUserChats.mockResolvedValueOnce([
      {
        id: "chat-1",
        workspaceId: "workspace-1",
        userId: "user-1",
        skillId: "skill-1",
        title: "My chat",
        skillName: "Skill",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ]);

    const { httpServer } = await createTestServer();
    try {
      const address = httpServer.address() as AddressInfo;
      const response = await fetch(`http://127.0.0.1:${address.port}/api/chat/sessions`);

      expect(response.status).toBe(200);
      const payload = (await response.json()) as { chats: Array<{ id: string }> };
      expect(payload.chats).toHaveLength(1);
      expect(chatService.listUserChats).toHaveBeenCalledWith("workspace-1", "user-1", undefined);
    } finally {
      await new Promise<void>((resolve, reject) => {
        httpServer.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it("allows posting a user message", async () => {
    setupDbMock();
    setupAuthMock();
    setupStorageMock();
    setupOtherMocks();
    const chatService = setupChatServiceMock();
    chatService.addUserMessage.mockResolvedValueOnce({
      id: "msg-1",
      chatId: "chat-1",
      role: "user",
      content: "Hello",
      metadata: {},
      createdAt: new Date().toISOString(),
    });

    const { httpServer } = await createTestServer();
    try {
      const address = httpServer.address() as AddressInfo;
      const response = await fetch(`http://127.0.0.1:${address.port}/api/chat/sessions/chat-1/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: "Hello" }),
      });

      expect(response.status).toBe(201);
      expect(chatService.addUserMessage).toHaveBeenCalledWith("chat-1", "workspace-1", "user-1", "Hello");
    } finally {
      await new Promise<void>((resolve, reject) => {
        httpServer.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it("creates an assistant reply via LLM endpoint", async () => {
    setupDbMock();
    setupAuthMock();
    setupStorageMock();
    setupOtherMocks();
    const logService = setupSkillExecutionLogMock();
    await setupFetchMock();
    const { executeLlmCompletion } = setupLlmClientMock();
    const chatService = setupChatServiceMock();

    chatService.getChatById.mockResolvedValueOnce({
      id: "chat-1",
      workspaceId: "workspace-1",
      userId: "user-1",
      skillId: "skill-1",
      title: "Chat",
      skillName: "Skill",
      skillIsSystem: false,
      skillSystemKey: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    chatService.addUserMessage.mockResolvedValueOnce({
      id: "user-msg-1",
      chatId: "chat-1",
      role: "user",
      content: "Привет",
      metadata: {},
      createdAt: new Date().toISOString(),
    });

    chatService.buildChatLlmContext.mockResolvedValueOnce({
      chat: {
        id: "chat-1",
        workspaceId: "workspace-1",
        userId: "user-1",
        skillId: "skill-1",
        title: "Chat",
        skillName: "Skill",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      provider: {
        id: "llm-1",
        name: "Provider",
        providerType: "gigachat",
        description: null,
        isActive: true,
        tokenUrl: "https://llm.example/token",
        completionUrl: "https://llm.example/completions",
        authorizationKey: "basic key",
        scope: "scope",
        model: "gpt",
        availableModels: [],
        allowSelfSignedCertificate: false,
        requestHeaders: {},
        requestConfig: {
          modelField: "model",
          messagesField: "messages",
          temperature: 0.2,
          additionalBodyFields: {},
        },
        responseConfig: null,
        workspaceId: "workspace-1",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      requestConfig: {
        modelField: "model",
        messagesField: "messages",
        temperature: 0.2,
        additionalBodyFields: {},
      },
      model: "gpt",
      messages: [],
    });

    chatService.buildChatCompletionRequestBody.mockReturnValueOnce({ stream: false });
    chatService.addAssistantMessage.mockResolvedValueOnce({
      id: "assistant-msg-1",
      chatId: "chat-1",
      role: "assistant",
      content: "Ответ",
      metadata: {},
      createdAt: new Date().toISOString(),
    });

    executeLlmCompletion.mockImplementationOnce(() => {
      const promise = Promise.resolve({
        answer: "Ответ",
        usageTokens: 21,
        rawResponse: {},
        request: { url: "", headers: {}, body: {} },
      });
      return Object.assign(promise, { streamIterator: undefined });
    });

    const { httpServer } = await createTestServer();
    try {
      const address = httpServer.address() as AddressInfo;
      const response = await fetch(
        `http://127.0.0.1:${address.port}/api/chat/sessions/chat-1/messages/llm`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ content: "Привет" }),
        },
      );

      expect(response.status).toBe(200);
      const payload = (await response.json()) as { message: { id: string } };
      expect(payload.message.id).toBe("assistant-msg-1");
      expect(chatService.buildChatLlmContext).toHaveBeenCalledWith("chat-1", "workspace-1", "user-1", {
        executionId: "execution-1",
      });
      expect(chatService.buildChatCompletionRequestBody).toHaveBeenCalled();
      expect(chatService.addAssistantMessage).toHaveBeenCalledWith("chat-1", "workspace-1", "user-1", "Ответ");
      expect(logService.startExecution).toHaveBeenCalledWith({
        workspaceId: "workspace-1",
        userId: "user-1",
        skillId: "skill-1",
        chatId: "chat-1",
        source: "workspace_skill",
      });
      expect(logService.logStepSuccess).toHaveBeenCalledWith(
        expect.objectContaining({ type: "RECEIVE_HTTP_REQUEST" }),
      );
      expect(logService.logStepSuccess).toHaveBeenCalledWith(
        expect.objectContaining({ type: "VALIDATE_REQUEST" }),
      );
      expect(logService.logStepSuccess).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "WRITE_USER_MESSAGE",
          output: expect.objectContaining({ messageId: "user-msg-1" }),
        }),
      );
      expect(logService.logStep).toHaveBeenCalledWith(
        expect.objectContaining({ type: "CALL_LLM", status: "running" }),
      );
      expect(logService.logStepSuccess).toHaveBeenCalledWith(
        expect.objectContaining({ type: "CALL_LLM" }),
      );
      expect(logService.logStepSuccess).toHaveBeenCalledWith(
        expect.objectContaining({ type: "WRITE_ASSISTANT_MESSAGE" }),
      );
      expect(logService.markExecutionSuccess).toHaveBeenCalledWith(
        "execution-1",
        expect.objectContaining({ userMessageId: "user-msg-1" }),
      );
    } finally {
      await new Promise<void>((resolve, reject) => {
        httpServer.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it("streams assistant reply and logs streaming steps", async () => {
    setupDbMock();
    setupAuthMock();
    setupStorageMock();
    setupOtherMocks();
    const logService = setupSkillExecutionLogMock();
    await setupFetchMock();
    const { executeLlmCompletion } = setupLlmClientMock();
    const chatService = setupChatServiceMock();

    chatService.getChatById.mockResolvedValueOnce({
      id: "chat-1",
      workspaceId: "workspace-1",
      userId: "user-1",
      skillId: "skill-1",
      title: "Chat",
      skillName: "Skill",
      skillIsSystem: false,
      skillSystemKey: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    chatService.addUserMessage.mockResolvedValueOnce({
      id: "user-msg-1",
      chatId: "chat-1",
      role: "user",
      content: "Привет",
      metadata: {},
      createdAt: new Date().toISOString(),
    });
    chatService.buildChatLlmContext.mockResolvedValueOnce({
      chat: {
        id: "chat-1",
        workspaceId: "workspace-1",
        userId: "user-1",
        skillId: "skill-1",
        title: "Chat",
        skillName: "Skill",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      provider: {
        id: "llm-1",
        name: "Provider",
        providerType: "gigachat",
        description: null,
        isActive: true,
        tokenUrl: "https://llm.example/token",
        completionUrl: "https://llm.example/completions",
        authorizationKey: "basic key",
        scope: "scope",
        model: "gpt",
        availableModels: [],
        allowSelfSignedCertificate: false,
        requestHeaders: {},
        requestConfig: {
          modelField: "model",
          messagesField: "messages",
          temperature: 0.2,
          additionalBodyFields: {},
        },
        responseConfig: null,
        workspaceId: "workspace-1",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      requestConfig: {
        modelField: "model",
        messagesField: "messages",
        temperature: 0.2,
        additionalBodyFields: {},
      },
      model: "gpt",
      messages: [],
    });
    chatService.buildChatCompletionRequestBody.mockReturnValueOnce({ stream: true });
    chatService.addAssistantMessage.mockResolvedValueOnce({
      id: "assistant-msg-1",
      chatId: "chat-1",
      role: "assistant",
      content: "Потоковый ответ",
      metadata: {},
      createdAt: new Date().toISOString(),
    });

    async function* streamIterator() {
      yield { event: "delta", data: { text: "part" } };
    }

    executeLlmCompletion.mockImplementationOnce(() => {
      const promise = Promise.resolve({
        answer: "Потоковый ответ",
        usageTokens: 5,
        rawResponse: {},
        request: { url: "", headers: {}, body: {} },
      });
      return Object.assign(promise, { streamIterator: streamIterator() });
    });

    const { httpServer } = await createTestServer();
    try {
      const address = httpServer.address() as AddressInfo;
      const response = await fetch(
        `http://127.0.0.1:${address.port}/api/chat/sessions/chat-1/messages/llm`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "text/event-stream",
          },
          body: JSON.stringify({ content: "Привет", stream: true }),
        },
      );

      expect(response.status).toBe(200);
      const textPayload = await response.text();
      expect(textPayload).toContain("event: done");
      expect(logService.logStep).toHaveBeenCalledWith(
        expect.objectContaining({ type: "STREAM_TO_CLIENT_START", status: "running" }),
      );
      expect(logService.logStepSuccess).toHaveBeenCalledWith(
        expect.objectContaining({ type: "STREAM_TO_CLIENT_FINISH" }),
      );
    } finally {
      await new Promise<void>((resolve, reject) => {
        httpServer.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it("writes error steps when user message cannot be stored", async () => {
    setupDbMock();
    setupAuthMock();
    setupStorageMock();
    setupOtherMocks();
    const logService = setupSkillExecutionLogMock();
    await setupFetchMock();
    setupLlmClientMock();
    const chatService = setupChatServiceMock();

    chatService.getChatById.mockResolvedValueOnce({
      id: "chat-1",
      workspaceId: "workspace-1",
      userId: "user-1",
      skillId: "skill-1",
      title: "Chat",
      skillName: "Skill",
      skillIsSystem: false,
      skillSystemKey: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    chatService.addUserMessage.mockRejectedValueOnce(
      new chatService.ChatServiceError("write failed", 409),
    );

    const { httpServer } = await createTestServer();
    try {
      const address = httpServer.address() as AddressInfo;
      const response = await fetch(
        `http://127.0.0.1:${address.port}/api/chat/sessions/chat-1/messages/llm`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: "Привет" }),
        },
      );

      expect(response.status).toBe(409);
      expect(logService.logStepError).toHaveBeenCalledWith(
        expect.objectContaining({ type: "WRITE_USER_MESSAGE" }),
      );
      expect(logService.markExecutionFailed).toHaveBeenCalledWith(
        "execution-1",
        expect.objectContaining({ userMessageId: undefined }),
      );
    } finally {
      await new Promise<void>((resolve, reject) => {
        httpServer.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it("logs assistant message errors", async () => {
    setupDbMock();
    setupAuthMock();
    setupStorageMock();
    setupOtherMocks();
    const logService = setupSkillExecutionLogMock();
    await setupFetchMock();
    const { executeLlmCompletion } = setupLlmClientMock();
    const chatService = setupChatServiceMock();

    chatService.getChatById.mockResolvedValueOnce({
      id: "chat-1",
      workspaceId: "workspace-1",
      userId: "user-1",
      skillId: "skill-1",
      title: "Chat",
      skillName: "Skill",
      skillIsSystem: false,
      skillSystemKey: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    chatService.addUserMessage.mockResolvedValueOnce({
      id: "user-msg-1",
      chatId: "chat-1",
      role: "user",
      content: "Привет",
      metadata: {},
      createdAt: new Date().toISOString(),
    });
    chatService.buildChatLlmContext.mockResolvedValueOnce({
      chat: {
        id: "chat-1",
        workspaceId: "workspace-1",
        userId: "user-1",
        skillId: "skill-1",
        title: "Chat",
        skillName: "Skill",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      provider: {
        id: "llm-1",
        name: "Provider",
        providerType: "gigachat",
        description: null,
        isActive: true,
        tokenUrl: "https://llm.example/token",
        completionUrl: "https://llm.example/completions",
        authorizationKey: "basic key",
        scope: "scope",
        model: "gpt",
        availableModels: [],
        allowSelfSignedCertificate: false,
        requestHeaders: {},
        requestConfig: {
          modelField: "model",
          messagesField: "messages",
          temperature: 0.2,
          additionalBodyFields: {},
        },
        responseConfig: null,
        workspaceId: "workspace-1",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      requestConfig: {
        modelField: "model",
        messagesField: "messages",
        temperature: 0.2,
        additionalBodyFields: {},
      },
      model: "gpt",
      messages: [],
    });
    chatService.buildChatCompletionRequestBody.mockReturnValueOnce({ stream: false });
    chatService.addAssistantMessage.mockRejectedValueOnce(
      new chatService.ChatServiceError("db failed", 503),
    );
    executeLlmCompletion.mockImplementationOnce(() => {
      const promise = Promise.resolve({
        answer: "Ответ",
        usageTokens: 10,
        rawResponse: {},
        request: { url: "", headers: {}, body: {} },
      });
      return Object.assign(promise, { streamIterator: undefined });
    });

    const { httpServer } = await createTestServer();
    try {
      const address = httpServer.address() as AddressInfo;
      const response = await fetch(
        `http://127.0.0.1:${address.port}/api/chat/sessions/chat-1/messages/llm`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ content: "Привет" }),
        },
      );

      expect(response.status).toBe(503);
      expect(logService.logStepError).toHaveBeenCalledWith(
        expect.objectContaining({ type: "WRITE_ASSISTANT_MESSAGE" }),
      );
      expect(logService.markExecutionFailed).toHaveBeenCalledWith(
        "execution-1",
        expect.objectContaining({ userMessageId: "user-msg-1" }),
      );
    } finally {
      await new Promise<void>((resolve, reject) => {
        httpServer.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });
});
