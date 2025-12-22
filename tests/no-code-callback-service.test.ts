import { beforeEach, describe, expect, it, vi } from "vitest";

const storageMock = {
  getChatSessionById: vi.fn(),
  createChatMessage: vi.fn(),
  touchChatSession: vi.fn(),
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
      noCodeConnection: { endpointUrl: "https://example.com/hook", authType: "none", tokenIsSet: false },
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
      noCodeConnection: { endpointUrl: null, authType: "none", tokenIsSet: false },
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
});
