/**
 * Types for VectorCollectionDetailPage components
 */

import type { PublicLlmProvider } from "@shared/schema";

export interface VectorCollectionDetail {
  name: string;
  status: string;
  optimizerStatus?: string | { error: string };
  pointsCount: number;
  vectorsCount: number | null;
  segmentsCount: number | null;
  vectorSize: number | null;
  distance: string | null;
  config?: Record<string, unknown> | null;
}

export type CollectionPoint = {
  id: string | number;
  payload: Record<string, unknown> | null;
  shard_key?: unknown;
  order_value?: unknown;
  score?: number;
  [key: string]: unknown;
};

export interface CollectionPointsResponse {
  points: CollectionPoint[];
  nextPageOffset: string | number | null;
}

export type SearchMode = "semantic" | "filter" | "vector" | "generative";

export type FilterOperator = "eq" | "neq" | "contains" | "gt" | "gte" | "lt" | "lte";

export type FilterCombineMode = "and" | "or";

export interface FilterCondition {
  id: string;
  field: string;
  operator: FilterOperator;
  value: string;
}

export type LlmModelSelectionOption = {
  key: string;
  provider: PublicLlmProvider;
  model: { label: string; value: string };
};

export interface ActiveSearchState {
  mode: SearchMode;
  description: string;
  results: CollectionPoint[];
  scores: Record<string, number>;
  vectorLength?: number;
  usageTokens?: number | null;
  providerName?: string;
  llmProviderName?: string;
  llmModelLabel?: string;
  llmUsageTokens?: number | null;
  answer?: string;
  queryVectorPreview?: string;
  limit: number;
  withPayload?: unknown;
  withVector?: unknown;
  filterPayload?: Record<string, unknown> | null;
  nextPageOffset?: string | number | null;
  contextLimit?: number;
}

export interface SearchSettingsStorage {
  semantic?: {
    topK?: number;
    providerId?: string | null;
    withPayload?: boolean;
    withVector?: boolean;
  };
  generative?: {
    topK?: number;
    contextLimit?: number;
    embeddingProviderId?: string | null;
    llmProviderId?: string | null;
    llmModel?: string | null;
  };
}

export interface TextSearchResponse {
  results: Array<{
    id: string | number;
    payload?: Record<string, unknown> | null;
    vector?: number[] | Record<string, unknown> | null;
    score?: number;
    shard_key?: unknown;
    order_value?: unknown;
    version?: unknown;
  }>;
  queryVector?: number[];
  vectorLength?: number;
  usageTokens?: number | null;
  provider?: { id: string; name: string };
}

export interface GenerativeSearchResponse {
  answer: string;
  usage?: {
    embeddingTokens: number | null;
    llmTokens: number | null;
  };
  provider: { id: string; name: string; model?: string; modelLabel?: string };
  embeddingProvider: { id: string; name: string };
  context: Array<{
    id: string | number;
    payload: Record<string, unknown> | null;
    score?: number | null;
    shard_key?: unknown;
    order_value?: unknown;
  }>;
  queryVector?: number[];
  vectorLength?: number;
}

export type GenerativeStreamMetadata = {
  context?: GenerativeSearchResponse["context"];
  usage?: GenerativeSearchResponse["usage"];
  provider?: GenerativeSearchResponse["provider"];
  embeddingProvider?: GenerativeSearchResponse["embeddingProvider"];
  queryVector?: number[];
  vectorLength?: number;
  limit?: number;
  contextLimit?: number;
};

export type GenerativeStreamToken = {
  delta?: string;
  text?: string;
};

export type GenerativeStreamCompletion = {
  answer?: string;
  usage?: GenerativeSearchResponse["usage"];
};

export type GenerativeStreamError = {
  message?: string;
};
