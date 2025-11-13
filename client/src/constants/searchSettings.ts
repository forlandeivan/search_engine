import type { KnowledgeBaseSearchSettings } from "@/components/knowledge-base/KnowledgeBaseSearchSettingsForm";
import {
  KNOWLEDGE_BASE_SEARCH_CONSTRAINTS,
  type KnowledgeBaseSearchResponseFormat,
} from "@shared/knowledge-base-search";

export type NumericSettingDefaults = {
  defaultValue: number;
  min: number;
  max: number;
  step: number;
};

export type BooleanSettingDefaults = {
  defaultValue: boolean;
};

export type ListSettingDefaults = {
  defaultValue: string[];
  maxItems?: number;
};

export type JsonSettingDefaults = {
  defaultValue: string;
};

export type TextSettingDefaults = {
  defaultValue: string;
};

const chunkConstraints = KNOWLEDGE_BASE_SEARCH_CONSTRAINTS.chunk;
const ragConstraints = KNOWLEDGE_BASE_SEARCH_CONSTRAINTS.rag;

export type ResponseFormat = KnowledgeBaseSearchResponseFormat;

export const searchDefaults = {
  topK: chunkConstraints.topK,
  bm25Weight: chunkConstraints.bm25Weight,
  vectorWeight: ragConstraints.vectorWeight,
  synonyms: chunkConstraints.synonyms,
  includeDrafts: chunkConstraints.includeDrafts,
  highlightResults: chunkConstraints.highlightResults,
  filters: chunkConstraints.filters,
} satisfies {
  topK: NumericSettingDefaults;
  bm25Weight: NumericSettingDefaults;
  vectorWeight: NumericSettingDefaults;
  synonyms: ListSettingDefaults;
  includeDrafts: BooleanSettingDefaults;
  highlightResults: BooleanSettingDefaults;
  filters: JsonSettingDefaults;
};

export const ragDefaults = {
  topK: ragConstraints.topK,
  bm25Weight: ragConstraints.bm25Weight,
  bm25Limit: ragConstraints.bm25Limit,
  vectorWeight: ragConstraints.vectorWeight,
  vectorLimit: ragConstraints.vectorLimit,
  temperature: ragConstraints.temperature,
  maxTokens: ragConstraints.maxTokens,
  systemPrompt: ragConstraints.systemPrompt,
  responseFormat: { defaultValue: ragConstraints.responseFormat.defaultValue as ResponseFormat },
} satisfies {
  topK: NumericSettingDefaults;
  bm25Weight: NumericSettingDefaults;
  bm25Limit: NumericSettingDefaults;
  vectorWeight: NumericSettingDefaults;
  vectorLimit: NumericSettingDefaults;
  temperature: NumericSettingDefaults;
  maxTokens: NumericSettingDefaults;
  systemPrompt: TextSettingDefaults;
  responseFormat: { defaultValue: ResponseFormat };
};

export type SearchTooltipKey =
  | "topK"
  | "bm25Weight"
  | "vectorWeight"
  | "synonyms"
  | "includeDrafts"
  | "highlightResults"
  | "filters"
  | "vectorLimit"
  | "bm25Limit"
  | "embeddingProviderId"
  | "collection"
  | "llmProviderId"
  | "llmModel"
  | "temperature"
  | "maxTokens"
  | "systemPrompt"
  | "responseFormat";

export const tooltips: Record<SearchTooltipKey, string> = {
  topK:
    "Сколько подсказок показывать в быстром поиске. Большие значения могут замедлить выдачу.",
  bm25Weight:
    "Вес классического текстового поиска. Чем выше значение, тем сильнее влияние полнотекстового ранжирования.",
  vectorWeight:
    "Вес векторного поиска. Увеличьте значение, если важнее семантическая релевантность.",
  synonyms:
    "Добавьте свои синонимы для запроса. Каждая строка — отдельный вариант, используется для расширения поиска.",
  includeDrafts:
    "Включать ли черновики документов в результаты. Черновики могут содержать неполную информацию.",
  highlightResults:
    "Подсвечивать совпадения в сниппетах быстрого поиска для удобства чтения.",
  filters:
    "JSON-правила для фильтрации результатов (аналог Qdrant filter). Пустое поле — без дополнительной фильтрации.",
  vectorLimit:
    "Сколько документов отправлять в LLM после векторного отбора. Большие значения увеличивают стоимость и время ответа.",
  bm25Limit:
    "Сколько документов брать из текстового поиска для RAG. Используйте, чтобы ограничить шум.",
  embeddingProviderId:
    "Выберите сервис эмбеддингов, который будет считать вектора для RAG-запросов.",
  collection:
    "Коллекция Qdrant с данными базы. Используется для поиска релевантных чанков.",
  llmProviderId:
    "LLM, которая будет формировать итоговый ответ. Используйте подключённые сервисы из раздела LLM.",
  llmModel:
    "Название модели в выбранном LLM-сервисе. Можно оставить пустым, чтобы использовать значение по умолчанию.",
  temperature:
    "Креативность ответа. При 0 модель будет отвечать максимально детерминированно.",
  maxTokens:
    "Максимальное число токенов в ответе LLM. Ограничивает длину генерируемого текста.",
  systemPrompt:
    "Системный промпт, который будет отправлен модели перед вопросом. Помогает задать тон и формат.",
  responseFormat:
    "Формат ответа от модели. Markdown подходит для форматированных текстов, HTML — для встраивания в виджеты.",
};

export type ExtractedSearchDefaults = typeof searchDefaults;
export type ExtractedRagDefaults = typeof ragDefaults;

export type KnowledgeBaseSearchSettingsState = KnowledgeBaseSearchSettings;
