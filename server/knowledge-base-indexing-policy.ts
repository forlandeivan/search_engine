import { eq, sql } from "drizzle-orm";

import { db } from "./db";
import { storage } from "./storage";
import {
  knowledgeBaseIndexingPolicy,
  type KnowledgeBaseIndexingPolicy as StoredKnowledgeBaseIndexingPolicy,
  type EmbeddingProvider,
} from "@shared/schema";
import {
  DEFAULT_KNOWLEDGE_BASE_INDEXING_POLICY,
  MAX_CHUNK_SIZE,
  MIN_CHUNK_SIZE,
  knowledgeBaseIndexingPolicySchema,
  type KnowledgeBaseIndexingPolicyDto,
  type UpdateKnowledgeBaseIndexingPolicyDto,
} from "@shared/knowledge-base-indexing-policy";
import {
  resolveEmbeddingProviderStatus,
  resolveEmbeddingProviderModels,
  type EmbeddingProviderModelsInfo,
  type EmbeddingProviderStatus,
} from "./embedding-provider-registry";

export class KnowledgeBaseIndexingPolicyError extends Error {
  status = 400;
  constructor(message: string) {
    super(message);
    this.name = "KnowledgeBaseIndexingPolicyError";
  }
}

export class KnowledgeBaseIndexingPolicyDomainError extends KnowledgeBaseIndexingPolicyError {
  code: string;
  field?: string;

  constructor(message: string, code: string, field?: string, status = 400) {
    super(message);
    this.name = "KnowledgeBaseIndexingPolicyDomainError";
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

type KnowledgeBaseIndexingPolicyRepository = {
  get(): Promise<StoredKnowledgeBaseIndexingPolicy | null>;
  upsert(values: StoredKnowledgeBaseIndexingPolicy): Promise<StoredKnowledgeBaseIndexingPolicy>;
};

const KNOWLEDGE_BASE_INDEXING_POLICY_SINGLETON_ID = "kb_indexing_policy_singleton";

class DbKnowledgeBaseIndexingPolicyRepository implements KnowledgeBaseIndexingPolicyRepository {
  async get(): Promise<StoredKnowledgeBaseIndexingPolicy | null> {
    const [row] = await db
      .select()
      .from(knowledgeBaseIndexingPolicy)
      .where(eq(knowledgeBaseIndexingPolicy.id, KNOWLEDGE_BASE_INDEXING_POLICY_SINGLETON_ID))
      .limit(1);
    return row ?? null;
  }

  async upsert(values: StoredKnowledgeBaseIndexingPolicy): Promise<StoredKnowledgeBaseIndexingPolicy> {
    const [row] = await db
      .insert(knowledgeBaseIndexingPolicy)
      .values(values)
      .onConflictDoUpdate({
        target: knowledgeBaseIndexingPolicy.id,
        set: {
          embeddingsProvider: values.embeddingsProvider,
          embeddingsModel: values.embeddingsModel,
          chunkSize: values.chunkSize,
          chunkOverlap: values.chunkOverlap,
          defaultSchema: values.defaultSchema,
          updatedByAdminId: values.updatedByAdminId ?? null,
          updatedAt: sql`CURRENT_TIMESTAMP`,
        },
      })
      .returning();

    return row;
  }
}

function mapToDto(row: StoredKnowledgeBaseIndexingPolicy | null): KnowledgeBaseIndexingPolicyDto {
  if (!row) {
    return { ...DEFAULT_KNOWLEDGE_BASE_INDEXING_POLICY };
  }

  return {
    embeddingsProvider: row.embeddingsProvider,
    embeddingsModel: row.embeddingsModel,
    chunkSize: row.chunkSize,
    chunkOverlap: row.chunkOverlap,
    defaultSchema: Array.isArray(row.defaultSchema) ? row.defaultSchema : [],
  };
}

function normalizeString(field: string, value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    throw new KnowledgeBaseIndexingPolicyError(`Поле '${field}' не может быть пустым`);
  }
  if (trimmed.length > 255) {
    throw new KnowledgeBaseIndexingPolicyError(`Поле '${field}' слишком длинное`);
  }

  return trimmed;
}

function normalizeInteger(
  field: string,
  value: number | undefined,
  options: { min?: number; max?: number; gt?: number } = {},
): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!Number.isInteger(value)) {
    throw new KnowledgeBaseIndexingPolicyError(`Поле '${field}' должно быть целым числом`);
  }

  if (options.gt !== undefined && !(value > options.gt)) {
    throw new KnowledgeBaseIndexingPolicyError(`Поле '${field}' должно быть больше ${options.gt}`);
  }

  if (options.min !== undefined && value < options.min) {
    throw new KnowledgeBaseIndexingPolicyError(`Поле '${field}' должно быть не меньше ${options.min}`);
  }

  if (options.max !== undefined && value > options.max) {
    throw new KnowledgeBaseIndexingPolicyError(`Поле '${field}' должно быть не больше ${options.max}`);
  }

  return value;
}

export class KnowledgeBaseIndexingPolicyService {
  constructor(
    private repository: KnowledgeBaseIndexingPolicyRepository,
    private providerResolver: EmbeddingProviderResolver,
    private modelsResolver: EmbeddingProviderModelsResolver,
  ) {}

  async get(): Promise<KnowledgeBaseIndexingPolicyDto> {
    const row = await this.repository.get();
    return mapToDto(row);
  }

  async update(
    update: UpdateKnowledgeBaseIndexingPolicyDto,
    updatedByAdminId: string | null,
    workspaceId?: string,
  ): Promise<KnowledgeBaseIndexingPolicyDto> {
    const current = await this.repository.get();
    const currentDto = mapToDto(current);

    const embeddingsProvider = normalizeString("embeddingsProvider", update.embeddingsProvider) ?? currentDto.embeddingsProvider;
    const embeddingsModel = normalizeString("embeddingsModel", update.embeddingsModel) ?? currentDto.embeddingsModel;
    const chunkSize = normalizeInteger("chunkSize", update.chunkSize, { min: MIN_CHUNK_SIZE, max: MAX_CHUNK_SIZE }) ?? currentDto.chunkSize;
    const chunkOverlap = normalizeInteger("chunkOverlap", update.chunkOverlap, { min: 0, gt: -1 }) ?? currentDto.chunkOverlap;
    const defaultSchema = update.defaultSchema ?? currentDto.defaultSchema;

    if (chunkOverlap >= chunkSize) {
      throw new KnowledgeBaseIndexingPolicyDomainError(
        "Перекрытие чанков должно быть меньше размера чанка",
        "CHUNK_OVERLAP_TOO_LARGE",
        "chunkOverlap",
      );
    }

    // Политика индексации для баз знаний глобальная, проверяем провайдер без workspaceId
    const providerStatus = await this.providerResolver.resolve(embeddingsProvider, undefined);
    if (!providerStatus) {
      throw new KnowledgeBaseIndexingPolicyDomainError(
        `Провайдер '${embeddingsProvider}' не найден`,
        "EMBEDDINGS_PROVIDER_UNKNOWN",
        "embeddingsProvider",
      );
    }
    
    if (!providerStatus.isConfigured) {
      throw new KnowledgeBaseIndexingPolicyDomainError(
        providerStatus.statusReason ?? `Провайдер '${embeddingsProvider}' недоступен`,
        "PROVIDER_UNAVAILABLE",
        "embeddingsProvider",
      );
    }

    const modelsInfo = await this.modelsResolver.resolveModels(embeddingsProvider, undefined);
    if (modelsInfo && modelsInfo.models.length > 0) {
      const modelExists = modelsInfo.models.includes(embeddingsModel);
      if (!modelExists) {
        throw new KnowledgeBaseIndexingPolicyDomainError(
          `Модель '${embeddingsModel}' не найдена у провайдера '${embeddingsProvider}'`,
          "MODEL_NOT_FOUND",
          "embeddingsModel",
        );
      }
    }

    const validated = knowledgeBaseIndexingPolicySchema.parse({
      embeddingsProvider,
      embeddingsModel,
      chunkSize,
      chunkOverlap,
      defaultSchema,
    });

    const stored: StoredKnowledgeBaseIndexingPolicy = {
      id: KNOWLEDGE_BASE_INDEXING_POLICY_SINGLETON_ID,
      embeddingsProvider: validated.embeddingsProvider,
      embeddingsModel: validated.embeddingsModel,
      chunkSize: validated.chunkSize,
      chunkOverlap: validated.chunkOverlap,
      defaultSchema: validated.defaultSchema as unknown as Record<string, unknown>,
      updatedByAdminId: updatedByAdminId ?? null,
      createdAt: current?.createdAt ?? new Date(),
      updatedAt: new Date(),
    };

    await this.repository.upsert(stored);
    return mapToDto(await this.repository.get());
  }
}

export const knowledgeBaseIndexingPolicyService = new KnowledgeBaseIndexingPolicyService(
  new DbKnowledgeBaseIndexingPolicyRepository(),
  {
    resolve: resolveEmbeddingProviderStatus,
  },
  {
    resolveModels: resolveEmbeddingProviderModels,
  },
);

