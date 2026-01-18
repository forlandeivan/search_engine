import type { Schemas } from "@qdrant/js-client-rest";
import { createHash } from "crypto";

import { EmbeddingProvider } from "@shared/schema";
import { getQdrantClient } from "./qdrant";
import { storage } from "./storage";
import { getHttpStatus, getErrorCode, type QdrantApiError } from "./types/errors";
import {
  buildSkillFileChunkPayload,
  buildSkillFileVectorFilter,
} from "./skill-file-payload";

export type SkillFileVectorPoint = {
  id: string;
  vector: number[];
  chunkId: string;
  chunkIndex: number;
  text: string;
};

export class VectorStoreError extends Error {
  constructor(message: string, public retryable: boolean) {
    super(message);
    this.name = "VectorStoreError";
  }
}

function sanitizeCollectionName(source: string): string {
  const normalized = source.replace(/[^a-zA-Z0-9_-]/g, "").toLowerCase();
  return normalized.length > 0 ? normalized.slice(0, 60) : "default";
}

function buildWorkspaceScopedCollectionName(workspaceId: string, projectId: string, collectionId: string): string {
  const workspaceSlug = sanitizeCollectionName(workspaceId);
  const projectSlug = sanitizeCollectionName(projectId);
  const collectionSlug = sanitizeCollectionName(collectionId);
  return `ws_${workspaceSlug}__proj_${projectSlug}__coll_${collectionSlug}`;
}

function toDeterministicUuid(input: string): string {
  const hex = createHash("sha256").update(input, "utf8").digest("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}

function buildSkillFileCollectionName(workspaceId: string, provider: EmbeddingProvider): string {
  const suffix = sanitizeCollectionName(provider.id || "skill_files");
  return buildWorkspaceScopedCollectionName(workspaceId, "skill_files", suffix);
}

function resolveSkillFileCollectionName(workspaceId: string, provider: EmbeddingProvider): string {
  const configuredName =
    typeof provider.qdrantConfig?.collectionName === "string" &&
    provider.qdrantConfig.collectionName.trim().toLowerCase() !== "auto"
      ? provider.qdrantConfig.collectionName.trim()
      : null;
  return configuredName ?? buildSkillFileCollectionName(workspaceId, provider);
}

function buildVectorPayload(vector: number[], _vectorFieldName?: string | null | undefined): number[] {
  if (!Array.isArray(vector) || vector.length === 0) {
    return vector;
  }

  const sanitizedVector = vector.map((entry, index) => {
    if (typeof entry !== "number" || Number.isNaN(entry)) {
      throw new Error(`Некорректное значение компоненты вектора (index=${index})`);
    }

    if (!Number.isFinite(entry)) {
      throw new Error(`Компонента вектора содержит бесконечность (index=${index})`);
    }

    return entry;
  });

  return sanitizedVector;
}

function isRetryableVectorError(error: unknown): boolean {
  const nodeCode = getErrorCode(error);
  if (typeof nodeCode === "string") {
    const retryableCodes = ["ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "EAI_AGAIN", "EPIPE"];
    if (retryableCodes.includes(nodeCode)) {
      return true;
    }
  }

  const status = getHttpStatus(error);
  if (typeof status === "number") {
    return status >= 500 || status === 429 || status === 408;
  }

  return true;
}

function isQdrantNotFoundError(error: unknown): boolean {
  const status = getHttpStatus(error);
  return status === 404;
}

async function ensureSkillFileCollection(options: {
  workspaceId: string;
  provider: EmbeddingProvider;
  vectorSize: number;
}): Promise<string> {
  const client = getQdrantClient();
  const { workspaceId, provider, vectorSize } = options;
  const collectionName = resolveSkillFileCollectionName(workspaceId, provider);

  let collectionExists = false;
  try {
    await client.getCollection(collectionName);
    collectionExists = true;
  } catch {
    collectionExists = false;
  }

  if (!collectionExists) {
    try {
      await client.createCollection(collectionName, {
        vectors: {
          size: vectorSize,
          distance: "Cosine",
        },
      });
      await storage.upsertCollectionWorkspace(collectionName, workspaceId);
    } catch (error) {
      throw new VectorStoreError("Не удалось подготовить коллекцию векторного хранилища", true);
    }
  } else {
    await storage.upsertCollectionWorkspace(collectionName, workspaceId);
  }

  return collectionName;
}

export function buildSkillFilePoints(params: {
  workspaceId: string;
  skillId: string;
  fileId: string;
  fileVersion: number;
  originalName?: string | null;
  vectors: Array<{ chunkId: string; chunkIndex: number; text: string; vector: number[] }>;
  vectorFieldName?: string | null;
}): Schemas["PointStruct"][] {
  const {
    workspaceId,
    skillId,
    fileId,
    fileVersion,
    originalName,
    vectors,
    vectorFieldName,
  } = params;

  return vectors.map((entry) => ({
    id: toDeterministicUuid(`${fileId}:${fileVersion}:${entry.chunkId}:${entry.chunkIndex}`),
    vector: buildVectorPayload(entry.vector, vectorFieldName),
    payload: buildSkillFileChunkPayload({
      workspaceId,
      skillId,
      fileId,
      fileVersion,
      chunkId: entry.chunkId,
      chunkIndex: entry.chunkIndex,
      text: entry.text,
      originalName,
    }),
  }));
}

export async function upsertSkillFileVectors(params: {
  workspaceId: string;
  skillId: string;
  fileId: string;
  fileVersion: number;
  provider: EmbeddingProvider;
  vectors: Array<{ chunkId: string; chunkIndex: number; text: string; vector: number[] }>;
}): Promise<void> {
  const { workspaceId, skillId, fileId, fileVersion, provider, vectors } = params;
  if (!workspaceId || !skillId || !fileId) {
    throw new VectorStoreError(
      "Некорректные параметры записи векторных точек: отсутствует workspaceId/skillId/fileId",
      false,
    );
  }

  if (!vectors || vectors.length === 0) {
    return;
  }

  const vectorSize = vectors[0]?.vector?.length ?? 0;
  if (!vectorSize) {
    throw new VectorStoreError("Вектор эмбеддинга пустой", false);
  }

  const client = getQdrantClient();
  const collectionName = await ensureSkillFileCollection({ workspaceId, provider, vectorSize });
  const points = buildSkillFilePoints({
    workspaceId,
    skillId,
    fileId,
    fileVersion,
    originalName: null,
    vectors,
    vectorFieldName: provider.qdrantConfig?.vectorFieldName,
  });

  try {
    await client.upsert(collectionName, {
      points,
      wait: true,
      ordering: "weak",
    });
  } catch (error) {
    const message = "Не удалось записать данные документа в векторное хранилище";
    throw new VectorStoreError(message, isRetryableVectorError(error));
  }
}

export async function deleteSkillFileVectors(params: {
  workspaceId: string;
  skillId: string;
  fileId: string;
  fileVersion?: number | null;
  provider: EmbeddingProvider;
  caller?: string;
}): Promise<{ durationMs: number | null }> {
  const { workspaceId, skillId, fileId, fileVersion, provider, caller } = params;
  if (!workspaceId || !skillId || !fileId) {
    throw new VectorStoreError(
      "Некорректные параметры удаления векторных точек: отсутствует workspaceId/skillId/fileId",
      false,
    );
  }
  const client = getQdrantClient();
  const collectionName = resolveSkillFileCollectionName(workspaceId, provider);

  const startedAt = performance.now ? performance.now() : Date.now();
  const logContext = {
    collectionName,
    workspaceId,
    skillId,
    fileId,
    fileVersion,
    caller: caller ?? "runtime",
  };
  try {
    await client.getCollection(collectionName);
  } catch {
    return { durationMs: null };
  }

  const must: any[] = [
    { key: "workspace_id", match: { value: workspaceId } },
    { key: "skill_id", match: { value: skillId } },
    { key: "doc_id", match: { value: fileId } },
  ];
  if (fileVersion !== null && fileVersion !== undefined) {
    must.push({ key: "doc_version", match: { value: fileVersion } });
  }

  try {
    await client.delete(collectionName, {
      wait: true,
      points: undefined,
      filter: buildSkillFileVectorFilter({ workspaceId, skillId, fileId, fileVersion }),
    });
    const durationMs = (performance.now ? performance.now() : Date.now()) - startedAt;
    if (durationMs > 1500) {
      console.warn("[skill-file-vectors] slow delete by filter", { ...logContext, durationMs });
    } else {
      console.info("[skill-file-vectors] delete by filter completed", { ...logContext, durationMs });
    }
    return { durationMs };
  } catch (error) {
    throw new VectorStoreError("Не удалось очистить данные документа из векторной БД", true);
  }
}

type SkillVectorSearchResult = {
  collection: string | null;
  results: Schemas["ScoredPoint"][];
  guardrailTriggered: boolean;
  guardrailReason?: string;
};

function logGuardrailWarning(reason: string, context: Record<string, unknown>) {
  const payload = { guardrail: "skill_file_search", reason, ...context };
  console.warn("[vector-guardrail] blocked search", payload);
}

export async function searchSkillFileVectors(params: {
  workspaceId: string;
  skillId: string;
  provider: EmbeddingProvider;
  vector: number[];
  limit: number;
  scoreThreshold?: number | null;
  caller?: string;
}): Promise<SkillVectorSearchResult> {
  const { workspaceId, skillId, provider, vector, limit, scoreThreshold, caller } = params;
  if (!workspaceId || !skillId) {
    logGuardrailWarning("missing_scope", {
      workspaceId: workspaceId || "<empty>",
      skillId: skillId || "<empty>",
      caller: caller ?? "runtime",
    });
    return { collection: null, results: [], guardrailTriggered: true, guardrailReason: "missing_scope" };
  }

  const vectorPayload = buildVectorPayload(vector, provider.qdrantConfig?.vectorFieldName);
  if (!vectorPayload || (Array.isArray(vectorPayload) && vectorPayload.length === 0)) {
    return { collection: null, results: [], guardrailTriggered: true, guardrailReason: "empty_vector" };
  }

  const client = getQdrantClient();
  const collectionName = resolveSkillFileCollectionName(workspaceId, provider);

  const ownerWorkspaceId = await storage.getCollectionWorkspace(collectionName);
  if (ownerWorkspaceId && ownerWorkspaceId !== workspaceId) {
    logGuardrailWarning("foreign_collection", {
      collectionName,
      ownerWorkspaceId,
      workspaceId,
      skillId,
      caller: caller ?? "runtime",
    });
    return {
      collection: null,
      results: [],
      guardrailTriggered: true,
      guardrailReason: "foreign_collection",
    };
  }

  const searchPayload: Parameters<typeof client.search>[1] = {
    vector: vectorPayload,
    limit,
    filter: buildSkillFileVectorFilter({ workspaceId, skillId }),
    with_payload: true,
    with_vector: false,
  };

  if (scoreThreshold !== null && scoreThreshold !== undefined) {
    searchPayload.score_threshold = scoreThreshold;
  }

  try {
    const results = await client.search(collectionName, searchPayload);
    return { collection: collectionName, results, guardrailTriggered: false };
  } catch (error) {
    if (isQdrantNotFoundError(error)) {
      logGuardrailWarning("collection_missing", { collectionName, workspaceId, skillId, caller: caller ?? "runtime" });
      return { collection: collectionName, results: [], guardrailTriggered: true, guardrailReason: "collection_missing" };
    }
    throw new VectorStoreError("Не удалось выполнить поиск в векторном хранилище", isRetryableVectorError(error));
  }
}
