import { z } from "zod";
import type { MappingExpression } from "./json-import";

// ============================================================================
// Типы полей схемы
// ============================================================================

export const COLLECTION_FIELD_TYPES = [
  "string",
  "integer",
  "float",
  "boolean",
  "text",
  "keyword",
  "datetime",
  "geo",
] as const;

export type CollectionFieldType = (typeof COLLECTION_FIELD_TYPES)[number];

// ============================================================================
// Конфигурация поля схемы
// ============================================================================

export interface SchemaFieldConfig {
  /** Уникальный идентификатор поля в UI */
  id: string;
  /** Имя поля в payload Qdrant */
  name: string;
  /** Тип данных */
  type: CollectionFieldType;
  /** Массив значений */
  isArray: boolean;
  /** Выражение для формирования значения */
  expression: MappingExpression;
  /** Поле для векторизации (только одно может быть true) */
  isEmbeddingField?: boolean;
}

// ============================================================================
// Конфигурация визарда индексации
// ============================================================================

export interface IndexingWizardConfig {
  // Параметры чанкования
  chunkSize: number;
  chunkOverlap: number;

  // Провайдер эмбеддингов
  embeddingsProvider: string;
  embeddingsModel: string;

  // Параметры поиска (используются при RAG)
  topK: number;
  relevanceThreshold: number;
  maxContextTokens: number;
  citationsEnabled: boolean;

  // Схема полей payload
  schemaFields: SchemaFieldConfig[];
}

// ============================================================================
// Запрос на индексацию с кастомным конфигом
// ============================================================================

export interface StartIndexingWithConfigRequest {
  mode: "full" | "changed";
  /** Кастомная конфигурация (для расширенного режима) */
  config?: {
    chunkSize: number;
    chunkOverlap: number;
    embeddingsProvider: string;
    embeddingsModel: string;
    schemaFields: Array<{
      name: string;
      type: string;
      isArray: boolean;
      template: string; // Скомпилированный шаблон из expression
      isEmbeddingField?: boolean;
    }>;
    /** Сохранить настройки в политику базы знаний */
    saveToPolicy?: boolean;
  };
}

// ============================================================================
// Zod схемы для валидации
// ============================================================================

export const schemaFieldConfigSchema = z.object({
  name: z.string().trim().min(1, "Укажите имя поля").max(120),
  type: z.enum(COLLECTION_FIELD_TYPES),
  isArray: z.boolean().default(false),
  template: z.string(),
  isEmbeddingField: z.boolean().optional(),
});

export const indexingConfigSchema = z
  .object({
    chunkSize: z.number().int().min(200).max(8000),
    chunkOverlap: z.number().int().min(0),
    embeddingsProvider: z.string().trim().min(1),
    embeddingsModel: z.string().trim().min(1),
    schemaFields: z.array(schemaFieldConfigSchema).max(50),
    saveToPolicy: z.boolean().optional(),
  })
  .refine(
    (data) => data.chunkOverlap < data.chunkSize,
    { message: "chunkOverlap должен быть меньше chunkSize", path: ["chunkOverlap"] },
  );

// ============================================================================
// Контекст для шаблонов полей
// ============================================================================

export interface IndexingTemplateContext {
  // Документ
  title: string;
  documentId: string;
  nodeSlug: string | null;

  // Чанк
  chunk_text: string;
  chunk_index: number;
  chunk_ordinal: number;

  // Версия
  versionId: string;
  versionNumber: number;

  // База знаний
  knowledgeBaseId: string;
  knowledgeBaseName: string;

  // Метаданные документа (из JSON-импорта)
  metadata: Record<string, unknown>;
}

// ============================================================================
// Константы
// ============================================================================

import { createFieldToken } from "./json-import";

export const DEFAULT_SCHEMA_FIELDS: SchemaFieldConfig[] = [
  {
    id: "content-field",
    name: "content",
    type: "text",
    isArray: false,
    expression: [createFieldToken("content")],
    isEmbeddingField: true,
  },
];

export const INDEXING_TEMPLATE_VARIABLES = [
  { name: "content", description: "Содержимое чанка (для векторизации)" },
  { name: "title", description: "Заголовок документа" },
  { name: "documentId", description: "ID документа" },
  { name: "documentUrl", description: "Ссылка на документ в системе" },
  { name: "nodeSlug", description: "Slug узла" },
  { name: "chunk_text", description: "Текст чанка" },
  { name: "chunk_index", description: "Индекс чанка (0-based)" },
  { name: "chunk_ordinal", description: "Порядковый номер чанка (1-based)" },
  { name: "versionId", description: "ID версии документа" },
  { name: "versionNumber", description: "Номер версии" },
  { name: "knowledgeBaseId", description: "ID базы знаний" },
  { name: "knowledgeBaseName", description: "Название базы знаний" },
  { name: "metadata.*", description: "Метаданные документа" },
] as const;
