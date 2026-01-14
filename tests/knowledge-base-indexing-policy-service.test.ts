import { describe, expect, it } from "vitest";

import {
  DEFAULT_KNOWLEDGE_BASE_INDEXING_POLICY,
  MIN_CHUNK_SIZE,
  MAX_CHUNK_SIZE,
} from "@shared/knowledge-base-indexing-policy";
import { KnowledgeBaseIndexingPolicyDomainError, KnowledgeBaseIndexingPolicyService } from "../server/knowledge-base-indexing-policy";

function createRepo() {
  let record: any | null = null;
  return {
    get: async () => record,
    upsert: async (values: any) => {
      record = { ...values };
      return record;
    },
    getRecord: () => record,
  };
}

describe("KnowledgeBaseIndexingPolicyService", () => {
  const defaultProviderStatus = {
    id: "test-provider-1",
    displayName: "Test Provider",
    providerType: "gigachat",
    model: "text-embedding-3-small",
    isActive: true,
    isConfigured: true,
  };

  const defaultModelsInfo = {
    providerId: "test-provider-1",
    providerName: "Test Provider",
    supportsModelSelection: true,
    defaultModel: "text-embedding-3-small",
    models: ["text-embedding-3-small", "text-embedding-3-large"],
    isConfigured: true,
  };

  it("возвращает дефолты если запись отсутствует", async () => {
    const repo = createRepo();
    const service = new KnowledgeBaseIndexingPolicyService(
      repo as any,
      { resolve: async () => defaultProviderStatus },
      { resolveModels: async () => defaultModelsInfo },
    );

    const result = await service.get();

    expect(result).toEqual(DEFAULT_KNOWLEDGE_BASE_INDEXING_POLICY);
  });

  it("сохраняет и возвращает обновленные значения", async () => {
    const repo = createRepo();
    const service = new KnowledgeBaseIndexingPolicyService(
      repo as any,
      {
        resolve: async (providerId: string) => {
          if (providerId === "test-provider-2") {
            return {
              id: "test-provider-2",
              displayName: "Test Provider 2",
              providerType: "openai",
              model: "text-embedding-ada-002",
              isActive: true,
              isConfigured: true,
            };
          }
          return defaultProviderStatus;
        },
      },
      {
        resolveModels: async (providerId: string) => {
          if (providerId === "test-provider-2") {
            return {
              providerId: "test-provider-2",
              providerName: "Test Provider 2",
              supportsModelSelection: true,
              defaultModel: "text-embedding-ada-002",
              models: ["text-embedding-ada-002"],
              isConfigured: true,
            };
          }
          return defaultModelsInfo;
        },
      },
    );

    const updated = await service.update(
      {
        embeddingsProvider: "test-provider-2",
        embeddingsModel: "text-embedding-ada-002",
        chunkSize: 1200,
        chunkOverlap: 150,
        defaultSchema: [
          { name: "content", type: "string", isArray: false, template: "{{ chunk.text }}" },
        ],
      },
      "admin-1",
    );

    expect(updated.embeddingsProvider).toBe("test-provider-2");
    expect(updated.embeddingsModel).toBe("text-embedding-ada-002");
    expect(updated.chunkSize).toBe(1200);
    expect(updated.chunkOverlap).toBe(150);
    expect(repo.getRecord()?.updatedByAdminId).toBe("admin-1");
  });

  it("бросает ошибку при chunkOverlap >= chunkSize", async () => {
    const repo = createRepo();
    const service = new KnowledgeBaseIndexingPolicyService(
      repo as any,
      { resolve: async () => defaultProviderStatus },
      { resolveModels: async () => defaultModelsInfo },
    );

    await expect(
      service.update({
        chunkSize: 500,
        chunkOverlap: 500,
      }),
    ).rejects.toBeInstanceOf(KnowledgeBaseIndexingPolicyDomainError);
  });

  it("бросает доменную ошибку при неизвестном провайдере", async () => {
    const repo = createRepo();
    const service = new KnowledgeBaseIndexingPolicyService(
      repo as any,
      { resolve: async () => null },
      { resolveModels: async () => null },
    );

    await expect(
      service.update({
        embeddingsProvider: "unknown-provider",
      }),
    ).rejects.toBeInstanceOf(KnowledgeBaseIndexingPolicyDomainError);
  });

  it("бросает доменную ошибку при ненастроенном провайдере", async () => {
    const repo = createRepo();
    const service = new KnowledgeBaseIndexingPolicyService(
      repo as any,
      {
        resolve: async () => ({
          id: "unconfigured-provider",
          displayName: "Unconfigured Provider",
          providerType: "gigachat",
          model: "test-model",
          isActive: true,
          isConfigured: false,
          statusReason: "Провайдер не настроен",
        }),
      },
      {
        resolveModels: async () => ({
          providerId: "unconfigured-provider",
          providerName: "Unconfigured Provider",
          supportsModelSelection: false,
          defaultModel: null,
          models: [],
          isConfigured: false,
          statusReason: "Провайдер не настроен",
        }),
      },
    );

    await expect(
      service.update({
        embeddingsProvider: "unconfigured-provider",
      }),
    ).rejects.toThrow("Провайдер не настроен");
  });

  it("бросает доменную ошибку при невалидном размере чанка", async () => {
    const repo = createRepo();
    const service = new KnowledgeBaseIndexingPolicyService(
      repo as any,
      { resolve: async () => defaultProviderStatus },
      { resolveModels: async () => defaultModelsInfo },
    );

    await expect(
      service.update({
        chunkSize: MIN_CHUNK_SIZE - 1,
      }),
    ).rejects.toThrow();

    await expect(
      service.update({
        chunkSize: MAX_CHUNK_SIZE + 1,
      }),
    ).rejects.toThrow();
  });

  it("бросает доменную ошибку при несуществующей модели", async () => {
    const repo = createRepo();
    const service = new KnowledgeBaseIndexingPolicyService(
      repo as any,
      { resolve: async () => defaultProviderStatus },
      {
        resolveModels: async () => ({
          ...defaultModelsInfo,
          models: ["model-1", "model-2"],
        }),
      },
    );

    await expect(
      service.update({
        embeddingsModel: "non-existent-model",
      }),
    ).rejects.toBeInstanceOf(KnowledgeBaseIndexingPolicyDomainError);
  });

  it("сохраняет политику с валидными параметрами", async () => {
    const repo = createRepo();
    const service = new KnowledgeBaseIndexingPolicyService(
      repo as any,
      { resolve: async () => defaultProviderStatus },
      { resolveModels: async () => defaultModelsInfo },
    );

    const testPolicy = {
      embeddingsProvider: "test-provider-1",
      embeddingsModel: "text-embedding-3-small",
      chunkSize: 1000,
      chunkOverlap: 200,
      defaultSchema: [
        { name: "content", type: "string", isArray: false, template: "{{ chunk.text }}" },
        { name: "title", type: "string", isArray: false, template: "{{ chunk.heading }}" },
      ],
    };

    const result = await service.update(testPolicy, "admin-123");

    expect(result.embeddingsProvider).toBe("test-provider-1");
    expect(result.embeddingsModel).toBe("text-embedding-3-small");
    expect(result.chunkSize).toBe(1000);
    expect(result.chunkOverlap).toBe(200);
    expect(result.defaultSchema).toHaveLength(2);
    expect(repo.getRecord()?.updatedByAdminId).toBe("admin-123");
  });
});

