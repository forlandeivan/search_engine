import { Readable } from "stream";
import { createInterface } from "readline";
import type { MappingConfig, MappingConfigV2, HierarchyConfig, ImportRecordError, ErrorType } from "@shared/json-import";
import { isMappingConfigV2, migrateMappingConfigV1ToV2 } from "@shared/json-import";
import { createKnowledgeDocument, createKnowledgeFolder } from "../knowledge-base";
import { getObject } from "../workspace-storage-service";
import { db } from "../db";
import { knowledgeNodes } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { ImportDeduplicator, extractDeduplicatorOptions } from "./deduplicator";
import { createExpressionInterpreter } from "../services/expression-interpreter";

const BATCH_SIZE = 100;

interface ParsedRecord {
  lineNumber?: number; // для JSONL
  recordIndex?: number; // для JSON-массива
  data: Record<string, unknown>;
}

interface BatchResult {
  created: number;
  skipped: number;
  errors: ImportRecordError[];
}

interface ImportContext {
  baseId: string;
  workspaceId: string;
  mappingConfig: MappingConfig; // Поддерживает v1 и v2
  hierarchyConfig: HierarchyConfig;
  onProgress: (stats: {
    processedRecords: number;
    createdDocuments: number;
    skippedRecords: number;
    errorRecords: number;
  }) => Promise<void>;
  onError: (error: ImportRecordError) => void;
  folderCache?: Map<string, string>; // Кэш папок: key = "parentId|folderName", value = folderId
  folderCreationLocks?: Map<string, Promise<string>>; // Блокировки создания папок: key = "parentId|folderName", value = Promise<folderId>
  baseParentId?: string | null; // базовый parentId для всех документов
}

/**
 * Получить значение из вложенного объекта по пути (например, "metadata.author")
 */
function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (current && typeof current === "object" && !Array.isArray(current)) {
      current = (current as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return current;
}

/**
 * Применить маппинг полей к записи
 * Поддерживает оба формата: v1 (старый) и v2 (expression-based)
 */
async function applyMapping(
  record: Record<string, unknown>, 
  config: MappingConfig,
  workspaceId: string
): Promise<{
  id?: string;
  title: string;
  content: string;
  contentMarkdown?: string;
  contentHtml?: string;
  metadata?: Record<string, unknown>;
}> {
  // Используем новый интерпретатор для v2
  if (isMappingConfigV2(config)) {
    const interpreter = createExpressionInterpreter(workspaceId);
    const mapped = await interpreter.applyMapping(config, record);
    
    return {
      id: mapped.id,
      title: mapped.title,
      content: mapped.content,
      contentMarkdown: mapped.contentMd,
      contentHtml: mapped.contentHtml,
      metadata: mapped.metadata,
    };
  }
  
  // Fallback на старую логику для v1
  return applyMappingV1(record, config);
}

/**
 * Старая логика маппинга (v1)
 */
function applyMappingV1(record: Record<string, unknown>, config: MappingConfig): {
  id?: string;
  title: string;
  content: string;
  contentMarkdown?: string;
  contentHtml?: string;
  metadata?: Record<string, unknown>;
} {
  const result: {
    id?: string;
    title: string;
    content: string;
    contentMarkdown?: string;
    contentHtml?: string;
    metadata?: Record<string, unknown>;
  } = {
    title: "",
    content: "",
  };

  // Проверяем, что это v1 конфиг
  if (isMappingConfigV2(config)) {
    throw new Error('applyMappingV1 called with v2 config');
  }

  const contentParts: string[] = [];
  const metadata: Record<string, unknown> = {};

  // Сортируем поля по priority (если есть)
  const sortedFields = [...config.fields].sort((a, b) => {
    const aPriority = a.priority ?? 0;
    const bPriority = b.priority ?? 0;
    return aPriority - bPriority;
  });

  for (const field of sortedFields) {
    if (field.role === "skip") {
      continue;
    }

    const value = getNestedValue(record, field.sourcePath);
    if (value === undefined || value === null) {
      continue;
    }

    const stringValue = String(value);

    switch (field.role) {
      case "id":
        result.id = stringValue;
        break;
      case "title":
        if (!result.title) {
          result.title = stringValue;
        }
        break;
      case "content":
        contentParts.push(stringValue);
        break;
      case "content_html":
        result.contentHtml = stringValue;
        break;
      case "content_md":
        result.contentMarkdown = stringValue;
        break;
      case "metadata":
        metadata[field.sourcePath] = value;
        break;
    }
  }

  // Объединяем контент
  const separator = config.contentJoinSeparator ?? "\n\n";
  result.content = contentParts.join(separator);

  // Если контент пустой, используем contentHtml или contentMarkdown
  if (!result.content && result.contentHtml) {
    result.content = result.contentHtml;
  } else if (!result.content && result.contentMarkdown) {
    result.content = result.contentMarkdown;
  }

  // Fallback для title
  if (!result.title) {
    if (config.titleFallback === "first_line" && result.content) {
      result.title = result.content.split("\n")[0].slice(0, 200);
    } else if (config.titleFallback === "content_excerpt" && result.content) {
      result.title = result.content.slice(0, 200);
    } else {
      result.title = "Без названия";
    }
  }

  if (Object.keys(metadata).length > 0) {
    result.metadata = metadata;
  }

  return result;
}

/**
 * Разрешить parentId на основе hierarchy config
 */
async function resolveParentFolder(
  record: Record<string, unknown>,
  config: HierarchyConfig,
  context: ImportContext,
): Promise<string | null> {
  // Если задан baseParentId, используем его как базовый parentId
  const baseParentId = context.baseParentId ?? config.baseParentId ?? null;

  if (config.mode === "flat") {
    // Если задана rootFolderName, создаём/находим корневую папку внутри baseParentId
    if (config.rootFolderName) {
      return await ensureFolder(context.baseId, context.workspaceId, baseParentId, config.rootFolderName, context.folderCache, context.folderCreationLocks);
    }
    return baseParentId;
  }

  // Режим grouped
  if (!config.groupByField) {
    return baseParentId;
  }

  const groupValue = getNestedValue(record, config.groupByField);
  // Нормализуем имя группы (убираем пробелы в начале/конце)
  const groupName = groupValue ? String(groupValue).trim() : null;

  if (!groupName || groupName === "") {
    // Пустое значение
    if (config.emptyValueStrategy === "skip") {
      throw new Error("Empty group value - skipping");
    }
    if (config.emptyValueStrategy === "folder_uncategorized") {
      const folderName = config.uncategorizedFolderName ?? "Без категории";
      return await ensureFolder(context.baseId, context.workspaceId, baseParentId, folderName, context.folderCache, context.folderCreationLocks);
    }
    // root (или baseParentId если задан)
    return baseParentId;
  }

  // Создаём/находим папку для группы
  const parentId = config.rootFolderName
    ? await ensureFolder(context.baseId, context.workspaceId, baseParentId, config.rootFolderName, context.folderCache, context.folderCreationLocks)
    : baseParentId;

  return await ensureFolder(context.baseId, context.workspaceId, parentId, groupName, context.folderCache, context.folderCreationLocks);
}

/**
 * Создать или найти папку
 * Использует кэш и блокировки для предотвращения дубликатов при параллельной обработке
 */
async function ensureFolder(
  baseId: string,
  workspaceId: string,
  parentId: string | null,
  folderName: string,
  folderCache?: Map<string, string>,
  folderCreationLocks?: Map<string, Promise<string>>,
): Promise<string> {
  // Нормализуем имя папки (убираем пробелы в начале/конце)
  const normalizedName = folderName.trim();
  if (!normalizedName) {
    throw new Error("Folder name cannot be empty");
  }

  // Создаём ключ для кэша и блокировок
  const cacheKey = `${parentId ?? "null"}|${normalizedName}`;

  // Проверяем кэш
  if (folderCache?.has(cacheKey)) {
    return folderCache.get(cacheKey)!;
  }

  // Проверяем, есть ли уже процесс создания этой папки
  // Важно: проверяем ДО создания нового промиса, чтобы избежать race condition
  let existingLock = folderCreationLocks?.get(cacheKey);
  if (existingLock) {
    // Ждём, пока другая запись создаст папку
    return await existingLock;
  }

  // Создаём блокировку для создания папки
  // Устанавливаем блокировку СРАЗУ, чтобы другие вызовы ждали
  const creationPromise = (async () => {
    try {
      // Проверяем кэш ещё раз (возможно, другая запись уже создала папку)
      if (folderCache?.has(cacheKey)) {
        return folderCache.get(cacheKey)!;
      }

      // Проверяем существующую папку в БД (возможно, была создана другой записью)
      const existing = await db
        .select()
        .from(knowledgeNodes)
        .where(
          and(
            eq(knowledgeNodes.baseId, baseId),
            eq(knowledgeNodes.workspaceId, workspaceId),
            eq(knowledgeNodes.type, "folder"),
            eq(knowledgeNodes.title, normalizedName),
            parentId ? eq(knowledgeNodes.parentId, parentId) : eq(knowledgeNodes.parentId, null),
          ),
        )
        .limit(1);

      if (existing.length > 0) {
        const folderId = existing[0].id;
        // Сохраняем в кэш
        folderCache?.set(cacheKey, folderId);
        return folderId;
      }

      // Создаём новую папку
      const folder = await createKnowledgeFolder(baseId, workspaceId, {
        title: normalizedName,
        parentId: parentId ?? undefined,
      });

      // Сохраняем в кэш
      folderCache?.set(cacheKey, folder.id);
      return folder.id;
    } catch (error) {
      // Если папка была создана параллельно, попробуем найти её снова
      const retryExisting = await db
        .select()
        .from(knowledgeNodes)
        .where(
          and(
            eq(knowledgeNodes.baseId, baseId),
            eq(knowledgeNodes.workspaceId, workspaceId),
            eq(knowledgeNodes.type, "folder"),
            eq(knowledgeNodes.title, normalizedName),
            parentId ? eq(knowledgeNodes.parentId, parentId) : eq(knowledgeNodes.parentId, null),
          ),
        )
        .limit(1);

      if (retryExisting.length > 0) {
        const folderId = retryExisting[0].id;
        folderCache?.set(cacheKey, folderId);
        return folderId;
      }

      // Если всё равно не нашли, пробрасываем ошибку
      throw error;
    } finally {
      // Удаляем блокировку после создания
      folderCreationLocks?.delete(cacheKey);
    }
  })();

  // Сохраняем блокировку СРАЗУ, чтобы другие вызовы ждали
  folderCreationLocks?.set(cacheKey, creationPromise);

  return await creationPromise;
}

/**
 * Обработать батч записей
 */
async function processBatch(
  batch: ParsedRecord[],
  context: ImportContext,
  deduplicator: ImportDeduplicator,
): Promise<BatchResult> {
  const result: BatchResult = {
    created: 0,
    skipped: 0,
    errors: [],
  };

  const deduplicatorOptions = extractDeduplicatorOptions(context.mappingConfig);

  // Обрабатываем в транзакции для атомарности
  for (const record of batch) {
    const lineNumber = record.lineNumber ?? record.recordIndex ?? 0;

    // Проверка дубликата
    const dupCheck = deduplicator.checkDuplicate(record.data, lineNumber, deduplicatorOptions);

    if (dupCheck.isDuplicate) {
      result.skipped++;
      const recordError: ImportRecordError = {
        lineNumber: record.lineNumber,
        recordIndex: record.recordIndex ?? record.lineNumber,
        errorType: "duplicate",
        message: `Дубликат записи (${dupCheck.reason === "duplicate_id" ? "ID" : "контент"}). Оригинал: строка ${dupCheck.duplicateOf}`,
        field: deduplicatorOptions.idField,
        rawPreview: JSON.stringify(record.data).slice(0, 200),
      };
      result.errors.push(recordError);
      context.onError(recordError);
      continue;
    }

    try {
      const mapped = await applyMapping(record.data, context.mappingConfig, context.workspaceId);

      // Валидация
      // Title может быть пустым, если есть fallback - он уже применён в applyMapping
      if (!mapped.title || mapped.title.trim() === "") {
        throw new Error("Title is required");
      }
      if (!mapped.content || mapped.content.trim() === "") {
        throw new Error("Content is required");
      }

      // Разрешаем parentId
      let parentId: string | null = null;
      try {
        parentId = await resolveParentFolder(record.data, context.hierarchyConfig, context);
      } catch (error) {
        if (error instanceof Error && error.message.includes("skipping")) {
          result.skipped++;
          continue;
        }
        throw error;
      }

      // Создаём документ
      // Для v2: используем contentHtml если есть, иначе content
      // contentMd сохраняется как contentMarkdown
      await createKnowledgeDocument(context.baseId, context.workspaceId, {
        title: mapped.title,
        content: mapped.contentHtml || mapped.content,
        contentMarkdown: mapped.contentMd || mapped.contentMarkdown,
        contentPlainText: mapped.content,
        parentId,
        sourceType: "json_import",
        importFileName: null,
        metadata: Object.keys(mapped.metadata || {}).length > 0 ? mapped.metadata : undefined,
      });

      result.created++;
    } catch (error) {
      const errorType: ErrorType = error instanceof Error && error.message.includes("validation")
        ? "validation_error"
        : error instanceof Error && error.message.includes("mapping")
          ? "mapping_error"
          : "database_error";

      const recordError: ImportRecordError = {
        lineNumber: record.lineNumber,
        recordIndex: record.recordIndex ?? record.lineNumber,
        errorType,
        message: error instanceof Error ? error.message : String(error),
        rawPreview: JSON.stringify(record.data).slice(0, 200),
      };

      result.errors.push(recordError);
      context.onError(recordError);
    }
  }

  return result;
}

/**
 * Обработать JSONL поток
 */
export async function processJsonlStream(
  s3Stream: Readable,
  context: ImportContext,
): Promise<{ totalRecords: number; createdDocuments: number; skippedRecords: number; errorRecords: number }> {
  const rl = createInterface({
    input: s3Stream,
    crlfDelay: Infinity,
  });

  const deduplicator = new ImportDeduplicator();
  let batch: ParsedRecord[] = [];
  let lineNumber = 0;
  let totalRecords = 0;
  let createdDocuments = 0;
  let skippedRecords = 0;
  let errorRecords = 0;

  for await (const line of rl) {
    lineNumber++;

    if (!line.trim()) {
      continue; // пропускаем пустые строки
    }

    try {
      const record = JSON.parse(line);
      batch.push({ lineNumber, data: record });
      totalRecords++;

      if (batch.length >= BATCH_SIZE) {
        const batchResult = await processBatch(batch, context, deduplicator);
        createdDocuments += batchResult.created;
        skippedRecords += batchResult.skipped;
        errorRecords += batchResult.errors.length;

        await context.onProgress({
          processedRecords: totalRecords,
          createdDocuments,
          skippedRecords,
          errorRecords,
        });

        batch = [];
      }
    } catch (error) {
      errorRecords++;
      const recordError: ImportRecordError = {
        lineNumber,
        recordIndex: lineNumber,
        errorType: "parse_error",
        message: error instanceof Error ? error.message : String(error),
        rawPreview: line.slice(0, 200),
      };
      context.onError(recordError);
    }
  }

  // Обработать оставшийся батч
  if (batch.length > 0) {
    const batchResult = await processBatch(batch, context, deduplicator);
    createdDocuments += batchResult.created;
    skippedRecords += batchResult.skipped;
    errorRecords += batchResult.errors.length;
  }

  await context.onProgress({
    processedRecords: totalRecords,
    createdDocuments,
    skippedRecords,
    errorRecords,
  });

  return { totalRecords, createdDocuments, skippedRecords, errorRecords };
}

/**
 * Обработать JSON-массив поток
 */
export async function processJsonArrayStream(
  s3Stream: Readable,
  context: ImportContext,
): Promise<{ totalRecords: number; createdDocuments: number; skippedRecords: number; errorRecords: number }> {
  // Динамический импорт для CommonJS модуля
  const streamJson = await import("stream-json");
  const streamArrayModule = await import("stream-json/streamers/StreamArray.js");
  // При динамическом импорте CommonJS модуля экспорты находятся в default
  const streamJsonMod = streamJson.default || streamJson;
  const streamArrayMod = streamArrayModule.default || streamArrayModule;
  const parser = streamJsonMod.parser;
  const streamArray = streamArrayMod.streamArray;
  const pipeline = s3Stream.pipe(parser()).pipe(streamArray());

  const deduplicator = new ImportDeduplicator();
  let batch: ParsedRecord[] = [];
  let recordIndex = 0;
  let totalRecords = 0;
  let createdDocuments = 0;
  let skippedRecords = 0;
  let errorRecords = 0;

  for await (const chunk of pipeline) {
    recordIndex++;
    const { value } = chunk;

    try {
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new Error("Expected object in array");
      }

      batch.push({ recordIndex, data: value as Record<string, unknown> });
      totalRecords++;

      if (batch.length >= BATCH_SIZE) {
        const batchResult = await processBatch(batch, context, deduplicator);
        createdDocuments += batchResult.created;
        skippedRecords += batchResult.skipped;
        errorRecords += batchResult.errors.length;

        await context.onProgress({
          processedRecords: totalRecords,
          createdDocuments,
          skippedRecords,
          errorRecords,
        });

        batch = [];
      }
    } catch (error) {
      errorRecords++;
      const recordError: ImportRecordError = {
        lineNumber: recordIndex,
        recordIndex,
        errorType: "parse_error",
        message: error instanceof Error ? error.message : String(error),
      };
      context.onError(recordError);
    }
  }

  // Обработать оставшийся батч
  if (batch.length > 0) {
    const batchResult = await processBatch(batch, context, deduplicator);
    createdDocuments += batchResult.created;
    skippedRecords += batchResult.skipped;
    errorRecords += batchResult.errors.length;
  }

  await context.onProgress({
    processedRecords: totalRecords,
    createdDocuments,
    skippedRecords,
    errorRecords,
  });

  return { totalRecords, createdDocuments, skippedRecords, errorRecords };
}

/**
 * Главная функция обработки импорта
 */
export async function processJsonImport(
  workspaceId: string,
  fileKey: string,
  fileFormat: "json" | "jsonl",
  context: Omit<ImportContext, "onProgress" | "onError">,
  onProgress: (stats: {
    processedRecords: number;
    createdDocuments: number;
    skippedRecords: number;
    errorRecords: number;
  }) => Promise<void>,
  onError: (error: ImportRecordError) => void,
): Promise<{ totalRecords: number; createdDocuments: number; skippedRecords: number; errorRecords: number }> {
  // Получаем файл из S3
  const fileObject = await getObject(workspaceId, fileKey);
  if (!fileObject || !fileObject.body) {
    throw new Error(`File not found: ${fileKey}`);
  }

  // Инициализируем кэш папок и блокировки для предотвращения дубликатов при параллельной обработке
  const folderCache = new Map<string, string>();
  const folderCreationLocks = new Map<string, Promise<string>>();

  const fullContext: ImportContext = {
    ...context,
    onProgress,
    onError,
    folderCache,
    folderCreationLocks,
  };

  if (fileFormat === "jsonl") {
    return await processJsonlStream(fileObject.body, fullContext);
  } else {
    return await processJsonArrayStream(fileObject.body, fullContext);
  }
}
