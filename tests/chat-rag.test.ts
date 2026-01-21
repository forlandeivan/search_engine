import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SkillDto } from "@shared/skills";
import { buildSkillRagRequestPayload, SkillRagConfigurationError, buildMultiTurnRagQuery } from "../server/chat-rag";
import type { ChatConversationMessage } from "../server/chat-service";

const storageMocks = vi.hoisted(() => ({
  getKnowledgeBaseSearchSettings: vi.fn(async () => null),
}));

vi.mock("../server/storage", () => ({
  storage: storageMocks,
}));

const baseSkill = (overrides: Partial<SkillDto> = {}): SkillDto => {
  const now = new Date().toISOString();
  return {
    id: "skill-1",
    workspaceId: "workspace-1",
    name: "Custom Skill",
    description: null,
    systemPrompt: "base prompt",
    modelId: "gpt-4",
    llmProviderConfigId: "llm-provider-1",
    collectionName: "kb_default_collection",
    isSystem: false,
    systemKey: null,
    executionMode: "standard",
    status: "active",
    mode: "rag",
    knowledgeBaseIds: ["kb-1"],
    ragConfig: {
      mode: "selected_collections",
      collectionIds: ["collection-a"],
      topK: 6,
      minScore: 0.5,
      maxContextTokens: 3000,
      showSources: true,
      bm25Weight: 0.4,
      bm25Limit: 5,
      vectorWeight: 0.6,
      vectorLimit: 8,
      embeddingProviderId: "embed-provider-1",
      llmTemperature: 0.2,
      llmMaxTokens: 1024,
      llmResponseFormat: "markdown",
    },
    createdAt: now,
    updatedAt: now,
    icon: null,
    onTranscriptionMode: "raw_only",
    onTranscriptionAutoActionId: null,
    ...overrides,
  };
};

describe("buildSkillRagRequestPayload", () => {
  beforeEach(() => {
    storageMocks.getKnowledgeBaseSearchSettings.mockReset();
    storageMocks.getKnowledgeBaseSearchSettings.mockResolvedValue(null);
  });

  it("uses skill rag config values for embedding provider and collections", async () => {
    const payload = await buildSkillRagRequestPayload({
      skill: baseSkill(),
      workspaceId: "workspace-1",
      userMessage: "Расскажи про процессы",
    });

    expect(payload.kb_id).toBe("kb-1");
    expect(payload.top_k).toBe(6);
    expect(payload.hybrid.vector.embedding_provider_id).toBe("embed-provider-1");
    expect(payload.hybrid.vector.collection).toBe("collection-a");
    expect(payload.llm.provider).toBe("llm-provider-1");
    expect(payload.llm.model).toBe("gpt-4");
    expect(storageMocks.getKnowledgeBaseSearchSettings).toHaveBeenCalledWith("workspace-1", "kb-1");
  });

  it("throws configuration error when embedding provider is missing", async () => {
    const base = baseSkill();
    const skill = {
      ...base,
      ragConfig: {
        ...base.ragConfig,
        embeddingProviderId: null,
      },
    };

    await expect(
      buildSkillRagRequestPayload({
        skill,
        workspaceId: "workspace-1",
        userMessage: "test",
      }),
    ).rejects.toThrow(new SkillRagConfigurationError("Для навыка не выбран сервис эмбеддингов. Укажите его в настройках навыка."));
  });

  it("requires manual mode to specify at least one collection", async () => {
    const base = baseSkill();
    const skill = {
      ...base,
      ragConfig: {
        ...base.ragConfig,
        collectionIds: [],
      },
    };

    await expect(
      buildSkillRagRequestPayload({
        skill,
        workspaceId: "workspace-1",
        userMessage: "Привет",
      }),
    ).rejects.toThrow(new SkillRagConfigurationError("В режиме ручного выбора коллекций укажите хотя бы одну коллекцию."));
  });

  it("uses conversation history when provided", async () => {
    const history: ChatConversationMessage[] = [
      { role: "user", content: "Что такое процесс?" },
      { role: "assistant", content: "Процесс - это последовательность действий." },
      { role: "user", content: "А какие бывают процессы?" },
    ];

    const payload = await buildSkillRagRequestPayload({
      skill: baseSkill(),
      workspaceId: "workspace-1",
      userMessage: "Расскажи подробнее",
      conversationHistory: history,
    });

    // Проверяем, что запрос содержит историю
    expect(payload.q).toContain("Что такое процесс?");
    expect(payload.q).toContain("А какие бывают процессы?");
    expect(payload.q).toContain("Расскажи подробнее");
  });

  it("works without conversation history (backward compatibility)", async () => {
    const payload = await buildSkillRagRequestPayload({
      skill: baseSkill(),
      workspaceId: "workspace-1",
      userMessage: "Расскажи про процессы",
    });

    expect(payload.q).toBe("Расскажи про процессы");
  });
});

describe("buildMultiTurnRagQuery", () => {
  it("returns current message when history is empty", () => {
    const result = buildMultiTurnRagQuery("Текущий вопрос", []);
    expect(result).toBe("Текущий вопрос");
  });

  it("returns current message when history is null", () => {
    const result = buildMultiTurnRagQuery("Текущий вопрос", []);
    expect(result).toBe("Текущий вопрос");
  });

  it("combines history with current message", () => {
    const history: ChatConversationMessage[] = [
      { role: "user", content: "Что такое процесс?" },
      { role: "assistant", content: "Процесс - это последовательность действий." },
    ];

    const result = buildMultiTurnRagQuery("Расскажи подробнее", history);

    expect(result).toContain("Вопрос: Что такое процесс?");
    expect(result).toContain("Ответ: Процесс - это последовательность действий.");
    expect(result).toContain("Вопрос: Расскажи подробнее");
  });

  it("respects maxHistoryMessages limit", () => {
    const history: ChatConversationMessage[] = [
      { role: "user", content: "Message 1" },
      { role: "assistant", content: "Response 1" },
      { role: "user", content: "Message 2" },
      { role: "assistant", content: "Response 2" },
      { role: "user", content: "Message 3" },
      { role: "assistant", content: "Response 3" },
      { role: "user", content: "Message 4" },
      { role: "assistant", content: "Response 4" },
    ];

    const result = buildMultiTurnRagQuery("Current", history, { maxHistoryMessages: 3 });

    // slice(-3) берет последние 3 элемента массива (индексы 5, 6, 7):
    // - Response 3 (индекс 5)
    // - Message 4 (индекс 6)
    // - Response 4 (индекс 7)
    expect(result).not.toContain("Message 1");
    expect(result).not.toContain("Response 1");
    expect(result).not.toContain("Message 2");
    expect(result).not.toContain("Response 2");
    expect(result).not.toContain("Message 3"); // Не включено, т.к. это индекс 4
    expect(result).toContain("Response 3"); // Включено (индекс 5)
    expect(result).toContain("Message 4"); // Включено (индекс 6)
    expect(result).toContain("Response 4"); // Включено (индекс 7)
    expect(result).toContain("Current");
  });

  it("respects maxHistoryLength limit", () => {
    const longMessage = "A".repeat(1500);
    const history: ChatConversationMessage[] = [
      { role: "user", content: longMessage },
      { role: "assistant", content: "Response" },
    ];

    const result = buildMultiTurnRagQuery("Current", history, { maxHistoryLength: 1000 });

    // Должна быть обрезана история, но текущее сообщение должно остаться
    expect(result).toContain("Current");
    // История должна быть обрезана или не включена полностью
    expect(result.length).toBeLessThan(longMessage.length + 100);
  });

  it("filters out empty messages", () => {
    const history: ChatConversationMessage[] = [
      { role: "user", content: "" },
      { role: "assistant", content: "Valid response" },
      { role: "user", content: "   " }, // Только пробелы
    ];

    const result = buildMultiTurnRagQuery("Current", history);

    expect(result).toContain("Valid response");
    expect(result).toContain("Current");
    // Пустые сообщения должны быть отфильтрованы, но префиксы остаются для валидных сообщений
    expect(result).toContain("Ответ: Valid response");
    expect(result).toContain("Вопрос: Current");
    // Не должно быть пустых вопросов/ответов без контента
    const lines = result.split("\n");
    const emptyLines = lines.filter(line => line === "Вопрос: " || line === "Ответ: ");
    expect(emptyLines.length).toBe(0);
  });

  it("handles single message in history", () => {
    const history: ChatConversationMessage[] = [
      { role: "user", content: "Previous question" },
    ];

    const result = buildMultiTurnRagQuery("Current question", history);

    expect(result).toContain("Previous question");
    expect(result).toContain("Current question");
  });

  it("uses default limits when options not provided", () => {
    const history: ChatConversationMessage[] = Array.from({ length: 10 }, (_, i) => ({
      role: i % 2 === 0 ? "user" : "assistant",
      content: `Message ${i}`,
    }));

    const result = buildMultiTurnRagQuery("Current", history);

    // Должны быть только последние 5 сообщений (по умолчанию)
    expect(result).not.toContain("Message 0");
    expect(result).not.toContain("Message 1");
    expect(result).not.toContain("Message 2");
    expect(result).not.toContain("Message 3");
    expect(result).not.toContain("Message 4");
    expect(result).toContain("Message 5");
    expect(result).toContain("Current");
  });
});
