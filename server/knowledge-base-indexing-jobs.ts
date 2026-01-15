import type { KnowledgeBaseIndexingJob, Workspace, EmbeddingProvider } from "@shared/schema";
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
import { buildVectorPayload } from "./qdrant-utils";
import type { Schemas } from "./qdrant-client";
import { fetchAccessToken } from "./llm-access-token";
import { knowledgeBaseIndexingActionsService } from "./knowledge-base-indexing-actions";
import { knowledgeBaseIndexingStateService } from "./knowledge-base-indexing-state";
import { log } from "./vite";
import fs from "fs";
import path from "path";
import { db } from "./db";
import { knowledgeDocuments } from "@shared/schema";
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

function buildCustomPayloadFromSchema(
  fields: CollectionSchemaFieldInput[],
  context: Record<string, unknown>,
): Record<string, unknown> {
  return fields.reduce<Record<string, unknown>>((acc, field) => {
    try {
      const rendered = renderLiquidTemplate(field.template ?? "", context);
      const typedValue = castValueToType(rendered, field.type);
      acc[field.name] = normalizeArrayValue(typedValue, field.isArray);
    } catch (error) {
      workerLog(`Не удалось обработать поле схемы "${field.name}": ${error instanceof Error ? error.message : String(error)}`);
      acc[field.name] = null;
    }

    return acc;
  }, {});
}

async function fetchEmbeddingVectorForChunk(
  provider: EmbeddingProvider,
  accessToken: string,
  text: string,
): Promise<{ vector: number[]; usageTokens?: number; embeddingId?: string | number }> {
  const headers = new Headers();
  headers.set("Content-Type", "application/json");
  headers.set("Authorization", `Bearer ${accessToken}`);
  
  for (const [key, value] of Object.entries(provider.requestHeaders ?? {})) {
    headers.set(key, value);
  }

  const allowSelfSigned = provider.allowSelfSignedCertificate ?? false;
  workerLog(`fetchEmbeddingVectorForChunk: provider.allowSelfSignedCertificate=${provider.allowSelfSignedCertificate}, allowSelfSigned=${allowSelfSigned}, url=${provider.embeddingsUrl}`);
  
  const requestOptions = applyTlsPreferences<NodeFetchOptions>(
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: provider.model,
        input: text,
      }),
    },
    allowSelfSigned,
  );

  workerLog(`fetchEmbeddingVectorForChunk: requestOptions.agent=${requestOptions.agent ? 'present' : 'absent'}`);
  const response = await fetch(provider.embeddingsUrl, requestOptions);

  if (!response.ok) {
    const errorText = await response.text().catch(() => response.statusText);
    throw new Error(`Embedding API error: ${response.status} ${errorText}`);
  }

  const data = await response.json();
  const vector = Array.isArray(data.data?.[0]?.embedding) ? data.data[0].embedding : data.embedding;
  if (!Array.isArray(vector)) {
    throw new Error("Invalid embedding response format");
  }

  return {
    vector,
    usageTokens: data.usage?.total_tokens,
    embeddingId: data.id,
  };
}

const POLL_INTERVAL_MS = 5_000;
const BASE_RETRY_DELAY_MS = 30_000;
const MAX_RETRY_DELAY_MS = 10 * 60_000;
const MAX_ATTEMPTS = 5;
const JOB_TYPE = "knowledge_base_indexing";
const LOCK_RETRY_DELAY_MS = 5_000;

// Логирование в файл для отладки
function logToFile(message: string): void {
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

async function updateIndexingActionStatus(
  workspaceId: string,
  baseId: string,
  stage: string,
  displayText: string,
  payload?: Record<string, unknown>,
): Promise<void> {
  try {
    const action = await knowledgeBaseIndexingActionsService.getLatest(workspaceId, baseId);
    if (action && action.status === "processing") {
      await knowledgeBaseIndexingActionsService.update(workspaceId, baseId, action.actionId, {
        stage: stage as any,
        displayText,
        payload,
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

    // Логируем состояние для диагностики
    workerLog(`updateIndexingActionProgress: workspace=${workspaceId} base=${baseId} completed=${completedCount} total=${totalCount} pending=${pendingCount} processing=${processingCount} failed=${failedCount} allDone=${allDone}`);

    if (allDone) {
      // Все job'ы завершены
      workerLog(`updateIndexingActionProgress: all done, failedCount=${failedCount}, setting status=${failedCount > 0 ? "error" : "done"}`);
      await knowledgeBaseIndexingActionsService.update(workspaceId, baseId, action.actionId, {
        status: failedCount > 0 ? "error" : "done",
        stage: failedCount > 0 ? "error" : "completed",
        displayText:
          failedCount > 0
            ? `Индексация завершена с ошибками: ${failedCount} документов не удалось проиндексировать`
            : `Индексация завершена: проиндексировано ${processedDocuments} из ${totalCount} документов`,
        payload: {
          totalDocuments: totalCount,
          processedDocuments,
          progressPercent: 100,
          failedDocuments: failedCount,
        },
      });
    } else {
      // Обновляем прогресс
      await knowledgeBaseIndexingActionsService.update(workspaceId, baseId, action.actionId, {
        stage: "processing",
        displayText: `Индексация в процессе: обработано ${processedDocuments} из ${totalCount} документов`,
        payload: {
          totalDocuments: totalCount,
          processedDocuments,
          progressPercent,
          remainingDocuments: remainingCount,
        },
      });
    }
  } catch (error) {
    // Игнорируем ошибки обновления прогресса, чтобы не прерывать индексацию
    const errorMsg = error instanceof Error ? error.message : String(error);
    workerLog(`Failed to update indexing action progress: ${errorMsg}`);
  }
}

async function tryAcquireDocumentIndexingLock(
  workspaceId: string,
  documentId: string,
): Promise<boolean> {
  try {
    const result = await db.execute(sql`
      SELECT pg_try_advisory_lock(hashtext(${workspaceId}), hashtext(${documentId})) AS locked
    `);
    const locked = Boolean((result.rows ?? [])[0]?.locked);
    return locked;
  } catch (error) {
    workerLog(
      `Failed to acquire document lock for document=${documentId}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return false;
  }
}

async function releaseDocumentIndexingLock(
  workspaceId: string,
  documentId: string,
): Promise<void> {
  try {
    await db.execute(sql`
      SELECT pg_advisory_unlock(hashtext(${workspaceId}), hashtext(${documentId}))
    `);
  } catch (error) {
    workerLog(
      `Failed to release document lock for document=${documentId}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

async function processJob(job: KnowledgeBaseIndexingJob): Promise<void> {
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

  let lockAcquired = false;
  // Внешний try-catch для ловли всех ошибок
  try {
    workerLog(
      `processJob ENTRY for job ${job.id} document=${job.documentId} base=${job.baseId} workspace=${job.workspaceId}`,
    );

    if (job.jobType && job.jobType !== JOB_TYPE) {
      workerLog(`job ${job.id} has wrong jobType: ${job.jobType}, expected ${JOB_TYPE}`);
      return;
    }

    lockAcquired = await tryAcquireDocumentIndexingLock(job.workspaceId, job.documentId);
    if (!lockAcquired) {
      workerLog(
        `document ${job.documentId} is already locked, rescheduling job ${job.id}`,
      );
      const nextRetryAt = new Date(Date.now() + LOCK_RETRY_DELAY_MS);
      await storage.rescheduleKnowledgeBaseIndexingJob(
        job.id,
        nextRetryAt,
        "Документ уже индексируется",
      );
      return;
    }

    let embeddingProvider: Awaited<ReturnType<typeof resolveEmbeddingProviderForWorkspace>>["provider"] | null = null;
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

    workerLog(`got node detail for job ${job.id}, fetching policy...`);
    let policy;
    try {
      policy = await knowledgeBaseIndexingPolicyService.get();
      workerLog(`got policy for job ${job.id}, providerId=${policy.embeddingsProvider}`);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      workerLog(`ERROR getting policy for job ${job.id}: ${errorMsg}`);
      await markJobError(`Ошибка получения политики: ${errorMsg}`);
      return;
    }

    await updateIndexingActionStatus(job.workspaceId, job.baseId, "initializing", "Инициализация...");

    // Политика индексации для баз знаний глобальная, проверяем провайдер без workspaceId
    const providerId = policy.embeddingsProvider;
    if (!providerId) {
      const message = "Сервис эмбеддингов не указан в политике индексации баз знаний";
      await markJobError(message);
      return;
    }

    try {
      const providerStatus = await resolveEmbeddingProviderStatus(providerId, undefined);
      if (!providerStatus) {
        const message = `Провайдер эмбеддингов '${providerId}' не найден`;
        await markJobError(message);
        return;
      }

      if (!providerStatus.isConfigured) {
        const message = providerStatus.statusReason ?? `Провайдер эмбеддингов '${providerId}' недоступен`;
        await markJobError(message);
        return;
      }

      const provider = await storage.getEmbeddingProvider(providerId, undefined);
      if (!provider) {
        const message = `Провайдер эмбеддингов '${providerId}' не найден`;
        await markJobError(message);
        return;
      }

      workerLog(`loaded provider ${providerId} for job ${job.id}, allowSelfSignedCertificate=${provider.allowSelfSignedCertificate}, embeddingsUrl=${provider.embeddingsUrl}`);

      // Используем модель из политики баз знаний
      const modelFromPolicy = policy.embeddingsModel;
      embeddingProvider = modelFromPolicy ? { ...provider, model: modelFromPolicy } : provider;
      
      workerLog(`final embeddingProvider for job ${job.id}, allowSelfSignedCertificate=${embeddingProvider.allowSelfSignedCertificate}, model=${embeddingProvider.model}`);
    } catch (error) {
      const message =
        error instanceof Error && error.message ? error.message : "Сервис эмбеддингов недоступен в админ-настройках";
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
    workerLog(`starting chunking for job ${job.id}...`);
    await updateIndexingActionStatus(
      job.workspaceId,
      job.baseId,
      "chunking",
      `Разбиваем документ "${nodeDetail.title ?? "без названия"}" на фрагменты...`,
    );

    let chunkSet;
    try {
      workerLog(`calling createKnowledgeDocumentChunkSet for job ${job.id} with nodeId=${nodeId}...`);
      chunkSet = await createKnowledgeDocumentChunkSet(
        job.baseId,
        nodeId,
        job.workspaceId,
        {
          maxChars: policy.chunkSize,
          overlapChars: policy.chunkOverlap,
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
      await markJobError(`Ошибка создания чанков: ${errorMsg}`);
      return;
    }

    if (!chunkSet || chunkSet.chunks.length === 0) {
      const message = "Не удалось создать чанки для документа";
      workerLog(`${message} for job ${job.id}`);
      await markJobError(message);
      return;
    }
    workerLog(`created ${chunkSet.chunks.length} chunks for job ${job.id}`);

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
    workerLog(`fetching access token for embedding provider ${embeddingProvider.id} for job ${job.id}...`);
    let accessToken;
    try {
      accessToken = await fetchAccessToken(embeddingProvider);
      workerLog(`got access token for job ${job.id}, token length=${accessToken?.length ?? 0}`);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      workerLog(`ERROR fetching access token for job ${job.id}: ${errorMsg}`);
      if (error instanceof Error && error.stack) {
        workerLog(`ERROR stack: ${error.stack}`);
      }
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
    );

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
          );
        }
      } catch (embeddingError) {
        const errorMsg = embeddingError instanceof Error ? embeddingError.message : String(embeddingError);
        workerLog(`ERROR embedding chunk ${index + 1}/${chunkSet.chunks.length} for job ${job.id}: ${errorMsg}`);
        if (embeddingError instanceof Error && embeddingError.stack) {
          workerLog(`ERROR stack: ${embeddingError.stack}`);
        }
        if (embeddingError instanceof Error && embeddingError.cause) {
          workerLog(`ERROR cause: ${embeddingError.cause}`);
        }
        const errorMessage = embeddingError instanceof Error ? embeddingError.message : String(embeddingError);
        await markJobError(`Ошибка эмбеддинга чанка #${index + 1}: ${errorMessage}`);
        return;
      }
    }
    workerLog(`completed vectorization for ${embeddingResults.length} chunks for job ${job.id}`);

    if (embeddingResults.length === 0) {
      const message = "Не удалось получить эмбеддинги для документа";
      await markJobError(message);
      return;
    }

    const firstVector = embeddingResults[0]?.vector;
    if (!Array.isArray(firstVector) || firstVector.length === 0) {
      const message = "Сервис эмбеддингов вернул пустой вектор";
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
      "uploading",
      `Загружаем векторы документа "${nodeDetail.title ?? "без названия"}" в коллекцию...`,
    );

    // Подготавливаем payload с использованием schema из политики
    const schemaFields: CollectionSchemaFieldInput[] = policy.defaultSchema as CollectionSchemaFieldInput[];
    const hasCustomSchema = schemaFields.length > 0;

    // Получаем данные версии
    const version = nodeDetail.currentVersion
      ? {
          id: nodeDetail.currentVersion.id,
          number: nodeDetail.currentVersion.versionNo,
          createdAt: nodeDetail.currentVersion.createdAt,
        }
      : null;

    const points: Schemas["PointStruct"][] = embeddingResults.map((result) => {
      const { chunk, vector, usageTokens, embeddingId, index } = result;
      const resolvedChunkId = chunk.id ?? `${nodeDetail.id}-chunk-${index + 1}`;
      const vectorId = chunk.vectorId;
      if (!vectorId) {
        throw new Error(`Не найден vector_id для чанка ${resolvedChunkId}`);
      }

      const templateContext = removeUndefinedDeep({
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
          chunkSize: policy.chunkSize,
          chunkOverlap: policy.chunkOverlap,
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
          id: embeddingProvider.id,
          name: embeddingProvider.name,
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
          model: embeddingProvider.model,
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
          chunkSize: policy.chunkSize,
          chunkOverlap: policy.chunkOverlap,
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
          id: embeddingProvider.id,
          name: embeddingProvider.name,
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
          model: embeddingProvider.model,
          vectorSize: vector.length,
          tokens: usageTokens ?? null,
          id: embeddingId ?? null,
        },
      };

      const customPayload = hasCustomSchema ? buildCustomPayloadFromSchema(schemaFields, templateContext) : null;
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
        embeddingProvider.qdrantConfig?.vectorFieldName,
      ) as Schemas["PointStruct"]["vector"];

      return {
        id: vectorId,
        vector: pointVectorPayload,
        payload,
      };
    });

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
      chunkSetId: chunkSet.id,
      mappings: vectorRecordMappings,
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
    if (lockAcquired) {
      await releaseDocumentIndexingLock(job.workspaceId, job.documentId);
    }
  }
}

export function startKnowledgeBaseIndexingWorker() {
  let stopped = false;
  let active = false;

  async function poll() {
    if (stopped || active) {
      return;
    }

    active = true;
    try {
      workerLog(`polling for next job...`);
      const job = await storage.claimNextKnowledgeBaseIndexingJob();
      workerLog(`claimNextKnowledgeBaseIndexingJob returned: ${job ? `job ${job.id}` : "null"}`);
      if (!job) {
        // Нет доступных job'ов, продолжаем опрос
        return;
      }

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
  }

  function scheduleNext() {
    if (stopped) {
      return;
    }
    setTimeout(() => {
      poll().finally(() => {
        scheduleNext();
      });
    }, POLL_INTERVAL_MS);
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
