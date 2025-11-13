import type { KnowledgeBaseSearchSettings } from "@/components/knowledge-base/KnowledgeBaseSearchSettingsForm";

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

export type ResponseFormat = "text" | "markdown" | "html";

export const searchDefaults = {
  topK: { defaultValue: 6, min: 1, max: 10, step: 1 },
  bm25Weight: { defaultValue: 0.6, min: 0, max: 1, step: 0.05 },
  vectorWeight: { defaultValue: 0.4, min: 0, max: 1, step: 0.05 },
  synonyms: { defaultValue: [], maxItems: 12 },
  includeDrafts: { defaultValue: false },
  highlightResults: { defaultValue: true },
  filters: { defaultValue: "" },
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
  topK: { defaultValue: 6, min: 1, max: 20, step: 1 },
  bm25Weight: { defaultValue: 0.5, min: 0, max: 1, step: 0.05 },
  bm25Limit: { defaultValue: 6, min: 1, max: 20, step: 1 },
  vectorWeight: { defaultValue: 0.5, min: 0, max: 1, step: 0.05 },
  vectorLimit: { defaultValue: 8, min: 1, max: 20, step: 1 },
  temperature: { defaultValue: 0.2, min: 0, max: 2, step: 0.1 },
  maxTokens: { defaultValue: 2048, min: 16, max: 4096, step: 1 },
  systemPrompt: { defaultValue: "" },
  responseFormat: { defaultValue: "markdown" as ResponseFormat },
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
