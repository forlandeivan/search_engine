import type { JsonImportJob } from "@shared/schema";
import { storage } from "./storage";
import type { MappingConfig, HierarchyConfig } from "@shared/json-import";

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
    // TODO: US-6 - Реализовать потоковую обработку JSON/JSONL
    // Пока что просто помечаем как completed для тестирования инфраструктуры
    await storage.markJsonImportJobDone(job.id, "completed", {
      processedRecords: 0,
      createdDocuments: 0,
      skippedRecords: 0,
      errorRecords: 0,
    });

    console.log(`[${JOB_TYPE}] Job ${job.id} completed`);
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
