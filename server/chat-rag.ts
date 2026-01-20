import type { Request } from "express";
import type { SkillDto } from "@shared/skills";
import { mergeRagSearchSettings } from "@shared/knowledge-base-search";
import { storage } from "./storage";
import { isRagSkill } from "./skill-type";
import { ensureModelAvailable, ModelInactiveError, ModelUnavailableError, ModelValidationError } from "./model-service";
import { indexingRulesService } from "./indexing-rules";

export type RagPipelineStream = {
  onEvent: (eventName: string, payload?: unknown) => void;
};

export type KnowledgeRagRequestPayload = {
  q: string;
  kb_id: string; // Оставляем для обратной совместимости, но может быть устаревшим
  kb_ids?: string[]; // Новое поле для списка БЗ
  top_k: number;
  collection: string; // Оставляем для обратной совместимости
  collections?: string[]; // Новое поле для списка коллекций
  skill_id?: string;
  workspace_id?: string; // Для получения настроек навыка в pipeline
  hybrid: {
    bm25: {
      weight?: number;
      limit?: number;
    };
    vector: {
      weight?: number;
      limit?: number;
      collection?: string; // Оставляем для обратной совместимости
      collections?: string[]; // Новое поле для списка коллекций
      embedding_provider_id?: string;
    };
  };
  llm: {
    provider: string;
    model?: string;
    temperature?: number;
    max_tokens?: number;
    system_prompt?: string;
    response_format?: string;
  };
  stream?: boolean;
};

export type RunKnowledgeBaseRagPipeline = (options: {
  req: Request;
  body: KnowledgeRagRequestPayload;
  stream?: RagPipelineStream | null;
}) => Promise<unknown>;

export class SkillRagConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SkillRagConfigurationError";
  }
}

const clampFraction = (value: number | null | undefined): number | null => {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return null;
  }
  if (value < 0 || value > 1) {
    return null;
  }
  return Number(value.toFixed(4));
};

const clampInteger = (value: number | null | undefined, min: number, max: number): number | null => {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    return null;
  }
  if (value < min || value > max) {
    return null;
  }
  return value;
};

const clampTemperature = (value: number | null | undefined): number | null => {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return null;
  }
  if (value < 0 || value > 2) {
    return null;
  }
  return Number(value.toFixed(3));
};

const ensurePositiveInteger = (value: number | null | undefined, fallback: number, limits: { min: number; max: number }) => {
  if (typeof value === "number" && Number.isFinite(value)) {
    const rounded = Math.floor(value);
    if (rounded >= limits.min && rounded <= limits.max) {
      return rounded;
    }
  }
  return Math.min(Math.max(fallback, limits.min), limits.max);
};

const sanitizeOptionalNumber = (value: number | null | undefined): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const sanitizeOptionalString = (value: string | null | undefined): string | undefined =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;

export async function buildSkillRagRequestPayload(options: {
  skill: SkillDto;
  workspaceId: string;
  userMessage: string;
  stream?: boolean;
}): Promise<KnowledgeRagRequestPayload> {
  const { skill, workspaceId } = options;
  
  if (!isRagSkill(skill)) {
    throw new SkillRagConfigurationError("Навык не поддерживает RAG-пайплайн");
  }

  const trimmedMessage = options.userMessage.trim();
  if (!trimmedMessage) {
    console.error(`[RAG BUILD PAYLOAD] ERROR: empty message`);
    throw new SkillRagConfigurationError("Пустое сообщение невозможно отправить в RAG-пайплайн");
  }

  const knowledgeBaseIds = skill.knowledgeBaseIds ?? [];
  if (knowledgeBaseIds.length === 0) {
    throw new SkillRagConfigurationError("У навыка не выбран источник (база знаний)");
  }

  // Получаем настройки поиска для первой БЗ (используем для общих настроек)
  const firstKnowledgeBaseId = knowledgeBaseIds[0];
  const searchSettingsRecord = await storage.getKnowledgeBaseSearchSettings(workspaceId, firstKnowledgeBaseId);
  const indexingRules = await indexingRulesService.getIndexingRules();
  
  const resolvedRagSettings = mergeRagSearchSettings(searchSettingsRecord?.ragSettings ?? null, {
    topK: indexingRules.topK,
  });

  // Используем провайдер эмбеддингов из правил индексации (БЗ индексируются с этим провайдером)
  const embeddingProviderId = indexingRules.embeddingsProvider;
  if (!embeddingProviderId || embeddingProviderId.trim().length === 0) {
    console.error(`[RAG BUILD PAYLOAD] ERROR: embedding provider not configured in indexing rules`);
    throw new SkillRagConfigurationError("Сервис эмбеддингов не настроен в правилах индексации. Настройте его в админ-панели.");
  }
  
  console.log(`[RAG BUILD PAYLOAD] embeddingProviderId=${embeddingProviderId}, knowledgeBaseIds=[${knowledgeBaseIds.join(", ")}]`);

  const llmProviderId = sanitizeOptionalString(skill.llmProviderConfigId);
  if (!llmProviderId) {
    throw new SkillRagConfigurationError("Для навыка не указан LLM-провайдер");
  }

  const llmModelInput = sanitizeOptionalString(skill.modelId);
  if (!llmModelInput) {
    throw new SkillRagConfigurationError("Для навыка не выбрана модель LLM");
  }

  let llmModel: string;
  try {
    const model = await ensureModelAvailable(llmModelInput, { expectedType: "LLM" });
    llmModel = model.modelKey;
  } catch (error) {
    if (error instanceof ModelValidationError || error instanceof ModelUnavailableError || error instanceof ModelInactiveError) {
      throw new SkillRagConfigurationError(error.message);
    }
    throw error;
  }

  const systemPrompt = sanitizeOptionalString(skill.systemPrompt) ?? undefined;
  const responseFormat = skill.ragConfig.llmResponseFormat ?? resolvedRagSettings.responseFormat ?? undefined;
  const temperature =
    clampTemperature(skill.ragConfig.llmTemperature) ??
    clampTemperature(resolvedRagSettings.temperature ?? undefined) ??
    undefined;
  const maxTokens =
    clampInteger(skill.ragConfig.llmMaxTokens, 16, 4096) ??
    clampInteger(resolvedRagSettings.maxTokens ?? null, 16, 4096) ??
    undefined;

  const fallbackTopK = resolvedRagSettings.topK ?? indexingRules.topK;
  const topK = ensurePositiveInteger(null, fallbackTopK, { min: 1, max: 20 });
  const bm25Limit =
    clampInteger(skill.ragConfig.bm25Limit, 1, 50) ??
    clampInteger(resolvedRagSettings.bm25Limit ?? null, 1, 50) ??
    topK;
  const vectorLimit =
    clampInteger(skill.ragConfig.vectorLimit, 1, 50) ??
    clampInteger(resolvedRagSettings.vectorLimit ?? null, 1, 50) ??
    topK;

  // Определяем коллекции автоматически из баз знаний
  // Коллекция для БЗ формируется как: kb_{baseId}_ws_{workspaceId}
  const sanitizeCollectionName = (source: string): string => {
    const normalized = source.replace(/[^a-zA-Z0-9_-]/g, "").toLowerCase();
    return normalized.length > 0 ? normalized.slice(0, 60) : "default";
  };

  const workspaceSlug = sanitizeCollectionName(workspaceId);
  const vectorCollections = knowledgeBaseIds.map((kbId) => {
    const baseSlug = sanitizeCollectionName(kbId);
    return `kb_${baseSlug}_ws_${workspaceSlug}`;
  });
  
  // Для обратной совместимости оставляем первую коллекцию
  const vectorCollection = vectorCollections[0];


  // Если используется только векторный поиск (есть vectorCollection), то по умолчанию bm25Weight=0, vectorWeight=1.0
  // Иначе (если нет векторной коллекции), то используется только BM25: bm25Weight=1.0, vectorWeight=0
  const defaultBm25Weight = vectorCollection ? 0 : 1.0;
  const defaultVectorWeight = vectorCollection ? 1.0 : 0;

  const bm25Weight =
    clampFraction(skill.ragConfig.bm25Weight) ??
    sanitizeOptionalNumber(resolvedRagSettings.bm25Weight ?? undefined) ??
    defaultBm25Weight;

  const vectorWeight =
    clampFraction(skill.ragConfig.vectorWeight) ??
    sanitizeOptionalNumber(resolvedRagSettings.vectorWeight ?? undefined) ??
    defaultVectorWeight;

  const request: KnowledgeRagRequestPayload = {
    q: trimmedMessage,
    kb_id: firstKnowledgeBaseId, // Для обратной совместимости
    kb_ids: knowledgeBaseIds, // Новое поле для списка БЗ
    top_k: topK,
    collection: vectorCollection, // Для обратной совместимости
    collections: vectorCollections, // Новое поле для списка коллекций
    skill_id: skill.id,
    workspace_id: workspaceId, // Передаём для получения настроек навыка
    hybrid: {
      bm25: {
        weight: bm25Weight,
        limit: bm25Limit,
      },
      vector: {
        weight: vectorWeight,
        limit: vectorLimit,
        collection: vectorCollection, // Для обратной совместимости
        collections: vectorCollections, // Новое поле для списка коллекций
        embedding_provider_id: embeddingProviderId,
      },
    },
    llm: {
      provider: llmProviderId,
      model: llmModel,
      temperature,
      max_tokens: maxTokens,
      system_prompt: systemPrompt,
      response_format: responseFormat,
    },
  };

  if (options.stream !== undefined) {
    request.stream = options.stream;
  }

  return request;
}

export async function callRagForSkillChat(options: {
  req: Request;
  skill: SkillDto;
  workspaceId: string;
  userMessage: string;
  runPipeline: RunKnowledgeBaseRagPipeline;
  stream?: RagPipelineStream | null;
}): Promise<unknown> {
  const body = await buildSkillRagRequestPayload({
    skill: options.skill,
    workspaceId: options.workspaceId,
    userMessage: options.userMessage,
    stream: options.stream ? true : undefined,
  });
  
  return await options.runPipeline({
    req: options.req,
    body,
    stream: options.stream ?? null,
  });
}
