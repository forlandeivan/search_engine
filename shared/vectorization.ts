export const collectionFieldTypes = ["string", "double", "object"] as const;

export type CollectionFieldType = (typeof collectionFieldTypes)[number];

export interface CollectionSchemaFieldInput {
  name: string;
  type: CollectionFieldType;
  isArray: boolean;
  template: string;
}

export interface VectorizeCollectionSchema {
  fields: CollectionSchemaFieldInput[];
  embeddingFieldName?: string | null;
}

function parsePathSegments(path: string): string[] {
  const segments: string[] = [];
  const regex = /([^.\[\]]+)|\[(\d+)\]/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(path)) !== null) {
    const [, dotSegment, indexSegment] = match;
    if (dotSegment) {
      segments.push(dotSegment);
    } else if (indexSegment) {
      segments.push(indexSegment);
    }
  }

  return segments;
}

export function getValueFromContext(source: unknown, path: string): unknown {
  if (!path) {
    return undefined;
  }

  const trimmed = path.trim();
  if (!trimmed) {
    return undefined;
  }

  const [basePath] = trimmed.split("|");
  const segments = parsePathSegments(basePath.trim());

  return segments.reduce<unknown>((current, segment) => {
    if (current === null || current === undefined) {
      return undefined;
    }

    if (typeof current === "object") {
      if (Array.isArray(current)) {
        const index = Number.parseInt(segment, 10);
        return Number.isNaN(index) ? undefined : current[index];
      }

      return (current as Record<string, unknown>)[segment];
    }

    return undefined;
  }, source);
}

export function renderLiquidTemplate(template: string, context: Record<string, unknown>): unknown {
  const raw = template ?? "";
  const trimmed = raw.trim();

  if (!trimmed) {
    return null;
  }

  const singleExpressionMatch = trimmed.match(/^\{\{\s*([^}]+)\s*\}\}$/);
  if (singleExpressionMatch) {
    const value = getValueFromContext(context, singleExpressionMatch[1]);
    return value ?? null;
  }

  let hasReplacement = false;
  const replaced = raw.replace(/\{\{\s*([^}]+)\s*\}\}/g, (_, expression: string) => {
    hasReplacement = true;
    const value = getValueFromContext(context, expression);

    if (value === null || value === undefined) {
      return "";
    }

    if (typeof value === "object") {
      try {
        return JSON.stringify(value);
      } catch (error) {
        console.error("Не удалось сериализовать значение для Liquid шаблона", error);
        return "";
      }
    }

    return String(value);
  });

  return hasReplacement ? replaced : raw;
}

export function castValueToType(value: unknown, type: CollectionFieldType): unknown {
  if (value === undefined) {
    return null;
  }

  if (value === null) {
    return null;
  }

  if (type === "double") {
    if (typeof value === "number") {
      return Number.isFinite(value) ? value : null;
    }

    if (typeof value === "string") {
      const parsed = Number.parseFloat(value.trim());
      return Number.isFinite(parsed) ? parsed : null;
    }

    return null;
  }

  if (type === "object") {
    if (typeof value === "object") {
      return value;
    }

    if (typeof value === "string") {
      const trimmed = value.trim();
      if (!trimmed) {
        return null;
      }

      try {
        return JSON.parse(trimmed);
      } catch (error) {
        console.error("Не удалось распарсить JSON из Liquid шаблона", error);
        return trimmed;
      }
    }

    return value;
  }

  if (typeof value === "string") {
    return value;
  }

  try {
    return JSON.stringify(value);
  } catch (error) {
    console.error("Не удалось преобразовать значение в строку", error);
    return String(value);
  }
}

export function normalizeArrayValue(value: unknown, isArray: boolean): unknown {
  if (!isArray) {
    return value;
  }

  if (value === null || value === undefined) {
    return [];
  }

  if (Array.isArray(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim().length === 0) {
    return [];
  }

  return [value];
}
