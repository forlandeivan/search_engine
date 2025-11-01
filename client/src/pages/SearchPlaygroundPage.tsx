import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Settings, Search as SearchIcon, RefreshCcw, HelpCircle } from "lucide-react";
import { apiRequest, getQueryFn } from "@/lib/queryClient";
import SearchQuickSwitcher, {
  buildSuggestGroups,
  type SuggestResultGroup,
} from "@/components/search/SearchQuickSwitcher";
import DOMPurify from "dompurify";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { KnowledgeBaseSummary } from "@shared/knowledge-base";
import type { PublicEmbeddingProvider, PublicLlmProvider, LlmModelOption, Site } from "@shared/schema";
import type {
  RagChunk,
  RagResponsePayload,
  SuggestResponsePayload,
  SuggestResponseItem,
} from "@/types/search";
import { useSuggestSearch } from "@/hooks/useSuggestSearch";
import type { SessionResponse } from "@/types/session";

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const maskApiKey = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  if (trimmed.length <= 6) {
    return `${trimmed.slice(0, 2)}***${trimmed.slice(-2)}`;
  }

  return `${trimmed.slice(0, 4)}***${trimmed.slice(-4)}`;
};

const ASK_AI_ALLOWED_TAGS = [
  "p",
  "br",
  "strong",
  "em",
  "a",
  "ul",
  "ol",
  "li",
  "code",
  "pre",
  "h1",
  "h2",
  "h3",
  "h4",
];

const ASK_AI_ALLOWED_ATTR = ["href", "title", "target", "rel"];

type AskAiHtmlToken = { type: "tag" | "text"; value: string };

const tokenizeAskAiHtml = (html: string): AskAiHtmlToken[] => {
  if (!html) {
    return [];
  }

  const tokens: AskAiHtmlToken[] = [];
  const regex = /(<[^>]+>|[^<]+)/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(html)) !== null) {
    const value = match[0];
    if (!value) {
      continue;
    }

    tokens.push({ type: value.startsWith("<") ? "tag" : "text", value });
  }

  return tokens;
};

const sanitizeAskAiHtml = (html: string): string => {
  if (!html) {
    return "";
  }

  if (typeof window === "undefined") {
    return html;
  }

  const sanitized = DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ASK_AI_ALLOWED_TAGS,
    ALLOWED_ATTR: ASK_AI_ALLOWED_ATTR,
    KEEP_CONTENT: true,
    RETURN_TRUSTED_TYPE: false,
  });

  if (!sanitized) {
    return "";
  }

  if (typeof window.DOMParser === "undefined") {
    return sanitized;
  }

  try {
    const parser = new DOMParser();
    const documentWrapper = parser.parseFromString(`<div>${sanitized}</div>`, "text/html");

    documentWrapper.querySelectorAll("a").forEach((anchor) => {
      anchor.setAttribute("target", "_blank");
      anchor.setAttribute("rel", "noopener noreferrer");
    });

    return documentWrapper.body.innerHTML;
  } catch {
    return sanitized;
  }
};

interface PublicRagContextEntry {
  id?: string | number | null;
  score?: number | null;
  payload?: unknown;
  shard_key?: string | null;
  order_value?: number | null;
}

interface PublicRagResponse {
  answer?: string | null;
  format?: string | null;
  usage?: { embeddingTokens?: number | null; llmTokens?: number | null } | null;
  provider?: { id?: string; name?: string; model?: string; modelLabel?: string | null } | null;
  embeddingProvider?: { id?: string; name?: string } | null;
  collection?: string | null;
  context?: PublicRagContextEntry[] | null;
  queryVector?: number[] | null;
  vectorLength?: number | null;
}

interface RagRequestPayload {
  query: string;
  workspace_id: string;
  collection: string;
  embeddingProviderId: string;
  llmProviderId: string;
  llmModel?: string;
  limit: number;
  contextLimit?: number;
  responseFormat?: PlaygroundSettings["rag"]["responseFormat"];
  includeContext?: boolean;
  includeQueryVector?: boolean;
  withPayload?: boolean;
  withVector?: boolean;
  sitePublicId?: string;
}

interface RagRequestState {
  id: number;
  payload: RagRequestPayload;
  startedAt: number;
  apiKey: string;
  query: string;
  siteName: string;
  sitePublicId?: string;
  workspaceId: string;
}

type RagStreamAbortHandle = {
  abort: () => void;
};

const buildChunkFromContext = (entry: PublicRagContextEntry, index: number): RagChunk => {
  const payload = isRecord(entry.payload) ? entry.payload : {};
  const chunkPayload = isRecord((payload as Record<string, unknown>).chunk)
    ? ((payload as { chunk: Record<string, unknown> }).chunk ?? {})
    : {};
  const documentPayload = isRecord((payload as Record<string, unknown>).document)
    ? ((payload as { document: Record<string, unknown> }).document ?? {})
    : {};
  const scorePayload = isRecord((payload as Record<string, unknown>).scores)
    ? ((payload as { scores: Record<string, unknown> }).scores ?? {})
    : {};

  const chunkIdCandidate = chunkPayload.id;
  const entryId = entry.id;
  const chunkId =
    typeof chunkIdCandidate === "string" && chunkIdCandidate.trim().length > 0
      ? chunkIdCandidate.trim()
      : typeof entryId === "string" && entryId.trim().length > 0
        ? entryId.trim()
        : `context-${index + 1}`;

  const docIdCandidate = documentPayload.id;
  const docId = typeof docIdCandidate === "string" ? docIdCandidate : "";
  const docTitleCandidate = documentPayload.title;
  const docTitle =
    typeof docTitleCandidate === "string" && docTitleCandidate.trim().length > 0
      ? docTitleCandidate.trim()
      : "Документ";

  const sectionTitleCandidate = chunkPayload.sectionTitle ?? chunkPayload.section_title;
  const sectionTitle =
    typeof sectionTitleCandidate === "string" && sectionTitleCandidate.trim().length > 0
      ? sectionTitleCandidate.trim()
      : null;

  const chunkTextCandidate = chunkPayload.text;
  const chunkText = typeof chunkTextCandidate === "string" ? chunkTextCandidate : undefined;
  const snippetCandidate = chunkPayload.snippet ?? chunkPayload.excerpt ?? chunkTextCandidate;
  const snippet =
    typeof snippetCandidate === "string" && snippetCandidate.trim().length > 0
      ? snippetCandidate
      : chunkText ?? "";

  const bm25ScoreCandidate = scorePayload.bm25;
  const vectorScoreCandidate = scorePayload.vector;

  const entryScore = typeof entry.score === "number" ? entry.score : null;
  const vectorScore =
    typeof entryScore === "number"
      ? entryScore
      : typeof vectorScoreCandidate === "number"
        ? vectorScoreCandidate
        : null;

  return {
    chunk_id: chunkId,
    doc_id: docId,
    doc_title: docTitle,
    section_title: sectionTitle,
    snippet,
    text: chunkText,
    score: typeof vectorScore === "number" ? vectorScore : 0,
    scores: {
      bm25: typeof bm25ScoreCandidate === "number" ? bm25ScoreCandidate : undefined,
      vector: typeof vectorScore === "number" ? vectorScore : undefined,
    },
  };
};

const normalizePublicRagResponse = (
  response: PublicRagResponse,
  params: { query: string },
): RagResponsePayload => {
  const contextEntries = Array.isArray(response.context) ? response.context : [];
  const citations = contextEntries.map((entry, index) => buildChunkFromContext(entry, index));

  const vectorSearchDetails = contextEntries.map((entry) => {
    return {
      id: entry.id ?? null,
      score: typeof entry.score === "number" ? entry.score : null,
      payload: isRecord(entry.payload) ? entry.payload : entry.payload ?? null,
    } satisfies Record<string, unknown>;
  });

  const normalizedAnswer =
    typeof response.answer === "string" && response.answer.trim().length > 0
      ? response.answer
      : "";

  const formatCandidate = typeof response.format === "string" ? response.format.trim() : "";
  const normalizedFormat =
    formatCandidate === "markdown"
      ? "markdown"
      : formatCandidate === "md"
        ? "markdown"
        : formatCandidate === "html"
          ? "html"
          : formatCandidate === "text"
            ? "text"
            : undefined;

  return {
    answer: normalizedAnswer,
    format: normalizedFormat,
    query: params.query,
    normalized_query: params.query,
    citations,
    chunks: citations,
    context: contextEntries.map((entry) => ({
      id: entry.id ?? null,
      score: typeof entry.score === "number" ? entry.score : null,
      payload: isRecord(entry.payload) ? entry.payload : null,
      shard_key: typeof entry.shard_key === "string" ? entry.shard_key : null,
      order_value: typeof entry.order_value === "number" ? entry.order_value : null,
    })),
    usage: response.usage ?? undefined,
    provider: response.provider ?? undefined,
    embeddingProvider: response.embeddingProvider ?? undefined,
    collection: typeof response.collection === "string" ? response.collection : undefined,
    queryVector: Array.isArray(response.queryVector) ? response.queryVector : undefined,
    vectorLength:
      typeof response.vectorLength === "number" ? response.vectorLength : undefined,
    debug: {
      vectorSearch: vectorSearchDetails,
    },
  };
};

type AskAiLogKind = "info" | "request" | "response" | "error";

interface AskAiLogEntry {
  id: string;
  requestId: number;
  timestamp: number;
  kind: AskAiLogKind;
  title: string;
  description?: string;
  data?: unknown;
}

interface VectorCollectionSummary {
  name: string;
}

interface VectorCollectionsResponse {
  collections: VectorCollectionSummary[];
}

type PlaygroundSettings = {
  knowledgeBaseId: string;
  siteId: string;
  suggestLimit: number;
  rag: {
    askAiEnabled: boolean;
    topK: number;
    bm25Weight: number;
    vectorWeight: number;
    bm25Limit: number;
    vectorLimit: number;
    embeddingProviderId: string;
    collection: string;
    llmProviderId: string;
    llmModel: string;
    temperature: number;
    maxTokens: number;
    systemPrompt: string;
    responseFormat: "text" | "markdown" | "html";
    includeDebug: boolean;
  };
};

const formatMs = (value?: number) => {
  if (value === undefined || Number.isNaN(value)) {
    return "—";
  }

  return `${value.toFixed(1)} мс`;
};

const stringifyJson = (value: unknown) => {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

const formatLogTime = (value: number) => {
  try {
    return new Date(value).toLocaleTimeString("ru-RU", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return "—";
  }
};

const formatDuration = (value: number) => {
  if (!Number.isFinite(value)) {
    return "—";
  }

  return `${Math.max(0, Math.round(value))} мс`;
};

const ASK_AI_LOG_KIND_LABEL: Record<AskAiLogKind, string> = {
  info: "инфо",
  request: "запрос",
  response: "ответ",
  error: "ошибка",
};

const ASK_AI_LOG_KIND_STYLES: Record<AskAiLogKind, string> = {
  info: "bg-sky-500/15 text-sky-600 dark:text-sky-400",
  request: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  response: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  error: "bg-destructive/15 text-destructive",
};

const extractErrorMessage = async (response: Response): Promise<string | null> => {
  try {
    const json = await response.clone().json();
    if (json && typeof json === "object") {
      const candidate = json as { error?: unknown; message?: unknown };
      if (typeof candidate.error === "string" && candidate.error.trim()) {
        return candidate.error.trim();
      }
      if (typeof candidate.message === "string" && candidate.message.trim()) {
        return candidate.message.trim();
      }
    }
  } catch {
    // Игнорируем: тело может быть не JSON.
  }

  try {
    const text = await response.clone().text();
    const trimmed = text.trim();
    if (trimmed) {
      return trimmed;
    }
  } catch {
    // Игнорируем: тело может быть уже прочитано.
  }

  return null;
};

const EMPTY_SELECT_VALUE = "__empty__";
const PLAYGROUND_SETTINGS_STORAGE_KEY = "search-playground-settings";

const RAG_STATUS_MESSAGES = ["Думаю…", "Ищу источники…", "Формулирую ответ…"] as const;

const DEFAULT_SETTINGS: PlaygroundSettings = {
  knowledgeBaseId: "",
  siteId: "",
  suggestLimit: 3,
  rag: {
    askAiEnabled: true,
    topK: 5,
    bm25Weight: 0.5,
    vectorWeight: 0.5,
    bm25Limit: 4,
    vectorLimit: 5,
    embeddingProviderId: "",
    collection: "",
    llmProviderId: "",
    llmModel: "",
    temperature: 0.2,
    maxTokens: 1024,
    systemPrompt: "",
    responseFormat: "markdown",
    includeDebug: false,
  },
};

interface SettingLabelProps {
  htmlFor?: string;
  label: string;
  description: string;
}

function SettingLabelWithTooltip({ htmlFor, label, description }: SettingLabelProps) {
  return (
    <div className="flex items-start justify-between gap-2">
      <Label htmlFor={htmlFor} className="text-sm font-medium text-foreground">
        {label}
      </Label>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-border bg-background text-muted-foreground transition-colors hover:text-foreground"
            aria-label={`Описание параметра: ${label}`}
          >
            <HelpCircle className="h-3.5 w-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs text-xs leading-relaxed text-foreground">
          {description}
        </TooltipContent>
      </Tooltip>
    </div>
  );
}

export default function SearchPlaygroundPage() {
  const [settings, setSettings] = useState<PlaygroundSettings>(DEFAULT_SETTINGS);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<"search" | "rag">("search");
  const [query, setQuery] = useState("");
  const [suggestResponse, setSuggestResponse] = useState<SuggestResponsePayload | null>(null);
  const [ragResponse, setRagResponse] = useState<RagResponsePayload | null>(null);
  const [ragError, setRagError] = useState<string | null>(null);
  const [isRagLoading, setIsRagLoading] = useState(false);
  const [, setStreamedAnswer] = useState("");
  const [streamedAnswerHtml, setStreamedAnswerHtml] = useState("");
  const [displayedAnswerHtml, setDisplayedAnswerHtml] = useState("");
  const ragRequestCounter = useRef(0);
  const [ragRequest, setRagRequest] = useState<RagRequestState | null>(null);
  const [ragStreamingState, setRagStreamingState] = useState<{
    requestId: number | null;
    question: string;
    answer: string;
    stage: "idle" | "connecting" | "retrieving" | "answering" | "done" | "error";
    statusMessage: string | null;
    statusIndex: number;
    showIndicator: boolean;
    error: string | null;
  }>({
    requestId: null,
    question: "",
    answer: "",
    stage: "idle",
    statusMessage: null,
    statusIndex: 0,
    showIndicator: false,
    error: null,
  });
  const [ragStreamingContext, setRagStreamingContext] = useState<PublicRagContextEntry[]>([]);
  const [ragStreamingChunks, setRagStreamingChunks] = useState<RagChunk[]>([]);
  const ragStreamAbortControllerRef = useRef<RagStreamAbortHandle | null>(null);
  const ragCurrentRequestIdRef = useRef<number | null>(null);
  const ragStatusTimerRef = useRef<NodeJS.Timeout | null>(null);
  const ragStreamingContextRef = useRef<PublicRagContextEntry[]>([]);
  const askAiTypingStateRef = useRef<{
    tokens: AskAiHtmlToken[];
    tokenIndex: number;
    charIndex: number;
    completedHtml: string;
    partialHtml: string;
    timer: ReturnType<typeof setTimeout> | null;
  }>({
    tokens: [],
    tokenIndex: 0,
    charIndex: 0,
    completedHtml: "",
    partialHtml: "",
    timer: null,
  });
  const [askAiLogEntries, setAskAiLogEntries] = useState<AskAiLogEntry[]>([]);
  const [isAskAiLogOpen, setIsAskAiLogOpen] = useState(false);
  const askAiLogContainerRef = useRef<HTMLDivElement | null>(null);
  const askAiLogCounterRef = useRef(0);

  const appendAskAiLog = useCallback((entry: Omit<AskAiLogEntry, "id">) => {
    askAiLogCounterRef.current += 1;
    const id = `${Date.now()}-${askAiLogCounterRef.current}`;
    setAskAiLogEntries((prev) => [...prev, { ...entry, id }]);
  }, []);

  const clearAskAiLog = useCallback(() => {
    setAskAiLogEntries([]);
  }, []);

  const { 
    status: suggestStatus,
    data: suggestData,
    error: suggestError,
    search: runSuggest,
    prefetch: prefetchSuggest,
    reset: resetSuggest,
  } = useSuggestSearch({
    knowledgeBaseId: settings.knowledgeBaseId,
    limit: settings.suggestLimit,
  });
  const isSuggestLoading = suggestStatus === "loading";

  const suggestGroups = useMemo<SuggestResultGroup[]>(
    () => buildSuggestGroups(suggestResponse),
    [suggestResponse],
  );
  const flattenedSuggestItems = useMemo(
    () =>
      suggestGroups.flatMap((group) =>
        group.items.map((item) => ({ group, item })),
      ),
    [suggestGroups],
  );

  const sessionQuery = useQuery<SessionResponse | null>({
    queryKey: ["/api/auth/session"],
    queryFn: getQueryFn<SessionResponse>({ on401: "returnNull" }),
  });

  const knowledgeBasesQuery = useQuery<KnowledgeBaseSummary[]>({
    queryKey: ["/api/knowledge/bases"],
    queryFn: async () => {
      const response = await apiRequest("GET", "/api/knowledge/bases");
      return (await response.json()) as KnowledgeBaseSummary[];
    },
  });

  const sitesQuery = useQuery<Site[]>({
    queryKey: ["/api/sites"],
    queryFn: async () => {
      const response = await apiRequest("GET", "/api/sites");
      return (await response.json()) as Site[];
    },
  });

  const embeddingProvidersQuery = useQuery<{ providers: PublicEmbeddingProvider[] }>({
    queryKey: ["/api/embedding/services"],
    queryFn: async () => {
      const response = await apiRequest("GET", "/api/embedding/services");
      return (await response.json()) as { providers: PublicEmbeddingProvider[] };
    },
  });

  const llmProvidersQuery = useQuery<{ providers: PublicLlmProvider[] }>({
    queryKey: ["/api/llm/providers"],
    queryFn: async () => {
      const response = await apiRequest("GET", "/api/llm/providers");
      return (await response.json()) as { providers: PublicLlmProvider[] };
    },
  });

  const vectorCollectionsQuery = useQuery<VectorCollectionsResponse>({
    queryKey: ["/api/vector/collections"],
    queryFn: async () => {
      const response = await apiRequest("GET", "/api/vector/collections");
      return (await response.json()) as VectorCollectionsResponse;
    },
  });

  const workspaceId = sessionQuery.data?.workspace.active.id ?? "";
  const knowledgeBases = knowledgeBasesQuery.data ?? [];
  const sites = sitesQuery.data ?? [];
  const selectedSite = useMemo(() => {
    return sites.find((site) => site.id === settings.siteId) ?? null;
  }, [sites, settings.siteId]);
  const siteApiKey = selectedSite?.publicApiKey?.trim() ?? "";
  const activeEmbeddingProviders = useMemo(() => {
    const providers = embeddingProvidersQuery.data?.providers ?? [];
    return providers.filter((provider) => provider.isActive);
  }, [embeddingProvidersQuery.data?.providers]);

  const activeLlmProviders = useMemo(() => {
    const providers = llmProvidersQuery.data?.providers ?? [];
    return providers.filter((provider) => provider.isActive);
  }, [llmProvidersQuery.data?.providers]);

  const vectorCollections = vectorCollectionsQuery.data?.collections ?? [];

  const selectedLlmProvider = useMemo(() => {
    return activeLlmProviders.find((provider) => provider.id === settings.rag.llmProviderId) ?? null;
  }, [activeLlmProviders, settings.rag.llmProviderId]);

  const availableLlmModels = useMemo(() => {
    if (!selectedLlmProvider) {
      return [] as LlmModelOption[];
    }

    const models = [...(selectedLlmProvider.availableModels ?? [])];
    const defaultModel = selectedLlmProvider.model?.trim();
    const providerName = selectedLlmProvider.name?.trim();
    const isDefaultModelProviderName =
      !!defaultModel &&
      !!providerName &&
      defaultModel.localeCompare(providerName, undefined, { sensitivity: "accent" }) === 0;

    if (defaultModel && !isDefaultModelProviderName && !models.some((model) => model.value === defaultModel)) {
      models.unshift({ label: `${defaultModel} (по умолчанию)`, value: defaultModel });
    }

    return models;
  }, [selectedLlmProvider]);

  useEffect(() => {
    if (!settings.knowledgeBaseId && knowledgeBases.length > 0) {
      setSettings((prev) => ({
        ...prev,
        knowledgeBaseId: knowledgeBases[0]?.id ?? "",
      }));
    }
  }, [knowledgeBases, settings.knowledgeBaseId]);

  useEffect(() => {
    if (!settings.siteId && sites.length > 0) {
      setSettings((prev) => ({
        ...prev,
        siteId: sites[0]?.id ?? "",
      }));
    }
  }, [settings.siteId, sites]);

  useEffect(() => {
    if (!isSettingsOpen) {
      setSettingsTab("search");
    }
  }, [isSettingsOpen]);

  useEffect(() => {
    const container = askAiLogContainerRef.current;
    if (!container) {
      return;
    }

    container.scrollTop = container.scrollHeight;
  }, [askAiLogEntries]);

  useEffect(() => {
    if (!settings.rag.embeddingProviderId && activeEmbeddingProviders.length > 0) {
      setSettings((prev) => ({
        ...prev,
        rag: {
          ...prev.rag,
          embeddingProviderId: activeEmbeddingProviders[0]?.id ?? "",
        },
      }));
    }
  }, [activeEmbeddingProviders, settings.rag.embeddingProviderId]);

  useEffect(() => {
    if (!settings.rag.llmProviderId && activeLlmProviders.length > 0) {
      const provider = activeLlmProviders[0];
      setSettings((prev) => ({
        ...prev,
        rag: {
          ...prev.rag,
          llmProviderId: provider?.id ?? "",
          llmModel:
            (provider?.model && provider.model.trim()) || provider?.availableModels?.[0]?.value || "",
          systemPrompt:
            typeof provider?.requestConfig?.systemPrompt === "string"
              ? provider.requestConfig.systemPrompt
              : prev.rag.systemPrompt,
        },
      }));
    }
  }, [activeLlmProviders, settings.rag.llmProviderId, settings.rag.systemPrompt]);

  useEffect(() => {
    if (!query.trim()) {
      setRagRequest(null);
      setRagResponse(null);
      setRagError(null);
      setIsRagLoading(false);
      setStreamedAnswer("");
    }
  }, [query]);

  const knowledgeBaseName = useMemo(() => {
    return knowledgeBases.find((base) => base.id === settings.knowledgeBaseId)?.name ?? "";
  }, [knowledgeBases, settings.knowledgeBaseId]);

  const vectorLayerReady = useMemo(() => {
    const providerId = settings.rag.embeddingProviderId?.trim() ?? "";
    const collection = settings.rag.collection?.trim() ?? "";

    return Boolean(providerId && collection);
  }, [settings.rag.collection, settings.rag.embeddingProviderId]);

  const ragConfigurationError = useMemo(() => {
    if (!settings.rag.askAiEnabled) {
      return null;
    }

    if (!workspaceId) {
      return "Не удалось определить рабочее пространство. Обновите страницу.";
    }

    if (!selectedSite) {
      return "Выберите сайт с публичным API-ключом.";
    }

    if (!siteApiKey) {
      return "У выбранного сайта отсутствует публичный API-ключ.";
    }

    if (!settings.rag.embeddingProviderId) {
      return "Выберите сервис эмбеддингов, чтобы Ask AI сформировал ответ.";
    }

    if (!vectorLayerReady) {
      return "Укажите коллекцию Qdrant и сервис эмбеддингов.";
    }

    if (!settings.rag.llmProviderId) {
      return "Выберите провайдера LLM, чтобы Ask AI сформировал ответ.";
    }

    return null;
  }, [
    settings.rag.askAiEnabled,
    settings.rag.embeddingProviderId,
    settings.rag.llmProviderId,
    selectedSite,
    siteApiKey,
    vectorLayerReady,
    workspaceId,
  ]);

  const searchKey = useMemo(
    () =>
      JSON.stringify({
        knowledgeBaseId: settings.knowledgeBaseId,
        siteId: settings.siteId,
        suggestLimit: settings.suggestLimit,
        rag: {
          askAiEnabled: settings.rag.askAiEnabled,
          topK: settings.rag.topK,
          bm25Weight: settings.rag.bm25Weight,
          vectorWeight: settings.rag.vectorWeight,
          bm25Limit: settings.rag.bm25Limit,
          vectorLimit: settings.rag.vectorLimit,
          embeddingProviderId: settings.rag.embeddingProviderId,
          collection: settings.rag.collection,
          llmProviderId: settings.rag.llmProviderId,
          llmModel: settings.rag.llmModel,
          temperature: settings.rag.temperature,
          maxTokens: settings.rag.maxTokens,
          systemPrompt: settings.rag.systemPrompt,
          responseFormat: settings.rag.responseFormat,
        },
      }),
    [settings],
  );

  useEffect(() => {
    const trimmed = query.trim();
    if (!settings.knowledgeBaseId || !trimmed) {
      setSuggestResponse(null);
      resetSuggest();
      return;
    }

    runSuggest(trimmed);
  }, [query, resetSuggest, runSuggest, settings.knowledgeBaseId]);

  useEffect(() => {
    if (suggestStatus === "success" && suggestData) {
      setSuggestResponse(suggestData);
    }

    if (suggestStatus === "idle" || suggestStatus === "error" || !suggestData) {
      setSuggestResponse(suggestStatus === "success" ? suggestData : null);
    }
  }, [suggestData, suggestStatus]);

  useEffect(() => {
    if (!ragStreamingState.showIndicator) {
      if (ragStatusTimerRef.current) {
        clearInterval(ragStatusTimerRef.current);
        ragStatusTimerRef.current = null;
      }
      return;
    }

    if (ragStatusTimerRef.current) {
      clearInterval(ragStatusTimerRef.current);
    }

    ragStatusTimerRef.current = setInterval(() => {
      setRagStreamingState((prev) => {
        if (!prev.showIndicator) {
          return prev;
        }

        const nextIndex = (prev.statusIndex + 1) % RAG_STATUS_MESSAGES.length;
        return {
          ...prev,
          statusIndex: nextIndex,
          statusMessage: RAG_STATUS_MESSAGES[nextIndex],
        };
      });
    }, 2200);

    return () => {
      if (ragStatusTimerRef.current) {
        clearInterval(ragStatusTimerRef.current);
        ragStatusTimerRef.current = null;
      }
    };
  }, [ragStreamingState.showIndicator]);

  useEffect(() => {
    ragStreamAbortControllerRef.current?.abort();
    ragStreamAbortControllerRef.current = null;
    setRagRequest(null);
    setRagResponse(null);
    setRagError(null);
    setIsRagLoading(false);
    setStreamedAnswer("");
    setStreamedAnswerHtml("");
    setDisplayedAnswerHtml("");
    setRagStreamingState({
      requestId: null,
      question: "",
      answer: "",
      stage: "idle",
      statusMessage: null,
      statusIndex: 0,
      showIndicator: false,
      error: null,
    });
    setRagStreamingContext([]);
    ragStreamingContextRef.current = [];
    setRagStreamingChunks([]);
  }, [searchKey]);

  const resetResults = () => {
    setQuery("");
    setSuggestResponse(null);
    setRagResponse(null);
    setRagError(null);
    setIsRagLoading(false);
    setStreamedAnswer("");
    setStreamedAnswerHtml("");
    setDisplayedAnswerHtml("");
    setRagRequest(null);
    ragCurrentRequestIdRef.current = null;
    resetSuggest();
  };

  const handleAskAiStop = useCallback(() => {
    ragStreamAbortControllerRef.current?.abort();
    ragStreamAbortControllerRef.current = null;
    ragCurrentRequestIdRef.current = null;
    setIsRagLoading(false);
    setRagStreamingState((prev) => ({
      ...prev,
      stage: "error",
      showIndicator: false,
      statusMessage: null,
      error: "Ответ остановлен пользователем.",
    }));
    setRagError("Ответ остановлен пользователем.");
  }, []);

  const runRagStream = useCallback(
    async (request: RagRequestState) => {
      ragStreamAbortControllerRef.current?.abort();
      ragStreamAbortControllerRef.current = null;

      const initializeStreamState = () => {
        setIsRagLoading(true);
        setRagError(null);
        setStreamedAnswer("");
        setStreamedAnswerHtml("");
        setDisplayedAnswerHtml("");
        setRagResponse(null);
        setRagStreamingContext([]);
        ragStreamingContextRef.current = [];
        setRagStreamingChunks([]);
        setRagStreamingState({
          requestId: request.id,
          question: request.query,
          answer: "",
          stage: "connecting",
          statusMessage: RAG_STATUS_MESSAGES[0],
          statusIndex: 0,
          showIndicator: true,
          error: null,
        });
      };

      const canUseEventSource = typeof window !== "undefined" && typeof window.EventSource === "function";

      ragCurrentRequestIdRef.current = request.id;
      initializeStreamState();

      appendAskAiLog({
        requestId: request.id,
        timestamp: Date.now(),
        kind: "request",
        title: `${canUseEventSource ? "GET (SSE)" : "POST"} /api/public/collections/search/rag`,
        description: `Отправляем запрос к сервису RAG (коллекция ${request.payload.collection}).`,
        data: {
          endpoint: "/api/public/collections/search/rag",
          transport: canUseEventSource ? "eventsource" : "fetch",
          headers: canUseEventSource
            ? undefined
            : {
                Accept: "text/event-stream",
                "Content-Type": "application/json",
                "X-API-Key": maskApiKey(request.apiKey),
              },
          payload: request.payload,
        },
      });

      const handleFinalizeError = (message: string, status?: number) => {
        setRagError(message);
        setRagStreamingState((prev) => ({
          ...prev,
          stage: "error",
          showIndicator: false,
          statusMessage: null,
          error: message,
        }));
        setStreamedAnswer("");
        setStreamedAnswerHtml("");
        setDisplayedAnswerHtml("");
        const errorData: Record<string, unknown> = {
          endpoint: "/api/public/collections/search/rag",
        };
        if (status !== undefined) {
          errorData.status = status;
        }
        appendAskAiLog({
          requestId: request.id,
          timestamp: Date.now(),
          kind: "error",
          title: "Ошибка запроса к Ask AI",
          description: message,
          data: errorData,
        });
        ragStreamAbortControllerRef.current = null;
        setIsRagLoading(false);
        ragCurrentRequestIdRef.current = null;
      };

      const handleEvent = (eventName: string, data: string, meta: { status: number }) => {
        if (!data) {
          return;
        }

        if (ragCurrentRequestIdRef.current !== request.id) {
          return;
        }

        if (eventName === "status") {
          try {
            const payload = JSON.parse(data) as { stage?: string; message?: string };
            setRagStreamingState((prev) => {
              const stage =
                payload.stage === "retrieving"
                  ? "retrieving"
                  : payload.stage === "answering"
                    ? "answering"
                    : payload.stage === "done"
                      ? "done"
                      : payload.stage === "error"
                        ? "error"
                        : "connecting";

              return {
                ...prev,
                stage,
                statusMessage: typeof payload.message === "string" ? payload.message : prev.statusMessage,
                statusIndex: prev.statusIndex,
                showIndicator: stage === "done" || stage === "error" ? false : prev.showIndicator || stage !== "answering",
              };
            });
          } catch {
            // ignore invalid status payload
          }
          return;
        }

        if (eventName === "delta") {
          try {
            const payload = JSON.parse(data) as { text?: string };
            const delta = typeof payload.text === "string" ? payload.text : "";
            if (!delta) {
              return;
            }

            setRagStreamingState((prev) => ({
              ...prev,
              stage: "answering",
              showIndicator: false,
              statusMessage: null,
              answer: prev.answer + delta,
            }));
            const sanitizedDelta = sanitizeAskAiHtml(delta);
            setStreamedAnswer((prev) => prev + delta);
            setStreamedAnswerHtml((prev) => prev + sanitizedDelta);
          } catch {
            // ignore invalid delta payload
          }
          return;
        }

        if (eventName === "source") {
          try {
            const payload = JSON.parse(data) as {
              context?: PublicRagContextEntry | null;
              index?: number;
            };
            if (!payload.context) {
              return;
            }

            setRagStreamingContext((prev) => {
              const contextEntry = payload.context as PublicRagContextEntry;
              const next = [...prev, contextEntry];
              ragStreamingContextRef.current = next;
              const currentIndex = next.length - 1;
              setRagStreamingChunks((prevChunks) => [
                ...prevChunks,
                buildChunkFromContext(contextEntry, currentIndex),
              ]);
              return next;
            });
          } catch {
            // ignore invalid source payload
          }
          return;
        }

        if (eventName === "error") {
          try {
            const payload = JSON.parse(data) as { message?: string };
            const message = payload.message || "Не удалось получить ответ от LLM.";
            throw new Error(message);
          } catch (error) {
            if (error instanceof Error) {
              throw error;
            }
            throw new Error("Не удалось получить ответ от LLM.");
          }
        }

        if (eventName === "done") {
          try {
            const payload = JSON.parse(data) as {
              answer?: string;
              usage?: PublicRagResponse["usage"];
              provider?: PublicRagResponse["provider"];
              embeddingProvider?: PublicRagResponse["embeddingProvider"];
              collection?: string | null;
              format?: string | null;
            };
            const answer = typeof payload.answer === "string" ? payload.answer : "";
            const contextEntries = ragStreamingContextRef.current;
            const responsePayload: PublicRagResponse = {
              answer,
              usage: payload.usage ?? null,
              provider: payload.provider ?? null,
              embeddingProvider: payload.embeddingProvider ?? null,
              collection: payload.collection ?? null,
              format: payload.format ?? null,
              context: contextEntries,
              queryVector: null,
              vectorLength: null,
            };
            const normalized = normalizePublicRagResponse(responsePayload, { query: request.query });

            setRagResponse(normalized);
            setStreamedAnswer(answer);
            setStreamedAnswerHtml(sanitizeAskAiHtml(answer));
            setRagStreamingState((prev) => ({
              ...prev,
              stage: "done",
              showIndicator: false,
              statusMessage: null,
              answer,
            }));

            ragCurrentRequestIdRef.current = null;

            const finishedAt = Date.now();
            const responseSummary: Record<string, unknown> = { status: meta.status };
            if (normalized.format) {
              responseSummary.format = normalized.format;
            }
            if (normalized.usage) {
              responseSummary.usage = normalized.usage;
            }
            if (normalized.provider) {
              responseSummary.provider = normalized.provider;
            }
            if (normalized.embeddingProvider) {
              responseSummary.embeddingProvider = normalized.embeddingProvider;
            }
            if (normalized.collection) {
              responseSummary.collection = normalized.collection;
            }
            if (normalized.citations?.length) {
              responseSummary.citations = normalized.citations.map((chunk) => ({
                chunk_id: chunk.chunk_id,
                doc_title: chunk.doc_title,
                scores: chunk.scores,
              }));
            }
            if (normalized.context) {
              responseSummary.contextLength = normalized.context.length;
            }
            if (typeof normalized.vectorLength === "number") {
              responseSummary.vectorLength = normalized.vectorLength;
            }
            if (normalized.debug?.vectorSearch) {
              responseSummary.vectorSearch = normalized.debug.vectorSearch;
            }

            appendAskAiLog({
              requestId: request.id,
              timestamp: finishedAt,
              kind: "response",
              title: `Ответ ${meta.status}`,
              description: `Ответ для сайта ${request.siteName} получен за ${formatDuration(finishedAt - request.startedAt)}.`,
              data: Object.keys(responseSummary).length > 0 ? responseSummary : undefined,
            });
            ragStreamAbortControllerRef.current = null;
            setIsRagLoading(false);
          } catch (error) {
            const message = error instanceof Error ? error.message : "Не удалось обработать ответ LLM.";
            setRagError(message);
            setRagStreamingState((prev) => ({
              ...prev,
              stage: "error",
              showIndicator: false,
              statusMessage: null,
              error: message,
            }));
          }
        }
      };

      const buildSseUrl = () => {
        const params = new URLSearchParams();
        params.set("apiKey", request.apiKey);
        params.set("workspace_id", request.workspaceId);
        if (request.sitePublicId) {
          params.set("sitePublicId", request.sitePublicId);
        }
        for (const [key, value] of Object.entries(request.payload)) {
          if (value === undefined || value === null) {
            continue;
          }
          if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
            params.set(key, String(value));
          } else {
            params.set(key, JSON.stringify(value));
          }
        }
        return `/api/public/collections/search/rag?${params.toString()}`;
      };

      if (canUseEventSource) {
        try {
          await new Promise<void>((resolve, reject) => {
            const eventSource = new EventSource(buildSseUrl());
            let settled = false;
            const safeResolve = () => {
              if (!settled) {
                settled = true;
                resolve();
              }
            };
            const safeReject = (error: Error) => {
              if (!settled) {
                settled = true;
                reject(error);
              }
            };
            const close = () => {
              eventSource.close();
            };

            const handleMessage = (eventName: string, eventData: string) => {
              if (!eventData) {
                return;
              }
              try {
                handleEvent(eventName, eventData, { status: 200 });
              } catch (error) {
                const message = error instanceof Error ? error.message : "Не удалось получить ответ от LLM.";
                handleFinalizeError(message, 200);
                close();
                safeResolve();
              }
            };

            eventSource.addEventListener("status", (event) =>
              handleMessage("status", (event as MessageEvent<string>).data ?? ""),
            );
            eventSource.addEventListener("delta", (event) =>
              handleMessage("delta", (event as MessageEvent<string>).data ?? ""),
            );
            eventSource.addEventListener("source", (event) =>
              handleMessage("source", (event as MessageEvent<string>).data ?? ""),
            );
            eventSource.addEventListener("done", (event) => {
              handleMessage("done", (event as MessageEvent<string>).data ?? "");
              close();
              safeResolve();
            });
            eventSource.addEventListener("error", (event) => {
              const maybeData = (event as MessageEvent<string>).data;
              if (typeof maybeData === "string" && maybeData.trim()) {
                handleMessage("error", maybeData);
                close();
                safeResolve();
                return;
              }
              close();
              safeReject(new Error("SSE connection unavailable"));
            });

            ragStreamAbortControllerRef.current = {
              abort: () => {
                close();
                safeResolve();
              },
            };
          });
          return;
        } catch (error) {
          console.warn("EventSource недоступен, переключаемся на fetch()", error);
          ragStreamAbortControllerRef.current = null;
          initializeStreamState();
        }
      }

      const abortController = new AbortController();
      ragStreamAbortControllerRef.current = {
        abort: () => abortController.abort(),
      };

      try {
        const response = await fetch("/api/public/collections/search/rag", {
          method: "POST",
          headers: {
            Accept: "text/event-stream",
            "Content-Type": "application/json",
            "X-API-Key": request.apiKey,
          },
          body: JSON.stringify(request.payload),
          signal: abortController.signal,
        });

        if (ragCurrentRequestIdRef.current !== request.id) {
          return;
        }

        if (!response.ok) {
          const fallbackMessage =
            response.status === 503
              ? "Сервис RAG временно недоступен. Попробуйте позже."
              : "Не удалось получить ответ от LLM.";
          const errorMessage = (await extractErrorMessage(response)) ?? fallbackMessage;
          throw new Error(`${errorMessage} (код ${response.status})`);
        }

        const contentType = response.headers.get("Content-Type") ?? response.headers.get("content-type");
        const isSse = typeof contentType === "string" && contentType.includes("text/event-stream");

        if (isSse && response.body) {
          const decoder = new TextDecoder();
          const reader = response.body.getReader();
          let buffer = "";

          while (true) {
            const { done, value } = await reader.read();
            if (done) {
              break;
            }

            buffer += decoder.decode(value, { stream: true });

            let boundaryIndex = buffer.indexOf("\n\n");
            while (boundaryIndex >= 0) {
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

              const eventData = dataLines.join("\n");
              if (!eventData) {
                continue;
              }

              try {
                handleEvent(eventName, eventData, { status: response.status });
              } catch (error) {
                const message = error instanceof Error ? error.message : "Не удалось получить ответ от LLM.";
                handleFinalizeError(message, response.status);
                reader.cancel().catch(() => {});
                return;
              }
            }
          }

          setIsRagLoading(false);
          ragStreamAbortControllerRef.current = null;
          ragCurrentRequestIdRef.current = null;
          return;
        }

        const text = await response.text();
        let json: unknown = null;
        try {
          json = JSON.parse(text);
        } catch {
          json = null;
        }
        if (!json || typeof json !== "object") {
          throw new Error("Не удалось прочитать ответ сервера.");
        }
        const payload = json as PublicRagResponse;
        const normalized = normalizePublicRagResponse(payload, { query: request.query });
        setRagResponse(normalized);
        const finalAnswer = normalized.answer ?? "";
        setStreamedAnswer(finalAnswer);
        setStreamedAnswerHtml(sanitizeAskAiHtml(finalAnswer));
        const contextEntries = Array.isArray(payload.context) ? payload.context : [];
        setRagStreamingContext(contextEntries);
        ragStreamingContextRef.current = contextEntries;
        setRagStreamingChunks(
          contextEntries.map((entry, index) =>
            buildChunkFromContext(entry, index),
          ),
        );
        setRagStreamingState({
          requestId: request.id,
          question: request.query,
          answer: finalAnswer,
          stage: "done",
          statusMessage: null,
          statusIndex: 0,
          showIndicator: false,
          error: null,
        });
        ragStreamAbortControllerRef.current = null;
        setIsRagLoading(false);
        ragCurrentRequestIdRef.current = null;
      } catch (error) {
        if (abortController.signal.aborted) {
          return;
        }

        console.error("Search playground RAG error", error);
        const message =
          error instanceof Error && error.message
            ? error.message
            : "Не удалось получить ответ от LLM.";
        setRagResponse(null);
        setStreamedAnswer("");
        handleFinalizeError(message);
      } finally {
        if (!abortController.signal.aborted) {
          setIsRagLoading(false);
        }
      }
    },
    [appendAskAiLog],
  );

  const clearAskAiTypingTimer = useCallback(() => {
    const state = askAiTypingStateRef.current;
    if (state.timer) {
      clearTimeout(state.timer);
      state.timer = null;
    }
  }, []);

  const runAskAiTypingTick = useCallback(() => {
    const state = askAiTypingStateRef.current;

    if (!state.tokens.length || state.tokenIndex >= state.tokens.length) {
      state.timer = null;
      setDisplayedAnswerHtml(state.completedHtml + state.partialHtml);
      return;
    }

    const token = state.tokens[state.tokenIndex];

    if (token.type === "tag") {
      state.completedHtml += token.value;
      state.tokenIndex += 1;
      state.charIndex = 0;
      state.partialHtml = "";
      setDisplayedAnswerHtml(state.completedHtml);
      state.timer = setTimeout(runAskAiTypingTick, 0);
      return;
    }

    const step = Math.max(1, Math.ceil(token.value.length / 28));
    state.charIndex = Math.min(token.value.length, state.charIndex + step);
    state.partialHtml = token.value.slice(0, state.charIndex);
    const nextHtml = state.completedHtml + state.partialHtml;
    setDisplayedAnswerHtml(nextHtml);

    if (state.charIndex >= token.value.length) {
      state.completedHtml = nextHtml;
      state.tokenIndex += 1;
      state.charIndex = 0;
      state.partialHtml = "";
    }

    state.timer = setTimeout(runAskAiTypingTick, 20);
  }, []);

  useEffect(() => {
    const state = askAiTypingStateRef.current;
    clearAskAiTypingTimer();

    if (!streamedAnswerHtml) {
      state.tokens = [];
      state.tokenIndex = 0;
      state.charIndex = 0;
      state.completedHtml = "";
      state.partialHtml = "";
      setDisplayedAnswerHtml("");
      return;
    }

    state.tokens = tokenizeAskAiHtml(streamedAnswerHtml);

    const currentHtml = state.completedHtml + state.partialHtml;

    if (!currentHtml || !streamedAnswerHtml.startsWith(currentHtml)) {
      state.tokenIndex = 0;
      state.charIndex = 0;
      state.completedHtml = "";
      state.partialHtml = "";
      setDisplayedAnswerHtml("");
    } else {
      let matchedLength = 0;
      let completedHtml = "";
      let tokenIndex = 0;
      let partialHtml = "";
      let partialChars = 0;

      while (tokenIndex < state.tokens.length && matchedLength < currentHtml.length) {
        const token = state.tokens[tokenIndex];
        const tokenLength = token.value.length;

        if (matchedLength + tokenLength <= currentHtml.length) {
          completedHtml += token.value;
          matchedLength += tokenLength;
          tokenIndex += 1;
          continue;
        }

        if (token.type === "text") {
          partialChars = currentHtml.length - matchedLength;
          partialHtml = token.value.slice(0, partialChars);
        }

        matchedLength = currentHtml.length;
        break;
      }

      state.completedHtml = completedHtml;
      state.tokenIndex = tokenIndex;
      state.charIndex = partialChars;
      state.partialHtml = partialHtml;
      setDisplayedAnswerHtml(currentHtml);
    }

    state.timer = setTimeout(runAskAiTypingTick, 16);

    return () => {
      clearAskAiTypingTimer();
    };
  }, [clearAskAiTypingTimer, runAskAiTypingTick, streamedAnswerHtml]);

  const handleAskAi = async (overrideQuery?: string) => {
    const trimmedQuery = (overrideQuery ?? query).trim();
    setQuery(trimmedQuery);

    const registerValidationError = (message: string) => {
      setRagError(message);
      setRagResponse(null);
      setStreamedAnswer("");
      setRagStreamingState((prev) => ({
        ...prev,
        question: trimmedQuery || prev.question,
        stage: "error",
        statusMessage: null,
        showIndicator: false,
        error: message,
      }));
    };

    if (!trimmedQuery) {
      registerValidationError("Введите вопрос, чтобы Ask AI подготовил ответ.");
      return;
    }

    if (!settings.knowledgeBaseId) {
      registerValidationError("Выберите базу знаний перед запросом к Ask AI.");
      return;
    }

    if (!selectedSite) {
      registerValidationError("Выберите сайт с публичным API-ключом перед запросом к Ask AI.");
      return;
    }

    if (!siteApiKey) {
      registerValidationError("Для выбранного сайта отсутствует публичный API-ключ.");
      return;
    }

    if (!workspaceId) {
      registerValidationError("Не удалось определить рабочее пространство. Обновите страницу и попробуйте снова.");
      return;
    }

    if (ragConfigurationError) {
      registerValidationError(ragConfigurationError);
      return;
    }

    const normalizedCollection = settings.rag.collection.trim();
    const payload: RagRequestPayload = {
      query: trimmedQuery,
      workspace_id: workspaceId,
      collection: normalizedCollection,
      embeddingProviderId: settings.rag.embeddingProviderId,
      llmProviderId: settings.rag.llmProviderId,
      llmModel: settings.rag.llmModel || undefined,
      limit: Math.max(settings.rag.vectorLimit, settings.rag.topK),
      contextLimit: settings.rag.topK,
      responseFormat: settings.rag.responseFormat,
      includeContext: true,
      includeQueryVector: settings.rag.includeDebug,
      withPayload: true,
      withVector: true,
      sitePublicId: selectedSite.publicId || undefined,
    };

    const nextRequestId = ragRequestCounter.current + 1;
    const startedAt = Date.now();

    appendAskAiLog({
      requestId: nextRequestId,
      timestamp: startedAt,
      kind: "info",
      title: "Запрос к Ask AI подготовлен",
      description: `Вопрос: «${trimmedQuery}». Сайт: ${selectedSite.name}. Коллекция: ${payload.collection}.`,
      data: {
        workspaceId,
        site: {
          id: selectedSite.id,
          name: selectedSite.name,
          publicId: selectedSite.publicId,
        },
        request: {
          collection: payload.collection,
          embeddingProviderId: payload.embeddingProviderId,
          llmProviderId: payload.llmProviderId,
          llmModel: payload.llmModel,
          limit: payload.limit,
          contextLimit: payload.contextLimit,
          responseFormat: payload.responseFormat,
        },
      },
    });

    ragRequestCounter.current = nextRequestId;
    const nextRequest: RagRequestState = {
      id: nextRequestId,
      payload,
      startedAt,
      apiKey: siteApiKey,
      query: trimmedQuery,
      siteName: selectedSite.name,
      sitePublicId: selectedSite.publicId ?? undefined,
      workspaceId,
    };
    setRagRequest(nextRequest);
    void runRagStream(nextRequest);
  };

  const handleOpenSuggestResult = (
    item: SuggestResponseItem,
    options?: { newTab?: boolean },
  ) => {
    if (!item.url || typeof window === "undefined") {
      return;
    }

    try {
      const targetUrl = new URL(item.url, window.location.origin);
      if (options?.newTab) {
        window.open(targetUrl.toString(), "_blank", "noopener,noreferrer");
      } else {
        window.open(targetUrl.toString(), "_self");
      }
    } catch (error) {
      console.error("Не удалось открыть результат поиска", error);
    }
  };

  const handleSettingsChange = <K extends keyof PlaygroundSettings>(key: K, value: PlaygroundSettings[K]) => {
    setSettings((prev) => ({
      ...prev,
      [key]: value,
    }));
  };

  const handleRagSettingsChange = <K extends keyof PlaygroundSettings["rag"]>(
    key: K,
    value: PlaygroundSettings["rag"][K],
  ) => {
    setSettings((prev) => {
      if (key === "topK" && typeof value === "number") {
        const nextTopK = value;
        const shouldSyncVectorLimit = prev.rag.vectorLimit === prev.rag.topK;

        return {
          ...prev,
          rag: {
            ...prev.rag,
            topK: nextTopK,
            vectorLimit: shouldSyncVectorLimit ? nextTopK : prev.rag.vectorLimit,
          },
        };
      }

      if (key === "vectorLimit" && typeof value === "number") {
        const nextVectorLimit = value;
        const shouldSyncTopK = prev.rag.vectorLimit === prev.rag.topK;
        const syncedTopK = Math.max(1, Math.min(10, nextVectorLimit));

        return {
          ...prev,
          rag: {
            ...prev.rag,
            vectorLimit: nextVectorLimit,
            topK: shouldSyncTopK ? syncedTopK : prev.rag.topK,
          },
        };
      }

      return {
        ...prev,
        rag: {
          ...prev.rag,
          [key]: value,
        },
      };
    });
  };

  useEffect(() => {
    if (typeof window === "undefined" || settingsLoaded) {
      return;
    }

    try {
      const raw = window.localStorage.getItem(PLAYGROUND_SETTINGS_STORAGE_KEY);
      if (!raw) {
        setSettingsLoaded(true);
        return;
      }

      const parsed = JSON.parse(raw) as Partial<PlaygroundSettings> | null;

      setSettings((prev) => {
        if (!parsed || typeof parsed !== "object") {
          return prev;
        }

        const next: PlaygroundSettings = {
          ...prev,
          knowledgeBaseId:
            typeof parsed.knowledgeBaseId === "string" ? parsed.knowledgeBaseId : prev.knowledgeBaseId,
          siteId: typeof parsed.siteId === "string" ? parsed.siteId : prev.siteId,
          suggestLimit:
            typeof parsed.suggestLimit === "number" && Number.isFinite(parsed.suggestLimit)
              ? Math.max(1, Math.min(20, Math.round(parsed.suggestLimit)))
              : prev.suggestLimit,
          rag: {
            ...prev.rag,
            ...(parsed.rag && typeof parsed.rag === "object"
              ? {
                  askAiEnabled:
                    typeof parsed.rag.askAiEnabled === "boolean"
                      ? parsed.rag.askAiEnabled
                      : prev.rag.askAiEnabled,
                  topK:
                    typeof parsed.rag.topK === "number" && Number.isFinite(parsed.rag.topK)
                      ? Math.max(1, Math.min(10, Math.round(parsed.rag.topK)))
                      : prev.rag.topK,
                  bm25Weight:
                    typeof parsed.rag.bm25Weight === "number" && Number.isFinite(parsed.rag.bm25Weight)
                      ? Math.min(1, Math.max(0, parsed.rag.bm25Weight))
                      : prev.rag.bm25Weight,
                  vectorWeight:
                    typeof parsed.rag.vectorWeight === "number" && Number.isFinite(parsed.rag.vectorWeight)
                      ? Math.min(1, Math.max(0, parsed.rag.vectorWeight))
                      : prev.rag.vectorWeight,
                  bm25Limit:
                    typeof parsed.rag.bm25Limit === "number" && Number.isFinite(parsed.rag.bm25Limit)
                      ? Math.max(1, Math.min(20, Math.round(parsed.rag.bm25Limit)))
                      : prev.rag.bm25Limit,
                  vectorLimit:
                    typeof parsed.rag.vectorLimit === "number" && Number.isFinite(parsed.rag.vectorLimit)
                      ? Math.max(1, Math.min(20, Math.round(parsed.rag.vectorLimit)))
                      : prev.rag.vectorLimit,
                  embeddingProviderId:
                    typeof parsed.rag.embeddingProviderId === "string"
                      ? parsed.rag.embeddingProviderId
                      : prev.rag.embeddingProviderId,
                  collection:
                    typeof parsed.rag.collection === "string" ? parsed.rag.collection : prev.rag.collection,
                  llmProviderId:
                    typeof parsed.rag.llmProviderId === "string"
                      ? parsed.rag.llmProviderId
                      : prev.rag.llmProviderId,
                  llmModel:
                    typeof parsed.rag.llmModel === "string" ? parsed.rag.llmModel : prev.rag.llmModel,
                  temperature:
                    typeof parsed.rag.temperature === "number" && Number.isFinite(parsed.rag.temperature)
                      ? Math.max(0, Math.min(2, parsed.rag.temperature))
                      : prev.rag.temperature,
                  maxTokens:
                    typeof parsed.rag.maxTokens === "number" && Number.isFinite(parsed.rag.maxTokens)
                      ? Math.max(128, Math.round(parsed.rag.maxTokens))
                      : prev.rag.maxTokens,
                  systemPrompt:
                    typeof parsed.rag.systemPrompt === "string"
                      ? parsed.rag.systemPrompt
                      : prev.rag.systemPrompt,
                  responseFormat:
                    parsed.rag.responseFormat === "text" ||
                    parsed.rag.responseFormat === "markdown" ||
                    parsed.rag.responseFormat === "html"
                      ? parsed.rag.responseFormat
                      : prev.rag.responseFormat,
                  includeDebug:
                    typeof parsed.rag.includeDebug === "boolean"
                      ? parsed.rag.includeDebug
                      : prev.rag.includeDebug,
                }
              : {}),
          },
        };

        return next;
      });
    } catch (error) {
      console.error("Не удалось загрузить настройки песочницы поиска", error);
    } finally {
      setSettingsLoaded(true);
    }
  }, [settingsLoaded]);

  useEffect(() => {
    if (typeof window === "undefined" || !settingsLoaded) {
      return;
    }

    try {
      window.localStorage.setItem(PLAYGROUND_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
    } catch (error) {
      console.error("Не удалось сохранить настройки песочницы поиска", error);
    }
  }, [settings, settingsLoaded]);

  const handleLlmProviderChange = (providerId: string) => {
    const provider = activeLlmProviders.find((item) => item.id === providerId);
    setSettings((prev) => ({
      ...prev,
      rag: {
        ...prev.rag,
        llmProviderId: providerId,
        llmModel:
          (provider?.model && provider.model.trim()) || provider?.availableModels?.[0]?.value || "",
        systemPrompt:
          typeof provider?.requestConfig?.systemPrompt === "string"
            ? provider.requestConfig.systemPrompt
            : prev.rag.systemPrompt,
      },
    }));
  };

  useEffect(() => {
    if (!selectedLlmProvider) {
      return;
    }

    const models = availableLlmModels;
    const currentValue = settings.rag.llmModel?.trim() ?? "";
    const hasCurrent = currentValue && models.some((model) => model.value === currentValue);

    if (hasCurrent) {
      return;
    }

    const defaultModel = selectedLlmProvider.model?.trim();
    const fallback =
      (defaultModel && models.find((model) => model.value === defaultModel)?.value) ||
      models[0]?.value ||
      defaultModel ||
      "";

    if (fallback !== currentValue) {
      setSettings((prev) => ({
        ...prev,
        rag: {
          ...prev.rag,
          llmModel: fallback,
        },
      }));
    }
  }, [availableLlmModels, selectedLlmProvider, settings.rag.llmModel]);

  useEffect(() => {
    const answer = ragResponse?.answer ?? "";

    if (!answer) {
      setStreamedAnswer(answer);
      return;
    }

    let cancelled = false;
    let position = 0;
    const step = Math.max(1, Math.ceil(answer.length / 160));
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const tick = () => {
      if (cancelled) {
        return;
      }

      position = Math.min(answer.length, position + step);
      setStreamedAnswer(answer.slice(0, position));

      if (position < answer.length) {
        timeoutId = setTimeout(tick, 24);
      }
    };

    setStreamedAnswer("");
    timeoutId = setTimeout(tick, 24);

    return () => {
      cancelled = true;
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
  }, [ragResponse?.answer]);

  const renderSuggestItem = (
    entry: { group: SuggestResultGroup; item: SuggestResponseItem },
    index: number,
  ) => {
    const { group, item } = entry;
    const scoreValue = Number.isFinite(item.score ?? NaN) ? item.score ?? 0 : null;
    const breadcrumbs = (item.breadcrumbs ?? []).filter(Boolean);
    const metaChips = [
      item.version ? (item.version.startsWith("v") ? item.version : `v${item.version}`) : null,
      item.language ? item.language.toUpperCase() : null,
      item.type ?? null,
    ].filter(Boolean) as string[];

    return (
      <div key={`${item.id ?? item.chunkId ?? index}-${index}`} className="rounded border px-3 py-2">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span className="line-clamp-1" title={group.title}>
            {group.title || "Без группы"}
          </span>
          {scoreValue !== null && <span className="font-mono">{scoreValue.toFixed(3)}</span>}
        </div>
        <div className="mt-1 text-sm font-semibold text-foreground">
          {item.heading_text || item.title || "Без заголовка"}
        </div>
        {breadcrumbs.length > 0 && (
          <div className="text-xs text-muted-foreground">
            {breadcrumbs.join(" › ")}
          </div>
        )}
        {item.snippet_html && (
          <p
            className="mt-2 text-sm leading-snug text-foreground"
            dangerouslySetInnerHTML={{ __html: item.snippet_html }}
          />
        )}
        {metaChips.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2 text-[11px] uppercase tracking-wide text-muted-foreground">
            {metaChips.map((chip, chipIndex) => (
              <Badge key={`${item.id}-meta-${chipIndex}`} variant="outline">
                {chip}
              </Badge>
            ))}
          </div>
        )}
      </div>
    );
  };

  const renderRagChunk = (chunk: RagChunk, index: number) => {
    const bm25Score = Number.isFinite(chunk.scores?.bm25 ?? NaN) ? chunk.scores?.bm25 : undefined;
    const vectorScore = Number.isFinite(chunk.scores?.vector ?? NaN) ? chunk.scores?.vector : undefined;

    return (
      <div key={`${chunk.chunk_id}-${index}`} className="rounded border px-3 py-2">
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <div>#{index + 1}</div>
          <div className="flex items-center gap-2">
            {bm25Score !== undefined && (
              <Badge variant="outline">BM25: {bm25Score.toFixed(3)}</Badge>
            )}
            {vectorScore !== undefined && (
              <Badge variant="outline">Vector: {vectorScore.toFixed(3)}</Badge>
            )}
          </div>
        </div>
        <div className="mt-1 text-sm font-semibold text-foreground">
          {chunk.section_title || chunk.doc_title || "Без заголовка"}
        </div>
        <p className="mt-2 text-sm leading-snug text-foreground">{chunk.snippet}</p>
      </div>
    );
  };

  const renderAskAiLogEntry = (entry: AskAiLogEntry) => {
    const dataJson = entry.data !== undefined ? stringifyJson(entry.data) : null;

    return (
      <div key={entry.id} className="rounded border border-border/60 bg-background p-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${ASK_AI_LOG_KIND_STYLES[entry.kind]}`}
            >
              {ASK_AI_LOG_KIND_LABEL[entry.kind]}
            </span>
            <span className="font-mono text-[11px] text-muted-foreground">#{entry.requestId}</span>
            <span className="text-xs font-semibold text-foreground">{entry.title}</span>
          </div>
          <span className="text-[11px] text-muted-foreground">{formatLogTime(entry.timestamp)}</span>
        </div>
        {entry.description && (
          <div className="mt-1 text-xs leading-relaxed text-foreground">{entry.description}</div>
        )}
        {dataJson && (
          <pre className="mt-2 max-h-36 overflow-auto rounded bg-muted/60 p-2 text-[11px] leading-relaxed text-foreground">
            {dataJson}
          </pre>
        )}
      </div>
    );
  };

  const askTabState = useMemo(
    () => ({
      isActive: ragStreamingState.stage !== "idle" || ragStreamingState.question.length > 0,
      question: ragStreamingState.question,
      answerHtml: displayedAnswerHtml,
      statusMessage: ragStreamingState.statusMessage,
      showIndicator: ragStreamingState.showIndicator,
      error: ragStreamingState.error ?? ragError,
      sources: ragStreamingChunks,
      isStreaming:
        ragStreamingState.stage === "connecting" ||
        ragStreamingState.stage === "retrieving" ||
        ragStreamingState.stage === "answering",
      isDone: ragStreamingState.stage === "done",
    }),
    [displayedAnswerHtml, ragError, ragStreamingChunks, ragStreamingState],
  );

  const ragAnswerHtml = useMemo(() => {
    if (displayedAnswerHtml) {
      return displayedAnswerHtml;
    }

    if (ragResponse?.answer) {
      return sanitizeAskAiHtml(ragResponse.answer);
    }

    return "";
  }, [displayedAnswerHtml, ragResponse?.answer]);

  return (
    <div className="flex h-full flex-col bg-background">
      <header className="flex items-center justify-between border-b px-4 py-2">
        <div className="flex items-center gap-2">
          <SearchIcon className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-semibold text-foreground">Глобальный поиск · Песочница</span>
          {knowledgeBaseName && (
            <Badge variant="secondary" className="text-xs">
              {knowledgeBaseName}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          <SearchQuickSwitcher
            query={query}
            isAskAiEnabled={settings.rag.askAiEnabled && !ragConfigurationError}
            suggest={suggestResponse}
            status={settings.knowledgeBaseId ? suggestStatus : "idle"}
            error={suggestError}
            onQueryChange={setQuery}
            onAskAi={handleAskAi}
            askState={askTabState}
            onAskAiStop={handleAskAiStop}
            onResultOpen={handleOpenSuggestResult}
            onPrefetch={(value) => {
              if (settings.knowledgeBaseId) {
                prefetchSuggest(value);
              }
            }}
            closeOnAsk={false}
            disabledReason={
              !settings.knowledgeBaseId
                ? "Выберите базу знаний"
                : !settings.rag.askAiEnabled
                ? "Ask AI отключён в настройках"
                : ragConfigurationError ?? null
            }
          />
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            onClick={resetResults}
            disabled={isSuggestLoading || isRagLoading}
          >
            <RefreshCcw className="h-3.5 w-3.5" />
            Сбросить
          </Button>
          <Dialog open={isSettingsOpen} onOpenChange={setIsSettingsOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm" className="gap-2">
                <Settings className="h-3.5 w-3.5" />
                Настройки
              </Button>
            </DialogTrigger>
            <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[72rem]">
              <DialogHeader>
                <DialogTitle>Настройки песочницы</DialogTitle>
                <DialogDescription>
                  Настройте базу знаний, параметры поиска и генерации ответа. Все параметры применяются сразу после
                  сохранения.
                </DialogDescription>
              </DialogHeader>
              <TooltipProvider delayDuration={150}>
                <Tabs value={settingsTab} onValueChange={(value) => setSettingsTab(value as "search" | "rag")} className="mt-4">
                  <TabsList className="grid w-full grid-cols-2">
                    <TabsTrigger value="search">Поиск по БЗ</TabsTrigger>
                    <TabsTrigger value="rag">RAG</TabsTrigger>
                  </TabsList>
                  <TabsContent value="search" className="mt-4 space-y-4">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="flex flex-col gap-2">
                        <SettingLabelWithTooltip
                          htmlFor="playground-kb"
                          label="База знаний"
                          description="Выберите базу знаний, из которой будут подбираться документы для подсказок и RAG. Пример: «Onboarding сотрудников» или «FAQ по продукту»."
                        />
                        <Select
                          value={settings.knowledgeBaseId}
                          onValueChange={(value) => handleSettingsChange("knowledgeBaseId", value)}
                        >
                          <SelectTrigger id="playground-kb">
                            <SelectValue placeholder="Выберите базу" />
                          </SelectTrigger>
                          <SelectContent>
                            {knowledgeBases.map((base) => (
                              <SelectItem key={base.id} value={base.id}>
                                {base.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="flex flex-col gap-2 sm:col-span-2">
                        <SettingLabelWithTooltip
                          htmlFor="playground-site"
                          label="Сайт (API-ключ)"
                          description="Сайт определяет публичный API-ключ и коллекцию, к которым обращается Ask AI. Выберите проект с нужным API-ключом."
                        />
                        <Select
                          value={settings.siteId}
                          onValueChange={(value) => handleSettingsChange("siteId", value)}
                          disabled={sites.length === 0}
                        >
                          <SelectTrigger id="playground-site">
                            <SelectValue placeholder={sites.length === 0 ? "Сайты не найдены" : "Выберите сайт"} />
                          </SelectTrigger>
                          <SelectContent>
                            {sites.map((site) => (
                              <SelectItem key={site.id} value={site.id}>
                                {site.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="flex flex-col gap-2">
                        <SettingLabelWithTooltip
                          htmlFor="playground-limit"
                          label="Количество подсказок"
                          description="Сколько чанков выводить в блоке подсказок поверх результатов. Пример: 5 покажет пять самых релевантных отрывков."
                        />
                        <Input
                          id="playground-limit"
                          type="number"
                          min={1}
                          max={10}
                          value={settings.suggestLimit}
                          onChange={(event) =>
                            handleSettingsChange("suggestLimit", Math.max(1, Number(event.target.value) || 1))
                          }
                        />
                      </div>
                    </div>
                    <div className="rounded border px-3 py-2 text-xs text-muted-foreground">
                      Все запросы уходят в публичные эндпоинты `/public/search/suggest` и `/api/public/collections/search/rag`
                      с текущими настройками. Так можно воспроизвести интеграцию клиента 1:1.
                    </div>
                  </TabsContent>
                  <TabsContent value="rag" className="mt-4 space-y-4">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="flex flex-col gap-2">
                        <SettingLabelWithTooltip
                          htmlFor="playground-topk"
                          label="Top-K"
                          description="Сколько чанков попадёт в итоговый запрос к LLM. Пример: 4 сохранит четыре наиболее полезных отрывка."
                        />
                        <Input
                          id="playground-topk"
                          type="number"
                          min={1}
                          max={10}
                          value={settings.rag.topK}
                          onChange={(event) =>
                            handleRagSettingsChange(
                              "topK",
                              Math.max(1, Math.min(10, Number(event.target.value) || 1)),
                            )
                          }
                        />
                      </div>
                      <div className="flex flex-col gap-2">
                        <SettingLabelWithTooltip
                          htmlFor="playground-bm25-weight"
                          label="Вес BM25"
                          description="Доля классического полнотекстового поиска в гибридном ранжировании. Пример: 0.7 делает акцент на точном совпадении текста."
                        />
                        <Input
                          id="playground-bm25-weight"
                          type="number"
                          step="0.05"
                          min={0}
                          max={1}
                          value={settings.rag.bm25Weight}
                          onChange={(event) => {
                            const value = Math.min(1, Math.max(0, Number(event.target.value)) || 0);
                            handleRagSettingsChange("bm25Weight", value);
                          }}
                        />
                      </div>
                      <div className="flex flex-col gap-2">
                        <SettingLabelWithTooltip
                          htmlFor="playground-vector-weight"
                          label="Вес векторов"
                          description="Баланс между семантическим (векторным) и классическим поиском: 0 — учитываем только BM25, 1 — полагаемся только на вектора. Меняйте вместе с весом BM25, чтобы подобрать нужный микс."
                        />
                        <Input
                          id="playground-vector-weight"
                          type="number"
                          step="0.05"
                          min={0}
                          max={1}
                          value={settings.rag.vectorWeight}
                          onChange={(event) => {
                            const value = Math.min(1, Math.max(0, Number(event.target.value)) || 0);
                            handleRagSettingsChange("vectorWeight", value);
                          }}
                        />
                      </div>
                      <div className="flex flex-col gap-2">
                        <SettingLabelWithTooltip
                          htmlFor="playground-bm25-limit"
                          label="Чанков BM25"
                          description="Сколько результатов BM25 брать перед смешиванием с векторами. Пример: 6 — шесть лучших текстовых совпадений."
                        />
                        <Input
                          id="playground-bm25-limit"
                          type="number"
                          min={1}
                          max={20}
                          value={settings.rag.bm25Limit}
                          onChange={(event) =>
                            handleRagSettingsChange("bm25Limit", Math.max(1, Number(event.target.value) || 1))
                          }
                        />
                      </div>
                      <div className="flex flex-col gap-2">
                        <SettingLabelWithTooltip
                          htmlFor="playground-vector-limit"
                          label="Чанков векторов"
                          description="Сколько ближайших векторных совпадений запрашивать из Qdrant. Значение по умолчанию совпадает с Top-K и синхронизируется с ним, пока вы вручную не зададите другое число."
                        />
                        <Input
                          id="playground-vector-limit"
                          type="number"
                          min={1}
                          max={20}
                          value={settings.rag.vectorLimit}
                          onChange={(event) =>
                            handleRagSettingsChange(
                              "vectorLimit",
                              Math.max(1, Math.min(20, Number(event.target.value) || 1)),
                            )
                          }
                        />
                      </div>
                      <div className="flex flex-col gap-2">
                        <SettingLabelWithTooltip
                          htmlFor="playground-embedding-provider"
                          label="Сервис эмбеддингов"
                          description="Сервис, который строит вектор запроса перед обращением к Qdrant. Пример: «GigaChat Embeddings»."
                        />
                        <Select
                          value={settings.rag.embeddingProviderId}
                          onValueChange={(value) => handleRagSettingsChange("embeddingProviderId", value)}
                        >
                          <SelectTrigger id="playground-embedding-provider">
                            <SelectValue placeholder="Выберите сервис" />
                          </SelectTrigger>
                          <SelectContent>
                            {activeEmbeddingProviders.map((provider) => (
                              <SelectItem key={provider.id} value={provider.id}>
                                {provider.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="flex flex-col gap-2">
                        <SettingLabelWithTooltip
                          htmlFor="playground-collection"
                          label="Коллекция Qdrant"
                          description="Коллекция с векторным индексом текущего пространства. Пример: `workspace-support`. Пустое значение отключит векторный слой."
                        />
                        <Select
                          value={settings.rag.collection || EMPTY_SELECT_VALUE}
                          onValueChange={(value) =>
                            handleRagSettingsChange(
                              "collection",
                              value === EMPTY_SELECT_VALUE ? "" : value,
                            )
                          }
                        >
                          <SelectTrigger id="playground-collection">
                            <SelectValue placeholder="Без коллекции" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={EMPTY_SELECT_VALUE}>Без коллекции (только BM25)</SelectItem>
                            {vectorCollections.map((collection) => (
                              <SelectItem key={collection.name} value={collection.name}>
                                {collection.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="flex items-center justify-between rounded border px-3 py-2 sm:col-span-2">
                        <SettingLabelWithTooltip
                          htmlFor="playground-ask-ai"
                          label="Ask AI"
                          description="Отключите, чтобы не обращаться к LLM и использовать только поиск по чанкам."
                        />
                        <Switch
                          id="playground-ask-ai"
                          checked={settings.rag.askAiEnabled}
                          onCheckedChange={(checked) => handleRagSettingsChange("askAiEnabled", checked)}
                        />
                      </div>
                      <div className="flex flex-col gap-2">
                        <SettingLabelWithTooltip
                          htmlFor="playground-llm-provider"
                          label="Провайдер LLM"
                          description="Сервис генерации ответа. Пример: «GigaChat» или «OpenAI»."
                        />
                        <Select value={settings.rag.llmProviderId} onValueChange={handleLlmProviderChange}>
                          <SelectTrigger id="playground-llm-provider">
                            <SelectValue placeholder="Выберите провайдера" />
                          </SelectTrigger>
                          <SelectContent>
                            {activeLlmProviders.map((provider) => (
                              <SelectItem key={provider.id} value={provider.id}>
                                {provider.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="flex flex-col gap-2">
                        <SettingLabelWithTooltip
                          htmlFor="playground-llm-model"
                          label="Модель"
                          description="Конкретная модель выбранного провайдера. Пример: `gigachat-pro` для развёрнутых ответов."
                        />
                        <Select
                          value={settings.rag.llmModel || EMPTY_SELECT_VALUE}
                          onValueChange={(value) =>
                            handleRagSettingsChange(
                              "llmModel",
                              value === EMPTY_SELECT_VALUE ? "" : value,
                            )
                          }
                          disabled={availableLlmModels.length === 0}
                        >
                          <SelectTrigger id="playground-llm-model">
                            <SelectValue placeholder="Выберите модель" />
                          </SelectTrigger>
                          <SelectContent>
                            {availableLlmModels.length === 0 ? (
                              <SelectItem value={EMPTY_SELECT_VALUE}>Модель по умолчанию</SelectItem>
                            ) : (
                              availableLlmModels.map((model) => (
                                <SelectItem key={model.value} value={model.value}>
                                  {model.label}
                                </SelectItem>
                              ))
                            )}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="flex flex-col gap-2">
                        <SettingLabelWithTooltip
                          htmlFor="playground-response-format"
                          label="Формат ответа"
                          description="Выберите представление ответа: Markdown для структурированного текста, HTML для встраивания или обычный текст без форматирования."
                        />
                        <Select
                          value={settings.rag.responseFormat}
                          onValueChange={(value) =>
                            handleRagSettingsChange(
                              "responseFormat",
                              value as PlaygroundSettings["rag"]["responseFormat"],
                            )
                          }
                        >
                          <SelectTrigger id="playground-response-format">
                            <SelectValue placeholder="Выберите формат" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="markdown">Markdown</SelectItem>
                            <SelectItem value="html">HTML</SelectItem>
                            <SelectItem value="text">Без форматирования</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="flex flex-col gap-2">
                        <SettingLabelWithTooltip
                          htmlFor="playground-temperature"
                          label="Temperature"
                          description="Степень креативности модели: 0 — строго, 1 — более свободно. Пример: 0.2 для лаконичных ответов."
                        />
                        <Input
                          id="playground-temperature"
                          type="number"
                          min={0}
                          max={2}
                          step={0.1}
                          value={settings.rag.temperature}
                          onChange={(event) =>
                            handleRagSettingsChange("temperature", Math.max(0, Number(event.target.value) || 0))
                          }
                        />
                      </div>
                      <div className="flex flex-col gap-2">
                        <SettingLabelWithTooltip
                          htmlFor="playground-max-tokens"
                          label="Максимум токенов"
                          description="Ограничение на длину ответа в токенах. Пример: 1024 — примерно до 750 слов."
                        />
                        <Input
                          id="playground-max-tokens"
                          type="number"
                          min={128}
                          max={4096}
                          value={settings.rag.maxTokens}
                          onChange={(event) =>
                            handleRagSettingsChange("maxTokens", Math.max(128, Number(event.target.value) || 128))
                          }
                        />
                      </div>
                      <div className="flex flex-col gap-2 sm:col-span-2">
                        <SettingLabelWithTooltip
                          htmlFor="playground-system-prompt"
                          label="Системный промпт"
                          description="Дополнительные инструкции для модели. Пример: «Отвечай как сотрудник службы поддержки, отвечай кратко»."
                        />
                        <Textarea
                          id="playground-system-prompt"
                          rows={4}
                          value={settings.rag.systemPrompt}
                          onChange={(event) => handleRagSettingsChange("systemPrompt", event.target.value)}
                          placeholder="Опционально: задайте контекст ассистенту"
                        />
                      </div>
                      <div className="flex items-center justify-between rounded border px-3 py-2 sm:col-span-2">
                        <SettingLabelWithTooltip
                          htmlFor="playground-include-debug"
                          label="Сырые данные в ответе"
                          description="Показывает технические детали: чанки, usage и сырой JSON. Пример: включите при настройке интеграции, отключите для демонстраций."
                        />
                        <Switch
                          id="playground-include-debug"
                          checked={settings.rag.includeDebug}
                          onCheckedChange={(checked) => handleRagSettingsChange("includeDebug", checked)}
                        />
                      </div>
                    </div>
                  </TabsContent>
                </Tabs>
              </TooltipProvider>
              <DialogFooter className="sm:justify-start">
                <Button type="button" onClick={() => setIsSettingsOpen(false)}>
                  Закрыть
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </header>
      <main className="flex-1 overflow-auto px-4 py-4">
        <div className="grid gap-4 lg:grid-cols-2">
          <section className="flex flex-col gap-3">
            <div className="rounded border px-3 py-2 text-xs text-muted-foreground">
              Все запросы уходят в публичные эндпоинты `/public/search/suggest` и `/api/public/collections/search/rag` с
              текущими настройками. Так можно воспроизвести интеграцию клиента 1:1.
            </div>

            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Подсказки ({flattenedSuggestItems.length})</span>
              {suggestResponse?.meta?.timing_ms !== undefined && (
                <span>Ответ за {formatMs(suggestResponse.meta.timing_ms)}</span>
              )}
            </div>
            {isSuggestLoading && <div className="rounded border px-3 py-6 text-center text-sm">Ищем подсказки…</div>}
            {suggestError && <div className="rounded border border-destructive px-3 py-2 text-sm text-destructive">{suggestError}</div>}
            {!isSuggestLoading && !suggestError && flattenedSuggestItems.length === 0 && query.trim() && (
              <div className="rounded border px-3 py-6 text-center text-sm text-muted-foreground">
                Подсказок не найдено.
              </div>
            )}
            <div className="grid gap-2">
              {flattenedSuggestItems.map(renderSuggestItem)}
            </div>

            {settings.rag.includeDebug && suggestResponse && (
              <div className="mt-2 space-y-2">
                <div className="text-xs font-semibold text-foreground">Сырый ответ</div>
                <pre className="max-h-64 overflow-auto rounded border bg-muted/60 p-2 text-xs text-foreground">
                  {stringifyJson(suggestResponse)}
                </pre>
              </div>
            )}
          </section>

          <section className="flex flex-col gap-3">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Ask AI</span>
              {ragResponse?.timings && (
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">Σ {formatMs(ragResponse.timings.total_ms)}</Badge>
                  <Badge variant="outline">Retrieval {formatMs(ragResponse.timings.retrieval_ms)}</Badge>
                  <Badge variant="outline">LLM {formatMs(ragResponse.timings.llm_ms)}</Badge>
                </div>
              )}
            </div>
            {isRagLoading && <div className="rounded border px-3 py-6 text-center text-sm">Готовим ответ…</div>}
            {ragError && <div className="rounded border border-destructive px-3 py-2 text-sm text-destructive">{ragError}</div>}
            {!isRagLoading && !ragError && !ragResponse && (
              <div className="rounded border px-3 py-6 text-center text-sm text-muted-foreground">
                Отправьте запрос через кнопку «Спросить AI», чтобы увидеть ответ.
              </div>
            )}
            {!isRagLoading && !ragError && ragResponse && (
              <>
                <div className="rounded border px-3 py-3 text-sm leading-relaxed text-foreground">
                  {ragAnswerHtml ? (
                    <div
                      className="prose prose-sm max-w-none text-foreground [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5"
                      dangerouslySetInnerHTML={{ __html: ragAnswerHtml }}
                    />
                  ) : (
                    <span className="text-muted-foreground">Ответ отсутствует.</span>
                  )}
                </div>
                {settings.rag.includeDebug && ragResponse.chunks && ragResponse.chunks.length > 0 && (
                  <div className="space-y-2">
                    <div className="text-xs font-semibold text-foreground">Чанки в контексте</div>
                    <div className="grid gap-2">
                      {ragResponse.chunks.map(renderRagChunk)}
                    </div>
                  </div>
                )}
                {settings.rag.includeDebug && (
                  <div className="space-y-2">
                    <div className="text-xs font-semibold text-foreground">Сырой ответ</div>
                    <pre className="max-h-64 overflow-auto rounded border bg-muted/60 p-2 text-xs text-foreground">
                      {stringifyJson(ragResponse)}
                    </pre>
                  </div>
                )}
              </>
            )}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>Журнал Ask AI</span>
                <div className="flex items-center gap-2">
                  {askAiLogEntries.length > 0 && (
                    <Badge variant="outline" className="text-[11px]">
                      {askAiLogEntries.length}
                    </Badge>
                  )}
                  <Dialog open={isAskAiLogOpen} onOpenChange={setIsAskAiLogOpen}>
                    <DialogTrigger asChild>
                      <Button variant="outline" size="sm" className="h-7 px-3 text-[11px]">
                        Открыть
                      </Button>
                    </DialogTrigger>
                    <DialogContent className="flex h-[90vh] w-[95vw] max-w-[95vw] flex-col gap-4 p-6 sm:w-[90vw] sm:max-w-[90vw]">
                      <DialogHeader className="space-y-1">
                        <DialogTitle>Журнал Ask AI</DialogTitle>
                        <DialogDescription>
                          Пошаговые события запросов к публичным эндпоинтам. Используйте журнал для диагностики интеграции.
                        </DialogDescription>
                      </DialogHeader>
                      <div className="flex flex-1 flex-col gap-3 overflow-hidden">
                        <div className="flex items-center justify-between text-xs text-muted-foreground">
                          <span>
                            Всего записей: {askAiLogEntries.length}
                          </span>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-3 text-[11px]"
                            onClick={clearAskAiLog}
                            disabled={askAiLogEntries.length === 0}
                          >
                            Очистить
                          </Button>
                        </div>
                        <div
                          ref={askAiLogContainerRef}
                          className="flex-1 overflow-auto rounded border bg-muted/40 p-3 text-xs text-foreground"
                        >
                          {askAiLogEntries.length === 0 ? (
                            <div className="text-muted-foreground">
                              Журнал пуст. Отправьте запрос, чтобы увидеть шаги.
                            </div>
                          ) : (
                            <div className="space-y-2">{askAiLogEntries.map(renderAskAiLogEntry)}</div>
                          )}
                        </div>
                      </div>
                      <DialogFooter className="flex flex-col gap-2 sm:flex-row sm:justify-between">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={clearAskAiLog}
                          disabled={askAiLogEntries.length === 0}
                        >
                          Очистить журнал
                        </Button>
                        <Button size="sm" onClick={() => setIsAskAiLogOpen(false)}>
                          Закрыть
                        </Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                </div>
              </div>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
