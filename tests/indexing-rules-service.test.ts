import { describe, expect, it } from "vitest";

import {
  DEFAULT_INDEXING_RULES,
  MAX_TOP_K,
  MIN_CHUNK_SIZE,
  MIN_RELEVANCE_THRESHOLD,
  MIN_TOP_K,
} from "@shared/indexing-rules";
import { IndexingRulesDomainError, IndexingRulesService } from "../server/indexing-rules";

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

describe("IndexingRulesService", () => {
  const defaultProvider = {
    id: "p1",
    displayName: "Provider",
    providerType: "gigachat",
    model: "m1",
    isActive: true,
    isConfigured: true,
  };

  const defaultModels = {
    providerId: "p1",
    providerName: "Provider",
    supportsModelSelection: true,
    defaultModel: "m1",
    models: [],
    isConfigured: true,
  };

  it("возвращает дефолты если запись отсутствует", async () => {
    const repo = createRepo();
    const service = new IndexingRulesService(
      repo as any,
      { resolve: async () => defaultProvider },
      { resolveModels: async () => defaultModels },
    );

    const result = await service.getIndexingRules();

    expect(result).toEqual(DEFAULT_INDEXING_RULES);
  });

  it("сохраняет и возвращает обновленные значения", async () => {
    const repo = createRepo();
    const service = new IndexingRulesService(
      repo as any,
      {
        resolve: async () => ({
          id: "yandex",
          displayName: "Yandex",
          providerType: "gigachat",
          model: "gpt-lite",
          isActive: true,
          isConfigured: true,
        }),
      },
      {
        resolveModels: async () => ({
          providerId: "yandex",
          providerName: "Yandex",
          supportsModelSelection: true,
          defaultModel: "gpt-lite",
          models: ["gpt-lite"],
          isConfigured: true,
        }),
      },
    );

    const updated = await service.updateIndexingRules(
      {
        embeddingsProvider: "yandex",
        embeddingsModel: "gpt-lite",
        chunkSize: 1024,
        chunkOverlap: 128,
        topK: 7,
        relevanceThreshold: 0.65,
        citationsEnabled: true,
      },
      "admin-1",
    );

    expect(updated.embeddingsProvider).toBe("yandex");
    expect(updated.chunkSize).toBe(1024);
    expect(updated.citationsEnabled).toBe(true);
    expect(repo.getRecord()?.updatedByAdminId).toBe("admin-1");
  });

  it("бросает ошибку при chunkOverlap >= chunkSize", async () => {
    const repo = createRepo();
    const service = new IndexingRulesService(
      repo as any,
      { resolve: async () => defaultProvider },
      { resolveModels: async () => defaultModels },
    );

    await expect(
      service.updateIndexingRules({
        chunkSize: 500,
        chunkOverlap: 500,
      }),
    ).rejects.toBeInstanceOf(IndexingRulesDomainError);
  });

  it("бросает доменную ошибку при выходе relevanceThreshold за пределы 0..1", async () => {
    const repo = createRepo();
    const service = new IndexingRulesService(
      repo as any,
      { resolve: async () => defaultProvider },
      { resolveModels: async () => defaultModels },
    );

    await expect(
      service.updateIndexingRules({
        relevanceThreshold: 1.5,
      }),
    ).rejects.toBeInstanceOf(IndexingRulesDomainError);
  });

  it("бросает доменную ошибку при неизвестном провайдере", async () => {
    const repo = createRepo();
    const service = new IndexingRulesService(
      repo as any,
      { resolve: async () => null },
      { resolveModels: async () => null },
    );

    await expect(
      service.updateIndexingRules({
        embeddingsProvider: "unknown",
      }),
    ).rejects.toBeInstanceOf(IndexingRulesDomainError);
  });

  it("бросает доменную ошибку при ненастроенном провайдере", async () => {
    const repo = createRepo();
    const service = new IndexingRulesService(
      repo as any,
      {
        resolve: async () => ({
          id: "p1",
          displayName: "Provider",
          providerType: "gigachat",
          model: "m1",
          isActive: true,
          isConfigured: false,
          statusReason: "Нет ключа",
        }),
      },
      { resolveModels: async () => defaultModels },
    );

    await expect(
      service.updateIndexingRules({
        embeddingsProvider: "p1",
      }),
    ).rejects.toBeInstanceOf(IndexingRulesDomainError);
  });

  it("подставляет defaultModel если выбор модели не поддерживается", async () => {
    const repo = createRepo();
    const service = new IndexingRulesService(
      repo as any,
      { resolve: async () => defaultProvider },
      {
        resolveModels: async () => ({
          providerId: "p1",
          providerName: "Provider",
          supportsModelSelection: false,
          defaultModel: "fixed-model",
          models: [],
          isConfigured: true,
        }),
      },
    );

    const updated = await service.updateIndexingRules({
      embeddingsProvider: "p1",
      embeddingsModel: "will-be-overwritten",
    });

    expect(updated.embeddingsModel).toBe("fixed-model");
  });

  it("бросает ошибку если выбранная модель не поддерживается", async () => {
    const repo = createRepo();
    const service = new IndexingRulesService(
      repo as any,
      { resolve: async () => defaultProvider },
      {
        resolveModels: async () => ({
          providerId: "p1",
          providerName: "Provider",
          supportsModelSelection: true,
          defaultModel: "m1",
          models: ["m1", "m2"],
          isConfigured: true,
        }),
      },
    );

    await expect(
      service.updateIndexingRules({
        embeddingsProvider: "p1",
        embeddingsModel: "unknown-model",
      }),
    ).rejects.toBeInstanceOf(IndexingRulesDomainError);
  });

  it("бросает ошибку если chunkSize ниже минимального", async () => {
    const repo = createRepo();
    const service = new IndexingRulesService(
      repo as any,
      { resolve: async () => defaultProvider },
      { resolveModels: async () => defaultModels },
    );

    await expect(
      service.updateIndexingRules({
        chunkSize: MIN_CHUNK_SIZE - 1,
      }),
    ).rejects.toBeInstanceOf(IndexingRulesDomainError);
  });

  it("бросает ошибку при некорректном topK", async () => {
    const repo = createRepo();
    const service = new IndexingRulesService(
      repo as any,
      { resolve: async () => defaultProvider },
      { resolveModels: async () => defaultModels },
    );

    await expect(service.updateIndexingRules({ topK: MIN_TOP_K - 1 })).rejects.toBeInstanceOf(IndexingRulesDomainError);
    await expect(service.updateIndexingRules({ topK: MAX_TOP_K + 1 })).rejects.toBeInstanceOf(IndexingRulesDomainError);
    await expect(service.updateIndexingRules({ topK: 2.5 as unknown as number })).rejects.toBeInstanceOf(
      IndexingRulesDomainError,
    );
  });

  it("бросает ошибку при пороге ниже минимума", async () => {
    const repo = createRepo();
    const service = new IndexingRulesService(
      repo as any,
      { resolve: async () => defaultProvider },
      { resolveModels: async () => defaultModels },
    );

    await expect(
      service.updateIndexingRules({
        relevanceThreshold: MIN_RELEVANCE_THRESHOLD - 0.1,
      }),
    ).rejects.toBeInstanceOf(IndexingRulesDomainError);
  });

  it("сохраняет валидные topK и порог релевантности", async () => {
    const repo = createRepo();
    const service = new IndexingRulesService(
      repo as any,
      { resolve: async () => defaultProvider },
      { resolveModels: async () => defaultModels },
    );

    const updated = await service.updateIndexingRules({
      topK: 5,
      relevanceThreshold: 0.75,
    });

    expect(updated.topK).toBe(5);
    expect(updated.relevanceThreshold).toBe(0.75);
  });

  it("не изменяет сохранённые правила при ошибке валидации (атомарность)", async () => {
    const repo = createRepo();
    const service = new IndexingRulesService(
      repo as any,
      { resolve: async () => defaultProvider },
      { resolveModels: async () => defaultModels },
    );

    await service.updateIndexingRules({
      embeddingsProvider: "p1",
      embeddingsModel: "m1",
      chunkSize: MIN_CHUNK_SIZE + 10,
      chunkOverlap: 0,
      topK: MIN_TOP_K,
      relevanceThreshold: 0.5,
      citationsEnabled: true,
    });

    await expect(
      service.updateIndexingRules({
        chunkSize: MIN_CHUNK_SIZE,
        chunkOverlap: MIN_CHUNK_SIZE, // invalid: overlap >= size
      }),
    ).rejects.toBeInstanceOf(IndexingRulesDomainError);

    expect(repo.getRecord()?.chunkOverlap).toBe(0);
    expect(repo.getRecord()?.chunkSize).toBe(MIN_CHUNK_SIZE + 10);
  });
});
