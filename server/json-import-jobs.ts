import type { JsonImportJob } from "@shared/schema";
import { storage } from "./storage";
import { deleteJsonImportFile } from "./workspace-storage-service";
import type { MappingConfig, HierarchyConfig, ImportRecordError } from "@shared/json-import";
import { processJsonImport } from "./json-import/streaming-processor";

const POLL_INTERVAL_MS = 5_000;
const BASE_RETRY_DELAY_MS = 30_000;
const MAX_RETRY_DELAY_MS = 10 * 60_000;
const MAX_ATTEMPTS = 5;
const JOB_TYPE = "json_import";

function computeRetryDelayMs(attempts: number): number {
  const exponent = Math.max(0, attempts - 1);
  const delay = BASE_RETRY_DELAY_MS * Math.pow(2, exponent);
  return Math.min(Math.max(BASE_RETRY_DELAY_MS, delay), MAX_RETRY_DELAY_MS);
}

async function processJob(job: JsonImportJob): Promise<void> {
  if (job.status !== "pending" && job.status !== "processing") {
    return;
  }

  console.log(`[${JOB_TYPE}] Processing job ${job.id} for base ${job.baseId}`);

  try {
    // claimNextJsonImportJob уже обновил статус на processing
    const mappingConfig = job.mappingConfig as MappingConfig;
    const hierarchyConfig = job.hierarchyConfig as HierarchyConfig;

    const errors: ImportRecordError[] = [];
    let firstProgressUpdate = true;

    // Обрабатываем импорт
    const result = await processJsonImport(
      job.workspaceId,
      job.sourceFileKey,
      job.sourceFileFormat,
      {
        baseId: job.baseId,
        workspaceId: job.workspaceId,
        mappingConfig,
        hierarchyConfig,
      },
      async (stats) => {
        // Обновляем прогресс в БД
        await storage.updateJsonImportJobProgress(job.id, {
          totalRecords: firstProgressUpdate ? stats.processedRecords : undefined,
          processedRecords: stats.processedRecords,
          createdDocuments: stats.createdDocuments,
          skippedRecords: stats.skippedRecords,
          errorRecords: stats.errorRecords,
        });
        firstProgressUpdate = false;
      },
      (error) => {
        // Собираем ошибки
        errors.push(error);
      },
    );

    // Добавляем ошибки в лог
    if (errors.length > 0) {
      await storage.appendJsonImportJobErrors(job.id, errors);
    }

    // Определяем финальный статус
    const finalStatus = result.errorRecords > 0 ? "completed_with_errors" : "completed";

    await storage.markJsonImportJobDone(job.id, finalStatus, {
      processedRecords: result.totalRecords,
      createdDocuments: result.createdDocuments,
      skippedRecords: result.skippedRecords,
      errorRecords: result.errorRecords,
    });

    // Delete source file after successful import
    try {
      await deleteJsonImportFile(job.workspaceId, job.sourceFileKey);
      console.log(`[${JOB_TYPE}] Deleted source file for job ${job.id}: ${job.sourceFileKey}`);
    } catch (deleteError) {
      // Log but don't fail the job if file deletion fails
      console.warn(
        `[${JOB_TYPE}] Failed to delete source file for job ${job.id}: ${deleteError instanceof Error ? deleteError.message : String(deleteError)}`,
      );
    }

    console.log(
      `[${JOB_TYPE}] Job ${job.id} completed: ${result.createdDocuments} documents created, ${result.errorRecords} errors`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const delayMs = computeRetryDelayMs(job.attempts ?? 1);
    const nextRetryAt = new Date(Date.now() + delayMs);

    if (job.attempts >= MAX_ATTEMPTS) {
      await storage.failJsonImportJob(job.id, message);
      console.warn(
        `[${JOB_TYPE}] job=${job.id} failed after ${job.attempts} attempts: ${message}`,
      );
    } else {
      await storage.rescheduleJsonImportJob(job.id, nextRetryAt, message);
      console.warn(
        `[${JOB_TYPE}] job=${job.id} retry in ${delayMs}ms (${job.attempts}/${MAX_ATTEMPTS}) :: ${message}`,
      );
    }
    throw error;
  }
}

export function startJsonImportWorker() {
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
      const job = await storage.claimNextJsonImportJob();
      if (!job) {
        schedule(POLL_INTERVAL_MS);
        return;
      }

      try {
        await processJob(job);
      } catch (error) {
        // Ошибка уже обработана в processJob
        console.error(`[${JOB_TYPE}] Error processing job ${job.id}:`, error);
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
