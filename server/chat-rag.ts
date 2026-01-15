import type { Request } from "express";
import type { SkillDto } from "@shared/skills";
import { mergeRagSearchSettings } from "@shared/knowledge-base-search";
import { storage } from "./storage";
import { isRagSkill } from "./skill-type";
import { ensureModelAvailable, ModelInactiveError, ModelUnavailableError, ModelValidationError } from "./model-service";
import { indexingRulesService } from "./indexing-rules";
import fs from "fs";
import path from "path";

function logToDevLog(message: string): void {
  try {
    const logFile = path.resolve(import.meta.dirname, "..", "dev.log");
    const timestamp = new Date().toISOString();
    const logLine = `[${timestamp}] ${message}\n`;
    fs.appendFileSync(logFile, logLine, "utf-8");
  } catch {
    // Игнорируем ошибки записи в лог
  }
}

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
  logToDevLog(`[RAG BUILD PAYLOAD] START: skillId=${skill.id}, workspaceId=${workspaceId}, messageLength=${options.userMessage.length}`);
  logToDevLog(`[RAG BUILD PAYLOAD] skill.mode=${skill.mode}, isRagSkill=${isRagSkill(skill)}`);
  logToDevLog(`[RAG BUILD PAYLOAD] skill.knowledgeBaseIds=${JSON.stringify(skill.knowledgeBaseIds)}`);
  console.log(`[RAG BUILD PAYLOAD] START: skillId=${skill.id}, workspaceId=${workspaceId}, messageLength=${options.userMessage.length}`);
  console.log(`[RAG BUILD PAYLOAD] skill.mode=${skill.mode}, isRagSkill=${isRagSkill(skill)}`);
  console.log(`[RAG BUILD PAYLOAD] skill.knowledgeBaseIds=${JSON.stringify(skill.knowledgeBaseIds)}`);
  
  if (!isRagSkill(skill)) {
    logToDevLog(`[RAG BUILD PAYLOAD] ERROR: skill is not RAG skill (mode=${skill.mode})`);
    console.error(`[RAG BUILD PAYLOAD] ERROR: skill is not RAG skill (mode=${skill.mode})`);
    throw new SkillRagConfigurationError("Навык не поддерживает RAG-пайплайн");
  }

  const trimmedMessage = options.userMessage.trim();
  if (!trimmedMessage) {
    console.error(`[RAG BUILD PAYLOAD] ERROR: empty message`);
    throw new SkillRagConfigurationError("Пустое сообщение невозможно отправить в RAG-пайплайн");
  }

  const knowledgeBaseId = skill.knowledgeBaseIds?.[0];
  if (!knowledgeBaseId) {
    console.error(`[RAG BUILD PAYLOAD] ERROR: no knowledge base selected`);
    throw new SkillRagConfigurationError("У навыка не выбран источник (база знаний)");
  }
  
  logToDevLog(`[RAG BUILD PAYLOAD] knowledgeBaseId=${knowledgeBaseId}`);
  console.log(`[RAG BUILD PAYLOAD] knowledgeBaseId=${knowledgeBaseId}`);

  const searchSettingsRecord = await storage.getKnowledgeBaseSearchSettings(workspaceId, knowledgeBaseId);
  const indexingRules = await indexingRulesService.getIndexingRules();
  logToDevLog(`[RAG BUILD PAYLOAD] indexingRules.topK=${indexingRules.topK}, embeddingsProvider=${indexingRules.embeddingsProvider}`);
  logToDevLog(`[RAG BUILD PAYLOAD] searchSettingsRecord=${searchSettingsRecord ? 'found' : 'not found'}`);
  console.log(`[RAG BUILD PAYLOAD] indexingRules.topK=${indexingRules.topK}, embeddingsProvider=${indexingRules.embeddingsProvider}`);
  console.log(`[RAG BUILD PAYLOAD] searchSettingsRecord=${searchSettingsRecord ? 'found' : 'not found'}`);
  
  const resolvedRagSettings = mergeRagSearchSettings(searchSettingsRecord?.ragSettings ?? null, {
    topK: indexingRules.topK,
  });

  // Используем провайдер эмбеддингов из правил индексации (БЗ индексируются с этим провайдером)
  const embeddingProviderId = indexingRules.embeddingsProvider;
  if (!embeddingProviderId || embeddingProviderId.trim().length === 0) {
    console.error(`[RAG BUILD PAYLOAD] ERROR: embedding provider not configured in indexing rules`);
    throw new SkillRagConfigurationError("Сервис эмбеддингов не настроен в правилах индексации. Настройте его в админ-панели.");
  }
  
  console.log(`[RAG BUILD PAYLOAD] embeddingProviderId=${embeddingProviderId}`);

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

  // Определяем коллекцию автоматически из базы знаний
  // Коллекция для БЗ формируется как: kb_{baseId}_ws_{workspaceId}
  const sanitizeCollectionName = (source: string): string => {
    const normalized = source.replace(/[^a-zA-Z0-9_-]/g, "").toLowerCase();
    return normalized.length > 0 ? normalized.slice(0, 60) : "default";
  };

  const baseSlug = sanitizeCollectionName(knowledgeBaseId);
  const workspaceSlug = sanitizeCollectionName(workspaceId);
  const vectorCollection = `kb_${baseSlug}_ws_${workspaceSlug}`;
  logToDevLog(`[RAG BUILD PAYLOAD] vectorCollection=${vectorCollection} (baseSlug=${baseSlug}, workspaceSlug=${workspaceSlug})`);
  console.log(`[RAG BUILD PAYLOAD] vectorCollection=${vectorCollection} (baseSlug=${baseSlug}, workspaceSlug=${workspaceSlug})`);


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

  logToDevLog(`[RAG BUILD PAYLOAD] SUCCESS: request prepared`);
  logToDevLog(`[RAG BUILD PAYLOAD] request.q=${request.q.slice(0, 50)}...`);
  logToDevLog(`[RAG BUILD PAYLOAD] request.kb_id=${request.kb_id}`);
  logToDevLog(`[RAG BUILD PAYLOAD] request.collection=${request.collection}`);
  logToDevLog(`[RAG BUILD PAYLOAD] request.top_k=${request.top_k}`);
  logToDevLog(`[RAG BUILD PAYLOAD] request.hybrid.vector.collection=${request.hybrid.vector.collection}`);
  logToDevLog(`[RAG BUILD PAYLOAD] request.hybrid.vector.embedding_provider_id=${request.hybrid.vector.embedding_provider_id}`);
  console.log(`[RAG BUILD PAYLOAD] SUCCESS: request prepared`);
  console.log(`[RAG BUILD PAYLOAD] request.q=${request.q.slice(0, 50)}...`);
  console.log(`[RAG BUILD PAYLOAD] request.kb_id=${request.kb_id}`);
  console.log(`[RAG BUILD PAYLOAD] request.collection=${request.collection}`);
  console.log(`[RAG BUILD PAYLOAD] request.top_k=${request.top_k}`);
  console.log(`[RAG BUILD PAYLOAD] request.hybrid.vector.collection=${request.hybrid.vector.collection}`);
  console.log(`[RAG BUILD PAYLOAD] request.hybrid.vector.embedding_provider_id=${request.hybrid.vector.embedding_provider_id}`);

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
  logToDevLog(`[RAG CALL PIPELINE] START: skillId=${options.skill.id}, workspaceId=${options.workspaceId}, messageLength=${options.userMessage.length}`);
  console.log(`[RAG CALL PIPELINE] START: skillId=${options.skill.id}, workspaceId=${options.workspaceId}, messageLength=${options.userMessage.length}`);
  
  const body = await buildSkillRagRequestPayload({
    skill: options.skill,
    workspaceId: options.workspaceId,
    userMessage: options.userMessage,
    stream: options.stream ? true : undefined,
  });

  logToDevLog(`[RAG CALL PIPELINE] payload built, calling runPipeline with collection=${body.collection}`);
  console.log(`[RAG CALL PIPELINE] payload built, calling runPipeline with collection=${body.collection}`);
  
  try {
    const result = await options.runPipeline({
      req: options.req,
      body,
      stream: options.stream ?? null,
    });
    logToDevLog(`[RAG CALL PIPELINE] SUCCESS: result received, answerLength=${result?.response?.answer?.length ?? 0}`);
    console.log(`[RAG CALL PIPELINE] SUCCESS: result received, answerLength=${result?.response?.answer?.length ?? 0}`);
    return result;
  } catch (error) {
    logToDevLog(`[RAG CALL PIPELINE] ERROR: ${error instanceof Error ? error.message : String(error)}`);
    logToDevLog(`[RAG CALL PIPELINE] ERROR stack: ${error instanceof Error ? error.stack : 'no stack'}`);
    console.error(`[RAG CALL PIPELINE] ERROR: ${error instanceof Error ? error.message : String(error)}`);
    console.error(`[RAG CALL PIPELINE] ERROR stack: ${error instanceof Error ? error.stack : 'no stack'}`);
    throw error;
  }
}
