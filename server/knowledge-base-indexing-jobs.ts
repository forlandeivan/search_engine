import type { KnowledgeBaseIndexingJob, Workspace, EmbeddingProvider } from "@shared/schema";
import { storage } from "./storage";
import { buildWorkspaceScopedCollectionName } from "./qdrant-utils";
import { knowledgeBaseIndexingPolicyService } from "./knowledge-base-indexing-policy";
import { createKnowledgeDocumentChunkSet, updateKnowledgeDocumentChunkVectorRecords } from "./knowledge-chunks";
import { getKnowledgeBaseById, getKnowledgeNodeDetail } from "./knowledge-base";
import { resolveEmbeddingProviderForWorkspace } from "./indexing-rules";
import { getQdrantClient } from "./qdrant";
import { ensureCollectionCreatedIfNeeded } from "./qdrant-collections";
import type { CollectionSchemaFieldInput } from "@shared/vectorization";
import { renderLiquidTemplate, castValueToType, normalizeArrayValue } from "@shared/vectorization";
import { buildVectorPayload } from "./qdrant-utils";
import type { Schemas } from "./qdrant-client";
import { fetchAccessToken } from "./llm-access-token";

function buildKnowledgeCollectionName(
  base: { id?: string | null; name?: string | null } | null | undefined,
  provider: EmbeddingProvider,
  workspaceId: string,
): string {
  const source = base?.id ?? base?.name ?? provider.id;
  return buildWorkspaceScopedCollectionName(workspaceId, source, provider.id);
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
      console.error(`Не удалось обработать поле схемы "${field.name}"`, error);
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
  // Упрощенная версия - можно улучшить, используя полную логику из routes.ts
  const response = await fetch(provider.embeddingsUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
      ...provider.requestHeaders,
    },
    body: JSON.stringify({
      model: provider.model,
      input: text,
    }),
  });

  if (!response.ok) {
    throw new Error(`Embedding API error: ${response.statusText}`);
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

function computeRetryDelayMs(attempts: number): number {
  const exponent = Math.max(0, attempts - 1);
  const delay = BASE_RETRY_DELAY_MS * Math.pow(2, exponent);
  return Math.min(Math.max(BASE_RETRY_DELAY_MS, delay), MAX_RETRY_DELAY_MS);
}

async function processJob(job: KnowledgeBaseIndexingJob): Promise<void> {
  if (job.jobType && job.jobType !== JOB_TYPE) {
    return;
  }

  let embeddingProvider: Awaited<ReturnType<typeof resolveEmbeddingProviderForWorkspace>>["provider"] | null = null;
  let workspace: Workspace | undefined;

  try {
    workspace = await storage.getWorkspace(job.workspaceId);
    if (!workspace) {
      const message = "Рабочее пространство не найдено";
      await storage.failKnowledgeBaseIndexingJob(job.id, message);
      return;
    }

    const base = await getKnowledgeBaseById(job.workspaceId, job.baseId);
    if (!base) {
      const message = "База знаний не найдена";
      await storage.failKnowledgeBaseIndexingJob(job.id, message);
      return;
    }

    const nodeDetail = await getKnowledgeNodeDetail(job.baseId, job.documentId, job.workspaceId);
    if (!nodeDetail || nodeDetail.type !== "document") {
      const message = "Документ не найден";
      await storage.failKnowledgeBaseIndexingJob(job.id, message);
      return;
    }

    const policy = await knowledgeBaseIndexingPolicyService.get();

    try {
      const resolved = await resolveEmbeddingProviderForWorkspace({ workspaceId: job.workspaceId });
      embeddingProvider = resolved.provider;
      if (!embeddingProvider) {
        const message = "Сервис эмбеддингов недоступен в админ-настройках";
        await storage.failKnowledgeBaseIndexingJob(job.id, message);
        return;
      }
    } catch (error) {
      const message =
        error instanceof Error && error.message ? error.message : "Сервис эмбеддингов недоступен в админ-настройках";
      await storage.failKnowledgeBaseIndexingJob(job.id, message);
      return;
    }

    // Создаем чанки
    const chunkSet = await createKnowledgeDocumentChunkSet(
      job.baseId,
      job.documentId,
      job.workspaceId,
      {
        maxChars: policy.chunkSize,
        overlapChars: policy.chunkOverlap,
        splitByPages: false,
        respectHeadings: true,
      },
    );

    if (!chunkSet || chunkSet.chunks.length === 0) {
      const message = "Не удалось создать чанки для документа";
      await storage.failKnowledgeBaseIndexingJob(job.id, message);
      return;
    }

    // Получаем эмбеддинги
    const accessToken = await fetchAccessToken(embeddingProvider);

    const embeddingResults: Array<{
      chunk: typeof chunkSet.chunks[0];
      vector: number[];
      usageTokens?: number;
      embeddingId?: string | number;
      index: number;
    }> = [];

    for (let index = 0; index < chunkSet.chunks.length; index += 1) {
      const chunk = chunkSet.chunks[index];
      try {
        const result = await fetchEmbeddingVectorForChunk(embeddingProvider, accessToken, chunk.text);
        embeddingResults.push({
          chunk,
          vector: result.vector,
          usageTokens: result.usageTokens,
          embeddingId: result.embeddingId,
          index,
        });
      } catch (embeddingError) {
        console.error("Ошибка эмбеддинга чанка документа базы знаний", embeddingError);
        const errorMessage = embeddingError instanceof Error ? embeddingError.message : String(embeddingError);
        throw new Error(`Ошибка эмбеддинга чанка #${index + 1}: ${errorMessage}`);
      }
    }

    if (embeddingResults.length === 0) {
      const message = "Не удалось получить эмбеддинги для документа";
      await storage.failKnowledgeBaseIndexingJob(job.id, message);
      return;
    }

    // Создаем коллекцию
    const collectionName = buildKnowledgeCollectionName(base, embeddingProvider, job.workspaceId);
    const client = getQdrantClient();
    const firstVector = embeddingResults[0]?.vector;
    if (!Array.isArray(firstVector) || firstVector.length === 0) {
      const message = "Сервис эмбеддингов вернул пустой вектор";
      await storage.failKnowledgeBaseIndexingJob(job.id, message);
      return;
    }

    const detectedVectorLength = firstVector.length;
    const collectionExists = await (client as any).collectionExists?.(collectionName) ?? false;

    await ensureCollectionCreatedIfNeeded({
      client,
      provider: embeddingProvider,
      collectionName,
      detectedVectorLength,
      shouldCreateCollection: true,
      collectionExists,
    });

    await storage.upsertCollectionWorkspace(collectionName, job.workspaceId);

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
        },
        embedding: {
          model: embeddingProvider.model,
          vectorSize: vector.length,
          tokens: usageTokens ?? null,
          id: embeddingId ?? null,
        },
      }) as Record<string, unknown>;

      const rawPayload = {
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
      const payload = removeUndefinedDeep(payloadSource) as Record<string, unknown>;

      const pointVectorPayload = buildVectorPayload(
        vector,
        embeddingProvider.qdrantConfig?.vectorFieldName,
      ) as Schemas["PointStruct"]["vector"];

      const pointId = normalizePointId(resolvedChunkId);

      return {
        id: pointId,
        vector: pointVectorPayload,
        payload,
      };
    });

    // Загружаем векторы в Qdrant
    await client.upsert(collectionName, {
      wait: true,
      points,
    });

    // Обновляем vectorRecordId в чанках
    const vectorRecordMappings = embeddingResults.map((result, index) => {
      const chunk = result.chunk;
      const resolvedChunkId = chunk.id ?? `${nodeDetail.id}-chunk-${index + 1}`;
      const pointId = normalizePointId(resolvedChunkId);
      const recordIdValue = typeof pointId === "number" ? pointId.toString() : String(pointId);
      return { chunkId: resolvedChunkId, vectorRecordId: recordIdValue };
    });

    await updateKnowledgeDocumentChunkVectorRecords({
      chunkSetId: chunkSet.id,
      mappings: vectorRecordMappings,
    });

    const totalChars = chunkSet.chunks.reduce((sum, chunk) => sum + (chunk.charCount ?? 0), 0);
    const totalTokens = chunkSet.chunks.reduce((sum, chunk) => sum + (chunk.tokenCount ?? 0), 0);

    await storage.markKnowledgeBaseIndexingJobDone(job.id, {
      chunkCount: chunkSet.chunks.length,
      totalChars,
      totalTokens,
    });

    console.info(
      `[${JOB_TYPE}] indexed document=${nodeDetail.id} base=${base.id} chunks=${chunkSet.chunks.length}`,
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const isRetryable = error instanceof Error && (error.message.includes("timeout") || error.message.includes("network"));

    if (isRetryable && job.attempts < MAX_ATTEMPTS) {
      const nextRetryAt = new Date(Date.now() + computeRetryDelayMs(job.attempts + 1));
      await storage.rescheduleKnowledgeBaseIndexingJob(job.id, nextRetryAt, errorMessage);
      throw error;
    }

    await storage.failKnowledgeBaseIndexingJob(job.id, errorMessage);
  }
}

function normalizePointId(chunkId: string): string | number {
  // Простая нормализация - можно улучшить
  const hash = chunkId.split("").reduce((acc, char) => {
    const code = char.charCodeAt(0);
    return ((acc << 5) - acc + code) | 0;
  }, 0);
  return Math.abs(hash);
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
      const job = await storage.claimNextKnowledgeBaseIndexingJob();
      if (!job) {
        return;
      }

      try {
        await processJob(job);
      } catch (error) {
        // Ошибка уже обработана в processJob
        console.error(`[${JOB_TYPE}] job ${job.id} failed`, error);
      }
    } catch (error) {
      console.error(`[${JOB_TYPE}] worker error`, error);
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

  console.info(`[${JOB_TYPE}] worker started`);
  scheduleNext();

  return {
    stop() {
      stopped = true;
      console.info(`[${JOB_TYPE}] worker stopped`);
    },
  };
}

