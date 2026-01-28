import { storage } from "./storage";
import { deleteWorkspaceFile } from "./workspace-storage-service";
import { createLogger } from "./lib/logger";

const logger = createLogger("chat-file-cleanup");

// Конфигурация
const CLEANUP_INTERVAL_MS = parseInt(
  process.env.CHAT_FILE_CLEANUP_INTERVAL_MS || "86400000", // 24 hours
  10
);
const MIN_AGE_HOURS = parseInt(
  process.env.CHAT_FILE_MIN_AGE_HOURS || "24",
  10
);
const BATCH_SIZE = parseInt(
  process.env.CHAT_FILE_CLEANUP_BATCH_SIZE || "100",
  10
);
const INITIAL_DELAY_MS = 10 * 60 * 1000; // 10 минут после старта

export interface CleanupStats {
  processed: number;
  cleaned: number;
  errors: number;
  skipped: number;
}

/**
 * Выполнить один цикл очистки файлов.
 * Возвращает статистику выполнения.
 */
export async function cleanupChatAttachmentFiles(): Promise<CleanupStats> {
  const stats: CleanupStats = {
    processed: 0,
    cleaned: 0,
    errors: 0,
    skipped: 0,
  };

  logger.info("Starting chat file cleanup cycle", { minAgeHours: MIN_AGE_HOURS, batchSize: BATCH_SIZE });

  try {
    // Получить attachments, готовые к очистке
    const attachments = await storage.getCleanableChatAttachments({
      minAgeHours: MIN_AGE_HOURS,
      limit: BATCH_SIZE,
    });

    logger.info(`Found ${attachments.length} attachments to clean`);

    for (const att of attachments) {
      stats.processed++;

      // Пропустить если storage_key уже пустой (двойная проверка)
      if (!att.storageKey || att.storageKey === "") {
        logger.debug("Skipping attachment with empty storage_key", { attachmentId: att.id });
        stats.skipped++;
        continue;
      }

      try {
        // 1. Удалить файл из MinIO
        await deleteWorkspaceFile(att.workspaceId, att.storageKey);

        logger.debug("Deleted file from storage", {
          attachmentId: att.id,
          workspaceId: att.workspaceId,
          storageKey: att.storageKey,
        });

        // 2. Обновить запись — помечаем как очищенную
        await storage.markChatAttachmentCleaned(att.id);

        stats.cleaned++;
      } catch (error) {
        logger.error("Failed to clean attachment", {
          attachmentId: att.id,
          workspaceId: att.workspaceId,
          storageKey: att.storageKey,
          error: error instanceof Error ? error.message : String(error),
        });
        stats.errors++;
      }
    }
  } catch (error) {
    logger.error("Chat file cleanup cycle failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  logger.info("Chat file cleanup cycle completed", stats);
  return stats;
}

/**
 * Запустить периодическую задачу очистки файлов чата.
 */
export function startChatFileCleanupJob() {
  let stopped = false;

  const run = async () => {
    if (stopped) return;
    try {
      await cleanupChatAttachmentFiles();
    } catch (error) {
      logger.error("Chat file cleanup job failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };

  // Добавляем jitter для предотвращения одновременного запуска на нескольких инстансах
  const jitter = Math.floor(Math.random() * 60 * 60 * 1000); // 0-60 min

  // Периодический запуск
  const timer = setInterval(() => {
    if (!stopped) {
      void run();
    }
  }, CLEANUP_INTERVAL_MS + jitter);
  
  // Убираем блокировку event loop для graceful shutdown
  if (timer.unref) {
    timer.unref();
  }

  // Первый запуск с задержкой (дать время на startup)
  const initialTimer = setTimeout(() => {
    if (!stopped) {
      void run();
    }
  }, INITIAL_DELAY_MS);
  
  if (initialTimer.unref) {
    initialTimer.unref();
  }

  logger.info("Chat file cleanup job started", {
    intervalMs: CLEANUP_INTERVAL_MS,
    jitterMs: jitter,
    initialDelayMs: INITIAL_DELAY_MS,
    minAgeHours: MIN_AGE_HOURS,
    batchSize: BATCH_SIZE,
  });

  return {
    stop() {
      stopped = true;
      clearInterval(timer);
      clearTimeout(initialTimer);
      logger.info("Chat file cleanup job stopped");
    },
  };
}
