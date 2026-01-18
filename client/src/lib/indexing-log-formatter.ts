import { format } from "date-fns";
import type { IndexingLogResponse } from "@shared/schema";

function formatDateTime(value: string | null | undefined): string {
  if (!value) {
    return "—";
  }

  try {
    return format(new Date(value), "dd.MM.yyyy HH:mm:ss");
  } catch {
    return value;
  }
}

function formatUser(userName: string | null, userEmail: string | null): string {
  if (userName && userEmail) {
    return `${userName} (${userEmail})`;
  }
  if (userName) {
    return userName;
  }
  if (userEmail) {
    return userEmail;
  }
  return "Система";
}

function formatStatus(status: IndexingLogResponse["summary"]["status"]): string {
  const statusMap: Record<string, string> = {
    processing: "Выполняется",
    done: "Завершено",
    error: "Ошибка",
  };
  return statusMap[status] ?? status;
}

function formatStage(stage: IndexingLogResponse["summary"]["stage"]): string {
  const stageMap: Record<IndexingLogResponse["summary"]["stage"], string> = {
    initializing: "Инициализация",
    creating_collection: "Создание коллекции",
    chunking: "Чанкинг",
    vectorizing: "Векторизация",
    uploading: "Загрузка",
    verifying: "Проверка",
    completed: "Завершено",
    error: "Ошибка",
  };
  return stageMap[stage] ?? stage;
}

function formatJobStatus(status: IndexingLogResponse["jobs"][number]["status"]): string {
  const statusMap: Record<IndexingLogResponse["jobs"][number]["status"], string> = {
    pending: "Ожидание",
    processing: "Обработка",
    completed: "Завершено",
    failed: "Ошибка",
  };
  return statusMap[status] ?? status;
}

function formatStageName(stage: string): string {
  const stageMap: Record<string, string> = {
    initializing: "Инициализация",
    creating_collection: "Создание коллекции",
    chunking: "Чанкинг",
    vectorizing: "Векторизация",
    uploading: "Загрузка",
    verifying: "Проверка",
    completed: "Завершено",
    error: "Ошибка",
  };
  return stageMap[stage] ?? stage;
}

export function formatIndexingLog(log: IndexingLogResponse): string {
  const lines: string[] = [];

  // Заголовок
  lines.push("=== Лог индексации базы знаний ===");
  lines.push(`ID индексации: ${log.actionId}`);
  lines.push(`Статус: ${formatStatus(log.summary.status)}`);
  lines.push(`Этап: ${formatStage(log.summary.stage)}`);
  lines.push(`Время начала: ${formatDateTime(log.summary.startedAt)}`);
  lines.push(`Время завершения: ${formatDateTime(log.summary.finishedAt)}`);
  lines.push(`Запустил: ${formatUser(log.summary.userName, log.summary.userEmail)}`);
  if (log.summary.displayText) {
    lines.push(`Описание: ${log.summary.displayText}`);
  }
  lines.push("");

  // Конфигурация
  if (log.config && Object.keys(log.config).length > 0) {
    lines.push("=== Конфигурация ===");
    if (log.config.providerId) {
      lines.push(`Провайдер эмбеддингов: ${log.config.providerName ?? log.config.providerId}`);
      if (log.config.providerId && typeof log.config.providerId === "string") {
        lines.push(`  ID: ${log.config.providerId}`);
      }
    }
    if (log.config.model) {
      lines.push(`Модель: ${log.config.model}`);
    }
    if (log.config.chunkSize !== null && log.config.chunkSize !== undefined) {
      lines.push(`Размер чанка: ${log.config.chunkSize}`);
    }
    if (log.config.chunkOverlap !== null && log.config.chunkOverlap !== undefined) {
      lines.push(`Перекрытие чанков: ${log.config.chunkOverlap}`);
    }
    if (log.config.mode) {
      lines.push(`Режим индексации: ${log.config.mode === "full" ? "Полная" : "Только изменения"}`);
    }
    lines.push("");
  }

  // Сводка
  lines.push("=== Сводка ===");
  lines.push(`Всего документов: ${log.summary.totalDocuments}`);
  lines.push(`Успешно проиндексировано: ${log.summary.processedDocuments}`);
  lines.push(`С ошибками: ${log.summary.failedDocuments}`);
  lines.push(`Всего чанков: ${log.summary.totalChunks.toLocaleString("ru-RU")}`);
  lines.push("");

  // События (хронология этапов)
  if (log.events && log.events.length > 0) {
    lines.push("=== События (хронология) ===");
    log.events.forEach((event, index) => {
      lines.push(`${index + 1}. [${formatDateTime(event.timestamp)}] ${formatStageName(event.stage)}: ${event.message}`);
      if (event.error) {
        lines.push(`   ❌ Ошибка: ${event.error}`);
      }
      if (event.metadata && Object.keys(event.metadata).length > 0) {
        const metadataStr = Object.entries(event.metadata)
          .map(([key, value]) => `${key}=${typeof value === "object" ? JSON.stringify(value) : String(value)}`)
          .join(", ");
        if (metadataStr) {
          lines.push(`   📋 ${metadataStr}`);
        }
      }
    });
    lines.push("");
  }

  // Ошибки (агрегированные)
  if (log.errors && log.errors.length > 0) {
    lines.push("=== Ошибки ===");
    log.errors.forEach((error, index) => {
      lines.push(`${index + 1}. Документ: "${error.documentTitle}" (ID: ${error.documentId})`);
      lines.push(`   Время: ${formatDateTime(error.timestamp)}`);
      lines.push(`   Этап: ${formatStageName(error.stage)}`);
      lines.push(`   Ошибка: ${error.error}`);
      lines.push("");
    });
  }

  // Детали по документам
  lines.push("=== Детали по документам ===");
  if (log.jobs.length === 0) {
    lines.push("Документы не найдены");
  } else {
    log.jobs.forEach((job, index) => {
      lines.push(`${index + 1}. Документ: ${job.documentTitle} (ID: ${job.documentId})`);
      lines.push(`   Версия: ${job.versionId}`);
      lines.push(`   Статус: ${formatJobStatus(job.status)}`);
      if (job.chunkCount !== null) {
        lines.push(`   Чанков: ${job.chunkCount.toLocaleString("ru-RU")}`);
      }
      if (job.totalChars !== null) {
        lines.push(`   Символов: ${job.totalChars.toLocaleString("ru-RU")}`);
      }
      if (job.totalTokens !== null) {
        lines.push(`   Токенов: ${job.totalTokens.toLocaleString("ru-RU")}`);
      }
      if (job.startedAt) {
        lines.push(`   Время начала: ${formatDateTime(job.startedAt)}`);
      }
      if (job.finishedAt) {
        lines.push(`   Время завершения: ${formatDateTime(job.finishedAt)}`);
      }
      if (job.attempts > 1) {
        lines.push(`   Попыток: ${job.attempts}`);
      }
      if (job.error) {
        lines.push(`   Ошибка: ${job.error}`);
      }
      lines.push("");
    });
  }

  return lines.join("\n");
}
