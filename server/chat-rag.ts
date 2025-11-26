import type { Request } from "express";
import type { SkillDto } from "@shared/skills";
import { mergeRagSearchSettings } from "@shared/knowledge-base-search";
import { storage } from "./storage";
import { isRagSkill } from "./skill-type";

export type RagPipelineStream = {
  onEvent: (eventName: string, payload?: unknown) => void;
};

export type KnowledgeRagRequestPayload = {
  q: string;
  kb_id: string;
  top_k: number;
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

  const embeddingProviderId =
    sanitizeOptionalString(skill.ragConfig.embeddingProviderId ?? undefined) ??
    sanitizeOptionalString(resolvedRagSettings.embeddingProviderId ?? undefined);
  if (!embeddingProviderId) {
    throw new SkillRagConfigurationError("Для базы знаний не настроен сервис эмбеддингов");
  }

  const llmProviderId =
    sanitizeOptionalString(skill.llmProviderConfigId) ?? sanitizeOptionalString(resolvedRagSettings.llmProviderId);
  if (!llmProviderId) {
    throw new SkillRagConfigurationError("Для навыка не указан LLM-провайдер");
  }

  const llmModel = sanitizeOptionalString(skill.modelId) ?? sanitizeOptionalString(resolvedRagSettings.llmModel);
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

  const vectorCollectionOverride =
    skill.ragConfig.mode === "selected_collections"
      ? skill.ragConfig.collectionIds.map((id) => id.trim()).filter((id) => id.length > 0).join(",")
      : null;

  const vectorCollection =
    (vectorCollectionOverride && vectorCollectionOverride.length > 0 ? vectorCollectionOverride : undefined) ??
    sanitizeOptionalString(resolvedRagSettings.collection ?? undefined) ??
    sanitizeOptionalString(skill.collectionName ?? undefined);

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
