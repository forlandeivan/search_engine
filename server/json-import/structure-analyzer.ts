import { Readable } from "stream";
import { createInterface } from "readline";
import { getObject, ensureWorkspaceBucketExists } from "../workspace-storage-service";
import { HeadObjectCommand } from "@aws-sdk/client-s3";
import { minioClient } from "../minio-client";
import type { FieldInfo } from "@shared/json-import";

export type FileFormat = "json_array" | "jsonl";

// Re-export from shared
export type { FieldInfo };

export interface StructureAnalysis {
  format: FileFormat;
  estimatedRecordCount: number;
  fileSize: number;
  fields: FieldInfo[];
  sampleRecords: Array<Record<string, unknown>>;
  warnings: Array<{
    code: string;
    message: string;
  }>;
}

export interface AnalyzerOptions {
  sampleSize: number; // сколько записей анализировать
  maxFieldDepth: number; // максимальная глубина вложенности (2 для MVP)
  maxStringPreview: number; // длина превью строк
}

const DEFAULT_OPTIONS: AnalyzerOptions = {
  sampleSize: 100,
  maxFieldDepth: 2,
  maxStringPreview: 100,
};

/**
 * Получить значение из вложенного объекта по пути
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
 * Определить тип значения
 */
function getValueType(value: unknown): "string" | "number" | "boolean" | "array" | "object" | "null" {
  if (value === null) {
    return "null";
  }
  if (Array.isArray(value)) {
    return "array";
  }
  if (typeof value === "object") {
    return "object";
  }
  return typeof value as "string" | "number" | "boolean";
}

/**
 * Собрать все поля из объекта (с ограничением глубины)
 */
function collectFields(
  obj: Record<string, unknown>,
  prefix: string = "",
  depth: number = 0,
  maxDepth: number = 2,
): Map<string, { type: string; value: unknown }> {
  const fields = new Map<string, { type: string; value: unknown }>();

  if (depth >= maxDepth) {
    return fields;
  }

  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    const type = getValueType(value);

    if (type === "object" && value !== null && !Array.isArray(value)) {
      // Рекурсивно обрабатываем вложенные объекты
      const nestedFields = collectFields(value as Record<string, unknown>, path, depth + 1, maxDepth);
      for (const [nestedPath, nestedInfo] of nestedFields.entries()) {
        fields.set(nestedPath, nestedInfo);
      }
    } else {
      fields.set(path, { type, value });
    }
  }

  return fields;
}

/**
 * Обрезать строку для превью
 */
function truncateString(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return value.slice(0, maxLength - 3) + "...";
}

/**
 * Преобразовать значение в строку для превью
 */
function valueToString(value: unknown, maxLength: number): string {
  if (value === null) {
    return "null";
  }
  if (Array.isArray(value)) {
    return `[массив из ${value.length} элементов]`;
  }
  if (typeof value === "object") {
    return `{объект}`;
  }
  const str = String(value);
  return truncateString(str, maxLength);
}

/**
 * Определить формат файла по первым байтам
 */
export async function detectFormat(stream: Readable): Promise<FileFormat> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    const maxBytes = 1024; // читаем первые 1KB
    let resolved = false;

    const finish = (format: FileFormat) => {
      if (resolved) return;
      resolved = true;
      resolve(format);
    };

    stream.on("data", (chunk: Buffer) => {
      if (resolved) return;
      
      chunks.push(chunk);
      totalBytes += chunk.length;

      if (totalBytes >= maxBytes) {
        stream.destroy();
        const buffer = Buffer.concat(chunks);
        const text = buffer.toString("utf8").trim();

        // Если начинается с '[' — JSON-массив
        if (text.startsWith("[")) {
          finish("json_array");
        } else if (text.startsWith("{")) {
          // Если начинается с '{' — вероятно JSONL (каждая строка — объект)
          finish("jsonl");
        } else {
          resolved = true;
          reject(new Error("Неизвестный формат файла"));
        }
      }
    });

    stream.on("end", () => {
      if (resolved) return;
      
      const buffer = Buffer.concat(chunks);
      const text = buffer.toString("utf8").trim();

      if (text.startsWith("[")) {
        finish("json_array");
      } else if (text.startsWith("{")) {
        finish("jsonl");
      } else {
        resolved = true;
        reject(new Error("Неизвестный формат файла"));
      }
    });

    stream.on("error", (err) => {
      if (resolved) return;
      resolved = true;
      reject(err);
    });
  });
}

/**
 * Анализировать JSONL структуру
 */
async function analyzeJsonlStructure(
  stream: Readable,
  options: AnalyzerOptions,
  fileSize: number,
): Promise<StructureAnalysis> {
  const rl = createInterface({
    input: stream,
    crlfDelay: Infinity,
  });

  const fieldStats = new Map<
    string,
    {
      types: Set<string>;
      values: string[];
      count: number;
    }
  >();

  const sampleRecords: Array<Record<string, unknown>> = [];
  let recordCount = 0;
  let totalRecords = 0;

  for await (const line of rl) {
    if (!line.trim()) {
      continue;
    }

    try {
      const record = JSON.parse(line) as Record<string, unknown>;
      totalRecords++;

      if (recordCount < options.sampleSize) {
        // Собираем поля из записи
        const fields = collectFields(record, "", 0, options.maxFieldDepth);

        for (const [path, { type, value }] of fields.entries()) {
          if (!fieldStats.has(path)) {
            fieldStats.set(path, {
              types: new Set(),
              values: [],
              count: 0,
            });
          }

          const stats = fieldStats.get(path)!;
          stats.types.add(type);
          stats.count++;

          // Сохраняем примеры значений (до 3)
          if (stats.values.length < 3 && value !== null && value !== undefined) {
            const preview = valueToString(value, options.maxStringPreview);
            if (!stats.values.includes(preview)) {
              stats.values.push(preview);
            }
          }
        }

        // Сохраняем пример записи (до 5)
        if (sampleRecords.length < 5) {
          sampleRecords.push(record);
        }

        recordCount++;
      }
    } catch (error) {
      // Пропускаем битые строки при анализе
      continue;
    }
  }

  // Преобразуем статистику в FieldInfo
  const fields: FieldInfo[] = Array.from(fieldStats.entries())
    .map(([path, stats]) => {
      const parts = path.split(".");
      const key = parts[parts.length - 1];

      let type: FieldInfo["type"] = "mixed";
      if (stats.types.size === 1) {
        const singleType = Array.from(stats.types)[0];
        if (singleType === "null") {
          type = "null";
        } else {
          type = singleType as FieldInfo["type"];
        }
      } else if (stats.types.size > 1) {
        type = "mixed";
      }

      return {
        key,
        path,
        type,
        frequency: Math.round((stats.count / recordCount) * 100),
        sampleValues: stats.values,
      };
    })
    .sort((a, b) => b.frequency - a.frequency); // сортируем по частоте

  const warnings: Array<{ code: string; message: string }> = [];

  // Проверяем глубину вложенности
  const maxDepth = Math.max(...fields.map((f) => f.path.split(".").length));
  if (maxDepth > options.maxFieldDepth) {
    warnings.push({
      code: "DEEP_NESTING",
      message: `Обнаружены вложенные объекты глубиной до ${maxDepth} уровней. В MVP поддерживается только ${options.maxFieldDepth} уровня вложенности.`,
    });
  }

  // Оцениваем общее количество записей
  // Если прочитали меньше sampleSize, значит файл маленький
  const estimatedRecordCount = totalRecords;

  return {
    format: "jsonl",
    estimatedRecordCount,
    fileSize,
    fields,
    sampleRecords,
    warnings,
  };
}

/**
 * Анализировать JSON-массив структуру
 */
async function analyzeJsonArrayStructure(
  stream: Readable,
  options: AnalyzerOptions,
  fileSize: number,
): Promise<StructureAnalysis> {
  // Динамический импорт для CommonJS модуля
  const streamJson = await import("stream-json");
  const streamArrayModule = await import("stream-json/streamers/StreamArray.js");
  // При динамическом импорте CommonJS модуля экспорты находятся в default
  const streamJsonMod = streamJson.default || streamJson;
  const streamArrayMod = streamArrayModule.default || streamArrayModule;
  const parser = streamJsonMod.parser;
  const streamArray = streamArrayMod.streamArray;
  const pipeline = stream.pipe(parser()).pipe(streamArray());

  const fieldStats = new Map<
    string,
    {
      types: Set<string>;
      values: string[];
      count: number;
    }
  >();

  const sampleRecords: Array<Record<string, unknown>> = [];
  let recordCount = 0;
  let totalRecords = 0;

  for await (const chunk of pipeline) {
    const { value } = chunk;

    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      continue;
    }

    totalRecords++;

    if (recordCount < options.sampleSize) {
      const record = value as Record<string, unknown>;

      // Собираем поля из записи
      const fields = collectFields(record, "", 0, options.maxFieldDepth);

      for (const [path, { type, value: fieldValue }] of fields.entries()) {
        if (!fieldStats.has(path)) {
          fieldStats.set(path, {
            types: new Set(),
            values: [],
            count: 0,
          });
        }

        const stats = fieldStats.get(path)!;
        stats.types.add(type);
        stats.count++;

        // Сохраняем примеры значений (до 3)
        if (stats.values.length < 3 && fieldValue !== null && fieldValue !== undefined) {
          const preview = valueToString(fieldValue, options.maxStringPreview);
          if (!stats.values.includes(preview)) {
            stats.values.push(preview);
          }
        }
      }

      // Сохраняем пример записи (до 5)
      if (sampleRecords.length < 5) {
        sampleRecords.push(record);
      }

      recordCount++;
    }
  }

  // Преобразуем статистику в FieldInfo
  const fields: FieldInfo[] = Array.from(fieldStats.entries())
    .map(([path, stats]) => {
      const parts = path.split(".");
      const key = parts[parts.length - 1];

      let type: FieldInfo["type"] = "mixed";
      if (stats.types.size === 1) {
        const singleType = Array.from(stats.types)[0];
        if (singleType === "null") {
          type = "null";
        } else {
          type = singleType as FieldInfo["type"];
        }
      } else if (stats.types.size > 1) {
        type = "mixed";
      }

      return {
        key,
        path,
        type,
        frequency: Math.round((stats.count / recordCount) * 100),
        sampleValues: stats.values,
      };
    })
    .sort((a, b) => b.frequency - a.frequency); // сортируем по частоте

  const warnings: Array<{ code: string; message: string }> = [];

  // Проверяем глубину вложенности
  const maxDepth = Math.max(...fields.map((f) => f.path.split(".").length));
  if (maxDepth > options.maxFieldDepth) {
    warnings.push({
      code: "DEEP_NESTING",
      message: `Обнаружены вложенные объекты глубиной до ${maxDepth} уровней. В MVP поддерживается только ${options.maxFieldDepth} уровня вложенности.`,
    });
  }

  // Оцениваем общее количество записей
  const estimatedRecordCount = totalRecords;

  return {
    format: "json_array",
    estimatedRecordCount,
    fileSize,
    fields,
    sampleRecords,
    warnings,
  };
}

/**
 * Главная функция анализа структуры
 */
export async function analyzeJsonStructure(
  workspaceId: string,
  fileKey: string,
  options: Partial<AnalyzerOptions> = {},
): Promise<StructureAnalysis> {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  // Получаем размер файла через HeadObjectCommand
  let fileSize = 0;
  try {
    const bucket = await ensureWorkspaceBucketExists(workspaceId);
    const minioClient = getMinioClient();
    const headResponse = await minioClient.send(
      new HeadObjectCommand({
        Bucket: bucket,
        Key: fileKey,
      }),
    );
    fileSize = typeof headResponse.ContentLength === "number" ? headResponse.ContentLength : 0;
  } catch (error) {
    // Если не удалось получить размер, продолжаем с 0
    console.warn(`[structure-analyzer] Failed to get file size for ${fileKey}:`, error instanceof Error ? error.message : String(error));
  }

  // Получаем файл из S3 для определения формата
  const formatFileObject = await getObject(workspaceId, fileKey);
  if (!formatFileObject || !formatFileObject.body) {
    throw new Error(`File not found: ${fileKey}`);
  }

  // Определяем формат
  let format: FileFormat;
  try {
    format = await detectFormat(formatFileObject.body);
  } catch (error) {
    throw new Error(`Неизвестный формат файла: ${error instanceof Error ? error.message : String(error)}`);
  }

  // Анализируем структуру (создаём новый stream, так как предыдущий уже прочитан)
  const analysisFileObject = await getObject(workspaceId, fileKey);
  if (!analysisFileObject || !analysisFileObject.body) {
    throw new Error(`File not found: ${fileKey}`);
  }

  if (format === "jsonl") {
    return await analyzeJsonlStructure(analysisFileObject.body, opts, fileSize);
  } else {
    return await analyzeJsonArrayStructure(analysisFileObject.body, opts, fileSize);
  }
}
