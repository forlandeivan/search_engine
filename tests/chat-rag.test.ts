import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SkillDto } from "@shared/skills";
import { buildSkillRagRequestPayload, SkillRagConfigurationError } from "../server/chat-rag";

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
});
