import type { ChatFileIngestionJob } from "@shared/schema";
import { storage } from "./storage";
import { extractTextFromBuffer, TextExtractionError } from "./text-extraction";
import { chunkSkillFileText, ChunkingError, MAX_CHUNKS_PER_FILE } from "./skill-file-chunking";
import { indexingRulesService } from "./indexing-rules";
import { embedSkillFileChunks, EmbeddingError } from "./skill-file-embeddings";
import { upsertChatFileVectors, ChatFileVectorStoreError } from "./chat-file-vector-store";
import { getSkillById } from "./skills";
import type { Workspace } from "@shared/schema";
import { resolveEmbeddingProviderForWorkspace } from "./indexing-rules";
import { getWorkspaceFile } from "./workspace-storage-service";
import { createLogger } from "./lib/logger";

const logger = createLogger("chat-file-ingestion");

const POLL_INTERVAL_MS = 5_000;
const BASE_RETRY_DELAY_MS = 30_000;
const MAX_RETRY_DELAY_MS = 10 * 60_000;
const MAX_ATTEMPTS = 5;
const JOB_TYPE = "chat_file_ingestion";

function computeRetryDelayMs(attempts: number): number {
  const exponent = Math.max(0, attempts - 1);
  const delay = BASE_RETRY_DELAY_MS * Math.pow(2, exponent);
  return Math.min(Math.max(BASE_RETRY_DELAY_MS, delay), MAX_RETRY_DELAY_MS);
}

async function processJob(job: ChatFileIngestionJob): Promise<void> {
  if (job.jobType && job.jobType !== JOB_TYPE) {
    return;
  }

  let embeddingProvider: Awaited<ReturnType<typeof resolveEmbeddingProviderForWorkspace>>["provider"] | null = null;
  let workspace: Workspace | undefined;

  // Get attachment
  const attachment = await storage.getChatAttachment(job.attachmentId);
  if (!attachment) {
    await storage.failChatFileIngestionJob(job.id, "Attachment не найден");
    return;
  }

  // Check if file still exists in storage
  if (!attachment.storageKey || attachment.storageKey === "") {
    logger.info({ jobId: job.id, attachmentId: attachment.id }, "File already cleaned up, skipping");
    await storage.markChatFileIngestionJobDone(job.id, {
      chunkCount: 0,
      totalChars: 0,
      totalTokens: 0,
    });
    return;
  }

  try {
    workspace = await storage.getWorkspace(attachment.workspaceId);
    if (!workspace) {
      const message = "Рабочее пространство не найдено";
      await storage.failChatFileIngestionJob(job.id, message);
      return;
    }

    const skill = await getSkillById(attachment.workspaceId, job.skillId);
    if (!skill) {
      const message = "Навык не найден";
      await storage.failChatFileIngestionJob(job.id, message);
      return;
    }

    // Get embedding provider
    try {
      const resolved = await resolveEmbeddingProviderForWorkspace({ workspaceId: attachment.workspaceId });
      embeddingProvider = resolved.provider;
    } catch (error) {
      const message =
        error instanceof Error && error.message ? error.message : "Сервис эмбеддингов недоступен в админ-настройках";
      await storage.failChatFileIngestionJob(job.id, message);
      return;
    }

    if (!embeddingProvider) {
      const message = "Провайдер эмбеддингов не настроен";
      await storage.failChatFileIngestionJob(job.id, message);
      return;
    }

    // Extract text from file in storage
    logger.info({ jobId: job.id, attachmentId: attachment.id, storageKey: attachment.storageKey }, "Extracting text from file");
    
    let extractedText: string;
    try {
      const fileObject = await getWorkspaceFile(attachment.workspaceId, attachment.storageKey);
      if (!fileObject?.body) {
        throw new TextExtractionError({
          code: "TEXT_EXTRACTION_FAILED",
          message: "Файл не найден в хранилище",
          retryable: false,
        });
      }

      // Stream to buffer
      const chunks: Buffer[] = [];
      for await (const chunk of fileObject.body) {
        chunks.push(Buffer.from(chunk));
      }
      const buffer = Buffer.concat(chunks);

      const result = await extractTextFromBuffer({
        buffer,
        filename: attachment.filename,
        mimeType: attachment.mimeType,
      });
      extractedText = result.text;
    } catch (error) {
      if (error instanceof TextExtractionError) {
        if (error.retryable) {
          throw error;
        }
        // Non-retryable extraction error
        const message = `Извлечение текста: ${error.message}`;
        logger.warn({ jobId: job.id, attachmentId: attachment.id, error: message }, "Non-retryable extraction error");
        await storage.failChatFileIngestionJob(job.id, message);
        return;
      }
      throw error;
    }

    if (!extractedText || extractedText.trim().length === 0) {
      const message = "Извлеченный текст пуст";
      logger.warn({ jobId: job.id, attachmentId: attachment.id }, message);
      await storage.failChatFileIngestionJob(job.id, message);
      return;
    }

    const totalChars = extractedText.length;
    logger.info({ jobId: job.id, attachmentId: attachment.id, totalChars }, "Text extracted successfully");

    // Chunk text
    const contextInputLimit = skill.contextInputLimit ?? null;
    const maxContextTokens = contextInputLimit;

    const rules = await indexingRulesService.getRulesForWorkspace(attachment.workspaceId);
    const chunkingConfig = {
      maxChunkSizeChars: rules?.chunkSize ?? 1500,
      chunkOverlapChars: rules?.chunkOverlap ?? 200,
      minChunkSizeChars: 100,
      maxChunksPerDocument: MAX_CHUNKS_PER_FILE,
    };

    let chunks: Awaited<ReturnType<typeof chunkSkillFileText>>["chunks"];
    try {
      const result = await chunkSkillFileText({
        text: extractedText,
        config: chunkingConfig,
        contextInputLimit: maxContextTokens,
      });
      chunks = result.chunks;
    } catch (error) {
      if (error instanceof ChunkingError) {
        const message = `Разбивка на чанки: ${error.message}`;
        await storage.failChatFileIngestionJob(job.id, message);
        return;
      }
      throw error;
    }

    if (chunks.length === 0) {
      const message = "Не удалось создать чанки из текста";
      await storage.failChatFileIngestionJob(job.id, message);
      return;
    }

    logger.info({ jobId: job.id, attachmentId: attachment.id, chunkCount: chunks.length }, "Text chunked");

    // Embed chunks
    let embeddings: number[][];
    let totalTokens = 0;

    try {
      const result = await embedSkillFileChunks({
        provider: embeddingProvider,
        chunks: chunks,
      });
      embeddings = result.map(r => r.vector);
      totalTokens = result.reduce((sum, r) => sum + (r.usageTokens ?? 0), 0);
    } catch (error) {
      if (error instanceof EmbeddingError) {
        const message = `Создание эмбеддингов: ${error.message}`;
        if (error.retryable) {
          throw error;
        }
        await storage.failChatFileIngestionJob(job.id, message);
        return;
      }
      throw error;
    }

    if (embeddings.length !== chunks.length) {
      const message = `Несоответствие: ${chunks.length} чанков, но ${embeddings.length} эмбеддингов`;
      await storage.failChatFileIngestionJob(job.id, message);
      return;
    }

    logger.info({ jobId: job.id, attachmentId: attachment.id, embeddingCount: embeddings.length, totalTokens }, "Embeddings created");

    // Upsert vectors to Qdrant
    const vectors = chunks.map((chunk, index) => ({
      chunkId: chunk.id,
      chunkIndex: chunk.index,
      text: chunk.text,
      vector: embeddings[index],
    }));

    try {
      await upsertChatFileVectors({
        workspaceId: attachment.workspaceId,
        skillId: job.skillId,
        chatId: job.chatId,
        attachmentId: attachment.id,
        fileVersion: job.fileVersion,
        provider: embeddingProvider,
        vectors,
        originalName: attachment.filename,
        uploadedByUserId: attachment.uploaderUserId,
      });
    } catch (error) {
      if (error instanceof ChatFileVectorStoreError) {
        const message = `Запись в Qdrant: ${error.message}`;
        if (error.retryable) {
          throw error;
        }
        await storage.failChatFileIngestionJob(job.id, message);
        return;
      }
      throw error;
    }

    logger.info({ jobId: job.id, attachmentId: attachment.id, vectorCount: vectors.length }, "Vectors upserted to Qdrant");

    // Mark job as done
    await storage.markChatFileIngestionJobDone(job.id, {
      chunkCount: chunks.length,
      totalChars,
      totalTokens,
    });

    logger.info({ jobId: job.id, attachmentId: attachment.id }, "Job completed successfully");
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Неизвестная ошибка";
    logger.error({ err: error, jobId: job.id, attachmentId: job.attachmentId }, "Job processing failed");

    // Determine if should retry
    const isRetryable =
      error instanceof TextExtractionError && error.retryable ||
      error instanceof EmbeddingError && error.retryable ||
      error instanceof ChatFileVectorStoreError && error.retryable;

    if (isRetryable && job.attempts < MAX_ATTEMPTS) {
      const nextRetryAt = new Date(Date.now() + computeRetryDelayMs(job.attempts + 1));
      await storage.rescheduleChatFileIngestionJob(job.id, nextRetryAt, errorMessage);
      logger.info({ jobId: job.id, nextRetryAt, attempts: job.attempts + 1 }, "Job rescheduled for retry");
    } else {
      await storage.failChatFileIngestionJob(job.id, errorMessage);
      logger.warn({ jobId: job.id, attempts: job.attempts }, "Job failed permanently");
    }
  }
}

async function pollAndProcess(): Promise<void> {
  try {
    const job = await storage.claimNextChatFileIngestionJob();
    if (job) {
      logger.info({ jobId: job.id, attachmentId: job.attachmentId }, "Processing job");
      await processJob(job);
    }
  } catch (error) {
    logger.error({ err: error }, "Error in poll cycle");
  }
}

export function startChatFileIngestionWorker(): { stop: () => void } {
  let stopped = false;

  const run = async () => {
    while (!stopped) {
      await pollAndProcess();
      if (!stopped) {
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      }
    }
  };

  // Start polling in background
  void run();

  logger.info("Chat file ingestion worker started");

  return {
    stop() {
      stopped = true;
      logger.info("Chat file ingestion worker stopping");
    },
  };
}
