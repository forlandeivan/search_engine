import { createHash } from "crypto";
import type { MappingConfig } from "@shared/json-import";

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

export interface DeduplicatorOptions {
  mode: "skip" | "allow_all";
  idField?: string; // путь к полю ID (если указан в маппинге)
  contentFields: string[]; // поля для hash (если ID не задан)
}

export interface DuplicateCheckResult {
  isDuplicate: boolean;
  duplicateOf?: number; // номер строки оригинала
  key?: string; // ID или hash
  reason?: "duplicate_id" | "duplicate_content";
}

export class ImportDeduplicator {
  private seenIds: Set<string> = new Set();
  private seenHashes: Map<string, number> = new Map(); // hash → lineNumber

  checkDuplicate(
    record: Record<string, unknown>,
    lineNumber: number,
    options: DeduplicatorOptions,
  ): DuplicateCheckResult {
    if (options.mode === "allow_all") {
      return { isDuplicate: false };
    }

    const key = this.computeKey(record, options);

    if (options.idField) {
      // Дедупликация по явному ID
      if (this.seenIds.has(key)) {
        const originalLine = this.seenHashes.get(key);
        return {
          isDuplicate: true,
          duplicateOf: originalLine,
          key,
          reason: "duplicate_id",
        };
      }
      this.seenIds.add(key);
      this.seenHashes.set(key, lineNumber);
    } else {
      // Дедупликация по hash контента
      if (this.seenHashes.has(key)) {
        const originalLine = this.seenHashes.get(key);
        return {
          isDuplicate: true,
          duplicateOf: originalLine,
          key,
          reason: "duplicate_content",
        };
      }
      this.seenHashes.set(key, lineNumber);
    }

    return { isDuplicate: false, key };
  }

  private computeKey(record: Record<string, unknown>, options: DeduplicatorOptions): string {
    if (options.idField) {
      const value = getNestedValue(record, options.idField);
      const stringValue = String(value ?? "");
      // Пустой ID считается как отсутствие ID
      if (stringValue.trim() === "") {
        // Fallback на hash контента
        return this.computeContentHash(record, options.contentFields);
      }
      return stringValue;
    }

    // Hash контента
    return this.computeContentHash(record, options.contentFields);
  }

  private computeContentHash(record: Record<string, unknown>, contentFields: string[]): string {
    const contentParts = contentFields.map((field) => {
      const value = getNestedValue(record, field);
      return String(value ?? "");
    });

    if (contentParts.length === 0 || contentParts.every((part) => part.trim() === "")) {
      // Если нет контента, используем весь объект
      return createHash("sha256").update(JSON.stringify(record)).digest("hex");
    }

    return createHash("sha256").update(contentParts.join("\n")).digest("hex");
  }

  /**
   * Получить статистику дедупликатора
   */
  getStats(): { uniqueIds: number; uniqueHashes: number } {
    return {
      uniqueIds: this.seenIds.size,
      uniqueHashes: this.seenHashes.size,
    };
  }

  /**
   * Очистить состояние (для тестирования)
   */
  reset(): void {
    this.seenIds.clear();
    this.seenHashes.clear();
  }
}

/**
 * Извлечь опции дедупликации из MappingConfig
 */
export function extractDeduplicatorOptions(mappingConfig: MappingConfig): DeduplicatorOptions {
  const mode = mappingConfig.deduplication?.mode ?? "skip";
  
  // Находим поле с ролью "id"
  const idFieldMapping = mappingConfig.fields.find((f) => f.role === "id");
  const idField = idFieldMapping?.sourcePath;

  // Находим поля с ролью "content"
  const contentFields = mappingConfig.fields
    .filter((f) => f.role === "content" || f.role === "content_html" || f.role === "content_md")
    .map((f) => f.sourcePath);

  return {
    mode,
    idField,
    contentFields,
  };
}
