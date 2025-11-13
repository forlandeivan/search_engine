import { type ReactNode } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { PublicEmbeddingProvider, PublicLlmProvider } from "@shared/schema";
import { Info } from "lucide-react";

export type KnowledgeBaseSearchSettings = {
  topK: number | null;
  vectorLimit: number | null;
  bm25Weight: number | null;
  vectorWeight: number | null;
  embeddingProviderId: string | null;
  llmProviderId: string | null;
  collection: string | null;
};

export type VectorCollectionSummary = {
  name: string;
};

export type KnowledgeBaseSearchSettingsFormProps = {
  baseName: string;
  storageKey: string;
  searchSettings: KnowledgeBaseSearchSettings;
  isSearchSettingsReady: boolean;
  activeEmbeddingProviders: PublicEmbeddingProvider[];
  activeLlmProviders: PublicLlmProvider[];
  vectorCollections: VectorCollectionSummary[];
  isVectorCollectionsLoading: boolean;
  onTopKChange: (value: string) => void;
  onVectorLimitChange: (value: string) => void;
  onBm25WeightChange: (value: string) => void;
  onVectorWeightChange: (value: string) => void;
  onEmbeddingProviderChange: (value: string) => void;
  onLlmProviderChange: (value: string) => void;
  onCollectionChange: (value: string) => void;
  className?: string;
};

const COLLECTION_DATALIST_ID = "kb-search-collection-suggestions";

const KnowledgeBaseSearchSettingsForm = ({
  baseName,
  storageKey,
  searchSettings,
  isSearchSettingsReady,
  activeEmbeddingProviders,
  activeLlmProviders,
  vectorCollections,
  isVectorCollectionsLoading,
  onTopKChange,
  onVectorLimitChange,
  onBm25WeightChange,
  onVectorWeightChange,
  onEmbeddingProviderChange,
  onLlmProviderChange,
  onCollectionChange,
  className,
}: KnowledgeBaseSearchSettingsFormProps) => {
  const hints: ReactNode[] = [];
  const embeddingProviderValue = searchSettings.embeddingProviderId ?? "";
  const collectionValue = searchSettings.collection ?? "";
  const llmProviderValue = searchSettings.llmProviderId ?? "";
  const isCustomProvider =
    embeddingProviderValue.length > 0 &&
    !activeEmbeddingProviders.some((provider) => provider.id === embeddingProviderValue);
  const isCustomLlmProvider =
    llmProviderValue.length > 0 &&
    !activeLlmProviders.some((provider) => provider.id === llmProviderValue);
  const isCustomCollection =
    collectionValue.length > 0 &&
    vectorCollections.length > 0 &&
    !vectorCollections.some((collection) => collection.name === collectionValue);
  const vectorWeightActive = (searchSettings.vectorWeight ?? 0) > 0;

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

  return (
    <Card className={cn("shadow-none", className)}>
      <CardHeader className="space-y-1.5 py-3">
        <div className="flex items-center gap-2">
          <CardTitle className="text-base">Параметры поиска</CardTitle>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Info className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              </TooltipTrigger>
              <TooltipContent className="max-w-xs text-xs leading-relaxed">
                Окно быстрого поиска работает только внутри выбранной базы. Откройте его сочетанием Ctrl+K или ⌘K —
                подсказки будут использовать сохранённые ниже локальные параметры.
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
        <CardDescription>
          Быстрый поиск (Ctrl+K или ⌘K) работает в контексте базы «{baseName}», использует локальные параметры ниже и сохраняет
          их в браузере.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="kb-search-topk">Top-K</Label>
            <Input
              id="kb-search-topk"
              type="number"
              min={1}
              max={10}
              step={1}
              inputMode="numeric"
              value={searchSettings.topK ?? ""}
              onChange={(event) => onTopKChange(event.target.value)}
              disabled={disabled}
            />
            <p className="text-xs text-muted-foreground">Количество результатов, отображаемых в подсказках.</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="kb-search-vector-limit">Top-K статей для LLM</Label>
            <Input
              id="kb-search-vector-limit"
              type="number"
              min={1}
              max={20}
              step={1}
              inputMode="numeric"
              value={searchSettings.vectorLimit ?? ""}
              onChange={(event) => onVectorLimitChange(event.target.value)}
              disabled={disabled}
            />
            <p className="text-xs text-muted-foreground">Сколько документов передаётся модели для генерации ответа.</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="kb-search-bm25-weight">Вес BM25</Label>
            <Input
              id="kb-search-bm25-weight"
              type="number"
              min={0}
              max={1}
              step={0.05}
              inputMode="decimal"
              value={searchSettings.bm25Weight ?? ""}
              onChange={(event) => onBm25WeightChange(event.target.value)}
              disabled={disabled}
            />
            <p className="text-xs text-muted-foreground">Чем выше значение, тем сильнее вклад текстового поиска.</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="kb-search-vector-weight">Вес вектора</Label>
            <Input
              id="kb-search-vector-weight"
              type="number"
              min={0}
              max={1}
              step={0.05}
              inputMode="decimal"
              value={searchSettings.vectorWeight ?? ""}
              onChange={(event) => onVectorWeightChange(event.target.value)}
              disabled={disabled}
            />
            <p className="text-xs text-muted-foreground">Определяет вклад векторного поиска в выдачу.</p>
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="kb-search-embedding-provider">Сервис эмбеддингов</Label>
            <Select value={embeddingProviderValue} onValueChange={onEmbeddingProviderChange} disabled={disabled}>
              <SelectTrigger id="kb-search-embedding-provider" disabled={disabled}>
                <SelectValue
                  placeholder={
                    activeEmbeddingProviders.length === 0 ? "Нет доступных провайдеров" : "Выберите провайдера"
                  }
                />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Не выбрано</SelectItem>
                {activeEmbeddingProviders.map((provider) => (
                  <SelectItem key={provider.id} value={provider.id}>
                    {provider.name}
                  </SelectItem>
                ))}
                {isCustomProvider && embeddingProviderValue && (
                  <SelectItem value={embeddingProviderValue}>{embeddingProviderValue} (не найден)</SelectItem>
                )}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">Используется для генерации векторных представлений документов.</p>
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="kb-search-llm-provider">LLM сервис для RAG</Label>
            <Select value={llmProviderValue} onValueChange={onLlmProviderChange} disabled={disabled}>
              <SelectTrigger id="kb-search-llm-provider" disabled={disabled}>
                <SelectValue
                  placeholder={activeLlmProviders.length === 0 ? "Нет доступных LLM сервисов" : "Выберите сервис"}
                />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Не выбрано</SelectItem>
                {activeLlmProviders.map((provider) => (
                  <SelectItem key={provider.id} value={provider.id}>
                    {provider.name}
                  </SelectItem>
                ))}
                {isCustomLlmProvider && llmProviderValue && (
                  <SelectItem value={llmProviderValue}>{llmProviderValue} (не найден)</SelectItem>
                )}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">LLM отвечает за генерацию ответов в Ask AI и Quick Switcher.</p>
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="kb-search-collection">Коллекция Qdrant</Label>
            <Input
              id="kb-search-collection"
              value={collectionValue}
              onChange={(event) => onCollectionChange(event.target.value)}
              placeholder={isVectorCollectionsLoading ? "Загрузка списка коллекций..." : "Укажите название коллекции"}
              list={vectorCollections.length > 0 ? COLLECTION_DATALIST_ID : undefined}
              disabled={disabled}
            />
            {vectorCollections.length > 0 && (
              <datalist id={COLLECTION_DATALIST_ID}>
                {vectorCollections.map((collection) => (
                  <option key={collection.name} value={collection.name} />
                ))}
              </datalist>
            )}
            <p className="text-xs text-muted-foreground">Коллекция, в которой хранятся вектора документов.</p>
          </div>
        </div>
        {hints.length > 0 && <div className="space-y-2">{hints}</div>}
      </CardContent>
      <CardFooter className="py-3 text-xs text-muted-foreground">
        <p>
          Данные сохраняются в localStorage с ключом
          <span className="ml-1 font-mono text-[11px]">{storageKey}</span>.
        </p>
      </CardFooter>
    </Card>
  );
};

export default KnowledgeBaseSearchSettingsForm;
