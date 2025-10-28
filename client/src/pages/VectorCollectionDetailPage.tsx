import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, MouseEvent } from "react";
import { Link, useRoute } from "wouter";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import {
  Check,
  ChevronLeft,
  Copy,
  Download,
  Filter,
  Loader2,
  Maximize2,
  Minimize2,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Settings2,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { PublicEmbeddingProvider, PublicLlmProvider } from "@shared/schema";

interface VectorCollectionDetail {
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

type CollectionPoint = {
  id: string | number;
  payload: Record<string, unknown> | null;
  shard_key?: unknown;
  order_value?: unknown;
  score?: number;
  [key: string]: unknown;
};

interface CollectionPointsResponse {
  points: CollectionPoint[];
  nextPageOffset: string | number | null;
}

const POINTS_PAGE_SIZE = 24;

const SEARCH_SETTINGS_STORAGE_KEY = "vector-collection-search-settings";

const DEFAULT_TOP_K = 5;
const DEFAULT_GENERATIVE_CONTEXT_LIMIT = 5;
const DEFAULT_SEMANTIC_WITH_PAYLOAD = true;
const DEFAULT_SEMANTIC_WITH_VECTOR = false;
const GENERATIVE_TYPING_INTERVAL_MS = 18;

const clampTopK = (value: number) => {
  if (!Number.isFinite(value)) {
    return 1;
  }

  const rounded = Math.round(value);
  return Math.min(100, Math.max(1, rounded));
};

const GenerativeLoadingDots = () => {
  return (
    <span className="flex items-center gap-1 text-primary" aria-hidden>
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current" style={{ animationDelay: "0ms" }} />
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current" style={{ animationDelay: "150ms" }} />
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current" style={{ animationDelay: "300ms" }} />
    </span>
  );
};

const GenerativeLoadingState = () => {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex w-full items-center justify-between gap-3 rounded-lg border border-border/60 bg-muted/40 p-3"
    >
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10">
          <Sparkles className="h-4 w-4 text-primary" />
        </div>
        <div className="flex flex-col">
          <span className="text-sm font-semibold text-foreground">Генерируем ответ...</span>
          <span className="text-xs text-muted-foreground">Запрос отправлен в LLM, подождите немного.</span>
        </div>
      </div>
      <GenerativeLoadingDots />
    </div>
  );
};

type SearchMode = "semantic" | "filter" | "vector" | "generative";

const searchModeOptions: Array<{ value: SearchMode; label: string; icon: LucideIcon }> = [
  { value: "semantic", label: "Текст", icon: Search },
  { value: "generative", label: "LLM", icon: Sparkles },
  { value: "filter", label: "Фильтр", icon: Filter },
  { value: "vector", label: "Вектор", icon: Maximize2 },
];

type FilterOperator = "eq" | "neq" | "contains" | "gt" | "gte" | "lt" | "lte";

type FilterCombineMode = "and" | "or";

interface FilterCondition {
  id: string;
  field: string;
  operator: FilterOperator;
  value: string;
}

type LlmModelSelectionOption = {
  key: string;
  provider: PublicLlmProvider;
  model: { label: string; value: string };
};

interface ActiveSearchState {
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

interface SearchSettingsStorage {
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

interface TextSearchResponse {
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

interface GenerativeSearchResponse {
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

type GenerativeStreamMetadata = {
  context?: GenerativeSearchResponse["context"];
  usage?: GenerativeSearchResponse["usage"];
  provider?: GenerativeSearchResponse["provider"];
  embeddingProvider?: GenerativeSearchResponse["embeddingProvider"];
  queryVector?: number[];
  vectorLength?: number;
  limit?: number;
  contextLimit?: number;
};

type GenerativeStreamToken = {
  delta?: string;
  text?: string;
};

type GenerativeStreamCompletion = {
  answer?: string;
  usage?: GenerativeSearchResponse["usage"];
};

type GenerativeStreamError = {
  message?: string;
};

const filterOperatorOptions: Array<{ value: FilterOperator; label: string }> = [
  { value: "eq", label: "Равно" },
  { value: "neq", label: "Не равно" },
  { value: "contains", label: "Содержит" },
  { value: "gt", label: ">" },
  { value: "gte", label: "≥" },
  { value: "lt", label: "<" },
  { value: "lte", label: "≤" },
];

const filterOperatorSymbols: Record<FilterOperator, string> = {
  eq: "=",
  neq: "≠",
  contains: "∋",
  gt: ">",
  gte: "≥",
  lt: "<",
  lte: "≤",
};

const excludedPointKeys = new Set(["id", "payload", "vector", "shard_key", "order_value", "score"]);

function generateConditionId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `condition-${Math.random().toString(36).slice(2, 10)}`;
}

function collectNestedFields(
  source: Record<string, unknown>,
  prefix: string,
  accumulator: Set<string>,
) {
  Object.entries(source).forEach(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    accumulator.add(path);

    if (value && typeof value === "object" && !Array.isArray(value)) {
      collectNestedFields(value as Record<string, unknown>, path, accumulator);
    }
  });
}

function getAvailableFieldPaths(points: CollectionPoint[]): string[] {
  const fields = new Set<string>();

  points.forEach((point) => {
    if (point.payload) {
      collectNestedFields(point.payload, "", fields);
    }

    Object.entries(point).forEach(([key, value]) => {
      if (excludedPointKeys.has(key) || value === undefined || value === null) {
        return;
      }

      fields.add(key);
    });
  });

  return Array.from(fields).sort((a, b) => a.localeCompare(b, "ru"));
}

function parseFilterPrimitive(rawValue: string): string | number | boolean {
  const trimmed = rawValue.trim();

  if (!trimmed) {
    return "";
  }

  if (/^(true|false)$/i.test(trimmed)) {
    return trimmed.toLowerCase() === "true";
  }

  const numeric = Number(trimmed);
  if (!Number.isNaN(numeric)) {
    return numeric;
  }

  return trimmed;
}

function buildFilterPayload(
  conditions: FilterCondition[],
  combineMode: FilterCombineMode,
): Record<string, unknown> {
  const meaningfulConditions = conditions.filter((condition) => condition.field.trim().length > 0);

  if (meaningfulConditions.length === 0) {
    throw new Error("Добавьте хотя бы одно условие фильтра.");
  }

  const positive: Array<Record<string, unknown>> = [];
  const negative: Array<Record<string, unknown>> = [];

  for (const condition of meaningfulConditions) {
    const field = condition.field.trim();
    const value = condition.value.trim();

    switch (condition.operator) {
      case "eq": {
        const parsedValue = parseFilterPrimitive(value);
        positive.push({ key: field, match: { value: parsedValue } });
        break;
      }
      case "neq": {
        const parsedValue = parseFilterPrimitive(value);
        negative.push({ key: field, match: { value: parsedValue } });
        break;
      }
      case "contains": {
        if (!value) {
          throw new Error("Укажите значение для оператора 'Содержит'.");
        }
        positive.push({ key: field, match: { text: value } });
        break;
      }
      case "gt":
      case "gte":
      case "lt":
      case "lte": {
        const parsedNumber = Number(value);
        if (Number.isNaN(parsedNumber)) {
          throw new Error("Для сравнений укажите числовое значение.");
        }

        const rangeKey = condition.operator === "gt"
          ? "gt"
          : condition.operator === "gte"
            ? "gte"
            : condition.operator === "lt"
              ? "lt"
              : "lte";

        positive.push({ key: field, range: { [rangeKey]: parsedNumber } });
        break;
      }
      default:
        throw new Error("Неизвестный оператор фильтра.");
    }
  }

  const filter: Record<string, unknown> = {};

  if (combineMode === "and" && positive.length > 0) {
    filter.must = positive;
  }

  if (combineMode === "or" && positive.length > 0) {
    filter.should = positive;
    filter.min_should = { conditions: positive, min_count: 1 };
  }

  if (negative.length > 0) {
    filter.must_not = negative;
  }

  if (!filter.must && !filter.should && !filter.must_not) {
    throw new Error("Не удалось построить фильтр. Проверьте условия.");
  }

  return filter;
}

function describeFilterConditions(conditions: FilterCondition[], combineMode: FilterCombineMode): string {
  const meaningful = conditions.filter((condition) => condition.field.trim().length > 0);

  if (meaningful.length === 0) {
    return "Фильтр не задан";
  }

  const separator = combineMode === "and" ? " ∧ " : " ∨ ";

  return meaningful
    .map((condition) => {
      const valuePart = condition.value.trim() ? condition.value.trim() : "∅";
      return `${condition.field} ${filterOperatorSymbols[condition.operator]} ${valuePart}`;
    })
    .join(separator);
}

function parseVectorInput(raw: string): number[] {
  const tokens = raw
    .split(/[\s,]+/u)
    .map((token) => token.trim())
    .filter(Boolean);

  if (tokens.length === 0) {
    throw new Error("Введите значения вектора через пробел или запятую.");
  }

  const vector: number[] = [];

  for (const token of tokens) {
    const parsed = Number(token);
    if (!Number.isFinite(parsed)) {
      throw new Error(`Некорректное значение вектора: "${token}".`);
    }
    vector.push(parsed);
  }

  return vector;
}

function formatVectorPreview(vector: number[]): string {
  if (vector.length === 0) {
    return "—";
  }

  const preview = vector.slice(0, 6).map((value) => value.toFixed(3)).join(", ");
  return vector.length > 6 ? `${preview}, …` : preview;
}

function resolveProviderVectorSize(provider: PublicEmbeddingProvider | undefined): number | null {
  if (!provider) {
    return null;
  }

  const candidate = provider.qdrantConfig?.vectorSize;

  if (typeof candidate === "number" && Number.isFinite(candidate)) {
    return candidate;
  }

  if (typeof candidate === "string" && candidate.trim()) {
    const parsed = Number.parseInt(candidate, 10);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return null;
}

const statusLabels: Record<string, string> = {
  green: "Готова",
  yellow: "Оптимизируется",
  red: "Ошибка",
};

const statusIndicatorVariants: Record<string, string> = {
  green: "bg-emerald-500",
  yellow: "bg-amber-500",
  red: "bg-red-500",
};

function formatNumber(value: number | null | undefined) {
  if (value === null || value === undefined) {
    return "—";
  }

  return new Intl.NumberFormat("ru-RU").format(value);
}

export default function VectorCollectionDetailPage() {
  const [match, params] = useRoute("/vector/collections/:name");
  const encodedName = params?.name ?? "";
  const collectionName = encodedName ? decodeURIComponent(encodedName) : null;
  const [selectedPoint, setSelectedPoint] = useState<CollectionPoint | null>(null);
  const [isJsonCopied, setIsJsonCopied] = useState(false);
  const [isCurlCopied, setIsCurlCopied] = useState(false);
  const [isPointPreviewFullScreen, setIsPointPreviewFullScreen] = useState(false);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const pendingLlmSelection = useRef<{ providerId: string | null; modelValue: string | null } | null>(null);
  const { toast } = useToast();

  const [searchMode, setSearchMode] = useState<SearchMode>("semantic");
  const [activeSearch, setActiveSearch] = useState<ActiveSearchState | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [isLoadingMoreSearchResults, setIsLoadingMoreSearchResults] = useState(false);
  const [animatedGenerativeAnswer, setAnimatedGenerativeAnswer] = useState("");
  const animatedAnswerRef = useRef("");
  const generativeAnswerTargetRef = useRef("");
  const generativeTypingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stopGenerativeTyping = useCallback(() => {
    if (generativeTypingTimeoutRef.current !== null) {
      clearTimeout(generativeTypingTimeoutRef.current);
      generativeTypingTimeoutRef.current = null;
    }
  }, []);

  const scheduleGenerativeTyping = useCallback(() => {
    if (generativeTypingTimeoutRef.current !== null) {
      return;
    }

    const step = () => {
      const target = generativeAnswerTargetRef.current;
      const current = animatedAnswerRef.current;

      if (current === target) {
        generativeTypingTimeoutRef.current = null;
        return;
      }

      const nextCharacter = target.slice(current.length, current.length + 1);
      animatedAnswerRef.current = current + nextCharacter;
      setAnimatedGenerativeAnswer(animatedAnswerRef.current);

      const delay = nextCharacter === "\n"
        ? GENERATIVE_TYPING_INTERVAL_MS * 2
        : GENERATIVE_TYPING_INTERVAL_MS;

      generativeTypingTimeoutRef.current = setTimeout(step, delay);
    };

    generativeTypingTimeoutRef.current = setTimeout(step, GENERATIVE_TYPING_INTERVAL_MS);
  }, []);

  const [textQuery, setTextQuery] = useState("");
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null);
  const [textSearchLimit, setTextSearchLimit] = useState(DEFAULT_TOP_K);
  const [textSearchWithPayload, setTextSearchWithPayload] = useState(DEFAULT_SEMANTIC_WITH_PAYLOAD);
  const [textSearchWithVector, setTextSearchWithVector] = useState(DEFAULT_SEMANTIC_WITH_VECTOR);
  const [selectedLlmModelKey, setSelectedLlmModelKey] = useState<string | null>(null);
  const [generativeLimit, setGenerativeLimit] = useState(DEFAULT_TOP_K);
  const [llmContextLimit, setLlmContextLimit] = useState(DEFAULT_GENERATIVE_CONTEXT_LIMIT);
  const [searchSettingsLoaded, setSearchSettingsLoaded] = useState(false);
  const [isSettingsPopoverOpen, setIsSettingsPopoverOpen] = useState(false);

  const [filterConditions, setFilterConditions] = useState<FilterCondition[]>([
    { id: generateConditionId(), field: "", operator: "eq", value: "" },
  ]);
  const [filterCombineMode, setFilterCombineMode] = useState<FilterCombineMode>("and");
  const [filterLimit, setFilterLimit] = useState(20);
  const [filterWithPayload, setFilterWithPayload] = useState(true);
  const [filterWithVector, setFilterWithVector] = useState(false);

  const [vectorInput, setVectorInput] = useState("");
  const [vectorLimit, setVectorLimit] = useState(DEFAULT_TOP_K);
  const [vectorWithPayload, setVectorWithPayload] = useState(true);
  const [vectorWithVector, setVectorWithVector] = useState(false);
  const [vectorScoreThreshold, setVectorScoreThreshold] = useState("");

  const {
    data: collection,
    isLoading: collectionLoading,
    isFetching: collectionFetching,
    error: collectionError,
    refetch: refetchCollection,
  } = useQuery<VectorCollectionDetail>({
    queryKey: ["/api/vector/collections", collectionName ?? ""],
    enabled: Boolean(collectionName),
  });

  const { data: embeddingServices } = useQuery<{ providers: PublicEmbeddingProvider[] }>({
    queryKey: ["/api/embedding/services"],
  });

  const { data: llmProvidersData } = useQuery<{ providers: PublicLlmProvider[] }>({
    queryKey: ["/api/llm/providers"],
  });

  const {
    data: pointsData,
    isLoading: pointsLoading,
    isFetching: pointsFetching,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
    error: pointsError,
    refetch: refetchPoints,
  } = useInfiniteQuery<CollectionPointsResponse, Error>({
    queryKey: ["/api/vector/collections", collectionName ?? "", "points"],
    initialPageParam: undefined as string | number | undefined,
    enabled: Boolean(collectionName),
    queryFn: async ({ pageParam }) => {
      if (!collectionName) {
        return { points: [], nextPageOffset: null };
      }

      const params = new URLSearchParams();
      params.set("limit", String(POINTS_PAGE_SIZE));
      if (pageParam !== undefined && pageParam !== null) {
        params.set("offset", String(pageParam));
      }

      const response = await apiRequest(
        "GET",
        `/api/vector/collections/${encodeURIComponent(collectionName)}/points?${params.toString()}`,
      );
      return (await response.json()) as CollectionPointsResponse;
    },
    getNextPageParam: (lastPage) => lastPage.nextPageOffset ?? undefined,
  });

  const isRefreshing = collectionFetching || pointsFetching;

  const points = useMemo(() => {
    return pointsData?.pages.flatMap((page) => page.points) ?? [];
  }, [pointsData]);

  const availableFields = useMemo(() => {
    return getAvailableFieldPaths([...points, ...(activeSearch?.results ?? [])]);
  }, [points, activeSearch]);

  const activeEmbeddingProviders = useMemo(() => {
    return (embeddingServices?.providers ?? []).filter((provider) => provider.isActive);
  }, [embeddingServices]);

  const activeLlmProviders = useMemo(() => {
    return (llmProvidersData?.providers ?? []).filter((provider) => provider.isActive);
  }, [llmProvidersData]);

  const llmModelGroups = useMemo(() => {
    return activeLlmProviders.map((provider) => {
      const seenValues = new Set<string>();
      const models: Array<{ label: string; value: string }> = [];

      for (const rawModel of provider.availableModels ?? []) {
        const value = (rawModel?.value ?? "").trim();
        if (!value || seenValues.has(value)) {
          continue;
        }

        const label = (rawModel.label ?? "").trim() || value;
        models.push({ label, value });
        seenValues.add(value);
      }

      const defaultModel = (provider.model ?? "").trim();
      if (defaultModel && !seenValues.has(defaultModel)) {
        models.push({ label: defaultModel, value: defaultModel });
        seenValues.add(defaultModel);
      }

      if (models.length === 0) {
        models.push({ label: provider.model, value: provider.model });
      }

      return { provider, models };
    });
  }, [activeLlmProviders]);

  const llmModelOptions = useMemo<LlmModelSelectionOption[]>(() => {
    return llmModelGroups.flatMap(({ provider, models }) =>
      models
        .filter((model) => model.value.trim().length > 0)
        .map((model) => ({
          key: `${provider.id}::${model.value}`,
          provider,
          model,
        })),
    );
  }, [llmModelGroups]);

  const collectionVectorSizeValue = collection?.vectorSize ?? null;

  const matchingProviders = useMemo(() => {
    if (activeEmbeddingProviders.length === 0) {
      return [];
    }

    if (!collectionVectorSizeValue) {
      return activeEmbeddingProviders;
    }

    return activeEmbeddingProviders.filter((provider) => {
      const providerSize = resolveProviderVectorSize(provider);
      return !providerSize || providerSize === collectionVectorSizeValue;
    });
  }, [activeEmbeddingProviders, collectionVectorSizeValue]);

  useEffect(() => {
    return () => {
      stopGenerativeTyping();
    };
  }, [stopGenerativeTyping]);

  useEffect(() => {
    if (activeSearch?.mode !== "generative") {
      generativeAnswerTargetRef.current = "";
      animatedAnswerRef.current = "";
      setAnimatedGenerativeAnswer("");
      stopGenerativeTyping();
      return;
    }

    const target = activeSearch.answer ?? "";
    const current = animatedAnswerRef.current;

    if (current && !target.startsWith(current)) {
      animatedAnswerRef.current = "";
      setAnimatedGenerativeAnswer("");
    }

    generativeAnswerTargetRef.current = target;

    if (target.length === 0) {
      stopGenerativeTyping();
      return;
    }

    scheduleGenerativeTyping();
  }, [
    activeSearch?.answer,
    activeSearch?.mode,
    scheduleGenerativeTyping,
    stopGenerativeTyping,
  ]);

  const fullGenerativeAnswer =
    activeSearch?.mode === "generative" ? activeSearch.answer ?? "" : "";
  const hasGenerativeAnswerContent = fullGenerativeAnswer.trim().length > 0;
  const isGenerativeTyping =
    activeSearch?.mode === "generative" &&
    fullGenerativeAnswer.length > 0 &&
    animatedGenerativeAnswer.length < fullGenerativeAnswer.length;

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    try {
      const raw = window.localStorage.getItem(SEARCH_SETTINGS_STORAGE_KEY);
      if (!raw) {
        setSearchSettingsLoaded(true);
        return;
      }

      const parsed = JSON.parse(raw) as SearchSettingsStorage;

      if (parsed.semantic) {
        if (typeof parsed.semantic.topK === "number") {
          setTextSearchLimit(clampTopK(parsed.semantic.topK));
        }
        if (typeof parsed.semantic.withPayload === "boolean") {
          setTextSearchWithPayload(parsed.semantic.withPayload);
        }
        if (typeof parsed.semantic.withVector === "boolean") {
          setTextSearchWithVector(parsed.semantic.withVector);
        }
      }

      const storedEmbeddingProviderId =
        typeof parsed.semantic?.providerId === "string"
          ? parsed.semantic.providerId
          : typeof parsed.generative?.embeddingProviderId === "string"
            ? parsed.generative.embeddingProviderId
            : null;

      if (storedEmbeddingProviderId) {
        setSelectedProviderId(storedEmbeddingProviderId);
      }

      let nextGenerativeTopK: number | null = null;

      if (parsed.generative) {
        if (typeof parsed.generative.topK === "number") {
          nextGenerativeTopK = clampTopK(parsed.generative.topK);
          setGenerativeLimit(nextGenerativeTopK);
        }

        if (typeof parsed.generative.contextLimit === "number") {
          const safeContext = clampTopK(parsed.generative.contextLimit);
          const cap = nextGenerativeTopK ?? DEFAULT_GENERATIVE_CONTEXT_LIMIT;
          setLlmContextLimit(Math.min(safeContext, cap));
        } else if (nextGenerativeTopK !== null) {
          setLlmContextLimit((previous) => Math.min(previous, nextGenerativeTopK!));
        }

        const storedLlmProviderId =
          typeof parsed.generative.llmProviderId === "string"
            ? parsed.generative.llmProviderId
            : null;
        const storedLlmModel =
          typeof parsed.generative.llmModel === "string" ? parsed.generative.llmModel : null;

        if (storedLlmProviderId || storedLlmModel) {
          pendingLlmSelection.current = { providerId: storedLlmProviderId, modelValue: storedLlmModel };
        }
      }
    } catch (error) {
      console.error("Не удалось загрузить настройки поиска", error);
    } finally {
      setSearchSettingsLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (selectedProviderId && !matchingProviders.some((provider) => provider.id === selectedProviderId)) {
      setSelectedProviderId(null);
    }
  }, [matchingProviders, selectedProviderId]);

  useEffect(() => {
    if (!selectedProviderId && matchingProviders.length > 0) {
      setSelectedProviderId(matchingProviders[0].id);
    }
  }, [matchingProviders, selectedProviderId]);

  const selectedProvider = useMemo(() => {
    if (selectedProviderId) {
      return matchingProviders.find((provider) => provider.id === selectedProviderId) ?? null;
    }

    return matchingProviders[0] ?? null;
  }, [matchingProviders, selectedProviderId]);

  useEffect(() => {
    if (pendingLlmSelection.current && llmModelOptions.length > 0) {
      const { providerId, modelValue } = pendingLlmSelection.current;

      const matchedOption =
        llmModelOptions.find((option) => {
          const providerMatches = providerId ? option.provider.id === providerId : true;
          const modelMatches = modelValue ? option.model.value === modelValue : true;
          return providerMatches && modelMatches;
        }) ??
        (providerId ? llmModelOptions.find((option) => option.provider.id === providerId) : null);

      if (matchedOption) {
        if (matchedOption.key !== selectedLlmModelKey) {
          setSelectedLlmModelKey(matchedOption.key);
        }
        pendingLlmSelection.current = null;
        return;
      }

      pendingLlmSelection.current = null;
    }

    if (llmModelOptions.length === 0) {
      if (selectedLlmModelKey !== null) {
        setSelectedLlmModelKey(null);
      }
      return;
    }

    if (!selectedLlmModelKey || !llmModelOptions.some((option) => option.key === selectedLlmModelKey)) {
      setSelectedLlmModelKey(llmModelOptions[0].key);
    }
  }, [llmModelOptions, selectedLlmModelKey]);

  const selectedLlmOption = useMemo<LlmModelSelectionOption | null>(() => {
    if (!selectedLlmModelKey) {
      return llmModelOptions[0] ?? null;
    }

    return llmModelOptions.find((option) => option.key === selectedLlmModelKey) ?? llmModelOptions[0] ?? null;
  }, [llmModelOptions, selectedLlmModelKey]);

  const selectedLlmProvider = selectedLlmOption?.provider ?? null;
  const selectedLlmModel = selectedLlmOption?.model ?? null;
  const selectedLlmProviderIdValue = selectedLlmProvider?.id ?? null;
  const selectedLlmModelValue = selectedLlmModel?.value ?? null;

  const canSubmitSemanticSearch = useMemo(() => {
    return !searchLoading && matchingProviders.length > 0 && textQuery.trim().length > 0;
  }, [matchingProviders.length, searchLoading, textQuery]);

  const canSubmitGenerativeSearch = useMemo(() => {
    const sanitizedQuery = textQuery.trim();
    return (
      !searchLoading &&
      sanitizedQuery.length > 0 &&
      matchingProviders.length > 0 &&
      llmModelOptions.length > 0
    );
  }, [llmModelOptions.length, matchingProviders.length, searchLoading, textQuery]);

  useEffect(() => {
    if (!searchSettingsLoaded || typeof window === "undefined") {
      return;
    }

    const payload: SearchSettingsStorage = {
      semantic: {
        topK: textSearchLimit,
        providerId: selectedProviderId,
        withPayload: textSearchWithPayload,
        withVector: textSearchWithVector,
      },
      generative: {
        topK: generativeLimit,
        contextLimit: llmContextLimit,
        embeddingProviderId: selectedProviderId,
        llmProviderId: selectedLlmProviderIdValue,
        llmModel: selectedLlmModelValue,
      },
    };

    try {
      window.localStorage.setItem(SEARCH_SETTINGS_STORAGE_KEY, JSON.stringify(payload));
    } catch (error) {
      console.error("Не удалось сохранить настройки поиска", error);
    }
  }, [
    generativeLimit,
    llmContextLimit,
    searchSettingsLoaded,
    selectedLlmModelKey,
    selectedLlmProviderIdValue,
    selectedLlmModelValue,
    selectedProviderId,
    textSearchLimit,
    textSearchWithPayload,
    textSearchWithVector,
  ]);

  useEffect(() => {
    setIsSettingsPopoverOpen(false);
  }, [searchMode]);

  useEffect(() => {
    if (searchLoading) {
      setIsSettingsPopoverOpen(false);
    }
  }, [searchLoading]);

  useEffect(() => {
    setLlmContextLimit((previous) => Math.min(previous, generativeLimit));
  }, [generativeLimit]);

  const semanticSettingsBadges = useMemo(() => {
    const badges: Array<{ key: string; label: string }> = [];

    if (textSearchLimit !== DEFAULT_TOP_K) {
      badges.push({ key: "top-k", label: `Top K: ${textSearchLimit}` });
    }

    if (!textSearchWithPayload) {
      badges.push({ key: "payload", label: "Payload: выкл" });
    }

    if (textSearchWithVector) {
      badges.push({ key: "vector", label: "Вектор: вкл" });
    }

    return badges;
  }, [textSearchLimit, textSearchWithPayload, textSearchWithVector]);

  const curlCommand = useMemo(() => {
    if (!collectionName) {
      return "";
    }

    const origin = typeof window !== "undefined" ? window.location.origin : "";
    const baseUrl = origin
      ? `${origin}/api/vector/collections/${encodeURIComponent(collectionName)}/search`
      : `/api/vector/collections/${encodeURIComponent(collectionName)}/search`;
    const vectorHint = collection?.vectorSize
      ? `<${collection.vectorSize}_vector_values>`
      : "<vector_values>";

    return [
      `curl -X POST '${baseUrl}' \\`,
      `  -H 'Content-Type: application/json' \\`,
      "  -d '{",
      `    "vector": ["${vectorHint}"],`,
      '    "limit": 10,',
      '    "with_payload": true',
      "  }'",
    ].join("\n");
  }, [collectionName, collection?.vectorSize]);

  useEffect(() => {
    if (activeSearch) {
      return;
    }

    const node = loadMoreRef.current;

    if (!node || !hasNextPage) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const [entry] = entries;
        if (entry?.isIntersecting && !isFetchingNextPage) {
          void fetchNextPage();
        }
      },
      {
        rootMargin: "200px",
      },
    );

    observer.observe(node);

    return () => {
      observer.disconnect();
    };
  }, [activeSearch, fetchNextPage, hasNextPage, isFetchingNextPage, points.length]);

  const selectedPointJson = useMemo(() => {
    if (!selectedPoint) {
      return "";
    }

    const { vector, ...rest } = selectedPoint;

    try {
      return JSON.stringify(rest, null, 2);
    } catch (error) {
      console.error("Не удалось подготовить JSON записи", error);
      return "";
    }
  }, [selectedPoint]);

  const selectedPointDownloadJson = useMemo(() => {
    if (!selectedPoint) {
      return "";
    }

    try {
      return JSON.stringify(selectedPoint, null, 2);
    } catch (error) {
      console.error("Не удалось подготовить полный JSON записи", error);
      return "";
    }
  }, [selectedPoint]);

  if (!match) {
    return null;
  }

  if (!collectionName) {
    return (
      <div className="p-6">
        <Alert variant="destructive">
          <AlertTitle>Коллекция не найдена</AlertTitle>
          <AlertDescription>Не удалось определить имя коллекции.</AlertDescription>
        </Alert>
      </div>
    );
  }

  const handleRefresh = () => {
    void refetchCollection();
    void refetchPoints();
  };

  const handleCopyCurl = async () => {
    if (!curlCommand) {
      return;
    }

    try {
      await navigator.clipboard.writeText(curlCommand);
      setIsCurlCopied(true);
      toast({
        title: "Команда скопирована",
        description: "curl для поиска по коллекции добавлен в буфер обмена.",
      });
      window.setTimeout(() => setIsCurlCopied(false), 2000);
    } catch (error) {
      toast({
        title: "Не удалось скопировать",
        description: "Скопируйте текст вручную и попробуйте ещё раз.",
        variant: "destructive",
      });
    }
  };

  const closePointPreview = () => {
    setSelectedPoint(null);
    setIsJsonCopied(false);
    setIsPointPreviewFullScreen(false);
  };

  const handleCopyJson = async () => {
    if (!selectedPointJson) {
      return;
    }

    try {
      await navigator.clipboard.writeText(selectedPointJson);
      setIsJsonCopied(true);
      toast({
        title: "JSON скопирован",
        description: "Полное содержимое записи добавлено в буфер обмена.",
      });
      window.setTimeout(() => setIsJsonCopied(false), 2000);
    } catch (error) {
      toast({
        title: "Не удалось скопировать",
        description: "Скопируйте данные вручную и попробуйте ещё раз.",
        variant: "destructive",
      });
    }
  };

  const handleDownloadJson = () => {
    if (!selectedPointDownloadJson || !selectedPoint) {
      return;
    }

    try {
      const blob = new Blob([selectedPointDownloadJson], {
        type: "text/plain;charset=utf-8",
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      const normalizedCollectionName = (collectionName ?? "collection").replace(/[^\p{L}\p{N}_-]+/gu, "-");
      link.href = url;
      link.download = `${normalizedCollectionName}-record-${selectedPoint.id}.txt`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      toast({
        title: "Файл скачан",
        description: "Полный JSON записи сохранён в формате TXT.",
      });
    } catch (error) {
      console.error("Не удалось скачать JSON записи", error);
      toast({
        title: "Не удалось скачать",
        description: "Попробуйте ещё раз или скопируйте данные вручную.",
        variant: "destructive",
      });
    }
  };

  const getPointEntries = (point: CollectionPoint) => {
    const entries: Array<{ key: string; value: string }> = [];

    const formatValue = (value: unknown): string => {
      if (value === null) {
        return "null";
      }

      if (value === undefined) {
        return "—";
      }

      if (typeof value === "string") {
        return value;
      }

      if (typeof value === "number" || typeof value === "boolean") {
        return String(value);
      }

      try {
        return JSON.stringify(value);
      } catch (error) {
        console.error("Не удалось преобразовать значение поля записи", error);
        return String(value);
      }
    };

    const pushEntries = (source: Record<string, unknown> | null | undefined, prefix?: string) => {
      if (!source) {
        return;
      }

      Object.entries(source).forEach(([key, value]) => {
        entries.push({
          key: prefix ? `${prefix}.${key}` : key,
          value: formatValue(value),
        });
      });
    };

    pushEntries(point.payload ?? undefined);

    Object.entries(point).forEach(([key, value]) => {
      if (["id", "payload", "vector", "shard_key", "order_value"].includes(key)) {
        return;
      }

      entries.push({ key, value: formatValue(value) });
    });

    return entries;
  };

  const mapSearchPoint = useCallback(
    (point: TextSearchResponse["results"][number]): CollectionPoint => {
      const { payload, vector, ...rest } = point;

      return {
        ...rest,
        payload: (payload ?? null) as Record<string, unknown> | null,
        vector: (vector ?? null) as CollectionPoint["vector"],
        score: typeof point.score === "number" && Number.isFinite(point.score) ? point.score : undefined,
      };
    },
    [],
  );

  const mapGenerativePoint = useCallback(
    (point: GenerativeSearchResponse["context"][number]): CollectionPoint => {
      return {
        id: point.id,
        payload: (point.payload ?? null) as Record<string, unknown> | null,
        vector: null,
        score: typeof point.score === "number" && Number.isFinite(point.score) ? point.score : undefined,
        shard_key: point.shard_key,
        order_value: point.order_value,
      };
    },
    [],
  );

  const buildScoreMap = useCallback((entries: CollectionPoint[]) => {
    return entries.reduce<Record<string, number>>((acc, entry) => {
      if (typeof entry.score === "number" && Number.isFinite(entry.score)) {
        acc[String(entry.id)] = entry.score;
      }
      return acc;
    }, {});
  }, []);

  const updateFilterCondition = useCallback((id: string, patch: Partial<FilterCondition>) => {
    setFilterConditions((previous) =>
      previous.map((condition) => (condition.id === id ? { ...condition, ...patch } : condition)),
    );
  }, []);

  const addFilterCondition = useCallback(() => {
    setFilterConditions((previous) => [
      ...previous,
      { id: generateConditionId(), field: "", operator: "eq", value: "" },
    ]);
  }, []);

  const removeFilterCondition = useCallback((id: string) => {
    setFilterConditions((previous) => {
      if (previous.length === 1) {
        return previous.map((condition) => (condition.id === id ? { ...condition, field: "", value: "" } : condition));
      }

      return previous.filter((condition) => condition.id !== id);
    });
  }, []);

  const clearSearchResults = useCallback(() => {
    setActiveSearch(null);
    setSearchError(null);
    setSearchLoading(false);
    setIsLoadingMoreSearchResults(false);
    setSelectedPoint(null);
  }, []);

  const handleTextSearch = useCallback(async () => {
    if (!collectionName) {
      return;
    }

    const providerId = selectedProvider?.id ?? matchingProviders[0]?.id;

    if (!providerId) {
      setSearchError("Нет активных сервисов эмбеддингов подходящей размерности.");
      return;
    }

    if (!textQuery.trim()) {
      setSearchError("Введите поисковый запрос.");
      return;
    }

    setSearchLoading(true);
    setSearchError(null);

    try {
      const response = await apiRequest(
        "POST",
        `/api/vector/collections/${encodeURIComponent(collectionName)}/search/text`,
        {
          query: textQuery.trim(),
          embeddingProviderId: providerId,
          limit: textSearchLimit,
          withPayload: textSearchWithPayload,
          withVector: textSearchWithVector,
        },
      );
      const data = (await response.json()) as (TextSearchResponse & { error?: string });

      if (!response.ok) {
        throw new Error(data.error ?? "Не удалось выполнить текстовый поиск");
      }

      const mapped = (data.results ?? []).map((point) => mapSearchPoint(point));
      const scores = buildScoreMap(mapped);

      setActiveSearch({
        mode: "semantic",
        description: `Текстовый запрос: «${textQuery.trim()}»`,
        results: mapped,
        scores,
        vectorLength: data.vectorLength ?? data.queryVector?.length ?? undefined,
        usageTokens: data.usageTokens ?? null,
        providerName: data.provider?.name,
        queryVectorPreview: data.queryVector ? formatVectorPreview(data.queryVector) : undefined,
        limit: textSearchLimit,
        withPayload: textSearchWithPayload,
        withVector: textSearchWithVector,
        filterPayload: null,
        nextPageOffset: null,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setSearchError(message);
    } finally {
      setSearchLoading(false);
    }
  }, [
    collectionName,
    selectedProvider,
    matchingProviders,
    textQuery,
    textSearchLimit,
    textSearchWithPayload,
    textSearchWithVector,
    mapSearchPoint,
    buildScoreMap,
  ]);

  const handleSemanticInputKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Enter") {
        event.preventDefault();

        if (canSubmitSemanticSearch) {
          void handleTextSearch();
        }
      }
    },
    [canSubmitSemanticSearch, handleTextSearch],
  );

  const handleGenerativeSearch = useCallback(async () => {
    if (!collectionName) {
      return;
    }

    const embeddingProviderId = selectedProvider?.id ?? matchingProviders[0]?.id;
    if (!embeddingProviderId) {
      setSearchError("Нет активных сервисов эмбеддингов подходящей размерности.");
      return;
    }

    const llmOption = selectedLlmOption ?? llmModelOptions[0] ?? null;
    const llmProviderId = llmOption?.provider.id ?? null;
    const llmModelValueToSend =
      (selectedLlmModelValue && selectedLlmModelValue.trim().length > 0
        ? selectedLlmModelValue.trim()
        : (llmOption?.provider.model ?? "").trim()) || null;

    if (!llmProviderId || !llmModelValueToSend) {
      setSearchError("Нет активных провайдеров LLM.");
      return;
    }

    const sanitizedQuery = textQuery.trim();
    if (!sanitizedQuery) {
      setSearchError("Введите поисковый запрос.");
      return;
    }

    setSearchLoading(true);
    setSearchError(null);
    setSelectedPoint(null);

    const safeLimit = Math.max(1, generativeLimit);
    const safeContextLimit = Math.max(1, Math.min(llmContextLimit, safeLimit));
    const requestPayload = {
      query: sanitizedQuery,
      embeddingProviderId,
      llmProviderId,
      llmModel: llmModelValueToSend,
      limit: safeLimit,
      contextLimit: safeContextLimit,
    };

    const isGigachatProvider = llmOption?.provider.providerType === "gigachat";

    if (isGigachatProvider) {
      try {
        const response = await fetch(
          `/api/vector/collections/${encodeURIComponent(collectionName)}/search/generative`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Accept: "text/event-stream",
            },
            body: JSON.stringify(requestPayload),
            credentials: "include",
          },
        );

        if (!response.ok) {
          const rawText = await response.text();
          const trimmed = rawText.trim();
          let message = trimmed || response.statusText || "Не удалось получить ответ LLM";

          if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
            try {
              const parsed = JSON.parse(trimmed) as { error?: string; details?: string };
              const parts: string[] = [];
              if (parsed.error) {
                parts.push(parsed.error);
              }
              if (parsed.details) {
                parts.push(parsed.details);
              }
              if (parts.length > 0) {
                message = parts.join(" — ");
              }
            } catch {
              // Игнорируем ошибки парсинга
            }
          } else if (trimmed.startsWith("<")) {
            message = response.statusText || "Не удалось получить ответ LLM";
          }

          throw new Error(message);
        }

        const reader = response.body?.getReader();
        if (!reader) {
          throw new Error("Поток SSE недоступен для ответа LLM.");
        }

        const decoder = new TextDecoder("utf-8");
        let buffer = "";
        let aggregatedAnswer = "";
        let metadataReceived = false;
        let currentLlmTokens: number | null = null;

        const updateAnswer = (next: string) => {
          aggregatedAnswer = next;
          if (!metadataReceived) {
            return;
          }
          setActiveSearch((prev) => {
            if (!prev || prev.mode !== "generative") {
              return prev;
            }
            return { ...prev, answer: next };
          });
        };

        const applyMetadata = (metadata: GenerativeStreamMetadata) => {
          const mapped = (metadata.context ?? []).map((entry) => mapGenerativePoint(entry));
          const scores = buildScoreMap(mapped);
          const providerFromStream = metadata.provider;
          const providerDisplayName = llmOption
            ? `${llmOption.provider.name} · ${llmOption.model.label}`
            : providerFromStream
              ? `${providerFromStream.name}${
                  providerFromStream.modelLabel ? ` · ${providerFromStream.modelLabel}` : ""
                }`
              : undefined;
          const modelLabel = llmOption?.model.label ?? providerFromStream?.modelLabel ?? null;
          currentLlmTokens = metadata.usage?.llmTokens ?? currentLlmTokens ?? null;
          metadataReceived = true;

          setActiveSearch({
            mode: "generative",
            description: `Генеративный ответ на запрос «${sanitizedQuery}»`,
            results: mapped,
            scores,
            vectorLength: metadata.vectorLength ?? metadata.queryVector?.length ?? undefined,
            usageTokens: metadata.usage?.embeddingTokens ?? null,
            llmUsageTokens: currentLlmTokens,
            providerName: selectedProvider?.name ?? metadata.embeddingProvider?.name,
            llmProviderName: providerDisplayName ?? undefined,
            llmModelLabel: modelLabel ?? undefined,
            answer: aggregatedAnswer,
            queryVectorPreview: metadata.queryVector ? formatVectorPreview(metadata.queryVector) : undefined,
            limit: metadata.limit ?? safeLimit,
            withPayload: true,
            withVector: false,
            filterPayload: null,
            nextPageOffset: null,
            contextLimit: metadata.contextLimit ?? safeContextLimit,
          });
        };

        let completed = false;
        let streamErrorMessage: string | null = null;

        while (!completed) {
          const { value, done } = await reader.read();
          if (done) {
            break;
          }

          buffer += decoder.decode(value, { stream: true });

          let boundaryIndex = buffer.indexOf("\n\n");
          while (boundaryIndex !== -1) {
            const rawEvent = buffer.slice(0, boundaryIndex).replace(/\r/g, "");
            buffer = buffer.slice(boundaryIndex + 2);
            boundaryIndex = buffer.indexOf("\n\n");

            if (!rawEvent.trim()) {
              continue;
            }

            const lines = rawEvent.split("\n");
            let eventName = "message";
            const dataLines: string[] = [];

            for (const line of lines) {
              if (line.startsWith("event:")) {
                eventName = line.slice(6).trim();
              } else if (line.startsWith("data:")) {
                dataLines.push(line.slice(5).trim());
              }
            }

            const dataPayload = dataLines.join("\n");
            if (!dataPayload) {
              continue;
            }

            if (eventName === "error") {
              try {
                const parsed = JSON.parse(dataPayload) as GenerativeStreamError;
                streamErrorMessage = parsed.message ?? "Не удалось получить ответ LLM";
              } catch {
                streamErrorMessage = "Не удалось получить ответ LLM";
              }
              completed = true;
              break;
            }

            if (dataPayload === "[DONE]") {
              completed = true;
              break;
            }

            let parsedData: unknown;
            try {
              parsedData = JSON.parse(dataPayload);
            } catch {
              continue;
            }

            if (eventName === "metadata") {
              applyMetadata(parsedData as GenerativeStreamMetadata);
              continue;
            }

            if (eventName === "complete") {
              const completionPayload = parsedData as GenerativeStreamCompletion;
              const finalAnswer = completionPayload.answer ?? aggregatedAnswer;
              aggregatedAnswer = finalAnswer;
              currentLlmTokens = completionPayload.usage?.llmTokens ?? currentLlmTokens ?? null;
              if (!metadataReceived) {
                applyMetadata({});
              }
              setActiveSearch((prev) => {
                if (!prev || prev.mode !== "generative") {
                  return prev;
                }
                return {
                  ...prev,
                  answer: finalAnswer,
                  llmUsageTokens: currentLlmTokens ?? prev.llmUsageTokens ?? null,
                  usageTokens: completionPayload.usage?.embeddingTokens ?? prev.usageTokens ?? null,
                };
              });
              completed = true;
              break;
            }

            const tokenPayload = parsedData as GenerativeStreamToken;
            const delta = tokenPayload.delta ?? tokenPayload.text ?? "";
            if (delta) {
              updateAnswer(aggregatedAnswer + delta);
            }
          }

          if (streamErrorMessage || completed) {
            break;
          }
        }

        try {
          reader.releaseLock();
        } catch {
          // Игнорируем ошибки при освобождении ридера
        }

        if (streamErrorMessage) {
          throw new Error(streamErrorMessage);
        }

        if (metadataReceived) {
          setActiveSearch((prev) => {
            if (!prev || prev.mode !== "generative") {
              return prev;
            }
            return {
              ...prev,
              answer: aggregatedAnswer,
              llmUsageTokens: currentLlmTokens ?? prev.llmUsageTokens ?? null,
            };
          });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setSearchError(message);
      } finally {
        setSearchLoading(false);
      }

      return;
    }

    try {
      const response = await apiRequest(
        "POST",
        `/api/vector/collections/${encodeURIComponent(collectionName)}/search/generative`,
        requestPayload,
      );
      const data = (await response.json()) as (GenerativeSearchResponse & { error?: string });

      if (!response.ok) {
        throw new Error(data.error ?? "Не удалось получить ответ LLM");
      }

      const mapped = (data.context ?? []).map((entry) => mapGenerativePoint(entry));
      const scores = buildScoreMap(mapped);

      const providerDisplayName = llmOption
        ? `${llmOption.provider.name} · ${llmOption.model.label}`
        : data.provider
          ? `${data.provider.name}${data.provider.modelLabel ? ` · ${data.provider.modelLabel}` : ""}`
          : undefined;

      const modelLabel = llmOption?.model.label ?? data.provider?.modelLabel ?? null;

      setActiveSearch({
        mode: "generative",
        description: `Генеративный ответ на запрос «${sanitizedQuery}»`,
        results: mapped,
        scores,
        vectorLength: data.vectorLength ?? data.queryVector?.length ?? undefined,
        usageTokens: data.usage?.embeddingTokens ?? null,
        llmUsageTokens: data.usage?.llmTokens ?? null,
        providerName: selectedProvider?.name ?? data.embeddingProvider?.name,
        llmProviderName: providerDisplayName ?? undefined,
        llmModelLabel: modelLabel ?? undefined,
        answer: data.answer,
        queryVectorPreview: data.queryVector ? formatVectorPreview(data.queryVector) : undefined,
        limit: safeLimit,
        withPayload: true,
        withVector: false,
        filterPayload: null,
        nextPageOffset: null,
        contextLimit: safeContextLimit,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setSearchError(message);
    } finally {
      setSearchLoading(false);
    }
  }, [
    collectionName,
    selectedProvider,
    matchingProviders,
    selectedLlmOption,
    llmModelOptions,
    selectedLlmModelValue,
    textQuery,
    generativeLimit,
    llmContextLimit,
    mapGenerativePoint,
    buildScoreMap,
  ]);

  const handleFilterSearch = useCallback(async () => {
    if (!collectionName || searchLoading) {
      return;
    }

    setSearchLoading(true);
    setSearchError(null);

    try {
      const filterPayload = buildFilterPayload(filterConditions, filterCombineMode);
      const response = await apiRequest(
        "POST",
        `/api/vector/collections/${encodeURIComponent(collectionName)}/scroll`,
        {
          filter: filterPayload,
          limit: filterLimit,
          withPayload: filterWithPayload,
          withVector: filterWithVector,
        },
      );
      const data = (await response.json()) as {
        points?: CollectionPoint[];
        nextPageOffset?: string | number | null;
        error?: string;
      };

      if (!response.ok) {
        throw new Error(data.error ?? "Не удалось выполнить фильтрацию");
      }

      const mapped = (data.points ?? []).map((point) => ({
        ...point,
        payload: point.payload ?? null,
        vector: point.vector ?? null,
      }));
      const scores = buildScoreMap(mapped);

      setActiveSearch({
        mode: "filter",
        description: describeFilterConditions(filterConditions, filterCombineMode),
        results: mapped,
        scores,
        limit: filterLimit,
        withPayload: filterWithPayload,
        withVector: filterWithVector,
        filterPayload,
        nextPageOffset: data.nextPageOffset ?? null,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setSearchError(message);
    } finally {
      setSearchLoading(false);
    }
  }, [
    collectionName,
    filterConditions,
    filterCombineMode,
    filterLimit,
    filterWithPayload,
    filterWithVector,
    searchLoading,
    buildScoreMap,
  ]);

  const handleVectorSearch = useCallback(async () => {
    if (!collectionName) {
      return;
    }

    setSearchLoading(true);
    setSearchError(null);

    try {
      const vector = parseVectorInput(vectorInput);

      if (collectionVectorSizeValue && vector.length !== collectionVectorSizeValue) {
        throw new Error(
          `Размер вектора должен быть ${collectionVectorSizeValue.toLocaleString("ru-RU")}, получено ${vector.length}.`,
        );
      }

      const payload: Record<string, unknown> = {
        vector,
        limit: vectorLimit,
        withPayload: vectorWithPayload,
        withVector: vectorWithVector,
      };

      if (vectorScoreThreshold.trim()) {
        const threshold = Number(vectorScoreThreshold.trim());
        if (Number.isNaN(threshold)) {
          throw new Error("Порог схожести должен быть числом.");
        }
        payload.scoreThreshold = threshold;
      }

      const response = await apiRequest(
        "POST",
        `/api/vector/collections/${encodeURIComponent(collectionName)}/search`,
        payload,
      );
      const data = (await response.json()) as { results?: TextSearchResponse["results"]; error?: string };

      if (!response.ok) {
        throw new Error(data.error ?? "Не удалось выполнить поиск по вектору");
      }

      const mapped = (data.results ?? []).map((point) => mapSearchPoint(point));
      const scores = buildScoreMap(mapped);

      setActiveSearch({
        mode: "vector",
        description: `Поиск по вектору (${vector.length.toLocaleString("ru-RU")} знач.)`,
        results: mapped,
        scores,
        vectorLength: vector.length,
        limit: vectorLimit,
        withPayload: vectorWithPayload,
        withVector: vectorWithVector,
        filterPayload: null,
        nextPageOffset: null,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setSearchError(message);
    } finally {
      setSearchLoading(false);
    }
  }, [
    collectionName,
    vectorInput,
    vectorLimit,
    vectorWithPayload,
    vectorWithVector,
    vectorScoreThreshold,
    collectionVectorSizeValue,
    mapSearchPoint,
    buildScoreMap,
  ]);

  const handleLoadMoreSearchResults = useCallback(async () => {
    if (!collectionName || !activeSearch || activeSearch.mode !== "filter" || !activeSearch.nextPageOffset) {
      return;
    }

    setIsLoadingMoreSearchResults(true);
    setSearchError(null);

    try {
      const response = await apiRequest(
        "POST",
        `/api/vector/collections/${encodeURIComponent(collectionName)}/scroll`,
        {
          filter: activeSearch.filterPayload ?? undefined,
          limit: activeSearch.limit,
          offset: activeSearch.nextPageOffset,
          withPayload: activeSearch.withPayload,
          withVector: activeSearch.withVector,
        },
      );
      const data = (await response.json()) as {
        points?: CollectionPoint[];
        nextPageOffset?: string | number | null;
        error?: string;
      };

      if (!response.ok) {
        throw new Error(data.error ?? "Не удалось загрузить дополнительные записи");
      }

      const mapped = (data.points ?? []).map((point) => ({
        ...point,
        payload: point.payload ?? null,
        vector: point.vector ?? null,
      }));
      const newScores = buildScoreMap(mapped);

      setActiveSearch((previous) => {
        if (!previous || previous.mode !== "filter") {
          return previous;
        }

        const mergedScores = { ...previous.scores };
        Object.entries(newScores).forEach(([key, value]) => {
          mergedScores[key] = value;
        });

        return {
          ...previous,
          results: [...previous.results, ...mapped],
          scores: mergedScores,
          nextPageOffset: data.nextPageOffset ?? null,
        };
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setSearchError(message);
    } finally {
      setIsLoadingMoreSearchResults(false);
    }
  }, [collectionName, activeSearch, buildScoreMap]);

  const handleCopyPointId = async (event: MouseEvent<HTMLSpanElement>, id: string | number) => {
    event.stopPropagation();

    try {
      await navigator.clipboard.writeText(String(id));
      toast({
        title: "ID скопирован",
        description: "Идентификатор записи добавлен в буфер обмена.",
      });
    } catch (error) {
      toast({
        title: "Не удалось скопировать",
        description: "Скопируйте значение вручную и попробуйте ещё раз.",
        variant: "destructive",
      });
    }
  };

  const isSearchActive = Boolean(activeSearch);
  const listPoints = isSearchActive ? activeSearch?.results ?? [] : points;
  const listScores = isSearchActive ? activeSearch?.scores ?? {} : {};
  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <Button asChild variant="ghost" size="sm" className="gap-2 px-2">
            <Link href="/vector/collections">
              <ChevronLeft className="h-4 w-4" />
              Назад
            </Link>
          </Button>
          <h1 className="text-2xl font-semibold">
            {collectionLoading ? <Skeleton className="h-7 w-56" /> : collection?.name ?? collectionName}
          </h1>
          {collection?.status && (
            <span className="flex items-center gap-1 text-sm text-muted-foreground">
              <span
                aria-hidden
                className={cn(
                  "h-2.5 w-2.5 rounded-full",
                  statusIndicatorVariants[collection.status] ?? "bg-muted-foreground",
                )}
              />
              {statusLabels[collection.status] ?? collection.status}
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleRefresh} disabled={isRefreshing}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Обновить
          </Button>
          <Button variant="outline" size="sm" onClick={handleCopyCurl} disabled={!curlCommand}>
            <Copy className="mr-2 h-4 w-4" />
            {isCurlCopied ? "Скопировано" : "curl для поиска"}
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground">
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground/70">Записей</span>
          <span className="font-semibold text-foreground">
            {collectionLoading ? <Skeleton className="h-4 w-12" /> : formatNumber(collection?.pointsCount)}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground/70">Размер вектора</span>
          <span className="font-semibold text-foreground">
            {collectionLoading ? <Skeleton className="h-4 w-16" /> : formatNumber(collection?.vectorSize)}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground/70">Метрика</span>
          <span className="font-semibold text-foreground">
            {collectionLoading ? <Skeleton className="h-4 w-16" /> : collection?.distance ?? "—"}
          </span>
        </div>
      </div>

      {collectionError && (
        <Alert variant="destructive">
          <AlertTitle>Не удалось загрузить информацию</AlertTitle>
          <AlertDescription>{(collectionError as Error).message}</AlertDescription>
        </Alert>
      )}

      {pointsError && (
        <Alert variant="destructive">
          <AlertTitle>Не удалось загрузить записи</AlertTitle>
          <AlertDescription>{pointsError.message}</AlertDescription>
        </Alert>
      )}

      <div className="rounded-xl border border-border/70 bg-card/80 p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Search className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-lg font-semibold text-foreground">Поиск по коллекции</h2>
          </div>
          {isSearchActive && (
            <Button
              variant="ghost"
              size="sm"
              className="gap-1 text-muted-foreground"
              onClick={clearSearchResults}
            >
              <X className="h-4 w-4" />
              Сбросить
            </Button>
          )}
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          Векторизуйте запрос, применяйте фильтры по payload или вставляйте готовый вектор.
        </p>

        <div className="mt-4 space-y-4">
          <div className="flex w-full flex-col gap-3 md:flex-row md:items-start md:gap-4">
            <div className="flex w-full flex-col gap-2 md:w-[220px]">
              <span className="text-xs uppercase text-muted-foreground">Тип поиска</span>
              <Select
                value={searchMode}
                onValueChange={(value) => {
                  setSearchMode(value as SearchMode);
                  setSearchError(null);
                }}
              >
                <SelectTrigger className="h-9 w-full md:w-[220px]" aria-label="Тип поиска">
                  <SelectValue placeholder="Выберите режим" />
                </SelectTrigger>
                <SelectContent>
                  {searchModeOptions.map(({ value, label, icon: Icon }) => (
                    <SelectItem key={value} value={value}>
                      <div className="flex items-center gap-2">
                        <Icon className="h-4 w-4" />
                        {label}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {searchMode === "semantic" && (
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <Label htmlFor="collection-text-query" className="text-xs uppercase text-muted-foreground">
                  Запрос
                </Label>
                <div className="flex w-full flex-wrap items-center gap-2 md:flex-nowrap">
                  <div className="relative flex min-w-[240px] flex-1">
                    <Input
                      id="collection-text-query"
                      value={textQuery}
                      onChange={(event) => setTextQuery(event.target.value)}
                      onKeyDown={handleSemanticInputKeyDown}
                      placeholder="Например, инструкция по сервису"
                      className="h-9 flex-1 pr-10"
                    />
                    {searchLoading && (
                      <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
                    )}
                  </div>
                  <Popover open={isSettingsPopoverOpen} onOpenChange={setIsSettingsPopoverOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-9 w-9 shrink-0 text-muted-foreground"
                        aria-label="Открыть настройки поиска"
                      >
                        <Settings2 className="h-4 w-4" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent align="end" className="w-80 p-4">
                      <div className="space-y-4">
                        <div className="space-y-2">
                          <Label htmlFor="collection-text-limit" className="text-xs uppercase text-muted-foreground">
                            Top K
                          </Label>
                          <Input
                            id="collection-text-limit"
                            type="number"
                            min={1}
                            max={100}
                            value={textSearchLimit}
                            onChange={(event) => {
                              const next = clampTopK(Number.parseInt(event.target.value, 10));
                              setTextSearchLimit(next);
                            }}
                            className="h-9"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label className="text-xs uppercase text-muted-foreground">Эмбеддинги</Label>
                          {matchingProviders.length > 0 ? (
                            <Select
                              value={selectedProvider?.id ?? matchingProviders[0].id}
                              onValueChange={(value) => setSelectedProviderId(value)}
                            >
                              <SelectTrigger className="h-9 w-full">
                                <SelectValue placeholder="Выберите сервис" />
                              </SelectTrigger>
                              <SelectContent>
                                {matchingProviders.map((provider) => {
                                  const size = resolveProviderVectorSize(provider);
                                  return (
                                    <SelectItem key={provider.id} value={provider.id}>
                                      {provider.name}
                                      {size ? ` · ${size.toLocaleString("ru-RU")}` : ""}
                                    </SelectItem>
                                  );
                                })}
                              </SelectContent>
                            </Select>
                          ) : (
                            <div className="flex h-9 items-center rounded-md border border-dashed border-border/60 px-3 text-xs text-muted-foreground">
                              Нет подходящих сервисов
                            </div>
                          )}
                        </div>
                        <div className="space-y-2">
                          <span className="text-xs uppercase text-muted-foreground">Возвращать</span>
                          <div className="space-y-2 rounded-lg border border-border/60 p-3 text-sm text-foreground">
                            <div className="flex items-center justify-between gap-3">
                              <span>Payload</span>
                              <Switch
                                id="semantic-with-payload"
                                aria-label="Вернуть payload записей"
                                checked={textSearchWithPayload}
                                onCheckedChange={(checked) => setTextSearchWithPayload(Boolean(checked))}
                              />
                            </div>
                            <div className="flex items-center justify-between gap-3">
                              <span>Вектор</span>
                              <Switch
                                id="semantic-with-vector"
                                aria-label="Добавить вектор записей"
                                checked={textSearchWithVector}
                                onCheckedChange={(checked) => setTextSearchWithVector(Boolean(checked))}
                              />
                            </div>
                          </div>
                        </div>
                      </div>
                    </PopoverContent>
                  </Popover>
                </div>
                {semanticSettingsBadges.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2">
                    {semanticSettingsBadges.map((badge) => (
                      <Badge key={badge.key} variant="outline" className="h-6 px-2 text-[11px] uppercase">
                        {badge.label}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            )}

            {searchMode === "generative" && (
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <Label htmlFor="collection-generative-query" className="text-xs uppercase text-muted-foreground">
                  Запрос
                </Label>
                {searchLoading ? (
                  <GenerativeLoadingState />
                ) : (
                  <div className="flex flex-wrap items-center gap-2">
                    <Input
                      id="collection-generative-query"
                      value={textQuery}
                      onChange={(event) => setTextQuery(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          if (canSubmitGenerativeSearch) {
                            void handleGenerativeSearch();
                          }
                        }
                      }}
                      placeholder="Например, как работает тариф"
                      className="h-9 min-w-[220px] flex-1"
                      disabled={searchLoading}
                    />
                    <Popover open={isSettingsPopoverOpen} onOpenChange={setIsSettingsPopoverOpen}>
                      <PopoverTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-9 w-9 shrink-0 text-muted-foreground"
                          aria-label="Открыть настройки поиска"
                          disabled={searchLoading}
                        >
                          <Settings2 className="h-4 w-4" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent align="end" className="w-80 p-4">
                        <div className="space-y-4">
                          <div className="space-y-2">
                            <Label htmlFor="collection-generative-limit" className="text-xs uppercase text-muted-foreground">
                              Top K
                            </Label>
                            <Input
                              id="collection-generative-limit"
                              type="number"
                              min={1}
                              max={100}
                              value={generativeLimit}
                              onChange={(event) => {
                                const next = clampTopK(Number.parseInt(event.target.value, 10));
                                setGenerativeLimit(next);
                                setLlmContextLimit((previous) => Math.min(previous, next));
                              }}
                              className="h-9"
                            />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="collection-generative-context" className="text-xs uppercase text-muted-foreground">
                              Контекст
                            </Label>
                            <Input
                              id="collection-generative-context"
                              type="number"
                              min={1}
                              max={generativeLimit}
                              value={llmContextLimit}
                              onChange={(event) => {
                                const next = clampTopK(Number.parseInt(event.target.value, 10));
                                setLlmContextLimit(Math.min(next, generativeLimit));
                              }}
                              className="h-9"
                            />
                          </div>
                          <div className="space-y-2">
                            <Label className="text-xs uppercase text-muted-foreground">Эмбеддинги</Label>
                            {matchingProviders.length > 0 ? (
                              <Select
                                value={selectedProvider?.id ?? matchingProviders[0].id}
                                onValueChange={(value) => setSelectedProviderId(value)}
                              >
                                <SelectTrigger className="h-9 w-full">
                                  <SelectValue placeholder="Выберите сервис" />
                                </SelectTrigger>
                                <SelectContent>
                                  {matchingProviders.map((provider) => {
                                    const size = resolveProviderVectorSize(provider);
                                    return (
                                      <SelectItem key={provider.id} value={provider.id}>
                                        {provider.name}
                                        {size ? ` · ${size.toLocaleString("ru-RU")}` : ""}
                                      </SelectItem>
                                    );
                                  })}
                                </SelectContent>
                              </Select>
                            ) : (
                              <div className="flex h-9 items-center rounded-md border border-dashed border-border/60 px-3 text-xs text-muted-foreground">
                                Нет подходящих сервисов
                              </div>
                            )}
                          </div>
                          <div className="space-y-2">
                            <Label className="text-xs uppercase text-muted-foreground">LLM</Label>
                            {llmModelOptions.length > 0 ? (
                              <Select
                                value={selectedLlmOption?.key ?? llmModelOptions[0].key}
                                onValueChange={(value) => setSelectedLlmModelKey(value)}
                              >
                                <SelectTrigger className="h-9 w-full">
                                  <SelectValue placeholder="Выберите модель" />
                                </SelectTrigger>
                                <SelectContent>
                                  {llmModelGroups.map(({ provider, models }) => (
                                    <SelectGroup key={provider.id}>
                                      <SelectLabel>{provider.name}</SelectLabel>
                                      {models.map((model) => {
                                        const optionKey = `${provider.id}::${model.value}`;
                                        return (
                                          <SelectItem key={optionKey} value={optionKey}>
                                            {model.label}
                                          </SelectItem>
                                        );
                                      })}
                                    </SelectGroup>
                                  ))}
                                </SelectContent>
                              </Select>
                            ) : (
                              <div className="flex h-9 items-center rounded-md border border-dashed border-border/60 px-3 text-xs text-muted-foreground">
                                Нет активных LLM
                              </div>
                            )}
                          </div>
                        </div>
                      </PopoverContent>
                    </Popover>
                  </div>
                )}
              </div>
            )}
          </div>

          {searchMode === "filter" && (
            <div className="space-y-2.5">
              <div className="flex flex-wrap items-center gap-2 text-xs uppercase text-muted-foreground">
                <span className="font-medium text-foreground">Связка</span>
                <Button
                  type="button"
                  size="sm"
                  variant={filterCombineMode === "and" ? "secondary" : "outline"}
                  onClick={() => setFilterCombineMode("and")}
                  className="h-7"
                >
                  AND
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={filterCombineMode === "or" ? "secondary" : "outline"}
                  onClick={() => setFilterCombineMode("or")}
                  className="h-7"
                >
                  OR
                </Button>
              </div>
              <div className="space-y-2">
                {filterConditions.map((condition) => (
                  <div
                    key={condition.id}
                    className="grid w-full gap-2.5 rounded-lg border border-border/50 bg-muted/5 p-2.5 md:grid-cols-[minmax(150px,0.8fr)_minmax(120px,0.6fr)_minmax(160px,1fr)_auto]"
                  >
                    <div className="flex flex-col gap-1">
                      <Label className="text-xs uppercase text-muted-foreground">Поле</Label>
                      <Input
                        list="collection-search-fields"
                        value={condition.field}
                        onChange={(event) => updateFilterCondition(condition.id, { field: event.target.value })}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            void handleFilterSearch();
                          }
                        }}
                        placeholder="payload.category"
                        className="h-9"
                      />
                    </div>
                    <div className="flex flex-col gap-1 md:w-[140px]">
                      <Label className="text-xs uppercase text-muted-foreground">Оператор</Label>
                      <Select
                        value={condition.operator}
                        onValueChange={(value) => updateFilterCondition(condition.id, { operator: value as FilterOperator })}
                      >
                        <SelectTrigger className="h-9">
                          <SelectValue>
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-foreground">{filterOperatorSymbols[condition.operator]}</span>
                              <span className="text-xs text-muted-foreground">
                                {filterOperatorOptions.find((option) => option.value === condition.operator)?.label}
                              </span>
                            </div>
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          {filterOperatorOptions.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex flex-col gap-1">
                      <Label className="text-xs uppercase text-muted-foreground">Значение</Label>
                      <Input
                        value={condition.value}
                        onChange={(event) => updateFilterCondition(condition.id, { value: event.target.value })}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            void handleFilterSearch();
                          }
                        }}
                        placeholder="Введите значение"
                        className="h-9"
                      />
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 self-center text-muted-foreground hover:text-destructive"
                      onClick={() => removeFilterCondition(condition.id)}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
                <Button type="button" variant="outline" size="sm" className="gap-2" onClick={addFilterCondition}>
                  <Plus className="h-4 w-4" />
                  Добавить условие
                </Button>
              </div>
              <datalist id="collection-search-fields">
                {availableFields.map((field) => (
                  <option key={field} value={field} />
                ))}
              </datalist>
              <div className="flex flex-wrap items-end gap-2.5 md:gap-3">
                <div className="flex items-center gap-3 rounded-md border border-border/50 bg-muted/5 px-3 py-2 text-xs uppercase text-muted-foreground">
                  <div className="flex items-center gap-1.5">
                    <Switch
                      id="filter-with-payload"
                      aria-label="Вернуть payload записей"
                      checked={filterWithPayload}
                      onCheckedChange={(checked) => setFilterWithPayload(Boolean(checked))}
                    />
                    <span>Payload</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Switch
                      id="filter-with-vector"
                      aria-label="Добавить вектор записей"
                      checked={filterWithVector}
                      onCheckedChange={(checked) => setFilterWithVector(Boolean(checked))}
                    />
                    <span>Вектор</span>
                  </div>
                </div>
                <div className="flex w-24 flex-col gap-1">
                  <Label htmlFor="filter-limit" className="text-xs uppercase text-muted-foreground">
                    Ограничение
                  </Label>
                  <Input
                    id="filter-limit"
                    type="number"
                    min={1}
                    max={100}
                    value={filterLimit}
                    onChange={(event) => {
                      const next = Number.parseInt(event.target.value, 10);
                      setFilterLimit(Number.isNaN(next) ? 1 : Math.min(100, Math.max(1, next)));
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        void handleFilterSearch();
                      }
                    }}
                    className="h-9"
                  />
                </div>
                <Button type="button" className="h-9" onClick={handleFilterSearch} disabled={searchLoading}>
                  {searchLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Применить фильтр
                </Button>
              </div>
            </div>
          )}

          {searchMode === "vector" && (
            <div className="space-y-3">
              <div className="flex flex-col gap-1">
                <Label htmlFor="vector-search-input" className="text-xs uppercase text-muted-foreground">
                  Вектор запроса
                </Label>
                <Textarea
                  id="vector-search-input"
                  value={vectorInput}
                  onChange={(event) => setVectorInput(event.target.value)}
                  placeholder="0.12 0.34 0.56"
                  rows={3}
                />
              </div>
              <div className="flex flex-wrap items-end gap-3">
                <div className="flex w-24 flex-col gap-1">
                  <Label htmlFor="vector-limit" className="text-xs uppercase text-muted-foreground">
                    Top K
                  </Label>
                  <Input
                    id="vector-limit"
                    type="number"
                    min={1}
                    max={100}
                    value={vectorLimit}
                    onChange={(event) => {
                      const next = Number.parseInt(event.target.value, 10);
                      setVectorLimit(Number.isNaN(next) ? 1 : Math.min(100, Math.max(1, next)));
                    }}
                    className="h-9"
                  />
                </div>
                <div className="flex w-32 flex-col gap-1">
                  <Label htmlFor="vector-threshold" className="text-xs uppercase text-muted-foreground">
                    Порог (опционально)
                  </Label>
                  <Input
                    id="vector-threshold"
                    type="number"
                    value={vectorScoreThreshold}
                    onChange={(event) => setVectorScoreThreshold(event.target.value)}
                    placeholder="Например, 0.4"
                    className="h-9"
                  />
                </div>
                <div className="flex items-center gap-3 rounded-md border border-border/60 px-3 py-2 text-xs uppercase text-muted-foreground">
                  <div className="flex items-center gap-2">
                    <Switch
                      id="vector-with-payload"
                      aria-label="Вернуть payload записей"
                      checked={vectorWithPayload}
                      onCheckedChange={(checked) => setVectorWithPayload(Boolean(checked))}
                    />
                    <span>Payload</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch
                      id="vector-with-vector"
                      aria-label="Добавить вектор записей"
                      checked={vectorWithVector}
                      onCheckedChange={(checked) => setVectorWithVector(Boolean(checked))}
                    />
                    <span>Вектор</span>
                  </div>
                </div>
                <Button type="button" className="h-9" onClick={handleVectorSearch} disabled={searchLoading}>
                  {searchLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Выполнить поиск
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                {collectionVectorSizeValue
                  ? `Ожидается ${collectionVectorSizeValue.toLocaleString("ru-RU")} значений вектора.`
                  : "Количество значений должно совпадать с размерностью коллекции."}
              </p>
            </div>
          )}
        </div>


        {isSearchActive && activeSearch && (
          <div className="mt-4 rounded-lg border border-border/60 bg-muted/20 p-3 text-sm text-muted-foreground">
            <div className="flex flex-wrap items-center gap-2 text-foreground">
              <Badge variant="outline">
                {activeSearch.mode === "semantic"
                  ? "Векторный поиск"
                  : activeSearch.mode === "generative"
                    ? "Генеративный ответ"
                    : activeSearch.mode === "filter"
                      ? "Фильтры"
                      : "Ручной вектор"}
              </Badge>
              <span>{activeSearch.description}</span>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              {activeSearch.providerName && (
                <Badge variant="secondary" className="bg-primary/10 text-primary">
                  Сервис: {activeSearch.providerName}
                </Badge>
              )}
              {activeSearch.llmProviderName && (
                <Badge variant="secondary" className="bg-primary/10 text-primary">
                  LLM: {activeSearch.llmProviderName}
                </Badge>
              )}
              {typeof activeSearch.vectorLength === "number" && (
                <Badge variant="secondary" className="bg-muted text-foreground">
                  Длина вектора: {activeSearch.vectorLength.toLocaleString("ru-RU")}
                </Badge>
              )}
              {activeSearch.queryVectorPreview && <span>Превью: {activeSearch.queryVectorPreview}</span>}
              {typeof activeSearch.usageTokens === "number" && (
                <Badge variant="outline">Токены: {activeSearch.usageTokens.toLocaleString("ru-RU")}</Badge>
              )}
              {typeof activeSearch.llmUsageTokens === "number" && (
                <Badge variant="outline">LLM токены: {activeSearch.llmUsageTokens.toLocaleString("ru-RU")}</Badge>
              )}
              {activeSearch.mode === "generative" && (
                <Badge variant="secondary" className="bg-muted text-foreground">
                  Контекст: {activeSearch.results.length.toLocaleString("ru-RU")} из{" "}
                  {(activeSearch.contextLimit ?? activeSearch.limit).toLocaleString("ru-RU")}
                </Badge>
              )}
            </div>
          </div>
        )}
      </div>

      {isSearchActive && activeSearch?.mode === "generative" && (
        <div className="rounded-lg border border-border/70 bg-muted/30 p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Sparkles className="h-4 w-4 text-primary" /> <span>Ответ LLM</span>
            {searchLoading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          </div>
          <div className="mt-2 min-h-[1.5rem] whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground">
            {hasGenerativeAnswerContent ? (
              <span className="inline-flex items-center gap-1">
                <span>{animatedGenerativeAnswer}</span>
                {isGenerativeTyping && (
                  <span
                    aria-hidden="true"
                    className="h-4 w-[2px] animate-pulse bg-primary/80"
                  />
                )}
              </span>
            ) : searchLoading ? (
              "Модель формирует ответ..."
            ) : (
              "Ответ отсутствует."
            )}
          </div>
        </div>
      )}

      {searchError && (
        <Alert variant="destructive">
          <AlertTitle>Ошибка поиска</AlertTitle>
          <AlertDescription>{searchError}</AlertDescription>
        </Alert>
      )}

      <div className="rounded-xl border border-border/70 bg-card/60">
        {isSearchActive ? (
          listPoints.length === 0 ? (
            <div className="p-6 text-sm text-muted-foreground">
              {searchLoading ? "Выполняем поиск..." : "По запросу ничего не найдено."}
            </div>
          ) : (
            <div className="divide-y divide-border/60">
              {listPoints.map((point) => {
                const entries = getPointEntries(point);
                const isSelected = selectedPoint?.id === point.id;
                const pointScore = listScores[String(point.id)];

                return (
                  <div
                    key={String(point.id)}
                    role="button"
                    tabIndex={0}
                    onClick={() => setSelectedPoint(point)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setSelectedPoint(point);
                      }
                    }}
                    className={cn(
                      "flex flex-col gap-3 p-4 transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                      isSelected && "bg-muted/50",
                    )}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <span
                        className="flex cursor-pointer items-center gap-2 font-mono text-sm text-foreground"
                        onClick={(event) => void handleCopyPointId(event, point.id)}
                      >
                        {point.id}
                        <Copy className="h-3.5 w-3.5 text-muted-foreground" />
                      </span>
                      <div className="flex items-center gap-2">
                        {typeof pointScore === "number" && (
                          <Badge variant="outline" className="font-mono text-xs">
                            score: {pointScore.toFixed(4)}
                          </Badge>
                        )}
                        <span className="text-xs text-muted-foreground">Результат поиска</span>
                      </div>
                    </div>

                    {entries.length > 0 ? (
                      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-sm">
                        {entries.map((entry, index) => (
                          <Fragment key={`${entry.key}-${index}`}>
                            <dt className="truncate text-xs uppercase text-muted-foreground">{entry.key}</dt>
                            <dd className="break-all font-mono text-[13px] text-foreground">{entry.value}</dd>
                          </Fragment>
                        ))}
                      </dl>
                    ) : (
                      <p className="text-sm text-muted-foreground">Нет данных для отображения.</p>
                    )}
                  </div>
                );
              })}
              {activeSearch?.mode === "filter" && activeSearch.nextPageOffset ? (
                <div className="flex justify-center p-4">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleLoadMoreSearchResults}
                    disabled={isLoadingMoreSearchResults}
                    className="gap-2"
                  >
                    {isLoadingMoreSearchResults && <Loader2 className="h-4 w-4 animate-spin" />}
                    Загрузить ещё
                  </Button>
                </div>
              ) : null}
            </div>
          )
        ) : pointsLoading && !points.length ? (
          <div className="p-6 text-sm text-muted-foreground">Загрузка записей...</div>
        ) : points.length === 0 ? (
          <div className="p-6 text-sm text-muted-foreground">В коллекции пока нет записей.</div>
        ) : (
          <div className="divide-y divide-border/60">
            {listPoints.map((point) => {
              const entries = getPointEntries(point);
              const isSelected = selectedPoint?.id === point.id;

              return (
                <div
                  key={String(point.id)}
                  role="button"
                  tabIndex={0}
                  onClick={() => setSelectedPoint(point)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      setSelectedPoint(point);
                    }
                  }}
                  className={cn(
                    "flex flex-col gap-3 p-4 transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                    isSelected && "bg-muted/50",
                  )}
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <span
                      className="flex cursor-pointer items-center gap-2 font-mono text-sm text-foreground"
                      onClick={(event) => void handleCopyPointId(event, point.id)}
                    >
                      {point.id}
                      <Copy className="h-3.5 w-3.5 text-muted-foreground" />
                    </span>
                    <span className="text-xs text-muted-foreground">Открыть полную запись</span>
                  </div>

                  {entries.length > 0 ? (
                    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-sm">
                      {entries.map((entry, index) => (
                        <Fragment key={`${entry.key}-${index}`}>
                          <dt className="truncate text-xs uppercase text-muted-foreground">{entry.key}</dt>
                          <dd className="break-all font-mono text-[13px] text-foreground">{entry.value}</dd>
                        </Fragment>
                      ))}
                    </dl>
                  ) : (
                    <p className="text-sm text-muted-foreground">Нет данных для отображения.</p>
                  )}
                </div>
              );
            })}
            <div ref={loadMoreRef} className="h-6" />
            {isFetchingNextPage && (
              <div className="p-4 text-sm text-muted-foreground">Загрузка дополнительных записей…</div>
            )}
          </div>
        )}
      </div>

      <Sheet
        open={Boolean(selectedPoint)}
        onOpenChange={(open) => {
          if (!open) {
            closePointPreview();
          }
        }}
      >
        <SheetContent
          side="right"
          size={isPointPreviewFullScreen ? "fullscreen" : "xl"}
          className="flex h-full flex-col gap-4"
        >
          <SheetHeader className="space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-1">
                <SheetTitle>Запись коллекции</SheetTitle>
                <SheetDescription>Полный JSON записи без поля вектора.</SheetDescription>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="gap-2"
                onClick={() => setIsPointPreviewFullScreen((prev) => !prev)}
              >
                {isPointPreviewFullScreen ? (
                  <>
                    <Minimize2 className="h-4 w-4" />
                    Свернуть
                  </>
                ) : (
                  <>
                    <Maximize2 className="h-4 w-4" />
                    На весь экран
                  </>
                )}
              </Button>
            </div>
          </SheetHeader>

          {selectedPoint && (
            <div className="flex flex-1 flex-col gap-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm text-muted-foreground">
                  ID: <span className="font-mono text-foreground">{selectedPoint.id}</span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleDownloadJson}
                    disabled={!selectedPointDownloadJson}
                  >
                    <Download className="mr-2 h-4 w-4" />
                    Скачать TXT
                  </Button>
                  <Button variant="outline" size="sm" onClick={handleCopyJson} disabled={!selectedPointJson}>
                    {isJsonCopied ? <Check className="mr-2 h-4 w-4" /> : <Copy className="mr-2 h-4 w-4" />}
                    {isJsonCopied ? "Скопировано" : "Скопировать JSON"}
                  </Button>
                </div>
              </div>

              <ScrollArea
                className={cn(
                  "rounded-lg border border-border/60 bg-muted/30 p-4",
                  isPointPreviewFullScreen ? "h-[calc(100vh-220px)]" : "h-[70vh]",
                )}
              >
                {selectedPointJson ? (
                  <pre className="text-sm leading-relaxed text-foreground">
                    {selectedPointJson}
                  </pre>
                ) : (
                  <p className="text-sm text-muted-foreground">Не удалось подготовить JSON запись.</p>
                )}
              </ScrollArea>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
