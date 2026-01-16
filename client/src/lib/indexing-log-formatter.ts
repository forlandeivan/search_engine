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
  const statusMap: Record<IndexingLogResponse["summary"]["status"], string> = {
    processing: "Выполняется",
    done: "Завершено",
    error: "Ошибка",
  };
  return statusMap[status] ?? status;
}

function formatStage(stage: IndexingLogResponse["summary"]["stage"]): string {
  const stageMap: Record<IndexingLogResponse["summary"]["stage"], string> = {
    initializing: "Инициализация",
    processing: "Обработка",
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
  lines.push("");

  // Сводка
  lines.push("=== Сводка ===");
  lines.push(`Всего документов: ${log.summary.totalDocuments}`);
  lines.push(`Успешно проиндексировано: ${log.summary.processedDocuments}`);
  lines.push(`С ошибками: ${log.summary.failedDocuments}`);
  lines.push(`Всего чанков: ${log.summary.totalChunks.toLocaleString("ru-RU")}`);
  lines.push("");

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
