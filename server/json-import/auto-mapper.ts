import type { FieldMapping, MappingConfig } from "@shared/json-import";
import type { FieldInfo } from "./structure-analyzer";

const TITLE_PATTERNS = [
  "title",
  "name",
  "header",
  "subject",
  "heading",
  "название",
  "заголовок",
  "имя",
  "наименование",
];

const CONTENT_PATTERNS = [
  "content",
  "text",
  "body",
  "description",
  "article",
  "контент",
  "текст",
  "содержание",
  "описание",
  "статья",
  "summary",
  "details",
];

const ID_PATTERNS = ["id", "_id", "uuid", "key", "identifier", "идентификатор"];

const HTML_PATTERNS = ["html", "content_html", "body_html", "html_content"];

const MARKDOWN_PATTERNS = ["markdown", "md", "content_md", "body_md", "md_content"];

/**
 * Предложить автоматический маппинг на основе имён полей
 */
export function suggestMapping(fields: FieldInfo[]): MappingConfig {
  const suggestions: FieldMapping[] = [];
  let contentPriority = 1;

  for (const field of fields) {
    const lowerName = field.key.toLowerCase();
    const lowerPath = field.path.toLowerCase();

    // Проверяем паттерны в порядке приоритета
    if (ID_PATTERNS.some((p) => lowerName.includes(p) || lowerPath.includes(p))) {
      suggestions.push({ sourcePath: field.path, role: "id" });
    } else if (HTML_PATTERNS.some((p) => lowerName.includes(p) || lowerPath.includes(p))) {
      suggestions.push({ sourcePath: field.path, role: "content_html" });
    } else if (MARKDOWN_PATTERNS.some((p) => lowerName.includes(p) || lowerPath.includes(p))) {
      suggestions.push({ sourcePath: field.path, role: "content_md" });
    } else if (TITLE_PATTERNS.some((p) => lowerName.includes(p) || lowerPath.includes(p))) {
      suggestions.push({ sourcePath: field.path, role: "title" });
    } else if (CONTENT_PATTERNS.some((p) => lowerName.includes(p) || lowerPath.includes(p))) {
      suggestions.push({ sourcePath: field.path, role: "content", priority: contentPriority++ });
    } else {
      // По умолчанию — метаданные
      suggestions.push({ sourcePath: field.path, role: "metadata" });
    }
  }

  return {
    fields: suggestions,
    contentJoinSeparator: "\n\n",
    titleFallback: "first_line",
  };
}

/**
 * Валидировать маппинг
 */
export function validateMapping(mappingConfig: MappingConfig): {
  valid: boolean;
  errors: Array<{ field: string; code: string; message: string }>;
  warnings: Array<{ field: string; code: string; message: string }>;
} {
  const errors: Array<{ field: string; code: string; message: string }> = [];
  const warnings: Array<{ field: string; code: string; message: string }> = [];

  // Проверяем наличие поля для контента
  const hasContentField = mappingConfig.fields.some(
    (f) => f.role === "content" || f.role === "content_html" || f.role === "content_md",
  );

  if (!hasContentField) {
    errors.push({
      field: "mapping",
      code: "NO_CONTENT_FIELD",
      message: "Выберите хотя бы одно поле для контента документа",
    });
  }

  // Проверяем дубликаты ID
  const idFields = mappingConfig.fields.filter((f) => f.role === "id");
  if (idFields.length > 1) {
    warnings.push({
      field: "mapping",
      code: "MULTIPLE_ID_FIELDS",
      message: `Найдено несколько полей с ролью "ID". Будет использовано первое: ${idFields[0].sourcePath}`,
    });
  }

  // Проверяем дубликаты title
  const titleFields = mappingConfig.fields.filter((f) => f.role === "title");
  if (titleFields.length > 1) {
    warnings.push({
      field: "mapping",
      code: "MULTIPLE_TITLE_FIELDS",
      message: `Найдено несколько полей с ролью "Заголовок". Будет использовано первое: ${titleFields[0].sourcePath}`,
    });
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}
