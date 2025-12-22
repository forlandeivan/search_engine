import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { skillExecutionLogServiceMock } = vi.hoisted(() => ({
  skillExecutionLogServiceMock: {
    startExecution: vi.fn(),
    logStep: vi.fn(),
    logStepSuccess: vi.fn(),
    logStepError: vi.fn(),
    finishExecution: vi.fn(),
    markExecutionSuccess: vi.fn(),
    markExecutionFailed: vi.fn(),
  },
}));

vi.mock("../server/skill-execution-log-context", () => ({
  skillExecutionLogService: skillExecutionLogServiceMock,
}));

vi.mock("../server/storage", () => ({
  storage: {
    listChatSessions: vi.fn(),
    getChatSessionById: vi.fn(),
    createChatSession: vi.fn(),
    updateChatSession: vi.fn(),
    touchChatSession: vi.fn(),
    softDeleteChatSession: vi.fn(),
    listChatMessages: vi.fn(),
    createChatMessage: vi.fn(),
    getUnicaChatConfig: vi.fn(),
    getLlmProvider: vi.fn(),
  },
}));

vi.mock("../server/skills", () => ({
  getSkillById: vi.fn(),
  UNICA_CHAT_SYSTEM_KEY: "UNICA_CHAT",
}));

vi.mock("../server/model-service", () => ({
  ensureModelAvailable: vi.fn(),
  tryResolveModel: vi.fn(),
  ModelInactiveError: class ModelInactiveError extends Error {},
  ModelUnavailableError: class ModelUnavailableError extends Error {},
  ModelValidationError: class ModelValidationError extends Error {},
}));

import { storage } from "../server/storage";
import { getSkillById, UNICA_CHAT_SYSTEM_KEY } from "../server/skills";
import { ensureModelAvailable } from "../server/model-service";

import {
  addUserMessage,
  buildChatLlmContext,
  ChatServiceError,
  createChat,
  deleteChat,
  getChatMessages,
  listUserChats,
} from "../server/chat-service";

const storageMock = vi.mocked(storage);
const getSkillByIdMock = vi.mocked(getSkillById);
const ensureModelAvailableMock = vi.mocked(ensureModelAvailable);

const baseChat = {
  id: "chat-1",
  workspaceId: "workspace-1",
  userId: "user-1",
  skillId: "skill-1",
  status: "active",
  title: "",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  deletedAt: null,
  skillName: "Test",
  skillStatus: "active",
};

afterEach(() => {
  vi.clearAllMocks();
});

beforeEach(() => {
  ensureModelAvailableMock.mockResolvedValue({
    id: "model-1",
    modelKey: "model-global",
    displayName: "Model",
    modelType: "LLM",
    consumptionUnit: "TOKENS",
    isActive: true,
  } as any);
});

describe("chat service", () => {
  it("returns user chats", async () => {
    storageMock.listChatSessions.mockResolvedValueOnce([baseChat as any]);

    const result = await listUserChats("workspace-1", "user-1");

    expect(result).toHaveLength(1);
    expect(storageMock.listChatSessions).toHaveBeenCalledWith("workspace-1", "user-1", undefined, {});
  });

  it("fails to create chat when skill is missing", async () => {
    getSkillByIdMock.mockResolvedValueOnce(null as any);

    await expect(() =>
      createChat({ workspaceId: "workspace-1", userId: "user-1", skillId: "skill-1" }),
    ).rejects.toThrow(ChatServiceError);
  });

  it("creates chat when skill exists", async () => {
    getSkillByIdMock.mockResolvedValueOnce({ id: "skill-1", name: "Skill" } as any);
    storageMock.createChatSession.mockResolvedValueOnce(baseChat as any);

    const chat = await createChat({
      workspaceId: "workspace-1",
      userId: "user-1",
      skillId: "skill-1",
      title: " My chat ",
    });

    expect(chat.skillName).toBe("Skill");
    expect(storageMock.createChatSession).toHaveBeenCalled();
  });

  it("prevents access to foreign chats", async () => {
    storageMock.getChatSessionById.mockResolvedValueOnce({
      ...baseChat,
      workspaceId: "workspace-2",
    } as any);

    await expect(() => getChatMessages("chat-1", "workspace-1", "user-1")).rejects.toThrow(
      ChatServiceError,
    );
  });

  it("prevents access to chats of another user", async () => {
    storageMock.getChatSessionById.mockResolvedValueOnce({
      ...baseChat,
      userId: "other-user",
    } as any);

    await expect(() => getChatMessages("chat-1", "workspace-1", "user-1")).rejects.toThrow(
      ChatServiceError,
    );
  });

  it("deletes own chat", async () => {
    storageMock.getChatSessionById.mockResolvedValueOnce(baseChat as any);
    storageMock.softDeleteChatSession.mockResolvedValueOnce(true);

    await deleteChat("chat-1", "workspace-1", "user-1");
    expect(storageMock.softDeleteChatSession).toHaveBeenCalledWith("chat-1");
  });

  it("adds user message and touches chat", async () => {
    storageMock.getChatSessionById.mockResolvedValueOnce(baseChat as any);
    storageMock.createChatMessage.mockResolvedValueOnce({
      id: "msg-1",
      chatId: "chat-1",
      role: "user",
      content: "hello",
      metadata: {},
      createdAt: new Date().toISOString(),
    } as any);

    await addUserMessage("chat-1", "workspace-1", "user-1", "hello");

    expect(storageMock.createChatMessage).toHaveBeenCalled();
    expect(storageMock.touchChatSession).toHaveBeenCalledWith("chat-1");
  });

  it("does not add messages to a chat of another user", async () => {
    storageMock.getChatSessionById.mockResolvedValueOnce({
      ...baseChat,
      userId: "user-2",
    } as any);

    await expect(() =>
      addUserMessage("chat-1", "workspace-1", "user-1", "hello"),
    ).rejects.toThrow(ChatServiceError);
  });

  it("blocks sending messages to archived chat", async () => {
    storageMock.getChatSessionById.mockResolvedValueOnce({
      ...baseChat,
      status: "archived",
    } as any);

    await expect(() =>
      addUserMessage("chat-1", "workspace-1", "user-1", "hello"),
    ).rejects.toMatchObject({
      message: "Чат архивирован. Отправка сообщений недоступна.",
      code: "CHAT_ARCHIVED",
    });
  });

  it("blocks sending messages when skill archived", async () => {
    storageMock.getChatSessionById.mockResolvedValueOnce({
      ...baseChat,
      skillStatus: "archived",
    } as any);

    await expect(() =>
      addUserMessage("chat-1", "workspace-1", "user-1", "hello"),
    ).rejects.toMatchObject({
      message: "Навык архивирован. Отправка сообщений недоступна.",
      code: "SKILL_ARCHIVED",
    });
  });

  it("logs skill config and provider resolution when building LLM context", async () => {
    storageMock.getChatSessionById.mockResolvedValueOnce(baseChat as any);
    getSkillByIdMock.mockResolvedValueOnce({
      id: "skill-1",
      llmProviderConfigId: "provider-skill",
      modelId: "model-skill",
      systemPrompt: "Skill prompt",
      isSystem: true,
      systemKey: UNICA_CHAT_SYSTEM_KEY,
    } as any);
    storageMock.getUnicaChatConfig.mockResolvedValueOnce({
      llmProviderConfigId: "provider-global",
      modelId: "model-global",
      systemPrompt: "Global prompt",
      temperature: 0.7,
      topP: 0.5,
      maxTokens: 1024,
    } as any);
    storageMock.getLlmProvider.mockResolvedValueOnce({
      id: "provider-global",
      name: "Provider",
      providerType: "gigachat",
      description: null,
      isActive: true,
      tokenUrl: "https://example/token",
      completionUrl: "https://example/completions",
      authorizationKey: "key",
      scope: "scope",
      model: "base-model",
      availableModels: [],
      allowSelfSignedCertificate: false,
      requestHeaders: {},
      requestConfig: {
        modelField: "model",
        messagesField: "messages",
        temperature: 0.1,
        additionalBodyFields: {},
      },
      responseConfig: null,
      workspaceId: "workspace-1",
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any);
    storageMock.listChatMessages.mockResolvedValueOnce([]);

    await buildChatLlmContext("chat-1", "workspace-1", "user-1", { executionId: "exec-1" });

    expect(skillExecutionLogServiceMock.logStepSuccess).toHaveBeenCalledWith(
      expect.objectContaining({
        executionId: "exec-1",
        type: "LOAD_SKILL_CONFIG",
      }),
    );
    expect(skillExecutionLogServiceMock.logStepSuccess).toHaveBeenCalledWith(
      expect.objectContaining({
        executionId: "exec-1",
        type: "RESOLVE_LLM_PROVIDER_CONFIG",
        output: expect.objectContaining({
          providerId: "provider-global",
          providerSource: "global_unica_chat",
        }),
      }),
    );
  });

  it("marks skill as RAG when knowledge bases are selected", async () => {
    storageMock.getChatSessionById.mockResolvedValueOnce(baseChat as any);
    getSkillByIdMock.mockResolvedValueOnce({
      id: "skill-1",
      llmProviderConfigId: "provider-global",
      modelId: "model-global",
      systemPrompt: null,
      isSystem: false,
      knowledgeBaseIds: ["kb-1"],
      ragConfig: { collectionIds: [] },
    } as any);
    storageMock.getLlmProvider.mockResolvedValueOnce({
      id: "provider-global",
      name: "Provider",
      providerType: "gigachat",
      description: null,
      isActive: true,
      tokenUrl: "https://example/token",
      completionUrl: "https://example/completions",
      authorizationKey: "key",
      scope: "scope",
      model: "base-model",
      availableModels: [],
      allowSelfSignedCertificate: false,
      requestHeaders: {},
      requestConfig: {
        modelField: "model",
        messagesField: "messages",
        temperature: 0.1,
        additionalBodyFields: {},
      },
      responseConfig: null,
      workspaceId: "workspace-1",
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any);
    storageMock.listChatMessages.mockResolvedValueOnce([]);

    const context = await buildChatLlmContext("chat-1", "workspace-1", "user-1", { executionId: "exec-rag" });

    expect(context.skill.isRagSkill).toBe(true);
    expect(context.skill.mode).toBe("rag");
  });

  it("marks skill as LLM when no RAG sources are selected", async () => {
    storageMock.getChatSessionById.mockResolvedValueOnce(baseChat as any);
    getSkillByIdMock.mockResolvedValueOnce({
      id: "skill-1",
      llmProviderConfigId: "provider-global",
      modelId: "model-global",
      systemPrompt: null,
      isSystem: false,
      knowledgeBaseIds: [],
      ragConfig: { collectionIds: [] },
    } as any);
    storageMock.getLlmProvider.mockResolvedValueOnce({
      id: "provider-global",
      name: "Provider",
      providerType: "gigachat",
      description: null,
      isActive: true,
      tokenUrl: "https://example/token",
      completionUrl: "https://example/completions",
      authorizationKey: "key",
      scope: "scope",
      model: "base-model",
      availableModels: [],
      allowSelfSignedCertificate: false,
      requestHeaders: {},
      requestConfig: {
        modelField: "model",
        messagesField: "messages",
        temperature: 0.1,
        additionalBodyFields: {},
      },
      responseConfig: null,
      workspaceId: "workspace-1",
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any);
    storageMock.listChatMessages.mockResolvedValueOnce([]);

    const context = await buildChatLlmContext("chat-1", "workspace-1", "user-1", { executionId: "exec-llm" });

    expect(context.skill.isRagSkill).toBe(false);
    expect(context.skill.mode).toBe("llm");
  });

  it("blocks building context for archived chat", async () => {
    storageMock.getChatSessionById.mockResolvedValueOnce({
      ...baseChat,
      status: "archived",
    } as any);

    await expect(() =>
      buildChatLlmContext("chat-1", "workspace-1", "user-1", { executionId: "exec-archived-chat" }),
    ).rejects.toMatchObject({
      message: "Чат архивирован. Отправка сообщений недоступна.",
      code: "CHAT_ARCHIVED",
    });
  });

  it("blocks building context for archived skill", async () => {
    storageMock.getChatSessionById.mockResolvedValueOnce({
      ...baseChat,
      skillStatus: "active",
    } as any);
    getSkillByIdMock.mockResolvedValueOnce({
      id: "skill-1",
      llmProviderConfigId: "provider-global",
      modelId: "model-global",
      systemPrompt: null,
      isSystem: false,
      status: "archived",
    } as any);

    await expect(() =>
      buildChatLlmContext("chat-1", "workspace-1", "user-1", { executionId: "exec-archived-skill" }),
    ).rejects.toMatchObject({
      message: "Навык архивирован. Отправка сообщений недоступна.",
      code: "SKILL_ARCHIVED",
    });
  });

  it("logs provider resolution errors", async () => {
    storageMock.getChatSessionById.mockResolvedValueOnce(baseChat as any);
    getSkillByIdMock.mockResolvedValueOnce({
      id: "skill-1",
      llmProviderConfigId: "provider-missing",
      modelId: null,
      systemPrompt: null,
      isSystem: false,
    } as any);
    storageMock.getLlmProvider.mockResolvedValueOnce(null as any);

    await expect(() =>
      buildChatLlmContext("chat-1", "workspace-1", "user-1", { executionId: "exec-err" }),
    ).rejects.toThrow(ChatServiceError);

    expect(skillExecutionLogServiceMock.logStepError).toHaveBeenCalledWith(
      expect.objectContaining({
        executionId: "exec-err",
        type: "RESOLVE_LLM_PROVIDER_CONFIG",
      }),
    );
  });
});

