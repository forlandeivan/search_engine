import type { KnowledgeBaseIndexingJob, Workspace, EmbeddingProvider, IndexingStage } from "@shared/schema";
import { storage } from "./storage";
import { buildWorkspaceScopedCollectionName } from "./qdrant-utils";
import { knowledgeBaseIndexingPolicyService } from "./knowledge-base-indexing-policy";
import { createKnowledgeDocumentChunkSet, updateKnowledgeDocumentChunkVectorRecords } from "./knowledge-chunks";
import { getKnowledgeBaseById, getKnowledgeNodeDetail } from "./knowledge-base";
import { resolveEmbeddingProviderStatus, resolveEmbeddingProviderModels } from "./embedding-provider-registry";
import { getQdrantClient } from "./qdrant";
import { ensureCollectionCreatedIfNeeded } from "./qdrant-collections";
import type { CollectionSchemaFieldInput } from "@shared/vectorization";
import { renderLiquidTemplate, castValueToType, normalizeArrayValue } from "@shared/vectorization";
import { ExpressionInterpreter } from "./services/expression-interpreter";
import { buildVectorPayload } from "./qdrant-utils";
import type { Schemas } from "@qdrant/js-client-rest";
import { fetchAccessToken } from "./llm-access-token";
import { knowledgeBaseIndexingActionsService } from "./knowledge-base-indexing-actions";
import { knowledgeBaseIndexingStateService } from "./knowledge-base-indexing-state";
import { log } from "./vite";
import fs from "fs";
import path from "path";
import { db, pool } from "./db";
import { knowledgeDocuments, knowledgeNodes } from "@shared/schema";
import { eq, and, sql } from "drizzle-orm";
import { applyTlsPreferences, type NodeFetchOptions } from "./http-utils";
import fetch, { Headers } from "node-fetch";

function buildKnowledgeCollectionName(
  base: { id?: string | null; name?: string | null } | null | undefined,
  provider: EmbeddingProvider,
  workspaceId: string,
): string {
  const baseId = base?.id;
  if (!baseId) {
    throw new Error("База знаний должна иметь ID для создания коллекции");
  }
  const baseSlug = baseId.replace(/[^a-zA-Z0-9_-]/g, "").toLowerCase().slice(0, 60) || "default";
  const workspaceSlug = workspaceId.replace(/[^a-zA-Z0-9_-]/g, "").toLowerCase().slice(0, 60) || "default";
  return `kb_${baseSlug}_ws_${workspaceSlug}`;
}

function removeUndefinedDeep<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => removeUndefinedDeep(item)) as unknown as T;
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, current]) => current !== undefined)
      .map(([key, current]) => [key, removeUndefinedDeep(current)]);
    return Object.fromEntries(entries) as unknown as T;
  }

  return value;
}

async function buildCustomPayloadFromSchema(
  fields: CollectionSchemaFieldInput[],
  context: Record<string, unknown>,
  workspaceId: string,
): Promise<Record<string, unknown>> {
  const result: Record<string, unknown> = {};
  
  // Проверяем, есть ли LLM токены в шаблонах
  const hasLlmTokens = fields.some((field) => {
    const template = field.template ?? "";
    return template.includes("{{LLM:") || template.includes("LLM:");
  });

  // Если есть LLM токены, используем ExpressionInterpreter
  if (hasLlmTokens) {
    const interpreter = new ExpressionInterpreter(workspaceId);
    
    for (const field of fields) {
      try {
        const template = field.template ?? "";
        
        // Парсим шаблон в expression
        const expression = parseTemplateToExpressionFromString(template);
        
        if (expression.length > 0) {
          // Вычисляем выражение через interpreter
          const evaluationResult = await interpreter.evaluate(expression, context);
          const rendered = evaluationResult.success ? evaluationResult.value : "";
          const typedValue = castValueToType(rendered, field.type);
          result[field.name] = normalizeArrayValue(typedValue, field.isArray);
        } else {
          result[field.name] = null;
        }
      } catch (error) {
        workerLog(`Не удалось обработать поле схемы "${field.name}": ${error instanceof Error ? error.message : String(error)}`);
        result[field.name] = null;
      }
    }
  } else {
    // Если нет LLM токенов, используем простой renderLiquidTemplate
    for (const field of fields) {
      try {
        const rendered = renderLiquidTemplate(field.template ?? "", context);
        const typedValue = castValueToType(rendered, field.type);
        result[field.name] = normalizeArrayValue(typedValue, field.isArray);
      } catch (error) {
        workerLog(`Не удалось обработать поле схемы "${field.name}": ${error instanceof Error ? error.message : String(error)}`);
        result[field.name] = null;
      }
    }
  }
  
  return result;
}

/**
 * Парсит строковый шаблон в MappingExpression (упрощённая версия для сервера)
 */
function parseTemplateToExpressionFromString(template: string): import("@shared/json-import").MappingExpression {
  if (!template || template.trim().length === 0) {
    return [];
  }

  const { createFieldToken, createTextToken, createFunctionToken, createLlmToken } = require("@shared/json-import");
  const tokens: import("@shared/json-import").ExpressionToken[] = [];
  
  // Regex для парсинга {{field}}, {{FUNC(...)}}, {{LLM:...}} и текста
  const regex = /\{\{([^}]+)\}\}|([^{]+)/g;
  let match;
  let lastIndex = 0;

  while ((match = regex.exec(template)) !== null) {
    // Если есть текст перед макросом
    if (match.index > lastIndex) {
      const textBefore = template.slice(lastIndex, match.index);
      if (textBefore) {
        const unescaped = textBefore.replace(/\\\{/g, "{").replace(/\\\}/g, "}");
        tokens.push(createTextToken(unescaped));
      }
    }

    if (match[1]) {
      // Это макрос {{...}}
      const content = match[1].trim();
      
      // Проверяем LLM токен
      if (content.startsWith("LLM:")) {
        try {
          const configStr = content.slice(4);
          const config = JSON.parse(configStr);
          tokens.push(createLlmToken(config, "LLM"));
        } catch {
          // Если не удалось распарсить, игнорируем
        }
      }
      // Проверяем функцию
      else {
        const functionMatch = parseFunctionCall(content);
        if (functionMatch) {
          tokens.push(createFunctionToken(functionMatch.name, functionMatch.args));
        } else {
          tokens.push(createFieldToken(content));
        }
      }
    } else if (match[2]) {
      const unescaped = match[2].replace(/\\\{/g, "{").replace(/\\\}/g, "}");
      tokens.push(createTextToken(unescaped));
    }

    lastIndex = regex.lastIndex;
  }

  // Добавляем оставшийся текст
  if (lastIndex < template.length) {
    const remainingText = template.slice(lastIndex);
    if (remainingText) {
      const unescaped = remainingText.replace(/\\\{/g, "{").replace(/\\\}/g, "}");
      tokens.push(createTextToken(unescaped));
    }
  }

  return tokens.length > 0 ? tokens : [];
}

/**
 * Парсит вызов функции с поддержкой вложенных макросов
 */
function parseFunctionCall(content: string): { name: string; args: string[] } | null {
  const funcMatch = content.match(/^(\w+)\s*\(/);
  if (!funcMatch) {
    return null;
  }

  const funcName = funcMatch[1];
  const argsStart = funcMatch[0].length;
  
  // Находим закрывающую скобку
  let depth = 1;
  let i = argsStart;
  let inString = false;
  let stringChar: string | null = null;
  
  while (i < content.length && depth > 0) {
    const char = content[i];
    
    if (!inString && (char === '"' || char === "'")) {
      inString = true;
      stringChar = char;
    } else if (inString && char === stringChar) {
      inString = false;
      stringChar = null;
    } else if (!inString) {
      if (char === "(") {
        depth++;
      } else if (char === ")") {
        depth--;
      }
    }
    
    i++;
  }
  
  if (depth !== 0) {
    return null;
  }
  
  const argsStr = content.slice(argsStart, i - 1);
  const args = parseFunctionArgs(argsStr);
  
  return { name: funcName, args };
}

/**
 * Парсит аргументы функции
 */
function parseFunctionArgs(argsStr: string): string[] {
  if (!argsStr.trim()) {
    return [];
  }
  
  const args: string[] = [];
  let currentArg = "";
  let depth = 0;
  let inString = false;
  let stringChar: string | null = null;
  let inMacro = false;
  let macroDepth = 0;
  
  for (let i = 0; i < argsStr.length; i++) {
    const char = argsStr[i];
    const nextChar = argsStr[i + 1];
    
    if (!inString && !inMacro && (char === '"' || char === "'")) {
      inString = true;
      stringChar = char;
      currentArg += char;
    } else if (inString && char === stringChar) {
      inString = false;
      stringChar = null;
      currentArg += char;
    } else if (!inString && char === "{" && nextChar === "{") {
      inMacro = true;
      macroDepth = 1;
      currentArg += char + nextChar;
      i++;
    } else if (inMacro && char === "}") {
      if (nextChar === "}") {
        macroDepth--;
        currentArg += char + nextChar;
        i++;
        if (macroDepth === 0) {
          inMacro = false;
        }
      } else {
        currentArg += char;
      }
    } else if (!inString && !inMacro && char === "(") {
      depth++;
      currentArg += char;
    } else if (!inString && !inMacro && char === ")") {
      depth--;
      currentArg += char;
    } else if (!inString && !inMacro && depth === 0 && char === ",") {
      args.push(currentArg.trim());
      currentArg = "";
    } else {
      currentArg += char;
    }
  }
  
  if (currentArg.trim()) {
    args.push(currentArg.trim());
  }
  
  return args;
}

// Создаёт тело запроса для Unica AI провайдера эмбеддингов
function createUnicaEmbeddingRequestBody(
  model: string,
  input: string | string[],
  options?: {
    workSpaceId?: string;
    truncate?: boolean;
    dimensions?: number;
  },
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    workSpaceId: options?.workSpaceId ?? "GENERAL",
    model,
    input: Array.isArray(input) ? input : [input],
  };

  if (options?.truncate !== undefined) {
    body.truncate = options.truncate;
  }

  if (options?.dimensions !== undefined && options.dimensions > 0) {
    body.dimensions = options.dimensions;
  }

  return body;
}

// Создаёт тело запроса для стандартного (OpenAI-совместимого) провайдера эмбеддингов
function createStandardEmbeddingRequestBody(
  model: string,
  input: string,
): Record<string, unknown> {
  return {
    model,
    input,
  };
}

// Извлекает вектор из ответа Unica AI провайдера
function extractUnicaEmbeddingVector(data: Record<string, unknown>): number[] | undefined {
  const vectors = data.vectors;
  if (Array.isArray(vectors) && vectors.length > 0) {
    const firstVector = vectors[0];
    if (Array.isArray(firstVector) && firstVector.every((v) => typeof v === "number")) {
      return firstVector as number[];
    }
  }
  return undefined;
}

// Извлекает вектор из ответа стандартного (OpenAI-совместимого) провайдера
function extractStandardEmbeddingVector(data: Record<string, unknown>): number[] | undefined {
  // Формат OpenAI: { data: [{ embedding: [...] }] }
  const dataArray = data.data;
  if (Array.isArray(dataArray) && dataArray.length > 0) {
    const firstEntry = dataArray[0] as Record<string, unknown> | undefined;
    const embedding = firstEntry?.embedding ?? firstEntry?.vector;
    if (Array.isArray(embedding) && embedding.every((v) => typeof v === "number")) {
      return embedding as number[];
    }
  }
  // Альтернативный формат: { embedding: [...] }
  const embedding = data.embedding;
  if (Array.isArray(embedding) && embedding.every((v) => typeof v === "number")) {
    return embedding as number[];
  }
  return undefined;
}

async function fetchEmbeddingVectorForChunk(
  provider: EmbeddingProvider,
  accessToken: string,
  text: string,
): Promise<{ vector: number[]; usageTokens?: number; embeddingId?: string | number }> {
  // Проверка входных данных
  if (!text || text.trim().length === 0) {
    throw new Error(`Пустой текст для эмбеддинга (длина: ${text?.length ?? 0}, после trim: ${text?.trim()?.length ?? 0})`);
  }

  const textLength = text.length;
  const textPreview = text.substring(0, 100).replace(/\n/g, '\\n');
  const isUnicaProvider = provider.providerType === "unica";
  
  workerLog(`fetchEmbeddingVectorForChunk: providerType=${provider.providerType}, model=${provider.model}, textLength=${textLength}, textPreview="${textPreview}..."`);

  const headers = new Headers();
  headers.set("Content-Type", "application/json");
  headers.set("Authorization", `Bearer ${accessToken}`);
  
  for (const [key, value] of Object.entries(provider.requestHeaders ?? {})) {
    headers.set(key, value);
  }

  const allowSelfSigned = provider.allowSelfSignedCertificate ?? false;
  workerLog(`fetchEmbeddingVectorForChunk: provider.allowSelfSignedCertificate=${provider.allowSelfSignedCertificate}, allowSelfSigned=${allowSelfSigned}, url=${provider.embeddingsUrl}`);
  
  // Формируем тело запроса в зависимости от типа провайдера
  const requestBody = isUnicaProvider
    ? createUnicaEmbeddingRequestBody(provider.model, text, {
        workSpaceId: provider.unicaWorkspaceId ?? (provider.requestConfig?.additionalBodyFields?.workSpaceId as string) ?? "GENERAL",
        truncate: provider.requestConfig?.additionalBodyFields?.truncate as boolean | undefined,
        dimensions: provider.requestConfig?.additionalBodyFields?.dimensions as number | undefined,
      })
    : createStandardEmbeddingRequestBody(provider.model, text);
  
  workerLog(`fetchEmbeddingVectorForChunk: requestBody=${JSON.stringify(requestBody).substring(0, 200)}...`);
  
  const requestOptions = applyTlsPreferences<NodeFetchOptions>(
    {
      method: "POST",
      headers,
      body: JSON.stringify(requestBody),
    },
    allowSelfSigned,
  );

  workerLog(`fetchEmbeddingVectorForChunk: requestOptions.agent=${requestOptions.agent ? 'present' : 'absent'}`);
  const response = await fetch(provider.embeddingsUrl, requestOptions);

  if (!response.ok) {
    const errorText = await response.text().catch(() => response.statusText);
    
    // Детальное логирование ошибки
    workerLog(`Embedding API error: status=${response.status}, statusText=${response.statusText}`);
    workerLog(`Embedding API error response body: ${errorText}`);
    workerLog(`Embedding API error request details: providerType=${provider.providerType}, model=${provider.model}, textLength=${textLength}, url=${provider.embeddingsUrl}`);
    workerLog(`Embedding API error request body: ${JSON.stringify(requestBody).substring(0, 500)}`);
    
    // Формируем понятное сообщение об ошибке
    let errorDetails = "";
    try {
      const errorJson = JSON.parse(errorText);
      if (errorJson.error?.message) {
        errorDetails = errorJson.error.message;
      } else if (errorJson.message) {
        errorDetails = errorJson.message;
      } else if (errorJson.detail) {
        errorDetails = typeof errorJson.detail === 'string' ? errorJson.detail : JSON.stringify(errorJson.detail);
      } else {
        errorDetails = errorText;
      }
    } catch {
      errorDetails = errorText || response.statusText;
    }
    
    // Добавляем контекст для отладки
    const contextInfo = `[провайдер: ${provider.providerType}, модель: ${provider.model}, длина текста: ${textLength} символов, URL: ${provider.embeddingsUrl}]`;
    
    throw new Error(`Ошибка API эмбеддингов (${response.status}): ${errorDetails} ${contextInfo}`);
  }

  const data = (await response.json()) as Record<string, unknown>;
  
  // Извлекаем вектор в зависимости от типа провайдера
  const vector = isUnicaProvider
    ? extractUnicaEmbeddingVector(data)
    : extractStandardEmbeddingVector(data);
    
  if (!Array.isArray(vector) || vector.length === 0) {
    const responsePreview = JSON.stringify(data).substring(0, 300);
    workerLog(`Invalid embedding response format: providerType=${provider.providerType}, responsePreview=${responsePreview}`);
    throw new Error(`Некорректный формат ответа от API эмбеддингов (провайдер: ${provider.providerType}). Ответ: ${responsePreview}...`);
  }

  // Извлекаем usage tokens
  let usageTokens: number | undefined;
  const usage = data.usage as Record<string, unknown> | undefined;
  if (usage?.total_tokens !== undefined && typeof usage.total_tokens === "number") {
    usageTokens = usage.total_tokens;
  } else if (isUnicaProvider) {
    // Для Unica токены могут быть в meta.metrics.inputTokens
    const meta = data.meta as Record<string, unknown> | undefined;
    const metrics = meta?.metrics as Record<string, unknown> | undefined;
    if (metrics?.inputTokens !== undefined && typeof metrics.inputTokens === "number") {
      usageTokens = metrics.inputTokens;
    }
  }

  return {
    vector,
    usageTokens,
    embeddingId: data.id as string | number | undefined,
  };
}

const POLL_INTERVAL_MS = 5_000;
const BASE_RETRY_DELAY_MS = 30_000;
const MAX_RETRY_DELAY_MS = 10 * 60_000;
const MAX_ATTEMPTS = 5;
const JOB_TYPE = "knowledge_base_indexing";
const LOCK_RETRY_DELAY_MS = 5_000;
const ACTION_TIMEOUT_HOURS = 1;
const ACTION_COMPLETION_CHECK_SECONDS = 30;
const ENABLE_DEV_LOG_FILE = process.env.DEV_LOG === "1";

// Логирование в файл для отладки
function logToFile(message: string): void {
  if (!ENABLE_DEV_LOG_FILE) {
    return;
  }
  try {
    const logFile = path.resolve(import.meta.dirname, "..", "dev.log");
    const timestamp = new Date().toISOString();
    const logLine = `[${timestamp}] [${JOB_TYPE}] ${message}\n`;
    fs.appendFileSync(logFile, logLine, "utf-8");
  } catch (error) {
    // Логируем ошибку записи в файл через console, чтобы увидеть проблему
    console.error(`[${JOB_TYPE}] Failed to write to log file:`, error instanceof Error ? error.message : String(error));
  }
}

function workerLog(message: string): void {
  log(message, JOB_TYPE);
  // logToFile(message); // Отключено - логирование в dev.log не требуется
}

function computeRetryDelayMs(attempts: number): number {
  const exponent = Math.max(0, attempts - 1);
  const delay = BASE_RETRY_DELAY_MS * Math.pow(2, exponent);
  return Math.min(Math.max(BASE_RETRY_DELAY_MS, delay), MAX_RETRY_DELAY_MS);
}

const MAX_EVENTS = 50;

type IndexingActionEvent = {
  timestamp: string;
  stage: IndexingStage;
  message: string;
  error?: string;
  metadata?: Record<string, unknown>;
};

async function addIndexingActionEvent(
  workspaceId: string,
  baseId: string,
  stage: IndexingStage,
  message: string,
  error?: string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  try {
    const action = await knowledgeBaseIndexingActionsService.getLatest(workspaceId, baseId);
    if (!action || action.status !== "processing") {
      return;
    }

    const currentPayload = (action.payload ?? {}) as Record<string, unknown>;
    const events = (Array.isArray(currentPayload.events) ? currentPayload.events : []) as IndexingActionEvent[];

    const newEvent: IndexingActionEvent = {
      timestamp: new Date().toISOString(),
      stage,
      message,
      ...(error && { error }),
      ...(metadata && { metadata }),
    };

    // Добавляем новое событие и ограничиваем размер до MAX_EVENTS
    const updatedEvents = [...events, newEvent].slice(-MAX_EVENTS);

    const updatedPayload = {
      ...currentPayload,
      events: updatedEvents,
    };

    await knowledgeBaseIndexingActionsService.update(workspaceId, baseId, action.actionId, {
      payload: updatedPayload,
    });
  } catch (error) {
    // Игнорируем ошибки обновления событий, чтобы не прерывать индексацию
    const errorMsg = error instanceof Error ? error.message : String(error);
    workerLog(`Failed to add indexing action event: ${errorMsg}`);
  }
}

async function updateIndexingActionStatus(
  workspaceId: string,
  baseId: string,
  stage: IndexingStage,
  displayText: string,
  payload?: Record<string, unknown>,
  error?: string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  try {
    const action = await knowledgeBaseIndexingActionsService.getLatest(workspaceId, baseId);
    if (action && action.status === "processing") {
      // Добавляем событие в историю
      await addIndexingActionEvent(workspaceId, baseId, stage, displayText, error, metadata);

      // Объединяем существующий payload с новым, сохраняя events
      const currentPayload = (action.payload ?? {}) as Record<string, unknown>;
      const events = currentPayload.events ?? [];
      const mergedPayload = {
        ...currentPayload,
        ...payload,
        events, // Сохраняем events из addIndexingActionEvent
      };

      await knowledgeBaseIndexingActionsService.update(workspaceId, baseId, action.actionId, {
        stage,
        displayText,
        payload: mergedPayload,
      });
    }
  } catch (error) {
    // Игнорируем ошибки обновления статуса, чтобы не прерывать индексацию
    const errorMsg = error instanceof Error ? error.message : String(error);
    workerLog(`Failed to update indexing action status: ${errorMsg}`);
  }
}

async function updateIndexingActionProgress(workspaceId: string, baseId: string): Promise<void> {
  try {
    const action = await knowledgeBaseIndexingActionsService.getLatest(workspaceId, baseId);
    if (!action || action.status !== "processing") {
      return;
    }

    const actionCreatedAt = action.createdAt ? new Date(action.createdAt) : null;
    const countOptions = actionCreatedAt ? { since: actionCreatedAt } : undefined;

    // Подсчитываем job'ы для этой базы знаний (в рамках текущего запуска)
    const [completedCount, totalCount] = await Promise.all([
      storage.countKnowledgeBaseIndexingJobs(workspaceId, baseId, "completed", countOptions),
      storage.countKnowledgeBaseIndexingJobs(workspaceId, baseId, null, countOptions),
    ]);

    const processedDocuments = completedCount;
    const progressPercent = totalCount > 0 ? Math.round((processedDocuments / totalCount) * 100) : 0;

    // Проверяем, все ли job'ы завершены
    const [pendingCount, processingCount, failedCount] = await Promise.all([
      storage.countKnowledgeBaseIndexingJobs(workspaceId, baseId, "pending", countOptions),
      storage.countKnowledgeBaseIndexingJobs(workspaceId, baseId, "processing", countOptions),
      storage.countKnowledgeBaseIndexingJobs(workspaceId, baseId, "failed", countOptions),
    ]);

    const remainingCount = pendingCount + processingCount;
    const allDone = remainingCount === 0;

    // Агрегируем ошибки из failed jobs (первые 10)
    const MAX_ERRORS = 10;
    let aggregatedErrors: Array<{
      documentId: string;
      documentTitle: string;
      error: string;
      stage: string;
      timestamp: string;
    }> = [];
    
    if (failedCount > 0 && actionCreatedAt) {
      try {
        const failedJobs = await storage.getKnowledgeBaseIndexingJobsByAction(
          workspaceId,
          baseId,
          actionCreatedAt,
          action.updatedAt ? new Date(action.updatedAt) : new Date(),
        );
        
        const failedJobsWithErrors = failedJobs
          .filter((job) => job.status === "failed" && job.lastError)
          .slice(0, MAX_ERRORS)
          .map((job) => ({
            documentId: job.documentId,
            documentTitle: job.documentTitle ?? "Без названия",
            error: job.lastError ?? "Неизвестная ошибка",
            stage: "processing", // Можно улучшить, добавив поле stage в job
            timestamp: job.updatedAt ? job.updatedAt.toISOString() : new Date().toISOString(),
          }));
        
        aggregatedErrors = failedJobsWithErrors;
      } catch (error) {
        // Игнорируем ошибки получения failed jobs
        workerLog(`Failed to get failed jobs for error aggregation: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    // Получаем текущий payload для сохранения config и events
    const currentPayload = (action.payload ?? {}) as Record<string, unknown>;
    const config = currentPayload.config ?? {};
    const events = currentPayload.events ?? [];

    // Логируем состояние для диагностики
    workerLog(`updateIndexingActionProgress: workspace=${workspaceId} base=${baseId} completed=${completedCount} total=${totalCount} pending=${pendingCount} processing=${processingCount} failed=${failedCount} allDone=${allDone}`);

    // Проверка таймаута: если action в статусе "processing" более 1 часа без обновлений
    const actionUpdatedAt = action.updatedAt ? new Date(action.updatedAt) : null;
    const now = new Date();
    const hoursSinceUpdate = actionUpdatedAt ? (now.getTime() - actionUpdatedAt.getTime()) / (1000 * 60 * 60) : 0;
    const TIMEOUT_HOURS = 1;
    
    if (hoursSinceUpdate > TIMEOUT_HOURS && !allDone) {
      // Принудительно завершаем action по таймауту
      workerLog(`updateIndexingActionProgress: action timeout (${hoursSinceUpdate.toFixed(2)}h), forcing completion`);
      await knowledgeBaseIndexingActionsService.update(workspaceId, baseId, action.actionId, {
        status: "error",
        stage: "error",
        displayText: `Индексация прервана по таймауту (более ${TIMEOUT_HOURS} часа без обновлений). Обработано ${processedDocuments} из ${totalCount} документов.`,
        payload: {
          ...currentPayload,
          config,
          events: [
            ...(Array.isArray(events) ? events : []),
            {
              timestamp: now.toISOString(),
              stage: "error",
              message: `Таймаут: действие не обновлялось более ${TIMEOUT_HOURS} часа`,
              error: "Таймаут индексации",
            },
          ],
          totalDocuments: totalCount,
          processedDocuments,
          progressPercent,
          failedDocuments: failedCount,
          ...(aggregatedErrors.length > 0 && { errors: aggregatedErrors }),
        },
      });
      return;
    }

    if (allDone) {
      // Все job'ы завершены
      workerLog(`updateIndexingActionProgress: all done, failedCount=${failedCount}, setting status=${failedCount > 0 ? "error" : "done"}`);
      
      const errorSummary = failedCount > 0 && aggregatedErrors.length > 0
        ? `\n\nОшибки:\n${aggregatedErrors.map((e, i) => `${i + 1}. "${e.documentTitle}": ${e.error}`).join("\n")}`
        : "";
      
      await knowledgeBaseIndexingActionsService.update(workspaceId, baseId, action.actionId, {
        status: failedCount > 0 ? "error" : "done",
        stage: failedCount > 0 ? "error" : "completed",
        displayText:
          failedCount > 0
            ? `Индексация завершена с ошибками: ${failedCount} документов не удалось проиндексировать${errorSummary}`
            : `Индексация завершена: проиндексировано ${processedDocuments} из ${totalCount} документов`,
        payload: {
          ...currentPayload,
          config,
          events,
          totalDocuments: totalCount,
          processedDocuments,
          progressPercent: 100,
          failedDocuments: failedCount,
          ...(aggregatedErrors.length > 0 && { errors: aggregatedErrors }),
        },
      });
    } else {
      // Обновляем прогресс
      await knowledgeBaseIndexingActionsService.update(workspaceId, baseId, action.actionId, {
        stage: "vectorizing",
        displayText: `Индексация в процессе: обработано ${processedDocuments} из ${totalCount} документов${failedCount > 0 ? `, ошибок: ${failedCount}` : ""}`,
        payload: {
          ...currentPayload,
          config,
          events,
          totalDocuments: totalCount,
          processedDocuments,
          progressPercent,
          remainingDocuments: remainingCount,
          failedDocuments: failedCount,
          ...(aggregatedErrors.length > 0 && { errors: aggregatedErrors }),
        },
      });
    }
  } catch (error) {
    // Игнорируем ошибки обновления прогресса, чтобы не прерывать индексацию
    const errorMsg = error instanceof Error ? error.message : String(error);
    workerLog(`Failed to update indexing action progress: ${errorMsg}`);
  }
}

type DocumentIndexingLock = {
  client: { query: (text: string, params?: unknown[]) => Promise<{ rows?: Record<string, unknown>[] }>; release: () => void } | null;
  workspaceId: string;
  documentId: string;
};

async function tryAcquireDocumentIndexingLock(
  workspaceId: string,
  documentId: string,
): Promise<DocumentIndexingLock | null> {
  if (!pool || !("connect" in pool) || typeof pool.connect !== "function") {
    workerLog(`Document lock skipped (pool unavailable) for document=${documentId}`);
    return { client: null, workspaceId, documentId };
  }

  const client = await pool.connect() as unknown as { 
    query: (text: string, params?: unknown[]) => Promise<{ rows?: Record<string, unknown>[] }>; 
    release: () => void;
  };
  try {
    const result = await client.query(
      "SELECT pg_try_advisory_lock(hashtext($1), hashtext($2)) AS locked",
      [workspaceId, documentId],
    );
    const locked = Boolean((result?.rows ?? [])[0]?.locked);
    if (!locked) {
      client.release();
      return null;
    }
    return { client, workspaceId, documentId };
  } catch (error) {
    client.release();
    workerLog(
      `Failed to acquire document lock for document=${documentId}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return null;
  }
}

async function releaseDocumentIndexingLock(lock: DocumentIndexingLock | null): Promise<void> {
  if (!lock?.client) {
    return;
  }
  const { client, workspaceId, documentId } = lock;
  try {
    await client.query("SELECT pg_advisory_unlock(hashtext($1), hashtext($2))", [
      workspaceId,
      documentId,
    ]);
  } catch (error) {
    workerLog(
      `Failed to release document lock for document=${documentId}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  } finally {
    client.release();
  }
}

async function processJob(job: KnowledgeBaseIndexingJob): Promise<void> {
  // Проверяем статус action перед обработкой
  const action = await knowledgeBaseIndexingActionsService.getLatest(job.workspaceId, job.baseId);
  if (action) {
    if (action.status === "canceled") {
      workerLog(`job ${job.id} skipped: action is canceled`);
      await storage.failKnowledgeBaseIndexingJob(job.id, "Индексация отменена");
      return;
    }
    if (action.status === "paused") {
      workerLog(`job ${job.id} skipped: action is paused`);
      // Reschedule job для повторной проверки через 10 секунд
      const nextRetryAt = new Date(Date.now() + 10_000);
      await storage.rescheduleKnowledgeBaseIndexingJob(
        job.id,
        nextRetryAt,
        "Индексация приостановлена",
      );
      return;
    }
  }

  let revisionId: string | null = null;
  const markJobError = async (message: string): Promise<void> => {
    try {
      await storage.failKnowledgeBaseIndexingJob(job.id, message);
    } catch (error) {
      workerLog(`failed to mark job ${job.id} as failed: ${error instanceof Error ? error.message : String(error)}`);
    }

    if (revisionId) {
      try {
        await storage.updateKnowledgeDocumentIndexRevision(
          job.workspaceId,
          job.documentId,
          revisionId,
          {
            status: "failed",
            error: message,
            finishedAt: new Date(),
          },
        );
      } catch (error) {
        workerLog(
          `failed to mark revision ${revisionId} as failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    try {
      await knowledgeBaseIndexingStateService.markDocumentError(
        job.workspaceId,
        job.baseId,
        job.documentId,
        message,
        job.versionId,
      );
    } catch (error) {
      workerLog(
        `failed to mark document ${job.documentId} as error: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    await updateIndexingActionProgress(job.workspaceId, job.baseId);
  };

  let lock: DocumentIndexingLock | null = null;
  const jobStartedAt = Date.now();
  logToFile(`job start doc=${job.documentId} job=${job.id}`);
  // Внешний try-catch для ловли всех ошибок
  try {
    workerLog(
      `processJob ENTRY for job ${job.id} document=${job.documentId} base=${job.baseId} workspace=${job.workspaceId}`,
    );

    if (job.jobType && job.jobType !== JOB_TYPE) {
      workerLog(`job ${job.id} has wrong jobType: ${job.jobType}, expected ${JOB_TYPE}`);
      return;
    }

    lock = await tryAcquireDocumentIndexingLock(job.workspaceId, job.documentId);
    if (!lock) {
      workerLog(
        `document ${job.documentId} is already locked, rescheduling job ${job.id}`,
      );
      logToFile(`lock busy doc=${job.documentId} job=${job.id} rescheduleMs=${LOCK_RETRY_DELAY_MS}`);
      const nextRetryAt = new Date(Date.now() + LOCK_RETRY_DELAY_MS);
      await storage.rescheduleKnowledgeBaseIndexingJob(
        job.id,
        nextRetryAt,
        "Документ уже индексируется",
      );
      return;
    }

    let embeddingProvider: EmbeddingProvider | null = null;
    let workspace: Workspace | undefined;

    try {
    workerLog(`fetching workspace ${job.workspaceId} for job ${job.id}`);
    workspace = await storage.getWorkspace(job.workspaceId);
    if (!workspace) {
      const message = "Рабочее пространство не найдено";
      workerLog(`${message} for job ${job.id} workspace=${job.workspaceId}`);
      await markJobError(message);
      return;
    }

    workerLog(`fetching base ${job.baseId} for job ${job.id}`);
    const base = await getKnowledgeBaseById(job.workspaceId, job.baseId);
    if (!base) {
      const message = "База знаний не найдена";
      workerLog(`${message} for job ${job.id} base=${job.baseId}`);
      await markJobError(message);
      return;
    }

    workerLog(`fetching nodeId for document ${job.documentId} for job ${job.id}`);
    // Получаем nodeId из базы по documentId
    const [documentRow] = await db
      .select({
        nodeId: knowledgeDocuments.nodeId,
      })
      .from(knowledgeDocuments)
      .where(
        and(
          eq(knowledgeDocuments.id, job.documentId),
          eq(knowledgeDocuments.baseId, job.baseId),
          eq(knowledgeDocuments.workspaceId, job.workspaceId),
        ),
      )
      .limit(1);

    if (!documentRow || !documentRow.nodeId) {
      const message = `Документ с ID ${job.documentId} не найден в базе данных`;
      workerLog(`${message} for job ${job.id}`);
      await markJobError(message);
      return;
    }

    const nodeId = documentRow.nodeId;
    workerLog(`got nodeId=${nodeId} for document ${job.documentId} for job ${job.id}, fetching node detail...`);
    
    let nodeDetail;
    try {
      nodeDetail = await getKnowledgeNodeDetail(job.baseId, nodeId, job.workspaceId);
      workerLog(`got node detail for job ${job.id}, type=${nodeDetail?.type ?? "null"}`);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      workerLog(`ERROR getting node detail for job ${job.id}: ${errorMsg}`);
      if (error instanceof Error && error.stack) {
        workerLog(`ERROR stack: ${error.stack}`);
      }
      await markJobError(`Ошибка получения документа: ${errorMsg}`);
      return;
    }
    
    if (!nodeDetail || nodeDetail.type !== "document") {
      const message = "Документ не найден";
      workerLog(`${message} for job ${job.id} document=${job.documentId} type=${nodeDetail?.type ?? "null"}`);
      await markJobError(message);
      return;
    }

    // Получаем metadata и slug из базы данных
    const [documentMetadataRow] = await db
      .select({
        metadata: knowledgeDocuments.metadata,
        slug: knowledgeNodes.slug,
      })
      .from(knowledgeDocuments)
      .innerJoin(knowledgeNodes, eq(knowledgeNodes.id, knowledgeDocuments.nodeId))
      .where(
        and(
          eq(knowledgeDocuments.id, job.documentId),
          eq(knowledgeDocuments.baseId, job.baseId),
          eq(knowledgeDocuments.workspaceId, job.workspaceId),
        ),
      )
      .limit(1);
    
    const documentMetadata = (documentMetadataRow?.metadata as Record<string, unknown>) ?? {};
    const documentSlug = documentMetadataRow?.slug ?? null;

    workerLog(`got node detail for job ${job.id}, fetching config...`);
    
    // Получаем action для проверки кастомного config
    let actionConfig: {
      embeddingsProvider?: string;
      embeddingsModel?: string;
      chunkSize?: number;
      chunkOverlap?: number;
      schemaFields?: Array<{ name: string; type: string; isArray: boolean; template: string; isEmbeddingField?: boolean }>;
    } | null = null;
    
    // Получаем последний action для этой базы знаний (jobs создаются в рамках одного action)
    try {
      const action = await knowledgeBaseIndexingActionsService.getLatest(job.workspaceId, job.baseId);
      if (action?.payload?.config) {
        const config = action.payload.config as Record<string, unknown>;
        if (config.source === "request") {
          actionConfig = {
            embeddingsProvider: config.providerId as string | undefined,
            embeddingsModel: config.model as string | undefined,
            chunkSize: config.chunkSize as number | undefined,
            chunkOverlap: config.chunkOverlap as number | undefined,
            schemaFields: Array.isArray(config.schemaFields) ? config.schemaFields as Array<{ name: string; type: string; isArray: boolean; template: string; isEmbeddingField?: boolean }> : undefined,
          };
          workerLog(`got custom config from action for job ${job.id}, providerId=${actionConfig.embeddingsProvider}, schemaFields=${actionConfig.schemaFields?.length ?? 0}`);
        }
      }
    } catch (error) {
      workerLog(`WARNING: failed to get action config for job ${job.id}: ${error instanceof Error ? error.message : String(error)}`);
      // Продолжаем с политикой
    }
    
    // Получаем политику (используется как fallback или для параметров, не переданных в config)
    let policy;
    try {
      policy = await knowledgeBaseIndexingPolicyService.get();
      workerLog(`got policy for job ${job.id}, providerId=${policy.embeddingsProvider}`);
      if (!actionConfig) {
        await addIndexingActionEvent(
          job.workspaceId,
          job.baseId,
          "initializing",
          "Политика индексации получена",
          undefined,
          { providerId: policy.embeddingsProvider, model: policy.embeddingsModel },
        );
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      workerLog(`ERROR getting policy for job ${job.id}: ${errorMsg}`);
      await updateIndexingActionStatus(
        job.workspaceId,
        job.baseId,
        "error",
        `Ошибка: Не удалось получить политику индексации: ${errorMsg}`,
        undefined,
        errorMsg,
        { documentId: job.documentId },
      );
      await markJobError(`Ошибка получения политики: ${errorMsg}`);
      return;
    }
    
    // Используем config из action, если он есть, иначе — политику
    const resolvedProviderId = actionConfig?.embeddingsProvider ?? policy.embeddingsProvider;
    const resolvedModel = actionConfig?.embeddingsModel ?? policy.embeddingsModel;
    const resolvedChunkSize = actionConfig?.chunkSize ?? policy.chunkSize;
    const resolvedChunkOverlap = actionConfig?.chunkOverlap ?? policy.chunkOverlap;

    await updateIndexingActionStatus(job.workspaceId, job.baseId, "initializing", "Инициализация...");

    // Используем resolved значения (из config или политики)
    const providerId = resolvedProviderId;
    if (!providerId) {
      const message = "Сервис эмбеддингов не указан в политике индексации баз знаний";
      await updateIndexingActionStatus(
        job.workspaceId,
        job.baseId,
        "error",
        `Ошибка: ${message}. Проверьте настройки в админ-панели.`,
        undefined,
        message,
        { documentId: job.documentId },
      );
      await markJobError(message);
      return;
    }

    try {
      const providerStatus = await resolveEmbeddingProviderStatus(providerId, undefined);
      if (!providerStatus) {
        const message = `Провайдер эмбеддингов '${providerId}' не найден`;
        await updateIndexingActionStatus(
          job.workspaceId,
          job.baseId,
          "error",
          `Ошибка: ${message}. Проверьте настройки в админ-панели.`,
          undefined,
          message,
          { documentId: job.documentId, providerId },
        );
        await markJobError(message);
        return;
      }

      if (!providerStatus.isConfigured) {
        const message = providerStatus.statusReason ?? `Провайдер эмбеддингов '${providerId}' недоступен`;
        const detailedMessage = `Провайдер эмбеддингов '${providerId}' не активирован. ${providerStatus.statusReason ? `Причина: ${providerStatus.statusReason}` : "Проверьте настройки в админ-панели."}`;
        await updateIndexingActionStatus(
          job.workspaceId,
          job.baseId,
          "error",
          `Ошибка: ${detailedMessage}`,
          undefined,
          message,
          { documentId: job.documentId, providerId, statusReason: providerStatus.statusReason },
        );
        await markJobError(message);
        return;
      }

      const provider = await storage.getEmbeddingProvider(providerId, undefined);
      if (!provider) {
        const message = `Провайдер эмбеддингов '${providerId}' не найден`;
        await updateIndexingActionStatus(
          job.workspaceId,
          job.baseId,
          "error",
          `Ошибка: ${message}. Проверьте настройки в админ-панели.`,
          undefined,
          message,
          { documentId: job.documentId, providerId },
        );
        await markJobError(message);
        return;
      }

      workerLog(`loaded provider ${providerId} for job ${job.id}, allowSelfSignedCertificate=${provider.allowSelfSignedCertificate}, embeddingsUrl=${provider.embeddingsUrl}`);

      // Используем модель из config или политики
      embeddingProvider = resolvedModel ? { ...provider, model: resolvedModel } : provider;
      
      if (!embeddingProvider) {
        const message = "Не удалось инициализировать провайдер эмбеддингов";
        await updateIndexingActionStatus(
          job.workspaceId,
          job.baseId,
          "error",
          `Ошибка: ${message}`,
          undefined,
          message,
          { documentId: job.documentId },
        );
        await markJobError(message);
        return;
      }
      
      workerLog(`final embeddingProvider for job ${job.id}, allowSelfSignedCertificate=${embeddingProvider.allowSelfSignedCertificate}, model=${embeddingProvider.model}`);
      
      await addIndexingActionEvent(
        job.workspaceId,
        job.baseId,
        "initializing",
        `Провайдер эмбеддингов '${provider.name}' (${embeddingProvider.model}) загружен`,
        undefined,
        { providerId, providerName: provider.name, model: embeddingProvider.model },
      );
    } catch (error) {
      const message =
        error instanceof Error && error.message ? error.message : "Сервис эмбеддингов недоступен в админ-настройках";
      await updateIndexingActionStatus(
        job.workspaceId,
        job.baseId,
        "error",
        `Ошибка: ${message}. Проверьте настройки в админ-панели.`,
        undefined,
        message,
        { documentId: job.documentId, providerId },
      );
      await markJobError(message);
      return;
    }

    // Проверяем, что embeddingProvider был установлен
    if (!embeddingProvider) {
      const message = "Не удалось инициализировать провайдер эмбеддингов";
      await updateIndexingActionStatus(
        job.workspaceId,
        job.baseId,
        "error",
        `Ошибка: ${message}`,
        undefined,
        message,
        { documentId: job.documentId },
      );
      await markJobError(message);
      return;
    }

    // Создаем коллекцию
    workerLog(`building collection name for job ${job.id}...`);
    const collectionName = buildKnowledgeCollectionName(base, embeddingProvider, job.workspaceId);
    workerLog(`collection name for job ${job.id}: ${collectionName}`);
    await updateIndexingActionStatus(
      job.workspaceId,
      job.baseId,
      "creating_collection",
      "Создаём коллекцию в Qdrant...",
      undefined,
      undefined,
      { collectionName },
    );

    workerLog(`checking if collection exists for job ${job.id}...`);
    const client = getQdrantClient();
    let collectionExists = false;
    try {
      await client.getCollection(collectionName);
      collectionExists = true;
      workerLog(`collection exists=true for job ${job.id}`);
    } catch (error) {
      collectionExists = false;
      const errorMsg = error instanceof Error ? error.message : String(error);
      workerLog(`collection does not exist for job ${job.id}, error: ${errorMsg}`);
    }

    // Создаем ревизию индексации
    try {
      const created = await storage.createKnowledgeDocumentIndexRevision({
        workspaceId: job.workspaceId,
        baseId: job.baseId,
        documentId: job.documentId,
        versionId: job.versionId,
        policyHash: policy.policyHash ?? null,
        status: "processing",
        startedAt: new Date(),
      });
      revisionId = created?.id ?? null;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      workerLog(`ERROR creating revision for job ${job.id}: ${errorMsg}`);
      await markJobError(`Ошибка создания ревизии индексации: ${errorMsg}`);
      return;
    }

    if (!revisionId) {
      const message = "Не удалось создать ревизию индексации";
      await markJobError(message);
      return;
    }

    // Создаем чанки
    const chunkingStartedAt = Date.now();
    logToFile(`chunking start doc=${job.documentId} job=${job.id}`);
    workerLog(`starting chunking for job ${job.id}...`);
    await updateIndexingActionStatus(
      job.workspaceId,
      job.baseId,
      "chunking",
      `Разбиваем документ "${nodeDetail.title ?? "без названия"}" на фрагменты...`,
      undefined,
      undefined,
      { documentId: job.documentId, documentTitle: nodeDetail.title },
    );

    let chunkSet;
    try {
      workerLog(`calling createKnowledgeDocumentChunkSet for job ${job.id} with nodeId=${nodeId}...`);
      chunkSet = await createKnowledgeDocumentChunkSet(
        job.baseId,
        nodeId,
        job.workspaceId,
        {
          maxChars: resolvedChunkSize,
          overlapChars: resolvedChunkOverlap,
          splitByPages: false,
          respectHeadings: true,
          // useHtmlContent определяется автоматически по sourceType документа
        },
        { revisionId, setLatest: false },
      );
      workerLog(`createKnowledgeDocumentChunkSet returned for job ${job.id}, chunks.length=${chunkSet?.chunks.length ?? 0}`);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      workerLog(`ERROR creating chunks for job ${job.id}: ${errorMsg}`);
      if (error instanceof Error && error.stack) {
        workerLog(`ERROR stack: ${error.stack}`);
      }
      await updateIndexingActionStatus(
        job.workspaceId,
        job.baseId,
        "error",
        `Ошибка создания чанков для документа "${nodeDetail.title ?? "без названия"}": ${errorMsg}`,
        undefined,
        errorMsg,
        { documentId: job.documentId, documentTitle: nodeDetail.title },
      );
      await markJobError(`Ошибка создания чанков: ${errorMsg}`);
      return;
    }

    if (!chunkSet || chunkSet.chunks.length === 0) {
      const message = "Не удалось создать чанки для документа";
      workerLog(`${message} for job ${job.id}`);
      await updateIndexingActionStatus(
        job.workspaceId,
        job.baseId,
        "error",
        `Ошибка: ${message} "${nodeDetail.title ?? "без названия"}"`,
        undefined,
        message,
        { documentId: job.documentId, documentTitle: nodeDetail.title },
      );
      await markJobError(message);
      return;
    }
    workerLog(`created ${chunkSet.chunks.length} chunks for job ${job.id}`);
    await addIndexingActionEvent(
      job.workspaceId,
      job.baseId,
      "chunking",
      `Создано ${chunkSet.chunks.length} фрагментов для документа "${nodeDetail.title ?? "без названия"}"`,
      undefined,
      { documentId: job.documentId, documentTitle: nodeDetail.title, chunkCount: chunkSet.chunks.length },
    );
    logToFile(
      `chunking done doc=${job.documentId} job=${job.id} chunks=${chunkSet.chunks.length} durationMs=${Date.now() - chunkingStartedAt}`,
    );

    try {
      await storage.updateKnowledgeDocumentIndexRevision(
        job.workspaceId,
        job.documentId,
        revisionId,
        {
          chunkSetId: chunkSet.id,
          chunkCount: chunkSet.chunks.length,
          totalTokens: chunkSet.totalTokens,
          totalChars: chunkSet.totalChars,
        },
      );
    } catch (error) {
      workerLog(
        `failed to attach chunk set ${chunkSet.id} to revision ${revisionId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    // Получаем эмбеддинги
    const tokenStartedAt = Date.now();
    logToFile(`access token start doc=${job.documentId} job=${job.id} provider=${embeddingProvider!.id}`);
    workerLog(`fetching access token for embedding provider ${embeddingProvider!.id} for job ${job.id}...`);
    let accessToken;
    try {
      accessToken = await fetchAccessToken(embeddingProvider);
      workerLog(`got access token for job ${job.id}, token length=${accessToken?.length ?? 0}`);
      logToFile(
        `access token done doc=${job.documentId} job=${job.id} provider=${embeddingProvider!.id} durationMs=${Date.now() - tokenStartedAt}`,
      );
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      workerLog(`ERROR fetching access token for job ${job.id}: ${errorMsg}`);
      if (error instanceof Error && error.stack) {
        workerLog(`ERROR stack: ${error.stack}`);
      }
      await updateIndexingActionStatus(
        job.workspaceId,
        job.baseId,
        "error",
        `Ошибка получения токена доступа для провайдера '${embeddingProvider!.name}': ${errorMsg}`,
        undefined,
        errorMsg,
        { documentId: job.documentId, documentTitle: nodeDetail.title, providerId: embeddingProvider!.id },
      );
      await markJobError(`Ошибка получения токена доступа: ${errorMsg}`);
      return;
    }

    const embeddingResults: Array<{
      chunk: typeof chunkSet.chunks[0];
      vector: number[];
      usageTokens?: number;
      embeddingId?: string | number;
      index: number;
    }> = [];

    await updateIndexingActionStatus(
      job.workspaceId,
      job.baseId,
      "vectorizing",
      `Векторизуем фрагменты документа "${nodeDetail.title ?? "без названия"}" (0 из ${chunkSet.chunks.length})...`,
      undefined,
      undefined,
      { documentId: job.documentId, documentTitle: nodeDetail.title, totalChunks: chunkSet.chunks.length },
    );

    const vectorizationStartedAt = Date.now();
    logToFile(`vectorization start doc=${job.documentId} job=${job.id} chunks=${chunkSet.chunks.length}`);
    workerLog(`starting vectorization for ${chunkSet.chunks.length} chunks for job ${job.id}...`);
    for (let index = 0; index < chunkSet.chunks.length; index += 1) {
      const chunk = chunkSet.chunks[index];
      try {
        workerLog(`fetching embedding for chunk ${index + 1}/${chunkSet.chunks.length} for job ${job.id}, text length=${chunk.text.length}...`);
        const result = await fetchEmbeddingVectorForChunk(embeddingProvider, accessToken, chunk.text);
        workerLog(`got embedding for chunk ${index + 1}/${chunkSet.chunks.length} for job ${job.id}, vector length=${result.vector?.length ?? 0}`);
        embeddingResults.push({
          chunk,
          vector: result.vector,
          usageTokens: result.usageTokens,
          embeddingId: result.embeddingId,
          index,
        });

        // Обновляем прогресс векторизации каждые 5 чанков или на последнем
        if ((index + 1) % 5 === 0 || index === chunkSet.chunks.length - 1) {
          await updateIndexingActionStatus(
            job.workspaceId,
            job.baseId,
            "vectorizing",
            `Векторизуем фрагменты документа "${nodeDetail.title ?? "без названия"}" (${index + 1} из ${chunkSet.chunks.length})...`,
            {
              progressPercent: Math.round(((index + 1) / chunkSet.chunks.length) * 100),
            },
            undefined,
            { documentId: job.documentId, documentTitle: nodeDetail.title, processedChunks: index + 1, totalChunks: chunkSet.chunks.length },
          );
        }
      } catch (embeddingError) {
        const errorMsg = embeddingError instanceof Error ? embeddingError.message : String(embeddingError);
        workerLog(`ERROR embedding chunk ${index + 1}/${chunkSet.chunks.length} for job ${job.id}: ${errorMsg}`);
        
        // Логируем детали проблемного чанка для отладки
        const chunkPreview = chunk.text.substring(0, 200).replace(/\n/g, '\\n');
        workerLog(`ERROR chunk details: textLength=${chunk.text.length}, charCount=${chunk.charCount ?? 'N/A'}, tokenCount=${chunk.tokenCount ?? 'N/A'}`);
        workerLog(`ERROR chunk preview: "${chunkPreview}..."`);
        
        if (embeddingError instanceof Error && embeddingError.stack) {
          workerLog(`ERROR stack: ${embeddingError.stack}`);
        }
        if (embeddingError instanceof Error && embeddingError.cause) {
          workerLog(`ERROR cause: ${embeddingError.cause}`);
        }
        const errorMessage = embeddingError instanceof Error ? embeddingError.message : String(embeddingError);
        await updateIndexingActionStatus(
          job.workspaceId,
          job.baseId,
          "error",
          `Ошибка эмбеддинга чанка #${index + 1} документа "${nodeDetail.title ?? "без названия"}": ${errorMessage}`,
          undefined,
          errorMessage,
          { documentId: job.documentId, documentTitle: nodeDetail.title, chunkIndex: index + 1, totalChunks: chunkSet.chunks.length },
        );
        await markJobError(`Ошибка эмбеддинга чанка #${index + 1}: ${errorMessage}`);
        return;
      }
    }
    workerLog(`completed vectorization for ${embeddingResults.length} chunks for job ${job.id}`);
    logToFile(
      `vectorization done doc=${job.documentId} job=${job.id} chunks=${embeddingResults.length} durationMs=${Date.now() - vectorizationStartedAt}`,
    );

    if (embeddingResults.length === 0) {
      const message = "Не удалось получить эмбеддинги для документа";
      await updateIndexingActionStatus(
        job.workspaceId,
        job.baseId,
        "error",
        `Ошибка: ${message} "${nodeDetail.title ?? "без названия"}"`,
        undefined,
        message,
        { documentId: job.documentId, documentTitle: nodeDetail.title },
      );
      await markJobError(message);
      return;
    }

    const firstVector = embeddingResults[0]?.vector;
    if (!Array.isArray(firstVector) || firstVector.length === 0) {
      const message = "Сервис эмбеддингов вернул пустой вектор";
      await updateIndexingActionStatus(
        job.workspaceId,
        job.baseId,
        "error",
        `Ошибка: ${message} для документа "${nodeDetail.title ?? "без названия"}"`,
        undefined,
        message,
        { documentId: job.documentId, documentTitle: nodeDetail.title },
      );
      await markJobError(message);
      return;
    }

    const detectedVectorLength = firstVector.length;

    workerLog(`ensuring collection created for job ${job.id}, collectionName=${collectionName}, vectorLength=${detectedVectorLength}`);
    await ensureCollectionCreatedIfNeeded({
      client,
      provider: embeddingProvider,
      collectionName,
      detectedVectorLength,
      shouldCreateCollection: true,
      collectionExists,
    });
    workerLog(`collection ensured for job ${job.id}`);

    await storage.upsertCollectionWorkspace(collectionName, job.workspaceId);
    workerLog(`collection workspace updated for job ${job.id}`);

    await updateIndexingActionStatus(
      job.workspaceId,
      job.baseId,
      "vectorizing",
      `Загружаем векторы документа "${nodeDetail.title ?? "без названия"}" в коллекцию...`,
      undefined,
      undefined,
      { documentId: job.documentId, documentTitle: nodeDetail.title, collectionName, vectorCount: embeddingResults.length },
    );

    // Подготавливаем payload с использованием schema из config или политики
    let schemaFields: CollectionSchemaFieldInput[] = [];
    if (actionConfig?.schemaFields && Array.isArray(actionConfig.schemaFields)) {
      schemaFields = actionConfig.schemaFields as CollectionSchemaFieldInput[];
    } else if (policy.defaultSchema && Array.isArray(policy.defaultSchema)) {
      schemaFields = policy.defaultSchema as CollectionSchemaFieldInput[];
    }
    
    // Гарантируем наличие document_url в схеме для RAG источников
    const hasDocumentUrl = schemaFields.some(f => f.name === "document_url");
    if (!hasDocumentUrl) {
      schemaFields = [
        ...schemaFields,
        {
          name: "document_url",
          type: "string",
          isArray: false,
          template: "{{ documentUrl }}",
        },
      ];
    }
    
    const hasCustomSchema = schemaFields.length > 0;

    // Получаем данные версии
    const version = nodeDetail.currentVersion
      ? {
          id: nodeDetail.currentVersion.id,
          number: nodeDetail.currentVersion.versionNo,
          createdAt: nodeDetail.currentVersion.createdAt,
        }
      : null;

    // Обрабатываем чанки с поддержкой async операций (LLM токены)
    const points: Schemas["PointStruct"][] = [];
    
    for (const result of embeddingResults) {
      const { chunk, vector, usageTokens, embeddingId, index } = result;
      const resolvedChunkId = chunk.id ?? `${nodeDetail.id}-chunk-${index + 1}`;
      const vectorId = chunk.vectorId;
      if (!vectorId) {
        throw new Error(`Не найден vector_id для чанка ${resolvedChunkId}`);
      }

      const templateContext = removeUndefinedDeep({
        // Добавляем переменные для контекста индексации
        content: chunk.text, // Алиас для chunk_text (основное содержимое для векторизации)
        title: nodeDetail.title ?? "",
        documentId: nodeDetail.id,
        documentUrl: `/knowledge/${base.id}/node/${nodeDetail.id}`, // Ссылка на документ в системе
        nodeSlug: documentSlug,
        chunk_text: chunk.text,
        chunk_index: index,
        chunk_ordinal: chunk.chunkOrdinal ?? index + 1,
        versionId: version?.id ?? "",
        versionNumber: version?.number ?? 0,
        knowledgeBaseId: base.id,
        knowledgeBaseName: base.name ?? "",
        metadata: documentMetadata,
        // Старые поля для обратной совместимости
        document: {
          id: nodeDetail.id,
          title: nodeDetail.title ?? null,
          text: nodeDetail.content ?? "",
          textPreview: (nodeDetail.content ?? "").slice(0, 1000),
          html: nodeDetail.html ?? null,
          htmlPreview: (nodeDetail.html ?? "").slice(0, 1000),
          path: `knowledge://${base.id}/${nodeDetail.id}`,
          sourceUrl: nodeDetail.sourceUrl ?? null,
          updatedAt: nodeDetail.updatedAt ?? null,
          charCount: chunk.charCount ?? 0,
          wordCount: chunk.wordCount ?? 0,
          excerpt: chunk.excerpt ?? null,
          totalChunks: chunkSet.chunks.length,
          chunkSize: resolvedChunkSize,
          chunkOverlap: resolvedChunkOverlap,
        },
        base: {
          id: base.id,
          name: base.name ?? null,
          description: base.description ?? null,
        },
        version: version
          ? {
              id: version.id,
              number: version.number,
              createdAt: version.createdAt,
            }
          : null,
        provider: {
          id: embeddingProvider!.id,
          name: embeddingProvider!.name,
        },
        revision: {
          id: revisionId,
          policyHash: policy.policyHash ?? null,
        },
        chunk: {
          id: resolvedChunkId,
          index,
          position: chunk.charStart ?? 0,
          start: chunk.charStart ?? 0,
          end: chunk.charEnd ?? 0,
          text: chunk.text,
          charCount: chunk.charCount ?? 0,
          wordCount: chunk.wordCount ?? 0,
          tokenCount: chunk.tokenCount ?? 0,
          excerpt: chunk.excerpt ?? null,
          hash: chunk.contentHash ?? null,
          ordinal: chunk.chunkOrdinal ?? null,
          vectorId,
        },
        embedding: {
          model: embeddingProvider!.model,
          vectorSize: vector.length,
          tokens: usageTokens ?? null,
          id: embeddingId ?? null,
        },
      }) as Record<string, unknown>;

      const rawPayload = {
        workspace_id: job.workspaceId,
        knowledge_base_id: base.id,
        document_id: nodeDetail.id,
        revision_id: revisionId,
        chunk_id: resolvedChunkId,
        chunk_hash: chunk.contentHash ?? null,
        chunk_ordinal: chunk.chunkOrdinal ?? null,
        vector_id: vectorId,
        policy_hash: policy.policyHash ?? null,
        document: {
          id: nodeDetail.id,
          title: nodeDetail.title ?? null,
          text: (nodeDetail.content ?? "").slice(0, 1000),
          html: (nodeDetail.html ?? "").slice(0, 1000),
          path: `knowledge://${base.id}/${nodeDetail.id}`,
          sourceUrl: nodeDetail.sourceUrl ?? null,
          updatedAt: nodeDetail.updatedAt ?? null,
          charCount: chunk.charCount ?? 0,
          wordCount: chunk.wordCount ?? 0,
          excerpt: chunk.excerpt ?? null,
          totalChunks: chunkSet.chunks.length,
          chunkSize: resolvedChunkSize,
          chunkOverlap: resolvedChunkOverlap,
        },
        base: {
          id: base.id,
          name: base.name ?? null,
          description: base.description ?? null,
        },
        version: version
          ? {
              id: version.id,
              number: version.number,
              createdAt: version.createdAt,
            }
          : null,
        provider: {
          id: embeddingProvider!.id,
          name: embeddingProvider!.name,
        },
        chunk: {
          id: resolvedChunkId,
          index,
          position: chunk.charStart ?? 0,
          start: chunk.charStart ?? 0,
          end: chunk.charEnd ?? 0,
          text: chunk.text,
          charCount: chunk.charCount ?? 0,
          wordCount: chunk.wordCount ?? 0,
          excerpt: chunk.excerpt ?? null,
        },
        embedding: {
          model: embeddingProvider!.model,
          vectorSize: vector.length,
          tokens: usageTokens ?? null,
          id: embeddingId ?? null,
        },
      };

      // Обрабатываем кастомную схему с поддержкой LLM токенов
      const customPayload = hasCustomSchema ? await buildCustomPayloadFromSchema(schemaFields, templateContext, job.workspaceId) : null;
      const payloadSource = customPayload ?? rawPayload;
      const payload = removeUndefinedDeep({
        ...(payloadSource as Record<string, unknown>),
        workspace_id: job.workspaceId,
        knowledge_base_id: base.id,
        document_id: nodeDetail.id,
        revision_id: revisionId,
        chunk_id: resolvedChunkId,
        chunk_hash: chunk.contentHash ?? null,
        chunk_ordinal: chunk.chunkOrdinal ?? null,
        vector_id: vectorId,
        policy_hash: policy.policyHash ?? null,
      }) as Record<string, unknown>;

      const pointVectorPayload = buildVectorPayload(
        vector,
        embeddingProvider!.qdrantConfig?.vectorFieldName,
      ) as Schemas["PointStruct"]["vector"];

      points.push({
        id: vectorId,
        vector: pointVectorPayload,
        payload,
      });
    }

    logToFile(
      `upsert start doc=${job.documentId} revision=${revisionId} collection=${collectionName} points=${points.length}`,
    );

    // Загружаем векторы в Qdrant
    await client.upsert(collectionName, {
      wait: true,
      points,
    });
    logToFile(
      `upsert done doc=${job.documentId} revision=${revisionId} collection=${collectionName} points=${points.length}`,
    );

    await updateIndexingActionStatus(
      job.workspaceId,
      job.baseId,
      "verifying",
      `Проверяем загруженные данные документа "${nodeDetail.title ?? "без названия"}"...`,
      undefined,
      undefined,
      { documentId: job.documentId, documentTitle: nodeDetail.title, vectorCount: embeddingResults.length },
    );

    // Обновляем vectorRecordId в чанках
    const vectorRecordMappings = embeddingResults.map((result, index) => {
      const chunk = result.chunk;
      const resolvedChunkId = chunk.id ?? `${nodeDetail.id}-chunk-${index + 1}`;
      const vectorId = chunk.vectorId;
      if (!vectorId) {
        throw new Error(`Не найден vector_id для чанка ${resolvedChunkId}`);
      }
      return { chunkId: resolvedChunkId, vectorRecordId: vectorId };
    });

    await updateKnowledgeDocumentChunkVectorRecords({
      workspaceId: job.workspaceId,
      chunkSetId: chunkSet.id,
      chunkRecords: vectorRecordMappings,
    });

    const totalChars = chunkSet.chunks.reduce((sum, chunk) => sum + (chunk.charCount ?? 0), 0);
    const totalTokens = chunkSet.chunks.reduce((sum, chunk) => sum + (chunk.tokenCount ?? 0), 0);

    let previousRevisionId: string | null = null;
    try {
      const switchResult = await storage.switchKnowledgeDocumentRevision(
        job.workspaceId,
        job.documentId,
        revisionId,
        chunkSet.id,
      );
      previousRevisionId = switchResult?.previousRevisionId ?? null;
      workerLog(
        `switched revision for document ${job.documentId}, previous=${previousRevisionId ?? "null"}, current=${revisionId}`,
      );
      logToFile(
        `switch revision doc=${job.documentId} previous=${previousRevisionId ?? "null"} current=${revisionId} chunkSet=${chunkSet.id}`,
      );
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      await markJobError(`Ошибка переключения ревизии: ${errorMsg}`);
      return;
    }

    try {
      await storage.updateKnowledgeDocumentIndexRevision(
        job.workspaceId,
        job.documentId,
        revisionId,
        {
          status: "ready",
          error: null,
          finishedAt: new Date(),
          chunkSetId: chunkSet.id,
          chunkCount: chunkSet.chunks.length,
          totalTokens,
          totalChars,
        },
      );
    } catch (error) {
      workerLog(
        `failed to mark revision ${revisionId} as ready: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    await storage.markKnowledgeBaseIndexingJobDone(job.id, {
      chunkCount: chunkSet.chunks.length,
      totalChars,
      totalTokens,
    });

    try {
      await knowledgeBaseIndexingStateService.markDocumentUpToDate(
        job.workspaceId,
        job.baseId,
        job.documentId,
        job.versionId,
        chunkSet.id,
        new Date(),
      );
    } catch (error) {
      workerLog(
        `failed to mark document ${job.documentId} as up to date: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    // Обновляем прогресс индексации
    await updateIndexingActionProgress(job.workspaceId, job.baseId);

    const previousRevisionLabel = previousRevisionId ?? "unknown";
    const cleanupDocumentIds = Array.from(new Set([job.documentId, nodeDetail.id]));
    workerLog(
      `cleanup non-current revisions for document ${job.documentId}, previous=${previousRevisionLabel}`,
    );

    for (const documentId of cleanupDocumentIds) {
      logToFile(
        `cleanup start doc=${documentId} keep=${revisionId} collection=${collectionName}`,
      );
      try {
        await client.delete(collectionName, {
          wait: true,
          filter: {
            must: [{ key: "document_id", match: { value: documentId } }],
            must_not: [{ key: "revision_id", match: { value: revisionId } }],
          },
        });
        logToFile(
          `cleanup done doc=${documentId} keep=${revisionId} collection=${collectionName}`,
        );
      } catch (error) {
        workerLog(
          `failed to cleanup non-current revisions for document ${documentId}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        logToFile(
          `cleanup failed doc=${documentId} keep=${revisionId} collection=${collectionName} error=${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    workerLog(`indexed document=${nodeDetail.id} base=${base.id} chunks=${chunkSet.chunks.length}`);
    logToFile(
      `job done doc=${job.documentId} job=${job.id} durationMs=${Date.now() - jobStartedAt}`,
    );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const isRetryable = error instanceof Error && (error.message.includes("timeout") || error.message.includes("network"));

      if (isRetryable && job.attempts < MAX_ATTEMPTS) {
        const nextRetryAt = new Date(Date.now() + computeRetryDelayMs(job.attempts + 1));
        await storage.rescheduleKnowledgeBaseIndexingJob(job.id, nextRetryAt, errorMessage);
        throw error;
      }

      await markJobError(errorMessage);
      
      await updateIndexingActionStatus(
        job.workspaceId,
        job.baseId,
        "error",
        `Ошибка индексации документа: ${errorMessage}`,
        { error: errorMessage },
        errorMessage,
        { documentId: job.documentId, attempts: job.attempts },
      );
    }
  } catch (outerError) {
    // Ловим ошибки, которые произошли до внутреннего try-catch или в самом начале функции
    const outerErrorMessage = outerError instanceof Error ? outerError.message : String(outerError);
    workerLog(`processJob OUTER ERROR for job ${job.id}: ${outerErrorMessage}`);
    if (outerError instanceof Error && outerError.stack) {
      workerLog(`processJob OUTER ERROR stack: ${outerError.stack}`);
    }
    // Помечаем job как failed
    try {
      await markJobError(outerErrorMessage);
    } catch (failError) {
      workerLog(`failed to mark job ${job.id} as failed in outer catch: ${failError instanceof Error ? failError.message : String(failError)}`);
    }
    throw outerError;
  } finally {
    if (lock) {
      await releaseDocumentIndexingLock(lock);
    }
  }
}

export function startKnowledgeBaseIndexingWorker() {
  let stopped = false;
  let active = false;

  async function poll() {
    if (stopped || active) {
      return false;
    }

    active = true;
    let hadJob = false;
    try {
      // Логируем только если есть задачи или для отладки
      const job = await storage.claimNextKnowledgeBaseIndexingJob();
      if (!job) {
        // Нет доступных job'ов, продолжаем опрос без лишнего логирования
        return false;
      }
      
      // Логируем только когда нашли задачу
      workerLog(`polling for next job... found job ${job.id}`);

      hadJob = true;
      workerLog(`claimed job ${job.id} for document ${job.documentId} base=${job.baseId} workspace=${job.workspaceId} status=${job.status} attempts=${job.attempts} versionId=${job.versionId ?? "null"}`);
      try {
        workerLog(`calling processJob for job ${job.id}...`);
        await processJob(job);
        workerLog(`job ${job.id} completed successfully`);
      } catch (error) {
        // Ошибка уже обработана в processJob
        const errorMsg = error instanceof Error ? error.message : String(error);
        workerLog(`job ${job.id} failed in poll catch: ${errorMsg}`);
        if (error instanceof Error && error.stack) {
          workerLog(`job ${job.id} stack: ${error.stack}`);
        }
        // Убеждаемся, что job помечен как failed
        try {
          await storage.failKnowledgeBaseIndexingJob(job.id, errorMsg);
          try {
            await knowledgeBaseIndexingStateService.markDocumentError(
              job.workspaceId,
              job.baseId,
              job.documentId,
              errorMsg,
              job.versionId,
              { recalculateBase: false },
            );
          } catch (stateError) {
            workerLog(
              `failed to mark document ${job.documentId} as error in poll: ${stateError instanceof Error ? stateError.message : String(stateError)}`,
            );
          }
          await updateIndexingActionProgress(job.workspaceId, job.baseId);
        } catch (failError) {
          workerLog(`failed to mark job ${job.id} as failed: ${failError instanceof Error ? failError.message : String(failError)}`);
        }
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      workerLog(`worker error in poll: ${errorMsg}`);
      if (error instanceof Error && error.stack) {
        workerLog(`worker error stack: ${error.stack}`);
      }
    } finally {
      active = false;
    }

    return hadJob;
  }

  function scheduleNext(delayMs = POLL_INTERVAL_MS) {
    if (stopped) {
      return;
    }
    setTimeout(() => {
      poll()
        .then((hadJob) => {
          scheduleNext(hadJob ? 0 : POLL_INTERVAL_MS);
        })
        .catch(() => {
          scheduleNext(POLL_INTERVAL_MS);
        });
    }, delayMs);
  }

  workerLog(`worker started`);
  scheduleNext();

  return {
    stop() {
      stopped = true;
      workerLog(`worker stopped`);
    },
  };
}
