import type { Schemas } from "@qdrant/js-client-rest";
import { createHash } from "crypto";
import { EmbeddingProvider } from "@shared/schema";
import { getQdrantClient } from "./qdrant";
import { 
  buildChatFileChunkPayload, 
  buildChatFileVectorFilter,
  CHAT_FILE_SOURCE,
  type ChatFileChunkPayload,
} from "./chat-file-payload";
import { resolveSkillFileCollectionName, isRetryableVectorError } from "./skill-file-vector-store";

export class ChatFileVectorStoreError extends Error {
  constructor(message: string, public retryable: boolean) {
    super(message);
    this.name = "ChatFileVectorStoreError";
  }
}

export type ChatFileVectorSearchResult = {
  chunks: Array<{
    id: string;
    score: number;
    text: string;
    attachmentId: string;
    chatId: string;
    originalName: string | null;
  }>;
};

/**
 * Используем ту же коллекцию что и для skill files
 * Разделение по полю source в payload
 */
function resolveChatFileCollectionName(
  workspaceId: string, 
  provider: EmbeddingProvider
): string {
  return resolveSkillFileCollectionName(workspaceId, provider);
}

/**
 * Генерация детерминированного UUID для точки
 */
function toChatFilePointId(input: string): string {
  const hex = createHash("sha256").update(input, "utf8").digest("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}

/**
 * Построить точки для upsert в Qdrant
 */
export function buildChatFilePoints(params: {
  workspaceId: string;
  skillId: string;
  chatId: string;
  attachmentId: string;
  fileVersion: number;
  originalName?: string | null;
  uploadedByUserId?: string | null;
  vectors: Array<{ chunkId: string; chunkIndex: number; text: string; vector: number[] }>;
}): Schemas["PointStruct"][] {
  const { workspaceId, skillId, chatId, attachmentId, fileVersion, vectors } = params;

  return vectors.map((entry) => ({
    id: toChatFilePointId(`${attachmentId}:${fileVersion}:${entry.chunkId}:${entry.chunkIndex}`),
    vector: entry.vector,
    payload: buildChatFileChunkPayload({
      workspaceId,
      skillId,
      chatId,
      attachmentId,
      fileVersion,
      chunkId: entry.chunkId,
      chunkIndex: entry.chunkIndex,
      text: entry.text,
      originalName: params.originalName,
      uploadedByUserId: params.uploadedByUserId,
    }),
  }));
}

/**
 * Записать векторы файла чата в Qdrant
 */
export async function upsertChatFileVectors(params: {
  workspaceId: string;
  skillId: string;
  chatId: string;
  attachmentId: string;
  fileVersion: number;
  provider: EmbeddingProvider;
  vectors: Array<{ chunkId: string; chunkIndex: number; text: string; vector: number[] }>;
  originalName?: string | null;
  uploadedByUserId?: string | null;
}): Promise<void> {
  const { workspaceId, provider, vectors } = params;

  if (!vectors || vectors.length === 0) {
    return;
  }

  const client = getQdrantClient();
  const collectionName = resolveChatFileCollectionName(workspaceId, provider);
  
  const points = buildChatFilePoints(params);

  try {
    await client.upsert(collectionName, {
      points,
      wait: true,
      ordering: "weak",
    });
  } catch (error) {
    throw new ChatFileVectorStoreError(
      "Не удалось записать данные файла в векторное хранилище",
      isRetryableVectorError(error)
    );
  }
}

/**
 * Поиск по векторам файлов чата
 */
export async function searchChatFileVectors(params: {
  workspaceId: string;
  skillId: string;
  chatId: string;
  sharedChatFiles: boolean;
  provider: EmbeddingProvider;
  vector: number[];
  limit: number;
  scoreThreshold?: number | null;
}): Promise<ChatFileVectorSearchResult> {
  const { workspaceId, skillId, chatId, sharedChatFiles, provider, vector, limit } = params;

  const client = getQdrantClient();
  const collectionName = resolveChatFileCollectionName(workspaceId, provider);

  const filter = buildChatFileVectorFilter({
    workspaceId,
    skillId,
    chatId,
    sharedChatFiles,
  });

  try {
    const response = await client.search(collectionName, {
      vector,
      limit,
      filter,
      with_payload: true,
      score_threshold: params.scoreThreshold ?? undefined,
    });

    const chunks = response.map((point) => {
      const payload = point.payload as ChatFileChunkPayload | undefined;
      return {
        id: String(point.id),
        score: point.score,
        text: payload?.chunk_text ?? "",
        attachmentId: payload?.attachment_id ?? "",
        chatId: payload?.chat_id ?? "",
        originalName: payload?.original_name ?? null,
      };
    });

    return { chunks };
  } catch (error) {
    throw new ChatFileVectorStoreError(
      "Не удалось выполнить поиск в векторном хранилище",
      isRetryableVectorError(error)
    );
  }
}

/**
 * Удалить векторы файла чата из Qdrant
 */
export async function deleteChatFileVectors(params: {
  workspaceId: string;
  skillId: string;
  chatId: string;
  attachmentId: string;
  provider: EmbeddingProvider;
}): Promise<void> {
  const { workspaceId, skillId, chatId, attachmentId, provider } = params;

  const client = getQdrantClient();
  const collectionName = resolveChatFileCollectionName(workspaceId, provider);

  const filter = buildChatFileVectorFilter({
    workspaceId,
    skillId,
    chatId,
    sharedChatFiles: false,
    attachmentId,
  });

  try {
    await client.delete(collectionName, {
      wait: true,
      filter,
    });
  } catch (error) {
    throw new ChatFileVectorStoreError(
      "Не удалось удалить векторы файла из хранилища",
      isRetryableVectorError(error)
    );
  }
}
