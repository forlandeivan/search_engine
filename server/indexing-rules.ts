import { eq, sql } from "drizzle-orm";

import { db } from "./db";
import { storage } from "./storage";
import { indexingRules, type IndexingRules as StoredIndexingRules, type EmbeddingProvider } from "@shared/schema";
import {
  DEFAULT_INDEXING_RULES,
  MAX_CHUNK_SIZE,
  MIN_CHUNK_SIZE,
  MAX_RELEVANCE_THRESHOLD,
  MAX_TOP_K,
  MIN_RELEVANCE_THRESHOLD,
  MIN_TOP_K,
  indexingRulesSchema,
  type IndexingRulesDto,
  type UpdateIndexingRulesDto,
} from "@shared/indexing-rules";
import {
  resolveEmbeddingProviderStatus,
  resolveEmbeddingProviderModels,
  type EmbeddingProviderModelsInfo,
  type EmbeddingProviderStatus,
} from "./embedding-provider-registry";

export class IndexingRulesError extends Error {
  status = 400;
  constructor(message: string) {
    super(message);
    this.name = "IndexingRulesError";
  }
}

export class IndexingRulesDomainError extends IndexingRulesError {
  code: string;
  field?: string;

  constructor(message: string, code: string, field?: string, status = 400) {
    super(message);
    this.name = "IndexingRulesDomainError";
    this.code = code;
    this.field = field;
    this.status = status;
  }
}

type EmbeddingProviderResolver = {
  resolve(providerId: string, workspaceId?: string): Promise<EmbeddingProviderStatus | null>;
};

type EmbeddingProviderModelsResolver = {
  resolveModels(providerId: string, workspaceId?: string): Promise<EmbeddingProviderModelsInfo | null>;
};

type IndexingRulesRepository = {
  get(): Promise<StoredIndexingRules | null>;
  upsert(values: StoredIndexingRules): Promise<StoredIndexingRules>;
};

const INDEXING_RULES_SINGLETON_ID = "indexing_rules_singleton";

class DbIndexingRulesRepository implements IndexingRulesRepository {
  async get(): Promise<StoredIndexingRules | null> {
    const [row] = await db.select().from(indexingRules).where(eq(indexingRules.id, INDEXING_RULES_SINGLETON_ID)).limit(1);
    return row ?? null;
  }

  async upsert(values: StoredIndexingRules): Promise<StoredIndexingRules> {
    const [row] = await db
      .insert(indexingRules)
      .values(values)
      .onConflictDoUpdate({
        target: indexingRules.id,
        set: {
          embeddingsProvider: values.embeddingsProvider,
          embeddingsModel: values.embeddingsModel,
          chunkSize: values.chunkSize,
          chunkOverlap: values.chunkOverlap,
          topK: values.topK,
          relevanceThreshold: values.relevanceThreshold,
          maxContextTokens: values.maxContextTokens,
          citationsEnabled: values.citationsEnabled,
          updatedByAdminId: values.updatedByAdminId ?? null,
          updatedAt: sql`CURRENT_TIMESTAMP`,
        },
      })
      .returning();

    return row;
  }
}

function mapToDto(row: StoredIndexingRules | null): IndexingRulesDto {
  if (!row) {
    return { ...DEFAULT_INDEXING_RULES };
  }

  return {
    embeddingsProvider: row.embeddingsProvider,
    embeddingsModel: row.embeddingsModel,
    chunkSize: row.chunkSize,
    chunkOverlap: row.chunkOverlap,
    topK: row.topK,
    relevanceThreshold: row.relevanceThreshold,
    maxContextTokens: row.maxContextTokens,
    citationsEnabled: row.citationsEnabled,
  };
}

function normalizeString(field: string, value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    throw new IndexingRulesError(`Поле '${field}' не может быть пустым`);
  }
  if (trimmed.length > 255) {
    throw new IndexingRulesError(`Поле '${field}' слишком длинное`);
  }

  return trimmed;
}

function normalizeInteger(field: string, value: number | undefined, options: { min?: number; max?: number; gt?: number } = {}): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!Number.isInteger(value)) {
    throw new IndexingRulesError(`Поле '${field}' должно быть целым числом`);
  }

  if (options.gt !== undefined && !(value > options.gt)) {
    throw new IndexingRulesError(`Поле '${field}' должно быть больше ${options.gt}`);
  }

  if (options.min !== undefined && value < options.min) {
    throw new IndexingRulesError(`Поле '${field}' должно быть не меньше ${options.min}`);
  }

  if (options.max !== undefined && value > options.max) {
    throw new IndexingRulesError(`Поле '${field}' должно быть не больше ${options.max}`);
  }

  return value;
}

function normalizeFraction(field: string, value: number | undefined, options: { min?: number; max?: number } = {}): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!Number.isFinite(value)) {
    throw new IndexingRulesError(`Поле '${field}' должно быть числом`);
  }

  const min = options.min ?? 0;
  const max = options.max ?? 1;

  if (value < min || value > max) {
    throw new IndexingRulesError(`Поле '${field}' должно быть в диапазоне ${min}..${max}`);
  }

  return value;
}

function validateRules(config: IndexingRulesDto): void {
  if (config.chunkSize < MIN_CHUNK_SIZE || config.chunkSize > MAX_CHUNK_SIZE) {
    throw new IndexingRulesDomainError(
      `Размер чанка должен быть в диапазоне ${MIN_CHUNK_SIZE}..${MAX_CHUNK_SIZE}`,
      "INDEXING_CHUNK_SIZE_OUT_OF_RANGE",
      "chunk_size",
    );
  }

  if (config.chunkOverlap < 0) {
    throw new IndexingRulesDomainError(
      "Перекрытие не может быть отрицательным",
      "INDEXING_CHUNK_OVERLAP_OUT_OF_RANGE",
      "chunk_overlap",
    );
  }

  if (config.chunkOverlap >= config.chunkSize) {
    throw new IndexingRulesDomainError(
      "Перекрытие не может быть больше или равно размеру чанка",
      "INDEXING_CHUNK_OVERLAP_GT_CHUNK_SIZE",
      "chunk_overlap",
    );
  }

  if (config.topK < MIN_TOP_K || config.topK > MAX_TOP_K) {
    throw new IndexingRulesDomainError(
      `Top K должно быть в диапазоне ${MIN_TOP_K}..${MAX_TOP_K}`,
      "INDEXING_TOP_K_OUT_OF_RANGE",
      "top_k",
    );
  }

  if (config.relevanceThreshold < MIN_RELEVANCE_THRESHOLD || config.relevanceThreshold > MAX_RELEVANCE_THRESHOLD) {
    throw new IndexingRulesDomainError(
      `Порог релевантности должен быть в диапазоне ${MIN_RELEVANCE_THRESHOLD}..${MAX_RELEVANCE_THRESHOLD}`,
      "INDEXING_THRESHOLD_OUT_OF_RANGE",
      "relevance_threshold",
    );
  }

  if (!config.embeddingsProvider.trim()) {
    throw new IndexingRulesError("embeddingsProvider не может быть пустым");
  }

  if (!config.embeddingsModel.trim()) {
    throw new IndexingRulesError("embeddingsModel не может быть пустым");
  }
}

export class IndexingRulesService {
  constructor(
    private readonly repo: IndexingRulesRepository = new DbIndexingRulesRepository(),
    private readonly providerResolver: EmbeddingProviderResolver = { resolve: resolveEmbeddingProviderStatus },
    private readonly modelsResolver: EmbeddingProviderModelsResolver = { resolveModels: resolveEmbeddingProviderModels },
  ) {}

  private buildRecord(values: IndexingRulesDto, existing?: StoredIndexingRules | null, actorAdminId?: string | null): StoredIndexingRules {
    return {
      id: existing?.id ?? INDEXING_RULES_SINGLETON_ID,
      embeddingsProvider: values.embeddingsProvider,
      embeddingsModel: values.embeddingsModel,
      chunkSize: values.chunkSize,
      chunkOverlap: values.chunkOverlap,
      topK: values.topK,
      relevanceThreshold: values.relevanceThreshold,
      maxContextTokens: values.maxContextTokens,
      citationsEnabled: values.citationsEnabled,
      updatedByAdminId: actorAdminId ?? existing?.updatedByAdminId ?? null,
      createdAt: existing?.createdAt ?? new Date(),
      updatedAt: new Date(),
    };
  }

  private async ensureInitialized(): Promise<StoredIndexingRules> {
    const existing = await this.repo.get();
    if (existing) {
      return existing;
    }

    const defaults = this.buildRecord(DEFAULT_INDEXING_RULES);
    return await this.repo.upsert(defaults);
  }

  async getIndexingRules(): Promise<IndexingRulesDto> {
    const existing = await this.ensureInitialized();
    return mapToDto(existing);
  }

  async updateIndexingRules(
    patch: UpdateIndexingRulesDto,
    actorAdminId?: string | null,
    options?: { workspaceId?: string },
  ): Promise<IndexingRulesDto> {
    // Дополнительная проверка типов на случай прямого вызова без zod
    const parsed = indexingRulesSchema.partial().safeParse(patch);
    if (!parsed.success) {
      const chunkSizeIssue = parsed.error.issues.find((issue) => issue.path?.[0] === "chunkSize");
      if (chunkSizeIssue) {
        throw new IndexingRulesDomainError(
          `Размер чанка должен быть в диапазоне ${MIN_CHUNK_SIZE}..${MAX_CHUNK_SIZE}`,
          "INDEXING_CHUNK_SIZE_OUT_OF_RANGE",
          "chunk_size",
        );
      }

      const chunkOverlapIssue = parsed.error.issues.find((issue) => issue.path?.[0] === "chunkOverlap");
      if (chunkOverlapIssue) {
        throw new IndexingRulesDomainError(
          "Перекрытие должно быть неотрицательным и меньше размера чанка",
          "INDEXING_CHUNK_OVERLAP_OUT_OF_RANGE",
          "chunk_overlap",
        );
      }

      const topKIssue = parsed.error.issues.find((issue) => issue.path?.[0] === "topK");
      if (topKIssue) {
        const isIntegerIssue = topKIssue.code === "invalid_type" && (topKIssue as any).expected === "integer";
        throw new IndexingRulesDomainError(
          isIntegerIssue
            ? `Top K должно быть целым числом в диапазоне ${MIN_TOP_K}..${MAX_TOP_K}`
            : `Top K должно быть в диапазоне ${MIN_TOP_K}..${MAX_TOP_K}`,
          isIntegerIssue ? "INDEXING_TOP_K_NOT_INTEGER" : "INDEXING_TOP_K_OUT_OF_RANGE",
          "top_k",
        );
      }

      const relevanceThresholdIssue = parsed.error.issues.find((issue) => issue.path?.[0] === "relevanceThreshold");
      if (relevanceThresholdIssue) {
        throw new IndexingRulesDomainError(
          `Порог релевантности должен быть в диапазоне ${MIN_RELEVANCE_THRESHOLD}..${MAX_RELEVANCE_THRESHOLD}`,
          "INDEXING_THRESHOLD_OUT_OF_RANGE",
          "relevance_threshold",
        );
      }
      throw new IndexingRulesError("Некорректные данные правил индексации");
    }

    const current = await this.ensureInitialized();
    const sanitizedPatch: Partial<IndexingRulesDto> = {};

    const provider = normalizeString("embeddingsProvider", patch.embeddingsProvider);
    if (provider !== undefined) {
      sanitizedPatch.embeddingsProvider = provider;
    }

    const model = normalizeString("embeddingsModel", patch.embeddingsModel);
    if (model !== undefined) {
      sanitizedPatch.embeddingsModel = model;
    }

    const chunkSize = normalizeInteger("chunkSize", patch.chunkSize, { gt: 0 });
    if (chunkSize !== undefined) {
      sanitizedPatch.chunkSize = chunkSize;
    }

    const chunkOverlap = normalizeInteger("chunkOverlap", patch.chunkOverlap, { min: 0 });
    if (chunkOverlap !== undefined) {
      sanitizedPatch.chunkOverlap = chunkOverlap;
    }

    if (patch.topK !== undefined) {
      if (!Number.isInteger(patch.topK)) {
        throw new IndexingRulesDomainError(
          `Top K должно быть целым числом в диапазоне ${MIN_TOP_K}..${MAX_TOP_K}`,
          "INDEXING_TOP_K_NOT_INTEGER",
          "top_k",
        );
      }
      try {
        const topK = normalizeInteger("topK", patch.topK, { min: MIN_TOP_K, max: MAX_TOP_K });
        sanitizedPatch.topK = topK;
      } catch (error) {
        if (error instanceof IndexingRulesError) {
          throw new IndexingRulesDomainError(
            `Top K должно быть в диапазоне ${MIN_TOP_K}..${MAX_TOP_K}`,
            "INDEXING_TOP_K_OUT_OF_RANGE",
            "top_k",
          );
        }
        throw error;
      }
    }

    if (patch.relevanceThreshold !== undefined) {
      try {
        const relevanceThreshold = normalizeFraction("relevanceThreshold", patch.relevanceThreshold, {
          min: MIN_RELEVANCE_THRESHOLD,
          max: MAX_RELEVANCE_THRESHOLD,
        });
        sanitizedPatch.relevanceThreshold = relevanceThreshold;
      } catch (error) {
        if (error instanceof IndexingRulesError) {
          throw new IndexingRulesDomainError(
            `Порог релевантности должен быть в диапазоне ${MIN_RELEVANCE_THRESHOLD}..${MAX_RELEVANCE_THRESHOLD}`,
            "INDEXING_THRESHOLD_OUT_OF_RANGE",
            "relevance_threshold",
          );
        }
        throw error;
      }
    }

    if (typeof patch.citationsEnabled === "boolean") {
      sanitizedPatch.citationsEnabled = patch.citationsEnabled;
    }

    const merged: IndexingRulesDto = {
      ...mapToDto(current),
      ...sanitizedPatch,
    };

    const isProviderChanged = sanitizedPatch.embeddingsProvider !== undefined;
    if (isProviderChanged || !current.embeddingsProvider) {
      const provider = await this.providerResolver.resolve(merged.embeddingsProvider, options?.workspaceId);
      if (!provider) {
        throw new IndexingRulesDomainError(
          "Провайдер эмбеддингов не найден",
          "EMBEDDINGS_PROVIDER_UNKNOWN",
          "embeddings_provider",
        );
      }

      if (!provider.isConfigured) {
        throw new IndexingRulesDomainError(
          provider.statusReason ?? "Провайдер эмбеддингов не настроен",
          "EMBEDDINGS_PROVIDER_NOT_CONFIGURED",
          "embeddings_provider",
        );
      }
    }

    const modelInfo = await this.modelsResolver.resolveModels(merged.embeddingsProvider, options?.workspaceId);
    if (!modelInfo) {
      throw new IndexingRulesDomainError(
        "Провайдер эмбеддингов не найден",
        "EMBEDDINGS_PROVIDER_UNKNOWN",
        "embeddings_provider",
      );
    }

    if (!modelInfo.supportsModelSelection) {
      const fallbackModel =
        modelInfo.defaultModel ??
        (typeof merged.embeddingsModel === "string" && merged.embeddingsModel.trim().length > 0
          ? merged.embeddingsModel.trim()
          : null);
      if (!fallbackModel) {
        throw new IndexingRulesDomainError(
          "Для выбранного провайдера не задана модель по умолчанию",
          "EMBEDDINGS_MODEL_REQUIRED",
          "embeddings_model",
        );
      }
      merged.embeddingsModel = fallbackModel;
    } else {
      const modelValue = typeof merged.embeddingsModel === "string" ? merged.embeddingsModel.trim() : "";
      if (!modelValue) {
        throw new IndexingRulesDomainError(
          "Укажите модель эмбеддингов",
          "EMBEDDINGS_MODEL_REQUIRED",
          "embeddings_model",
        );
      }

      if (modelInfo.models.length > 0 && !modelInfo.models.includes(modelValue)) {
        throw new IndexingRulesDomainError(
          `Модель '${modelValue}' не поддерживается провайдером ${modelInfo.providerName}`,
          "EMBEDDINGS_MODEL_NOT_SUPPORTED",
          "embeddings_model",
        );
      }

      merged.embeddingsModel = modelValue;
    }

    validateRules(merged);

    const saved = await this.repo.upsert(this.buildRecord(merged, current, actorAdminId ?? null));
    return mapToDto(saved);
  }
}

export async function resolveEmbeddingProviderForWorkspace(options: {
  workspaceId?: string;
  requestedProviderId?: string | null;
}): Promise<{ provider: EmbeddingProvider; rules: IndexingRulesDto; status: EmbeddingProviderStatus }> {
  const rules = await indexingRulesService.getIndexingRules();
  const requestedId = options.requestedProviderId ?? null;
  const providerId =
    (typeof rules.embeddingsProvider === "string" && rules.embeddingsProvider.trim()) ||
    (requestedId && requestedId.trim());

  if (!providerId) {
    throw new IndexingRulesDomainError(
      "Сервис эмбеддингов не указан",
      "EMBEDDINGS_PROVIDER_NOT_CONFIGURED",
      "embeddings_provider",
    );
  }

  const status = await resolveEmbeddingProviderStatus(providerId, options.workspaceId);
  if (!status) {
    throw new IndexingRulesDomainError(
      "Провайдер эмбеддингов не найден",
      "EMBEDDINGS_PROVIDER_UNKNOWN",
      "embeddings_provider",
      404,
    );
  }

  if (!status.isConfigured) {
    throw new IndexingRulesDomainError(
      status.statusReason ?? "Провайдер эмбеддингов не настроен",
      "EMBEDDINGS_PROVIDER_NOT_CONFIGURED",
      "embeddings_provider",
    );
  }

  const provider = await storage.getEmbeddingProvider(status.id, options.workspaceId);
  if (!provider) {
    throw new IndexingRulesDomainError(
      "Провайдер эмбеддингов не найден",
      "EMBEDDINGS_PROVIDER_UNKNOWN",
      "embeddings_provider",
      404,
    );
  }

  const modelFromRules =
    typeof rules.embeddingsModel === "string" && rules.embeddingsModel.trim().length > 0
      ? rules.embeddingsModel.trim()
      : "";
  const normalizedProvider = modelFromRules ? { ...provider, model: modelFromRules } : provider;

  return { provider: normalizedProvider, rules, status };
}

export const indexingRulesService = new IndexingRulesService();
