import type { JsonImportJobStatus } from "./schema";

export type FieldRole =
  | "id" // идентификатор для дедупликации
  | "title" // заголовок документа
  | "content" // основной текст (может быть несколько)
  | "content_html" // HTML версия контента
  | "content_md" // Markdown версия контента
  | "metadata" // метаданные (сохраняются в JSON)
  | "skip"; // пропустить поле

export interface FieldMapping {
  sourcePath: string; // путь к полю в JSON (например, "metadata.author")
  role: FieldRole;
  priority?: number; // для контента: порядок объединения
}

export interface MappingConfig {
  fields: FieldMapping[];
  contentJoinSeparator?: string; // разделитель при объединении контента (default: "\n\n")
  titleFallback?: "first_line" | "content_excerpt" | "filename";
  deduplication?: {
    mode: "skip" | "allow_all";
  };
}

export type EmptyValueStrategy =
  | "folder_uncategorized" // создать папку "Без категории"
  | "root" // положить в корень
  | "skip"; // пропустить запись

export interface HierarchyConfig {
  mode: "flat" | "grouped";

  // Для режима grouped
  groupByField?: string; // путь к полю (например, "category")
  emptyValueStrategy?: EmptyValueStrategy;
  uncategorizedFolderName?: string; // название папки для пустых (default: "Без категории")

  // Общая родительская папка
  rootFolderName?: string; // если задано, все документы/папки внутри
}

export interface JsonImportJobProgress {
  totalRecords: number;
  processedRecords: number;
  createdDocuments: number;
  skippedRecords: number;
  errorRecords: number;
  percent: number;
}

export interface JsonImportJobTiming {
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  durationSeconds: number | null;
}

export type ErrorType =
  | "parse_error" // ошибка парсинга JSON
  | "validation_error" // ошибка валидации данных
  | "mapping_error" // ошибка применения маппинга
  | "duplicate" // дубликат по ID
  | "database_error" // ошибка записи в БД
  | "unknown"; // неизвестная ошибка

export interface ImportRecordError {
  lineNumber: number; // для JSONL (1-based)
  recordIndex: number; // для JSON-массива (0-based)
  errorType: ErrorType;
  message: string;
  field?: string; // поле с ошибкой (для валидации)
  rawPreview?: string; // первые 200 символов записи
}

export interface ImportErrorLog {
  errors: ImportRecordError[];
  summary: {
    parseErrors: number;
    validationErrors: number;
    mappingErrors: number;
    duplicates: number;
    databaseErrors: number;
    unknownErrors: number;
  };
}

export interface CreateJsonImportRequest {
  fileKey: string; // ключ файла в S3 после загрузки
  fileName: string; // оригинальное имя файла
  fileSize: number; // размер файла в байтах
  mappingConfig: MappingConfig;
  hierarchyConfig: HierarchyConfig;
}

export interface CreateJsonImportResponse {
  jobId: string;
  status: "pending";
}

export interface GetJsonImportStatusResponse {
  jobId: string;
  baseId: string;
  baseName: string;
  status: JsonImportJobStatus;
  progress: JsonImportJobProgress;
  timing: JsonImportJobTiming;
  recentErrors: ImportRecordError[];
  hasMoreErrors: boolean;
}
