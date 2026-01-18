/**
 * Utilities for managing Knowledge Base search settings
 */

import { ragDefaults, searchDefaults } from "@/constants/searchSettings";
import {
  mergeChunkSearchSettings,
  mergeRagSearchSettings,
  type KnowledgeBaseSearchSettingsResponsePayload,
  type KnowledgeBaseSearchSettingsUpdatePayload,
} from "@shared/knowledge-base-search";
import type { KnowledgeBaseSearchSettings } from "@/components/knowledge-base/KnowledgeBaseSearchSettingsForm";

export function buildSearchSettingsFromResolved(
  chunk: ReturnType<typeof mergeChunkSearchSettings>,
  rag: ReturnType<typeof mergeRagSearchSettings>,
): KnowledgeBaseSearchSettings {
  const filtersValue = typeof chunk.filters === "string" ? chunk.filters : "";
  let filtersValid = true;

  if (filtersValue.trim()) {
    try {
      JSON.parse(filtersValue);
    } catch {
      filtersValid = false;
    }
  }

  return {
    topK: chunk.topK,
    vectorLimit: rag.vectorLimit,
    bm25Limit: rag.bm25Limit,
    bm25Weight: chunk.bm25Weight,
    vectorWeight: rag.vectorWeight,
    embeddingProviderId: rag.embeddingProviderId,
    llmProviderId: rag.llmProviderId,
    llmModel: rag.llmModel,
    collection: rag.collection,
    synonyms: [...chunk.synonyms],
    includeDrafts: chunk.includeDrafts,
    highlightResults: chunk.highlightResults,
    filters: filtersValue,
    filtersValid,
    temperature: rag.temperature,
    maxTokens: rag.maxTokens,
    systemPrompt: rag.systemPrompt,
    responseFormat: rag.responseFormat,
  };
}

export function createDefaultSearchSettings(): KnowledgeBaseSearchSettings {
  const chunk = mergeChunkSearchSettings(null);
  const rag = mergeRagSearchSettings(null, {
    topK: chunk.topK,
    bm25Weight: chunk.bm25Weight,
  });

  return buildSearchSettingsFromResolved(chunk, rag);
}

export function clampTopKValue(value: number | null): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  const rounded = Math.round(value);
  return Math.max(searchDefaults.topK.min, Math.min(searchDefaults.topK.max, rounded));
}

export function composeSearchSettingsFromApi(
  payload: KnowledgeBaseSearchSettingsResponsePayload | null | undefined,
): KnowledgeBaseSearchSettings {
  if (!payload) {
    return createDefaultSearchSettings();
  }

  const chunk = mergeChunkSearchSettings(payload.chunkSettings ?? null);
  const rag = mergeRagSearchSettings(payload.ragSettings ?? null, {
    topK: chunk.topK,
    bm25Weight: chunk.bm25Weight,
  });

  return buildSearchSettingsFromResolved(chunk, rag);
}

export function clampVectorLimitValue(value: number | null): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  const rounded = Math.round(value);
  return Math.max(ragDefaults.vectorLimit.min, Math.min(ragDefaults.vectorLimit.max, rounded));
}

export function clampTemperatureValue(value: number | null): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  const normalized = Math.max(ragDefaults.temperature.min, Math.min(ragDefaults.temperature.max, value));
  return Number(normalized.toFixed(2));
}

export function clampMaxTokensValue(value: number | null): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  const rounded = Math.round(value);
  return Math.max(ragDefaults.maxTokens.min, Math.min(ragDefaults.maxTokens.max, rounded));
}

export function clampWeightValue(value: number | null): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  const normalized = Math.max(0, Math.min(1, value));
  return Number(normalized.toFixed(2));
}

export function parseStoredSearchSettings(value: unknown): KnowledgeBaseSearchSettings {
  if (!value || typeof value !== "object") {
    return createDefaultSearchSettings();
  }

  const defaults = createDefaultSearchSettings();
  const record = value as Record<string, unknown>;

  const resolveNumber = (
    raw: unknown,
    clamp: (val: number | null) => number | null,
  ): number | null => {
    if (typeof raw === "number") {
      return clamp(raw);
    }

    if (typeof raw === "string") {
      const parsed = Number(raw);
      if (!Number.isNaN(parsed)) {
        return clamp(parsed);
      }
    }

    return null;
  };

  const resolveString = (raw: unknown): string | null => {
    if (typeof raw !== "string") {
      return null;
    }

    const trimmed = raw.trim();
    return trimmed.length > 0 ? trimmed : null;
  };

  const resolveBoolean = (raw: unknown, fallback: boolean): boolean => {
    if (typeof raw === "boolean") {
      return raw;
    }

    if (raw === "true") {
      return true;
    }

    if (raw === "false") {
      return false;
    }

    return fallback;
  };

  const resolveStringArray = (raw: unknown): string[] => {
    if (!Array.isArray(raw)) {
      return [];
    }

    const normalized = raw
      .map((item) => (typeof item === "string" ? item.trim() : ""))
      .filter((item) => item.length > 0);

    const unique = Array.from(new Set(normalized));
    return unique.slice(0, searchDefaults.synonyms.maxItems ?? unique.length);
  };

  const responseFormatValue = (() => {
    const value = record.responseFormat ?? record.response_format;
    if (typeof value !== "string") {
      return null;
    }
    const normalized = value.trim().toLowerCase();
    if (normalized === "text" || normalized === "markdown" || normalized === "html") {
      return normalized;
    }
    return null;
  })();

  let filtersRaw = defaults.filters;
  if (typeof record.filters === "string") {
    filtersRaw = record.filters;
  }

  const result: KnowledgeBaseSearchSettings = {
    ...defaults,
    synonyms: [...defaults.synonyms],
  };

  const topKValue = resolveNumber(record.topK, clampTopKValue);
  if (topKValue !== null) {
    result.topK = topKValue;
  }

  const vectorLimitValue = resolveNumber(record.vectorLimit, clampVectorLimitValue);
  if (vectorLimitValue !== null) {
    result.vectorLimit = vectorLimitValue;
  }

  const hasBm25Limit = "bm25Limit" in record || "bm25_limit" in record;
  if (hasBm25Limit) {
    result.bm25Limit = resolveNumber(record.bm25Limit ?? record.bm25_limit, clampVectorLimitValue);
  }

  const bm25WeightValue = resolveNumber(record.bm25Weight, clampWeightValue);
  if (bm25WeightValue !== null) {
    result.bm25Weight = bm25WeightValue;
  }

  const vectorWeightValue = resolveNumber(record.vectorWeight, clampWeightValue);
  if (vectorWeightValue !== null) {
    result.vectorWeight = vectorWeightValue;
  }

  if ("embeddingProviderId" in record) {
    result.embeddingProviderId = resolveString(record.embeddingProviderId);
  }

  if ("llmProviderId" in record) {
    result.llmProviderId = resolveString(record.llmProviderId);
  }

  if ("llmModel" in record) {
    result.llmModel = resolveString(record.llmModel);
  }

  if ("collection" in record) {
    result.collection = resolveString(record.collection);
  }

  if ("synonyms" in record) {
    result.synonyms = resolveStringArray(record.synonyms);
  }

  result.includeDrafts = resolveBoolean(record.includeDrafts, defaults.includeDrafts);
  result.highlightResults = resolveBoolean(record.highlightResults, defaults.highlightResults);
  result.filters = filtersRaw;

  if ("temperature" in record) {
    result.temperature = resolveNumber(record.temperature, clampTemperatureValue);
  }

  const hasMaxTokens = "maxTokens" in record || "max_tokens" in record;
  if (hasMaxTokens) {
    result.maxTokens = resolveNumber(record.maxTokens ?? record.max_tokens, clampMaxTokensValue);
  }

  if (typeof record.systemPrompt === "string") {
    result.systemPrompt = record.systemPrompt;
  }

  result.responseFormat = responseFormatValue;

  const chunkSanitized = mergeChunkSearchSettings({
    topK: result.topK,
    bm25Weight: result.bm25Weight,
    synonyms: result.synonyms,
    includeDrafts: result.includeDrafts,
    highlightResults: result.highlightResults,
    filters: result.filters,
  });

  const ragSanitized = mergeRagSearchSettings(
    {
      topK: result.topK,
      bm25Weight: result.bm25Weight,
      bm25Limit: result.bm25Limit,
      vectorWeight: result.vectorWeight,
      vectorLimit: result.vectorLimit,
      embeddingProviderId: result.embeddingProviderId,
      collection: result.collection,
      llmProviderId: result.llmProviderId,
      llmModel: result.llmModel,
      temperature: result.temperature,
      maxTokens: result.maxTokens,
      systemPrompt: result.systemPrompt,
      responseFormat: result.responseFormat,
    },
    { topK: chunkSanitized.topK, bm25Weight: chunkSanitized.bm25Weight },
  );

  return buildSearchSettingsFromResolved(chunkSanitized, ragSanitized);
}

export function buildSearchSettingsUpdatePayload(
  settings: KnowledgeBaseSearchSettings,
): KnowledgeBaseSearchSettingsUpdatePayload {
  const chunk = mergeChunkSearchSettings({
    topK: settings.topK,
    bm25Weight: settings.bm25Weight,
    synonyms: settings.synonyms,
    includeDrafts: settings.includeDrafts,
    highlightResults: settings.highlightResults,
    filters: settings.filters,
  });

  const rag = mergeRagSearchSettings(
    {
      topK: settings.topK,
      bm25Weight: settings.bm25Weight,
      bm25Limit: settings.bm25Limit,
      vectorWeight: settings.vectorWeight,
      vectorLimit: settings.vectorLimit,
      embeddingProviderId: settings.embeddingProviderId,
      collection: settings.collection,
      llmProviderId: settings.llmProviderId,
      llmModel: settings.llmModel,
      temperature: settings.temperature,
      maxTokens: settings.maxTokens,
      systemPrompt: settings.systemPrompt,
      responseFormat: settings.responseFormat,
    },
    { topK: chunk.topK, bm25Weight: chunk.bm25Weight },
  );

  return { chunkSettings: chunk, ragSettings: rag };
}

export function buildSearchSettingsHash(settings: KnowledgeBaseSearchSettings): string {
  return JSON.stringify({
    topK: settings.topK,
    vectorLimit: settings.vectorLimit,
    bm25Limit: settings.bm25Limit,
    bm25Weight: settings.bm25Weight,
    vectorWeight: settings.vectorWeight,
    embeddingProviderId: settings.embeddingProviderId,
    llmProviderId: settings.llmProviderId,
    llmModel: settings.llmModel,
    collection: settings.collection,
    synonyms: [...settings.synonyms],
    includeDrafts: settings.includeDrafts,
    highlightResults: settings.highlightResults,
    filters: settings.filters,
    filtersValid: settings.filtersValid,
    temperature: settings.temperature,
    maxTokens: settings.maxTokens,
    systemPrompt: settings.systemPrompt,
    responseFormat: settings.responseFormat,
  });
}

export function cloneSearchSettings(
  settings: KnowledgeBaseSearchSettings,
): KnowledgeBaseSearchSettings {
  return {
    ...settings,
    synonyms: [...settings.synonyms],
  };
}
