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
  
  // Базовый parentId для импорта (если указан, все документы создаются в этой папке)
  baseParentId?: string | null;
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
  parentId?: string | null; // родительская папка для импорта (если указана, все документы создаются в ней)
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

// === Expression-based Mapping Types (v2) ===

/**
 * Тип токена в выражении
 */
export type ExpressionTokenType = 'field' | 'function' | 'text';

/**
 * Токен в выражении маппинга
 * 
 * Примеры:
 * - { type: 'field', value: 'metadata.author' }
 * - { type: 'function', value: 'NewGUID' }
 * - { type: 'text', value: ' - ' }
 */
export interface ExpressionToken {
  type: ExpressionTokenType;
  value: string;
  args?: string[];  // для функций с аргументами (будущее расширение)
}

/**
 * Выражение = последовательность токенов
 * 
 * Пример: [{{ title }}] - [{{ category }}]
 * → [
 *     { type: 'field', value: 'title' },
 *     { type: 'text', value: ' - ' },
 *     { type: 'field', value: 'category' }
 *   ]
 */
export type MappingExpression = ExpressionToken[];

/**
 * Маппинг для одного поля документа
 */
export interface DocumentFieldMapping {
  expression: MappingExpression;
  required?: boolean;
}

/**
 * Динамическое поле метаданных
 */
export interface MetadataFieldMapping {
  key: string;
  expression: MappingExpression;
}

/**
 * Конфиг маппинга v2 (expression-based)
 */
export interface MappingConfigV2 {
  version: 2;
  
  // Основные поля документа
  id?: DocumentFieldMapping;
  title: DocumentFieldMapping;
  content: DocumentFieldMapping;
  contentHtml?: DocumentFieldMapping;
  contentMd?: DocumentFieldMapping;
  
  // Динамические метаданные
  metadata: MetadataFieldMapping[];
  
  // Настройки
  contentJoinSeparator?: string;
  titleFallback?: 'first_line' | 'content_excerpt' | 'filename';
}

/**
 * Старый формат для backwards compatibility
 */
export interface MappingConfigV1 {
  fields: FieldMapping[];
  contentJoinSeparator?: string;
  titleFallback?: 'first_line' | 'content_excerpt' | 'filename';
  deduplication?: {
    mode: 'skip' | 'allow_all';
  };
}

/**
 * Объединённый тип для обратной совместимости
 */
export type MappingConfig = MappingConfigV1 | MappingConfigV2;

/**
 * Type guard для проверки версии конфига
 */
export function isMappingConfigV2(config: MappingConfig): config is MappingConfigV2 {
  return 'version' in config && config.version === 2;
}

/**
 * Создание пустого выражения
 */
export function createEmptyExpression(): MappingExpression {
  return [];
}

/**
 * Создание токена поля
 */
export function createFieldToken(fieldPath: string): ExpressionToken {
  return { type: 'field', value: fieldPath };
}

/**
 * Создание токена функции
 */
export function createFunctionToken(functionName: string, args?: string[]): ExpressionToken {
  return { type: 'function', value: functionName, args };
}

/**
 * Создание текстового токена
 */
export function createTextToken(text: string): ExpressionToken {
  return { type: 'text', value: text };
}

/**
 * Конвертация старого формата маппинга в новый
 */
export function migrateMappingConfigV1ToV2(v1: MappingConfigV1): MappingConfigV2 {
  const v2: MappingConfigV2 = {
    version: 2,
    title: { expression: [] },
    content: { expression: [], required: true },
    metadata: [],
    contentJoinSeparator: v1.contentJoinSeparator,
    titleFallback: v1.titleFallback,
  };

  const contentFields: FieldMapping[] = [];

  for (const field of v1.fields) {
    switch (field.role) {
      case 'id':
        if (!v2.id) {
          v2.id = { expression: [{ type: 'field', value: field.sourcePath }] };
        }
        break;

      case 'title':
        if (v2.title.expression.length === 0) {
          v2.title = { expression: [{ type: 'field', value: field.sourcePath }] };
        }
        break;

      case 'content':
        contentFields.push(field);
        break;

      case 'content_html':
        if (!v2.contentHtml) {
          v2.contentHtml = { expression: [{ type: 'field', value: field.sourcePath }] };
        }
        break;

      case 'content_md':
        if (!v2.contentMd) {
          v2.contentMd = { expression: [{ type: 'field', value: field.sourcePath }] };
        }
        break;

      case 'metadata':
        v2.metadata.push({
          key: field.sourcePath.split('.').pop() ?? field.sourcePath,
          expression: [{ type: 'field', value: field.sourcePath }],
        });
        break;

      case 'skip':
      default:
        // Игнорируем
        break;
    }
  }

  // Объединяем контентные поля
  if (contentFields.length > 0) {
    const sortedContent = [...contentFields].sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0));
    
    // Добавляем поля с разделителями
    const contentExpression: ExpressionToken[] = [];
    const separator = v1.contentJoinSeparator ?? '\n\n';
    
    sortedContent.forEach((field, index) => {
      if (index > 0) {
        contentExpression.push({ type: 'text', value: separator });
      }
      contentExpression.push({ type: 'field', value: field.sourcePath });
    });
    
    v2.content = { expression: contentExpression, required: true };
  }

  return v2;
}
