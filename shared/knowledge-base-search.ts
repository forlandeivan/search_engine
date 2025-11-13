import type {
  KnowledgeBaseChunkSearchSettings,
  KnowledgeBaseRagSearchSettings,
} from "./schema";

export type KnowledgeBaseSearchResponseFormat = "text" | "markdown" | "html";

type NumericConstraint = {
  defaultValue: number;
  min: number;
  max: number;
  step: number;
};

type BooleanConstraint = {
  defaultValue: boolean;
};

type ListConstraint = {
  defaultValue: string[];
  maxItems?: number;
};

type TextConstraint = {
  defaultValue: string;
};

type ResponseFormatConstraint = {
  defaultValue: KnowledgeBaseSearchResponseFormat;
};

type NullableNumericConstraint = {
  defaultValue: number;
  min: number;
  max: number;
  step: number;
};

type NullableNumberConstraint = {
  defaultValue: number;
  min: number;
  max: number;
  step: number;
};

export const KNOWLEDGE_BASE_SEARCH_CONSTRAINTS = {
  chunk: {
    topK: { defaultValue: 6, min: 1, max: 10, step: 1 } satisfies NumericConstraint,
    bm25Weight: { defaultValue: 0.6, min: 0, max: 1, step: 0.05 } satisfies NumericConstraint,
    synonyms: { defaultValue: [], maxItems: 12 } satisfies ListConstraint,
    includeDrafts: { defaultValue: false } satisfies BooleanConstraint,
    highlightResults: { defaultValue: true } satisfies BooleanConstraint,
    filters: { defaultValue: "" } satisfies TextConstraint,
  },
  rag: {
    topK: { defaultValue: 6, min: 1, max: 20, step: 1 } satisfies NumericConstraint,
    bm25Weight: { defaultValue: 0.5, min: 0, max: 1, step: 0.05 } satisfies NumericConstraint,
    bm25Limit: { defaultValue: 6, min: 1, max: 20, step: 1 } satisfies NumericConstraint,
    vectorWeight: { defaultValue: 0.5, min: 0, max: 1, step: 0.05 } satisfies NumericConstraint,
    vectorLimit: { defaultValue: 8, min: 1, max: 20, step: 1 } satisfies NullableNumberConstraint,
    temperature: { defaultValue: 0.2, min: 0, max: 2, step: 0.1 } satisfies NumericConstraint,
    maxTokens: { defaultValue: 2048, min: 16, max: 4096, step: 1 } satisfies NullableNumericConstraint,
    systemPrompt: { defaultValue: "" } satisfies TextConstraint,
    responseFormat: { defaultValue: "markdown" } satisfies ResponseFormatConstraint,
  },
} as const;

export type KnowledgeBaseChunkSearchSettingsResolved = {
  topK: number;
  bm25Weight: number;
  synonyms: string[];
  includeDrafts: boolean;
  highlightResults: boolean;
  filters: string;
};

export type KnowledgeBaseRagSearchSettingsResolved = {
  topK: number;
  bm25Weight: number;
  bm25Limit: number | null;
  vectorWeight: number | null;
  vectorLimit: number | null;
  embeddingProviderId: string | null;
  collection: string | null;
  llmProviderId: string | null;
  llmModel: string | null;
  temperature: number | null;
  maxTokens: number | null;
  systemPrompt: string;
  responseFormat: KnowledgeBaseSearchResponseFormat | null;
};

export type KnowledgeBaseSearchSettingsResponsePayload = {
  chunkSettings: KnowledgeBaseChunkSearchSettingsResolved;
  ragSettings: KnowledgeBaseRagSearchSettingsResolved;
  updatedAt: string | null;
};

export type KnowledgeBaseSearchSettingsUpdatePayload = {
  chunkSettings: KnowledgeBaseChunkSearchSettingsResolved;
  ragSettings: KnowledgeBaseRagSearchSettingsResolved;
};

function parseNumber(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return raw;
  }

  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (trimmed.length === 0) {
      return null;
    }

    const parsed = Number(trimmed);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return null;
}

function clampInteger(value: number, min: number, max: number): number {
  const rounded = Math.round(value);
  return Math.max(min, Math.min(max, rounded));
}

function clampFraction(value: number, min: number, max: number): number {
  const clamped = Math.max(min, Math.min(max, value));
  return Math.round(clamped * 100) / 100;
}

function clampTemperature(value: number, min: number, max: number): number {
  const clamped = Math.max(min, Math.min(max, value));
  return Math.round(clamped * 100) / 100;
}

function sanitizeBoolean(raw: unknown, fallback: boolean): boolean {
  if (typeof raw === "boolean") {
    return raw;
  }

  if (typeof raw === "string") {
    const normalized = raw.trim().toLowerCase();
    if (normalized === "true") {
      return true;
    }
    if (normalized === "false") {
      return false;
    }
  }

  return fallback;
}

function sanitizeString(raw: unknown): string | null {
  if (typeof raw !== "string") {
    return null;
  }

  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function sanitizeSynonyms(raw: unknown, constraints: ListConstraint): string[] {
  if (!Array.isArray(raw)) {
    return [...constraints.defaultValue];
  }

  const normalized = raw
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter((item) => item.length > 0);

  const unique = Array.from(new Set(normalized));
  const limit = constraints.maxItems ?? unique.length;
  return unique.slice(0, limit);
}

function sanitizeResponseFormat(
  raw: unknown,
): KnowledgeBaseSearchResponseFormat | null {
  if (typeof raw !== "string") {
    return null;
  }

  const normalized = raw.trim().toLowerCase();
  if (normalized === "text" || normalized === "markdown" || normalized === "html") {
    return normalized;
  }

  return null;
}

export function mergeChunkSearchSettings(
  input: KnowledgeBaseChunkSearchSettings | null | undefined,
): KnowledgeBaseChunkSearchSettingsResolved {
  const constraints = KNOWLEDGE_BASE_SEARCH_CONSTRAINTS.chunk;

  const topKValue = clampInteger(
    parseNumber(input?.topK) ?? constraints.topK.defaultValue,
    constraints.topK.min,
    constraints.topK.max,
  );

  const bm25WeightValue = clampFraction(
    parseNumber(input?.bm25Weight) ?? constraints.bm25Weight.defaultValue,
    constraints.bm25Weight.min,
    constraints.bm25Weight.max,
  );

  const synonymsValue = sanitizeSynonyms(input?.synonyms, constraints.synonyms);

  const includeDraftsValue = sanitizeBoolean(input?.includeDrafts, constraints.includeDrafts.defaultValue);
  const highlightValue = sanitizeBoolean(
    input?.highlightResults,
    constraints.highlightResults.defaultValue,
  );

  const filtersValue =
    typeof input?.filters === "string" ? input.filters : constraints.filters.defaultValue;

  return {
    topK: topKValue,
    bm25Weight: bm25WeightValue,
    synonyms: synonymsValue,
    includeDrafts: includeDraftsValue,
    highlightResults: highlightValue,
    filters: filtersValue,
  };
}

export function mergeRagSearchSettings(
  input: KnowledgeBaseRagSearchSettings | null | undefined,
  fallback?: { topK?: number | null; bm25Weight?: number | null },
): KnowledgeBaseRagSearchSettingsResolved {
  const constraints = KNOWLEDGE_BASE_SEARCH_CONSTRAINTS.rag;

  const topKBase = fallback?.topK ?? constraints.topK.defaultValue;
  const bm25WeightBase = fallback?.bm25Weight ?? constraints.bm25Weight.defaultValue;

  const result: KnowledgeBaseRagSearchSettingsResolved = {
    topK: clampInteger(topKBase ?? constraints.topK.defaultValue, constraints.topK.min, constraints.topK.max),
    bm25Weight: clampFraction(
      bm25WeightBase ?? constraints.bm25Weight.defaultValue,
      constraints.bm25Weight.min,
      constraints.bm25Weight.max,
    ),
    bm25Limit: constraints.bm25Limit.defaultValue,
    vectorWeight: constraints.vectorWeight.defaultValue,
    vectorLimit: constraints.vectorLimit.defaultValue,
    embeddingProviderId: null,
    collection: null,
    llmProviderId: null,
    llmModel: null,
    temperature: constraints.temperature.defaultValue,
    maxTokens: constraints.maxTokens.defaultValue,
    systemPrompt: constraints.systemPrompt.defaultValue,
    responseFormat: null,
  };

  if (input) {
    if (Object.prototype.hasOwnProperty.call(input, "topK")) {
      const parsed = parseNumber(input.topK);
      if (parsed !== null) {
        result.topK = clampInteger(parsed, constraints.topK.min, constraints.topK.max);
      }
    }

    if (Object.prototype.hasOwnProperty.call(input, "bm25Weight")) {
      const parsed = parseNumber(input.bm25Weight);
      if (parsed !== null) {
        result.bm25Weight = clampFraction(parsed, constraints.bm25Weight.min, constraints.bm25Weight.max);
      }
    }

    if (Object.prototype.hasOwnProperty.call(input, "bm25Limit")) {
      const parsed = parseNumber(input.bm25Limit);
      result.bm25Limit = parsed === null
        ? null
        : clampInteger(parsed, constraints.bm25Limit.min, constraints.bm25Limit.max);
    }

    if (Object.prototype.hasOwnProperty.call(input, "vectorWeight")) {
      const parsed = parseNumber(input.vectorWeight);
      result.vectorWeight = parsed === null
        ? null
        : clampFraction(parsed, constraints.vectorWeight.min, constraints.vectorWeight.max);
    }

    if (Object.prototype.hasOwnProperty.call(input, "vectorLimit")) {
      const parsed = parseNumber(input.vectorLimit);
      result.vectorLimit = parsed === null
        ? null
        : clampInteger(parsed, constraints.vectorLimit.min, constraints.vectorLimit.max);
    }

    if (Object.prototype.hasOwnProperty.call(input, "temperature")) {
      const parsed = parseNumber(input.temperature);
      result.temperature = parsed === null
        ? null
        : clampTemperature(parsed, constraints.temperature.min, constraints.temperature.max);
    }

    if (Object.prototype.hasOwnProperty.call(input, "maxTokens")) {
      const parsed = parseNumber(input.maxTokens);
      result.maxTokens = parsed === null
        ? null
        : clampInteger(parsed, constraints.maxTokens.min, constraints.maxTokens.max);
    }

    if (Object.prototype.hasOwnProperty.call(input, "embeddingProviderId")) {
      result.embeddingProviderId = sanitizeString(input.embeddingProviderId);
    }

    if (Object.prototype.hasOwnProperty.call(input, "collection")) {
      result.collection = sanitizeString(input.collection);
    }

    if (Object.prototype.hasOwnProperty.call(input, "llmProviderId")) {
      result.llmProviderId = sanitizeString(input.llmProviderId);
    }

    if (Object.prototype.hasOwnProperty.call(input, "llmModel")) {
      result.llmModel = sanitizeString(input.llmModel);
    }

    if (Object.prototype.hasOwnProperty.call(input, "systemPrompt")) {
      if (typeof input.systemPrompt === "string") {
        result.systemPrompt = input.systemPrompt;
      }
    }

    if (Object.prototype.hasOwnProperty.call(input, "responseFormat")) {
      result.responseFormat = sanitizeResponseFormat(input.responseFormat);
    }
  }

  return result;
}
