import type { SkillFileIngestionJob } from "@shared/schema";
import { storage } from "./storage";
import { extractSkillFileText, TextExtractionError } from "./text-extraction";
import { chunkSkillFileText, ChunkingError, MAX_CHUNKS_PER_FILE } from "./skill-file-chunking";
import { indexingRulesService } from "./indexing-rules";
import { embedSkillFileChunks, EmbeddingError } from "./skill-file-embeddings";
import { upsertSkillFileVectors, deleteSkillFileVectors, VectorStoreError } from "./skill-file-vector-store";
import { getSkillById } from "./skills";
import type { Workspace } from "@shared/schema";
import { resolveEmbeddingProviderForWorkspace } from "./indexing-rules";

const POLL_INTERVAL_MS = 5_000;
const BASE_RETRY_DELAY_MS = 30_000;
const MAX_RETRY_DELAY_MS = 10 * 60_000;
const MAX_ATTEMPTS = 5;
const JOB_TYPE = "skill_file_ingestion";

function computeRetryDelayMs(attempts: number): number {
  const exponent = Math.max(0, attempts - 1);
  const delay = BASE_RETRY_DELAY_MS * Math.pow(2, exponent);
  return Math.min(Math.max(BASE_RETRY_DELAY_MS, delay), MAX_RETRY_DELAY_MS);
}

async function processJob(job: SkillFileIngestionJob): Promise<void> {
  if (job.jobType && job.jobType !== JOB_TYPE) {
    return;
  }

  let embeddingProvider: Awaited<ReturnType<typeof resolveEmbeddingProviderForWorkspace>>["provider"] | null = null;
  let workspace: Workspace | undefined;

  const file = await storage.getSkillFile(job.fileId, job.workspaceId, job.skillId);
  if (!file) {
    await storage.failSkillFileIngestionJob(job.id, "Файл для обработки не найден");
    return;
  }

  await storage.updateSkillFileStatus(file.id, file.workspaceId, file.skillId, {
    status: "processing",
    processingStatus: "processing",
    errorMessage: null,
    processingErrorMessage: null,
  });

  try {
    workspace = await storage.getWorkspace(file.workspaceId);
    if (!workspace) {
      const message = "Рабочее пространство не найдено";
      await storage.failSkillFileIngestionJob(job.id, message);
      await storage.updateSkillFileStatus(file.id, file.workspaceId, file.skillId, {
        status: "error",
        processingStatus: "error",
        processingErrorMessage: message,
        errorMessage: message,
      });
      return;
    }

    const skill = await getSkillById(file.workspaceId, file.skillId);
    if (!skill) {
      const message = "Навык для файла не найден";
      await storage.failSkillFileIngestionJob(job.id, message);
      await storage.updateSkillFileStatus(file.id, file.workspaceId, file.skillId, {
        status: "error",
        processingStatus: "error",
        processingErrorMessage: message,
        errorMessage: message,
      });
      return;
    }

    const fileRecord = file.fileId ? await storage.getFile(file.fileId, file.workspaceId) : null;
    const skipNoCode =
      skill.executionMode === "no_code" || fileRecord?.storageType === "external_provider";
    if (skipNoCode) {
      console.info(
        `[${JOB_TYPE}] skip_no_code_ingestion file=${file.id} skill=${file.skillId} storage=${fileRecord?.storageType ?? "unknown"}`,
      );
      await storage.markSkillFileIngestionJobDone(job.id, {
        chunkCount: 0,
        totalChars: 0,
        totalTokens: 0,
      });
      await storage.updateSkillFileStatus(file.id, file.workspaceId, file.skillId, {
        status: "uploaded",
        processingStatus: "ready",
        errorMessage: null,
        processingErrorMessage: null,
      });
      return;
    }

    try {
      const resolved = await resolveEmbeddingProviderForWorkspace({ workspaceId: file.workspaceId });
      embeddingProvider = resolved.provider;
    } catch (error) {
      const message =
        error instanceof Error && error.message ? error.message : "Сервис эмбеддингов недоступен в админ-настройках";
      await storage.failSkillFileIngestionJob(job.id, message);
      await storage.updateSkillFileStatus(file.id, file.workspaceId, file.skillId, {
        status: "error",
        processingStatus: "error",
        processingErrorMessage: message,
        errorMessage: message,
      });
      return;
    }

    const result = await extractSkillFileText({
      workspaceId: file.workspaceId,
      storageKey: file.storageKey,
      filename: file.originalName,
      mimeType: file.mimeType ?? undefined,
    });

    const rules = await indexingRulesService.getIndexingRules();
    const chunkSize = rules.chunkSize;
    const chunkOverlap = rules.chunkOverlap;

    const { chunks, totalChars, totalTokens } = chunkSkillFileText({
      text: result.text,
      chunkSize,
      chunkOverlap,
      fileId: file.id,
      fileVersion: file.version ?? 1,
    });

    const embeddings = await embedSkillFileChunks({
      provider: embeddingProvider,
      chunks,
    });

    const vectors = embeddings.map((entry) => {
      const chunk = chunks.find((c) => c.id === entry.chunkId);
      if (!chunk) {
        throw new Error("Несогласованность эмбеддингов и чанков");
      }
      return {
        chunkId: chunk.id,
        chunkIndex: chunk.index,
        text: chunk.text,
        vector: entry.vector,
      };
    });

    const freshFile = await storage.getSkillFile(file.id, file.workspaceId, file.skillId);
    if (!freshFile) {
      console.warn("[skill-file-ingestion] file deleted before vector upsert", {
        workspaceId: file.workspaceId,
        skillId: file.skillId,
        fileId: file.id,
      });
      await storage.failSkillFileIngestionJob(job.id, "Файл удалён до завершения обработки");
      return;
    }

    await upsertSkillFileVectors({
      workspaceId: file.workspaceId,
      skillId: file.skillId,
      fileId: file.id,
      fileVersion: file.version ?? 1,
      provider: embeddingProvider,
      vectors,
    });

    console.info(
      `[${JOB_TYPE}] text extracted and chunked for file=${file.id} v=${file.version ?? 1} chunks=${chunks.length}/${MAX_CHUNKS_PER_FILE}`,
    );

    await storage.markSkillFileIngestionJobDone(job.id, {
      chunkCount: chunks.length,
      totalChars,
      totalTokens,
    });
    await storage.updateSkillFileStatus(file.id, file.workspaceId, file.skillId, {
      status: "uploaded",
      processingStatus: "ready",
      errorMessage: null,
      processingErrorMessage: null,
    });
  } catch (error) {
    if (error instanceof TextExtractionError) {
      if (error.retryable) {
        throw error;
      }

      await storage.failSkillFileIngestionJob(job.id, error.message);
      await storage.updateSkillFileStatus(file.id, file.workspaceId, file.skillId, {
        status: "error",
        processingStatus: "error",
        processingErrorMessage: error.message,
        errorMessage: error.message,
      });
      return;
    }
    if (error instanceof ChunkingError) {
      await storage.failSkillFileIngestionJob(job.id, error.message);
      await storage.updateSkillFileStatus(file.id, file.workspaceId, file.skillId, {
        status: "error",
        processingStatus: "error",
        processingErrorMessage: error.message,
        errorMessage: error.message,
      });
      return;
    }
    if (error instanceof EmbeddingError) {
      if (error.retryable) {
        throw error;
      }
      await storage.failSkillFileIngestionJob(job.id, error.message);
      await storage.updateSkillFileStatus(file.id, file.workspaceId, file.skillId, {
        status: "error",
        processingStatus: "error",
        processingErrorMessage: error.message,
        errorMessage: error.message,
      });
      return;
    }
    if (error instanceof VectorStoreError) {
      if (embeddingProvider) {
        await deleteSkillFileVectors({
          workspaceId: file.workspaceId,
          skillId: file.skillId,
          fileId: file.id,
          fileVersion: file.version ?? 1,
          provider: embeddingProvider,
        }).catch(() => {});
      }

      if (error.retryable) {
        throw error;
      }

      await storage.failSkillFileIngestionJob(job.id, error.message);
      await storage.updateSkillFileStatus(file.id, file.workspaceId, file.skillId, {
        status: "error",
        processingStatus: "error",
        processingErrorMessage: error.message,
        errorMessage: error.message,
      });
      return;
    }
    throw error;
  }
}

export function startSkillFileIngestionWorker() {
  let stopped = false;
  let active = false;
  let timer: NodeJS.Timeout | null = null;

  const schedule = (delayMs: number) => {
    if (stopped) {
      return;
    }
    if (timer) {
      clearTimeout(timer);
    }
    timer = setTimeout(tick, Math.max(0, delayMs));
    timer.unref?.();
  };

  const tick = async () => {
    if (stopped || active) {
      schedule(POLL_INTERVAL_MS);
      return;
    }

    active = true;
    try {
      const job = await storage.claimNextSkillFileIngestionJob();
      if (!job) {
        schedule(POLL_INTERVAL_MS);
        return;
      }

      try {
        await processJob(job);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const delayMs = computeRetryDelayMs(job.attempts ?? 1);
        const nextRetryAt = new Date(Date.now() + delayMs);

        if (job.attempts >= MAX_ATTEMPTS) {
          await storage.failSkillFileIngestionJob(job.id, message);
          console.warn(
            `[${JOB_TYPE}] job=${job.id} failed after ${job.attempts} attempts: ${message}`,
          );
        } else {
          await storage.rescheduleSkillFileIngestionJob(job.id, nextRetryAt, message);
          console.warn(
            `[${JOB_TYPE}] job=${job.id} retry in ${delayMs}ms (${job.attempts}/${MAX_ATTEMPTS}) :: ${message}`,
          );
        }
      }

      schedule(0);
    } catch (error) {
      console.warn(`[${JOB_TYPE}] tick failed:`, error instanceof Error ? error.message : String(error));
      schedule(POLL_INTERVAL_MS);
    } finally {
      active = false;
    }
  };

  schedule(0);

  return {
    stop() {
      stopped = true;
      if (timer) {
        clearTimeout(timer);
      }
    },
  };
}
