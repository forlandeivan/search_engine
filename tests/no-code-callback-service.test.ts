import { beforeEach, describe, expect, it, vi } from "vitest";

const storageMock = {
  getChatSessionById: vi.fn(),
  createChatMessage: vi.fn(),
  touchChatSession: vi.fn(),
  findChatMessageByResultId: vi.fn(),
  findChatMessageByStreamId: vi.fn(),
  updateChatMessage: vi.fn(),
};

const getSkillByIdMock = vi.fn();

vi.doMock("../server/storage", () => ({ storage: storageMock }));
vi.doMock("../server/skills", () => ({
  getSkillById: getSkillByIdMock,
  UNICA_CHAT_SYSTEM_KEY: "UNICA_CHAT",
}));
vi.doMock("../server/db", () => ({
  db: { execute: vi.fn(async () => ({ rows: [] })) },
  pool: null,
  isDatabaseConfigured: true,
}));

describe("no-code callback message creation", () => {
  beforeEach(() => {
    vi.resetModules();
    storageMock.getChatSessionById.mockReset();
    storageMock.createChatMessage.mockReset();
    storageMock.touchChatSession.mockReset();
    storageMock.findChatMessageByResultId.mockReset();
    storageMock.findChatMessageByStreamId.mockReset();
    storageMock.updateChatMessage.mockReset();
    getSkillByIdMock.mockReset();
  });

  it("creates assistant message and stores triggerMessageId in metadata", async () => {
    const { addNoCodeCallbackMessage } = await import("../server/chat-service");

    storageMock.getChatSessionById.mockResolvedValueOnce({
      id: "chat-1",
      workspaceId: "workspace-1",
      userId: "user-1",
      skillId: "skill-1",
      title: "Chat",
      status: "active",
      createdAt: new Date("2025-01-01T00:00:00.000Z"),
      updatedAt: new Date("2025-01-01T00:00:00.000Z"),
      deletedAt: null,
      skillName: "Skill",
      skillIsSystem: false,
      skillSystemKey: null,
      skillStatus: "active",
    });
    getSkillByIdMock.mockResolvedValueOnce({
      id: "skill-1",
      workspaceId: "workspace-1",
      isSystem: false,
      executionMode: "no_code",
      status: "active",
      mode: "rag",
      ragConfig: {
        mode: "all_collections",
        collectionIds: [],
        topK: 5,
        minScore: 0.7,
        maxContextTokens: 3000,
        showSources: true,
        bm25Weight: null,
        bm25Limit: null,
        vectorWeight: null,
        vectorLimit: null,
        embeddingProviderId: null,
        llmTemperature: null,
        llmMaxTokens: null,
        llmResponseFormat: null,
      },
      onTranscriptionMode: "raw_only",
      onTranscriptionAutoActionId: null,
      noCodeConnection: {
        endpointUrl: "https://example.com/hook",
        authType: "none",
        tokenIsSet: false,
        callbackTokenIsSet: false,
        callbackTokenLastRotatedAt: null,
        callbackTokenLastFour: null,
      },
      createdAt: new Date("2025-01-01T00:00:00.000Z").toISOString(),
      updatedAt: new Date("2025-01-01T00:00:00.000Z").toISOString(),
    });

    storageMock.createChatMessage.mockResolvedValueOnce({
      id: "msg-1",
      chatId: "chat-1",
      role: "assistant",
      content: "Ответ",
      metadata: { triggerMessageId: "user-msg-1", foo: "bar" },
      createdAt: new Date("2025-01-01T00:00:01.000Z"),
    });

    const message = await addNoCodeCallbackMessage({
      workspaceId: "workspace-1",
      chatId: "chat-1",
      role: "assistant",
      content: "Ответ",
      triggerMessageId: "user-msg-1",
      metadata: { foo: "bar" },
    });

    expect(storageMock.createChatMessage).toHaveBeenCalledWith({
      chatId: "chat-1",
      role: "assistant",
      content: "Ответ",
      metadata: { foo: "bar", triggerMessageId: "user-msg-1" },
    });
    expect(storageMock.touchChatSession).toHaveBeenCalledWith("chat-1");
    expect(message.role).toBe("assistant");
    expect((message.metadata as any).triggerMessageId).toBe("user-msg-1");
  });

  it("rejects messages for archived chat", async () => {
    const { addNoCodeCallbackMessage, ChatServiceError } = await import("../server/chat-service");

    storageMock.getChatSessionById.mockResolvedValueOnce({
      id: "chat-1",
      workspaceId: "workspace-1",
      userId: "user-1",
      skillId: "skill-1",
      title: "Chat",
      status: "archived",
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
      skillName: "Skill",
      skillIsSystem: false,
      skillSystemKey: null,
      skillStatus: "active",
    });

    await expect(
      addNoCodeCallbackMessage({
        workspaceId: "workspace-1",
        chatId: "chat-1",
        role: "system",
        content: "Сервисное",
      }),
    ).rejects.toBeInstanceOf(ChatServiceError);
  });

  it("rejects when skill is not in no_code mode", async () => {
    const { addNoCodeCallbackMessage } = await import("../server/chat-service");

    storageMock.getChatSessionById.mockResolvedValueOnce({
      id: "chat-1",
      workspaceId: "workspace-1",
      userId: "user-1",
      skillId: "skill-1",
      title: "Chat",
      status: "active",
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
      skillName: "Skill",
      skillIsSystem: false,
      skillSystemKey: null,
      skillStatus: "active",
    });
    getSkillByIdMock.mockResolvedValueOnce({
      id: "skill-1",
      workspaceId: "workspace-1",
      isSystem: false,
      executionMode: "standard",
      status: "active",
      mode: "rag",
      ragConfig: {
        mode: "all_collections",
        collectionIds: [],
        topK: 5,
        minScore: 0.7,
        maxContextTokens: 3000,
        showSources: true,
        bm25Weight: null,
        bm25Limit: null,
        vectorWeight: null,
        vectorLimit: null,
        embeddingProviderId: null,
        llmTemperature: null,
        llmMaxTokens: null,
        llmResponseFormat: null,
      },
      onTranscriptionMode: "raw_only",
      onTranscriptionAutoActionId: null,
      noCodeConnection: {
        endpointUrl: null,
        authType: "none",
        tokenIsSet: false,
        callbackTokenIsSet: false,
        callbackTokenLastRotatedAt: null,
        callbackTokenLastFour: null,
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    await expect(
      addNoCodeCallbackMessage({
        workspaceId: "workspace-1",
        chatId: "chat-1",
        role: "assistant",
        content: "Ответ",
      }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("creates sync_final messages and skips duplicates by resultId", async () => {
    const { addNoCodeSyncFinalResults } = await import("../server/chat-service");

    storageMock.getChatSessionById.mockResolvedValue({
      id: "chat-1",
      workspaceId: "workspace-1",
      userId: "user-1",
      skillId: "skill-1",
      title: "Chat",
      status: "active",
      createdAt: new Date("2025-01-01T00:00:00.000Z"),
      updatedAt: new Date("2025-01-01T00:00:00.000Z"),
      deletedAt: null,
      skillName: "Skill",
      skillIsSystem: false,
      skillSystemKey: null,
      skillStatus: "active",
    });
    getSkillByIdMock.mockResolvedValue({
      id: "skill-1",
      workspaceId: "workspace-1",
      isSystem: false,
      executionMode: "no_code",
      status: "active",
    });

    storageMock.findChatMessageByResultId.mockResolvedValueOnce(undefined);
    storageMock.createChatMessage.mockResolvedValueOnce({
      id: "msg-1",
      chatId: "chat-1",
      role: "assistant",
      content: "Ответ",
      metadata: { resultId: "r1" },
      createdAt: new Date(),
    });

    const messages = await addNoCodeSyncFinalResults({
      workspaceId: "workspace-1",
      chatId: "chat-1",
      skillId: "skill-1",
      triggerMessageId: "orig-1",
      results: [{ role: "assistant", text: "Ответ", resultId: "r1" }],
    });

    expect(messages).toHaveLength(1);
    expect(storageMock.createChatMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ resultId: "r1", triggerMessageId: "orig-1" }),
      }),
    );
  });

  it("creates stream placeholder and appends chunks", async () => {
    const { addNoCodeStreamChunk } = await import("../server/chat-service");

    storageMock.getChatSessionById.mockResolvedValue({
      id: "chat-1",
      workspaceId: "workspace-1",
      userId: "user-1",
      skillId: "skill-1",
      title: "Chat",
      status: "active",
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
      skillName: "Skill",
      skillIsSystem: false,
      skillSystemKey: null,
      skillStatus: "active",
    });
    getSkillByIdMock.mockResolvedValue({
      id: "skill-1",
      workspaceId: "workspace-1",
      isSystem: false,
      executionMode: "no_code",
      status: "active",
    });

    storageMock.findChatMessageByStreamId.mockResolvedValueOnce(undefined);
    storageMock.createChatMessage.mockResolvedValueOnce({
      id: "m1",
      chatId: "chat-1",
      role: "assistant",
      content: "Прив",
      metadata: { streamId: "s1", processedChunkIds: ["c1"] },
      createdAt: new Date(),
    });

    const first = await addNoCodeStreamChunk({
      workspaceId: "workspace-1",
      chatId: "chat-1",
      streamId: "s1",
      chunkId: "c1",
      triggerMessageId: "orig",
      delta: "Прив",
    });
    expect(first.id).toBe("m1");

    storageMock.findChatMessageByStreamId.mockResolvedValueOnce({
      id: "m1",
      chatId: "chat-1",
      role: "assistant",
      content: "Прив",
      metadata: { streamId: "s1", processedChunkIds: ["c1"] },
      createdAt: new Date(),
    });
    storageMock.updateChatMessage.mockResolvedValueOnce({
      id: "m1",
      chatId: "chat-1",
      role: "assistant",
      content: "Привет!",
      metadata: { streamId: "s1", processedChunkIds: ["c1", "c2"], streaming: false },
      createdAt: new Date(),
    });

    const second = await addNoCodeStreamChunk({
      workspaceId: "workspace-1",
      chatId: "chat-1",
      streamId: "s1",
      chunkId: "c2",
      triggerMessageId: "orig",
      delta: "ет!",
      isFinal: true,
    });

    expect(second.content).toBe("Привет!");
    expect(storageMock.updateChatMessage).toHaveBeenCalledWith(
      "m1",
      expect.objectContaining({
        content: "Привет!",
      }),
    );
  });
});
