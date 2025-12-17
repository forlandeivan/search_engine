import { type ReactNode, useMemo } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { ragDefaults, searchDefaults, tooltips } from "@/constants/searchSettings";
import {
  BooleanField,
  JsonEditorField,
  NumericField,
  SelectField,
  SettingLabel,
  SynonymListEditor,
} from "./search-settings";
import type { SelectOption } from "./search-settings";
import type { PublicEmbeddingProvider, PublicLlmProvider } from "@shared/schema";
import { useModels, type PublicModel } from "@/hooks/useModels";
import { Info } from "lucide-react";

export type KnowledgeBaseSearchSettings = {
  topK: number | null;
  vectorLimit: number | null;
  bm25Limit: number | null;
  bm25Weight: number | null;
  vectorWeight: number | null;
  embeddingProviderId: string | null;
  llmProviderId: string | null;
  llmModel: string | null;
  collection: string | null;
  synonyms: string[];
  includeDrafts: boolean;
  highlightResults: boolean;
  filters: string;
  filtersValid: boolean;
  temperature: number | null;
  maxTokens: number | null;
  systemPrompt: string;
  responseFormat: "text" | "markdown" | "html" | null;
};

export type VectorCollectionSummary = {
  name: string;
};

export type KnowledgeBaseSearchSettingsFormProps = {
  baseName: string;
  searchSettings: KnowledgeBaseSearchSettings;
  isSearchSettingsReady: boolean;
  isDirty: boolean;
  isSaving: boolean;
  isSaveDisabled?: boolean;
  onSave: () => void;
  onCancel: () => void;
  activeEmbeddingProviders: PublicEmbeddingProvider[];
  activeLlmProviders: PublicLlmProvider[];
  vectorCollections: VectorCollectionSummary[];
  isVectorCollectionsLoading: boolean;
  onTopKChange: (value: string) => void;
  onVectorLimitChange: (value: string) => void;
  onBm25LimitChange: (value: string) => void;
  onBm25WeightChange: (value: string) => void;
  onVectorWeightChange: (value: string) => void;
  onEmbeddingProviderChange: (value: string) => void;
  onLlmProviderChange: (value: string) => void;
  onLlmModelChange: (value: string) => void;
  onCollectionChange: (value: string) => void;
  onSynonymsChange: (value: string[]) => void;
  onIncludeDraftsChange: (value: boolean) => void;
  onHighlightResultsChange: (value: boolean) => void;
  onFiltersChange: (value: string, isValid: boolean) => void;
  onTemperatureChange: (value: string) => void;
  onMaxTokensChange: (value: string) => void;
  onSystemPromptChange: (value: string) => void;
  onResponseFormatChange: (value: string) => void;
  className?: string;
};

const KnowledgeBaseSearchSettingsForm = ({
  baseName,
  searchSettings,
  isSearchSettingsReady,
  isDirty,
  isSaving,
  isSaveDisabled = false,
  onSave,
  onCancel,
  activeEmbeddingProviders,
  activeLlmProviders,
  vectorCollections,
  isVectorCollectionsLoading,
  onTopKChange,
  onVectorLimitChange,
  onBm25LimitChange,
  onBm25WeightChange,
  onVectorWeightChange,
  onEmbeddingProviderChange,
  onLlmProviderChange,
  onLlmModelChange,
  onCollectionChange,
  onSynonymsChange,
  onIncludeDraftsChange,
  onHighlightResultsChange,
  onFiltersChange,
  onTemperatureChange,
  onMaxTokensChange,
  onSystemPromptChange,
  onResponseFormatChange,
  className,
}: KnowledgeBaseSearchSettingsFormProps) => {
  const hints: ReactNode[] = [];
  const embeddingProviderValue = searchSettings.embeddingProviderId ?? "none";
  const collectionValue = searchSettings.collection ?? "";
  const llmProviderValue = searchSettings.llmProviderId ?? "none";
  const llmModelValue = searchSettings.llmModel ?? "";
  const selectedLlmProvider =
    llmProviderValue !== "none"
      ? activeLlmProviders.find((provider) => provider.id === llmProviderValue) ?? null
      : null;
  const isCustomProvider =
    embeddingProviderValue !== "none" &&
    embeddingProviderValue.length > 0 &&
    !activeEmbeddingProviders.some((provider) => provider.id === embeddingProviderValue);
  const isCustomLlmProvider =
    llmProviderValue !== "none" &&
    llmProviderValue.length > 0 &&
    !activeLlmProviders.some((provider) => provider.id === llmProviderValue);
  const isCustomCollection =
    collectionValue.length > 0 &&
    vectorCollections.length > 0 &&
    !vectorCollections.some((collection) => collection.name === collectionValue);
  const vectorWeightActive = (searchSettings.vectorWeight ?? 0) > 0;
  const collectionOptions = useMemo<SelectOption[]>(() => {
    const baseOptions = vectorCollections.map((collection) => ({
      value: collection.name,
      label: collection.name,
    }));

    const items: SelectOption[] = [{ value: "", label: "Не выбрано" }, ...baseOptions];

    if (isCustomCollection && collectionValue.length > 0) {
      items.push({ value: collectionValue, label: `${collectionValue} (не найдена)` });
    }

    return items;
  }, [collectionValue, isCustomCollection, vectorCollections]);

  const catalogModels = useModels("LLM").data ?? [];
  const catalogByProvider = useMemo(() => {
    const map = new Map<string, PublicModel[]>();
    for (const model of catalogModels) {
      const providerId = model.providerId;
      if (!providerId) continue;
      const existing = map.get(providerId) ?? [];
      existing.push(model);
      map.set(providerId, existing);
    }
    return map;
  }, [catalogModels]);

  const providerLlmModels = selectedLlmProvider ? catalogByProvider.get(selectedLlmProvider.id) ?? [] : [];
  const isCustomLlmModel =
    llmModelValue.length > 0 &&
    providerLlmModels.every((model) => model.key !== llmModelValue);
  const llmModelOptions = useMemo<SelectOption[]>(() => {
    const baseOptions = providerLlmModels.map((model) => ({
      value: model.key,
      label: model.displayName ?? model.key,
    }));

    const items: SelectOption[] = [{ value: "", label: "Не выбрано" }, ...baseOptions];

    if (isCustomLlmModel && llmModelValue.length > 0) {
      items.push({ value: llmModelValue, label: `${llmModelValue} (не найдена)` });
    }

    return items;
  }, [providerLlmModels, isCustomLlmModel, llmModelValue]);

  const collectionPlaceholder = isVectorCollectionsLoading
    ? "Загрузка списка коллекций..."
    : vectorCollections.length > 0
      ? "Выберите коллекцию"
      : "Коллекции не найдены";

  const llmModelPlaceholder = selectedLlmProvider
    ? providerLlmModels.length > 0
      ? "Выберите модель"
      : "Нет доступных моделей"
    : "Сначала выберите LLM сервис";

  if (activeEmbeddingProviders.length === 0) {
    hints.push(
      <Alert key="hint-no-providers" variant="default">
        <AlertTitle>Нет активных провайдеров эмбеддингов</AlertTitle>
        <AlertDescription>
          Подключите сервис в разделе «Сервисы эмбеддингов», чтобы включить векторный поиск.
        </AlertDescription>
      </Alert>,
    );
  }

  if (activeLlmProviders.length === 0) {
    hints.push(
      <Alert key="hint-no-llm-providers" variant="default">
        <AlertTitle>Нет активных LLM-сервисов</AlertTitle>
        <AlertDescription>
          Подключите LLM-провайдера в разделе «LLM сервисы», чтобы Ask AI мог генерировать ответы.
        </AlertDescription>
      </Alert>,
    );
  }

  if (!isVectorCollectionsLoading && vectorCollections.length === 0) {
    hints.push(
      <Alert key="hint-no-collections" variant="default">
        <AlertTitle>Коллекции Qdrant не найдены</AlertTitle>
        <AlertDescription>
          Создайте коллекцию в разделе «Векторные коллекции», чтобы сохранять векторные данные.
        </AlertDescription>
      </Alert>,
    );
  }

  if (isCustomProvider) {
    hints.push(
      <Alert key="hint-provider-missing" variant="default">
        <AlertTitle>Сохранённый провайдер недоступен</AlertTitle>
        <AlertDescription>
          Провайдер эмбеддингов отсутствует среди активных. Выберите актуальный сервис.
        </AlertDescription>
      </Alert>,
    );
  }

  if (isCustomLlmProvider) {
    hints.push(
      <Alert key="hint-llm-provider-missing" variant="default">
        <AlertTitle>Сохранённый LLM-сервис недоступен</AlertTitle>
        <AlertDescription>
          Провайдер LLM отсутствует среди активных. Выберите доступный сервис для Ask AI.
        </AlertDescription>
      </Alert>,
    );
  }

  if (collectionValue && isCustomCollection) {
    hints.push(
      <Alert key="hint-collection-missing" variant="default">
        <AlertTitle>Коллекция не найдена</AlertTitle>
        <AlertDescription>
          Проверьте название коллекции или создайте новую в Qdrant, затем обновите список.
        </AlertDescription>
      </Alert>,
    );
  }

  if (vectorWeightActive && !searchSettings.embeddingProviderId) {
    hints.push(
      <Alert key="hint-provider-required" variant="default">
        <AlertTitle>Укажите сервис эмбеддингов</AlertTitle>
        <AlertDescription>Для векторного поиска нужен активный провайдер эмбеддингов.</AlertDescription>
      </Alert>,
    );
  }

  if (vectorWeightActive && !searchSettings.collection) {
    hints.push(
      <Alert key="hint-collection-required" variant="default">
        <AlertTitle>Укажите коллекцию Qdrant</AlertTitle>
        <AlertDescription>Для векторного поиска требуется коллекция с векторами документов.</AlertDescription>
      </Alert>,
    );
  }

  const disabled = !isSearchSettingsReady;

  const quickSearchBadges: Array<{ key: string; label: string; variant?: "secondary" | "destructive" }> = [];
  if (searchSettings.synonyms.length > 0) {
    quickSearchBadges.push({ key: "synonyms", label: `Синонимов: ${searchSettings.synonyms.length}` });
  }

  const ragBadges: Array<{ key: string; label: string; variant?: "secondary" | "destructive" }> = [];
  if (!searchSettings.filtersValid) {
    ragBadges.push({ key: "filters", label: "Проверьте JSON фильтров", variant: "destructive" });
  }
  if (vectorWeightActive && !searchSettings.embeddingProviderId) {
    ragBadges.push({ key: "provider", label: "Нужен сервис эмбеддингов", variant: "destructive" });
  }
  if (vectorWeightActive && !searchSettings.collection) {
    ragBadges.push({ key: "collection", label: "Не выбрана коллекция Qdrant", variant: "destructive" });
  }
  if (searchSettings.llmProviderId) {
    ragBadges.push({ key: "llm", label: "Ask AI включён" });
  }

  const embeddingOptions: SelectOption[] = [
    { value: "none", label: "Не выбрано" },
    ...activeEmbeddingProviders.map((provider) => ({ value: provider.id, label: provider.name })),
    ...(isCustomProvider && embeddingProviderValue
      ? [{ value: embeddingProviderValue, label: `${embeddingProviderValue} (не найден)` }]
      : []),
  ];

  const llmOptions: SelectOption[] = [
    { value: "none", label: "Не выбрано" },
    ...activeLlmProviders.map((provider) => ({ value: provider.id, label: provider.name })),
    ...(isCustomLlmProvider && llmProviderValue
      ? [{ value: llmProviderValue, label: `${llmProviderValue} (не найден)` }]
      : []),
  ];

  const responseFormatValue = searchSettings.responseFormat ?? "";

  return (
    <div className={cn("rounded-md border border-border bg-card", className)}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
            Параметры поиска
            <TooltipProvider delayDuration={200}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Info className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                </TooltipTrigger>
                <TooltipContent className="max-w-xs text-xs leading-relaxed">
                  Окно быстрого поиска работает только внутри выбранной базы. Откройте его сочетанием Ctrl+K или ⌘K —
                  подсказки используют сохранённые локально параметры.
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
          <p className="text-xs text-muted-foreground">
            Быстрый поиск в контексте «{baseName}». Настройки сохраняются в браузере и влияют на Quick Switcher и Ask AI.
          </p>
        </div>
      </div>
      <Tabs defaultValue="search" className="px-4 pb-4 pt-3">
        <TabsList className="mb-3 grid h-8 w-full max-w-xs grid-cols-2">
          <TabsTrigger value="search" className="text-xs">
            Быстрый поиск
          </TabsTrigger>
          <TabsTrigger value="rag" className="text-xs">
            Ask AI (RAG)
          </TabsTrigger>
        </TabsList>
        <TabsContent value="search" className="space-y-3">
          {quickSearchBadges.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {quickSearchBadges.map((badge) => (
                <Badge
                  key={badge.key}
                  variant={badge.variant ?? "outline"}
                  className="rounded-sm px-1.5 py-0 text-[10px] font-medium"
                >
                  {badge.label}
                </Badge>
              ))}
            </div>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-2">
            <NumericField
              id="kb-search-topk"
              label="Top-K подсказок"
              tooltip={tooltips.topK}
              value={searchSettings.topK}
              min={searchDefaults.topK.min}
              max={searchDefaults.topK.max}
              step={searchDefaults.topK.step}
              defaultValue={searchDefaults.topK.defaultValue}
              disabled={disabled}
              onChange={(next) => onTopKChange(next === null ? "" : String(next))}
            />
            <NumericField
              id="kb-search-bm25-weight"
              label="Вес BM25"
              tooltip={tooltips.bm25Weight}
              value={searchSettings.bm25Weight}
              min={searchDefaults.bm25Weight.min}
              max={searchDefaults.bm25Weight.max}
              step={searchDefaults.bm25Weight.step}
              defaultValue={searchDefaults.bm25Weight.defaultValue}
              disabled={disabled}
              onChange={(next) => onBm25WeightChange(next === null ? "" : String(next))}
            />
            <NumericField
              id="kb-search-bm25-limit"
              label="Top-K текстовых документов"
              tooltip={tooltips.bm25Limit}
              value={searchSettings.bm25Limit}
              min={ragDefaults.bm25Limit.min}
              max={ragDefaults.bm25Limit.max}
              step={ragDefaults.bm25Limit.step}
              defaultValue={ragDefaults.bm25Limit.defaultValue}
              disabled={disabled}
              onChange={(next) => onBm25LimitChange(next === null ? "" : String(next))}
            />
          </div>
          <SynonymListEditor
            id="kb-search-synonyms"
            label="Синонимы запроса"
            tooltip={tooltips.synonyms}
            value={searchSettings.synonyms}
            maxItems={searchDefaults.synonyms.maxItems}
            disabled={disabled}
            onChange={onSynonymsChange}
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <BooleanField
              id="kb-search-include-drafts"
              label="Учитывать черновики"
              tooltip={tooltips.includeDrafts}
              checked={searchSettings.includeDrafts}
              defaultChecked={searchDefaults.includeDrafts.defaultValue}
              disabled={disabled}
              onChange={onIncludeDraftsChange}
            />
            <BooleanField
              id="kb-search-highlight"
              label="Подсветка совпадений"
              tooltip={tooltips.highlightResults}
              checked={searchSettings.highlightResults}
              defaultChecked={searchDefaults.highlightResults.defaultValue}
              disabled={disabled}
              onChange={onHighlightResultsChange}
            />
          </div>
        </TabsContent>
        <TabsContent value="rag" className="space-y-3">
          {ragBadges.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {ragBadges.map((badge) => (
                <Badge
                  key={badge.key}
                  variant={badge.variant ?? "outline"}
                  className="rounded-sm px-1.5 py-0 text-[10px] font-medium"
                >
                  {badge.label}
                </Badge>
              ))}
            </div>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-2">
            <NumericField
              id="kb-search-vector-limit"
              label="Top-K векторов для LLM"
              tooltip={tooltips.vectorLimit}
              value={searchSettings.vectorLimit}
              min={ragDefaults.vectorLimit.min}
              max={ragDefaults.vectorLimit.max}
              step={ragDefaults.vectorLimit.step}
              defaultValue={ragDefaults.vectorLimit.defaultValue}
              disabled={disabled}
              onChange={(next) => onVectorLimitChange(next === null ? "" : String(next))}
            />
            <NumericField
              id="kb-search-temperature"
              label="Temperature"
              tooltip={tooltips.temperature}
              value={searchSettings.temperature}
              min={ragDefaults.temperature.min}
              max={ragDefaults.temperature.max}
              step={ragDefaults.temperature.step}
              defaultValue={ragDefaults.temperature.defaultValue}
              disabled={disabled}
              onChange={(next) => onTemperatureChange(next === null ? "" : String(next))}
            />
            <NumericField
              id="kb-search-max-tokens"
              label="Max tokens"
              tooltip={tooltips.maxTokens}
              value={searchSettings.maxTokens}
              min={ragDefaults.maxTokens.min}
              max={ragDefaults.maxTokens.max}
              step={ragDefaults.maxTokens.step}
              defaultValue={ragDefaults.maxTokens.defaultValue}
              disabled={disabled}
              onChange={(next) => onMaxTokensChange(next === null ? "" : String(next))}
            />
          </div>
          <SelectField
            id="kb-search-embedding-provider"
            label="Сервис эмбеддингов"
            tooltip={tooltips.embeddingProviderId}
            value={embeddingProviderValue}
            placeholder={
              activeEmbeddingProviders.length === 0 ? "Нет доступных провайдеров" : "Выберите провайдера"
            }
            options={embeddingOptions}
            disabled={disabled}
            isMissing={isCustomProvider}
            onChange={onEmbeddingProviderChange}
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <SelectField
              id="kb-search-llm-provider"
              label="LLM сервис"
              tooltip={tooltips.llmProviderId}
              value={llmProviderValue}
              placeholder={activeLlmProviders.length === 0 ? "Нет доступных LLM сервисов" : "Выберите сервис"}
              options={llmOptions}
              disabled={disabled}
              isMissing={isCustomLlmProvider}
              onChange={onLlmProviderChange}
            />
            <NumericField
              id="kb-search-vector-weight"
              label="Вес вектора"
              tooltip={tooltips.vectorWeight}
              value={searchSettings.vectorWeight}
              min={ragDefaults.vectorWeight.min}
              max={ragDefaults.vectorWeight.max}
              step={ragDefaults.vectorWeight.step}
              defaultValue={ragDefaults.vectorWeight.defaultValue}
              disabled={disabled}
              onChange={(next) => onVectorWeightChange(next === null ? "" : String(next))}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <SelectField
              id="kb-search-llm-model"
              label="Модель LLM"
              tooltip={tooltips.llmModel}
              value={llmModelValue}
              placeholder={llmModelPlaceholder}
              options={llmModelOptions}
              disabled={disabled || !selectedLlmProvider || availableLlmModels.length === 0}
              isMissing={isCustomLlmModel}
              missingLabel="Модель не найдена"
              onChange={onLlmModelChange}
            />
            <SelectField
              id="kb-search-response-format"
              label="Формат ответа"
              tooltip={tooltips.responseFormat}
              value={responseFormatValue}
              options={[
                { value: "", label: "Авто" },
                { value: "text", label: "Text" },
                { value: "markdown", label: "Markdown" },
                { value: "html", label: "HTML" },
              ]}
              defaultValue={ragDefaults.responseFormat.defaultValue}
              disabled={disabled}
              onChange={onResponseFormatChange}
            />
          </div>
          <div className="space-y-1.5">
            <SettingLabel id="kb-search-system-prompt" label="Системный промпт" tooltip={tooltips.systemPrompt} />
            <Textarea
              id="kb-search-system-prompt"
              value={searchSettings.systemPrompt}
              onChange={(event) => onSystemPromptChange(event.target.value)}
              rows={4}
              disabled={disabled}
              className="text-xs"
              placeholder="Например: Ты — помощник, отвечающий на вопросы по базе знаний"
            />
          </div>
          <SelectField
            id="kb-search-collection"
            label="Коллекция Qdrant"
            tooltip={tooltips.collection}
            value={collectionValue}
            placeholder={collectionPlaceholder}
            options={collectionOptions}
            disabled={disabled}
            isMissing={isCustomCollection}
            missingLabel="Коллекция не найдена"
            onChange={onCollectionChange}
          />
          <JsonEditorField
            id="kb-search-filters"
            label="Фильтры Qdrant"
            tooltip={tooltips.filters}
            value={searchSettings.filters}
            defaultValue={searchDefaults.filters.defaultValue}
            disabled={disabled}
            onChange={onFiltersChange}
          />
        </TabsContent>
      </Tabs>
      {hints.length > 0 ? <div className="space-y-2 border-t border-border px-4 py-3 text-xs">{hints}</div> : null}
      {isDirty || isSaving ? (
        <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-3">
          <Button type="button" variant="outline" size="sm" onClick={onCancel} disabled={isSaving}>
            Отмена
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={onSave}
            disabled={!isDirty || isSaving || isSaveDisabled}
          >
            {isSaving ? "Сохраняем…" : "Сохранить"}
          </Button>
        </div>
      ) : null}
    </div>
  );
};

export default KnowledgeBaseSearchSettingsForm;
