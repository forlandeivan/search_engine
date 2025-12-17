import type { Request } from "express";
import type { SkillDto } from "@shared/skills";
import { mergeRagSearchSettings } from "@shared/knowledge-base-search";
import { storage } from "./storage";
import { isRagSkill } from "./skill-type";
import { ensureModelAvailable, ModelUnavailableError, ModelValidationError } from "./model-service";

export type RagPipelineStream = {
  onEvent: (eventName: string, payload?: unknown) => void;
};

export type KnowledgeRagRequestPayload = {
  q: string;
  kb_id: string;
  top_k: number;
  collection: string;
  skill_id?: string;
  hybrid: {
    bm25: {
      weight?: number;
      limit?: number;
    };
    vector: {
      weight?: number;
      limit?: number;
      collection?: string;
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
    throw new SkillRagConfigurationError("Пустое сообщение невозможно отправить в RAG-пайплайн");
  }

  const knowledgeBaseId = skill.knowledgeBaseIds?.[0];
  if (!knowledgeBaseId) {
    throw new SkillRagConfigurationError("У навыка не выбран источник (база знаний)");
  }

  const searchSettingsRecord = await storage.getKnowledgeBaseSearchSettings(workspaceId, knowledgeBaseId);
  const resolvedRagSettings = mergeRagSearchSettings(searchSettingsRecord?.ragSettings ?? null, {
    topK: skill.ragConfig.topK,
  });

  const embeddingProviderId = sanitizeOptionalString(skill.ragConfig.embeddingProviderId ?? undefined);
  if (!embeddingProviderId) {
    throw new SkillRagConfigurationError("Для навыка не выбран сервис эмбеддингов. Укажите его в настройках навыка.");
  }

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
    if (error instanceof ModelValidationError || error instanceof ModelUnavailableError) {
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

  const fallbackTopK = resolvedRagSettings.topK ?? 6;
  const topK = ensurePositiveInteger(skill.ragConfig.topK, fallbackTopK, { min: 1, max: 20 });
  const bm25Limit =
    clampInteger(skill.ragConfig.bm25Limit, 1, 50) ??
    clampInteger(resolvedRagSettings.bm25Limit ?? null, 1, 50) ??
    topK;
  const vectorLimit =
    clampInteger(skill.ragConfig.vectorLimit, 1, 50) ??
    clampInteger(resolvedRagSettings.vectorLimit ?? null, 1, 50) ??
    topK;

  const selectedCollections =
    skill.ragConfig.mode === "selected_collections"
      ? skill.ragConfig.collectionIds
          .map((id) => (typeof id === "string" ? id.trim() : ""))
          .filter((id) => id.length > 0)
      : [];

  if (skill.ragConfig.mode === "selected_collections" && selectedCollections.length === 0) {
    throw new SkillRagConfigurationError("В режиме ручного выбора коллекций укажите хотя бы одну коллекцию.");
  }

  let vectorCollectionOverride: string | null = selectedCollections[0] ?? null;

  const fallbackCollectionFromSettings = sanitizeOptionalString(resolvedRagSettings.collection ?? undefined);
  const fallbackCollectionFromSkill = sanitizeOptionalString(skill.collectionName ?? undefined);

  const vectorCollection =
    (vectorCollectionOverride && vectorCollectionOverride.length > 0 ? vectorCollectionOverride : undefined) ??
    fallbackCollectionFromSettings ??
    fallbackCollectionFromSkill;

  if (!vectorCollection) {
    throw new SkillRagConfigurationError(
      "Не удалось определить коллекцию для RAG. Настройте коллекцию в базе знаний или в конфиге навыка.",
    );
  }


  const bm25Weight =
    clampFraction(skill.ragConfig.bm25Weight) ??
    sanitizeOptionalNumber(resolvedRagSettings.bm25Weight ?? undefined) ??
    0.5;

  const vectorWeight =
    clampFraction(skill.ragConfig.vectorWeight) ??
    sanitizeOptionalNumber(resolvedRagSettings.vectorWeight ?? undefined) ??
    (vectorCollection ? 0.5 : 0);

  const request: KnowledgeRagRequestPayload = {
    q: trimmedMessage,
    kb_id: knowledgeBaseId,
    top_k: topK,
    collection: vectorCollection,
    skill_id: skill.id,
    hybrid: {
      bm25: {
        weight: bm25Weight,
        limit: bm25Limit,
      },
      vector: {
        weight: vectorWeight,
        limit: vectorLimit,
        collection: vectorCollection,
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

  return options.runPipeline({
    req: options.req,
    body,
    stream: options.stream ?? null,
  });
}
