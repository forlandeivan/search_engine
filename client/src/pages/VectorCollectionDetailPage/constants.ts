/**
 * Constants for VectorCollectionDetailPage components
 */

import { Filter, Maximize2, Search, Sparkles } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { FilterOperator, SearchMode } from "./types";

export const POINTS_PAGE_SIZE = 24;

export const SEARCH_SETTINGS_STORAGE_KEY = "vector-collection-search-settings";

export const DEFAULT_TOP_K = 5;
export const DEFAULT_GENERATIVE_CONTEXT_LIMIT = 5;
export const DEFAULT_SEMANTIC_WITH_PAYLOAD = true;
export const DEFAULT_SEMANTIC_WITH_VECTOR = false;
export const GENERATIVE_TYPING_INTERVAL_MS = 18;

export const searchModeOptions: Array<{ value: SearchMode; label: string; icon: LucideIcon }> = [
  { value: "semantic", label: "Текст", icon: Search },
  { value: "generative", label: "LLM", icon: Sparkles },
  { value: "filter", label: "Фильтр", icon: Filter },
  { value: "vector", label: "Вектор", icon: Maximize2 },
];

export const filterOperatorOptions: Array<{ value: FilterOperator; label: string }> = [
  { value: "eq", label: "Равно" },
  { value: "neq", label: "Не равно" },
  { value: "contains", label: "Содержит" },
  { value: "gt", label: ">" },
  { value: "gte", label: "≥" },
  { value: "lt", label: "<" },
  { value: "lte", label: "≤" },
];

export const filterOperatorSymbols: Record<FilterOperator, string> = {
  eq: "=",
  neq: "≠",
  contains: "∋",
  gt: ">",
  gte: "≥",
  lt: "<",
  lte: "≤",
};

export const excludedPointKeys = new Set(["id", "payload", "vector", "shard_key", "order_value", "score"]);

export const statusLabels: Record<string, string> = {
  green: "Готова",
  yellow: "Оптимизируется",
  red: "Ошибка",
};

export const statusIndicatorVariants: Record<string, string> = {
  green: "bg-emerald-500",
  yellow: "bg-amber-500",
  red: "bg-red-500",
};
