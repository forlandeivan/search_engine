/**
 * Constants for KnowledgeBasePage
 */

import type { KnowledgeBaseCrawlJobStatus } from "@shared/knowledge-base";
import type { KnowledgeBaseIndexStatus, KnowledgeDocumentIndexStatus } from "@shared/schema";

export const ROOT_PARENT_VALUE = "__root__";

export const TERMINAL_CRAWL_STATUSES: Array<KnowledgeBaseCrawlJobStatus["status"]> = [
  "failed",
  "canceled",
  "done",
];

export const DOCUMENT_STATUS_LABELS: Record<string, string> = {
  draft: "Черновик",
  published: "Опубликован",
  archived: "Архивирован",
};

export const DOCUMENT_SOURCE_LABELS: Record<string, string> = {
  manual: "Создан вручную",
  import: "Импортированный документ",
  crawl: "Импорт со страницы",
};

export const INDEXING_STATUS_LABELS: Record<KnowledgeBaseIndexStatus, string> = {
  up_to_date: "Актуальна",
  outdated: "Есть изменения",
  partial: "Частично актуальна",
  indexing: "Индексируется",
  error: "Ошибка",
  not_indexed: "Не индексировалась",
};

export const INDEXING_STATUS_DESCRIPTIONS: Record<KnowledgeBaseIndexStatus, string> = {
  up_to_date: "База знаний полностью индексирована и готова к использованию в RAG.",
  outdated: "Есть изменения в документах. Рекомендуем индексировать изменения.",
  partial: "Индексация выполнена частично. Рекомендуем индексировать изменения.",
  indexing: "Индексация выполняется. Дождитесь завершения процесса.",
  error: "Часть документов не индексировалась из-за ошибок. Попробуйте переиндексацию.",
  not_indexed: "Индексация еще не запускалась.",
};

import type { BadgeVariant } from "./types";

export const INDEXING_STATUS_BADGE_VARIANTS: Record<KnowledgeBaseIndexStatus, BadgeVariant> = {
  up_to_date: "secondary",
  outdated: "outline",
  partial: "outline",
  indexing: "outline",
  error: "destructive",
  not_indexed: "outline",
};

export const INDEXING_CHANGE_STATUS_LABELS: Record<KnowledgeDocumentIndexStatus, string> = {
  not_indexed: "Не индексирован",
  outdated: "Есть изменения",
  indexing: "Индексируется",
  up_to_date: "Актуален",
  error: "Ошибка",
};

export const INDEXING_CHANGE_BADGE_VARIANTS: Record<KnowledgeDocumentIndexStatus, BadgeVariant> = {
  not_indexed: "outline",
  outdated: "outline",
  indexing: "outline",
  up_to_date: "secondary",
  error: "destructive",
};
