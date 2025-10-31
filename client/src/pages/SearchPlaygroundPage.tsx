import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Settings, Search as SearchIcon, RefreshCcw, HelpCircle } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
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
import type { PublicEmbeddingProvider, PublicLlmProvider, LlmModelOption } from "@shared/schema";

interface SuggestResponseSection {
  chunk_id: string;
  doc_id: string;
  doc_title: string;
  section_title: string | null;
  snippet: string;
  score: number;
  source?: string;
}

interface SuggestResponsePayload {
  query: string;
  kb_id: string;
  normalized_query: string;
  ask_ai: { label: string; query: string };
  sections: SuggestResponseSection[];
  timings?: { total_ms?: number };
}

interface RagChunk {
  chunk_id: string;
  doc_id: string;
  doc_title: string;
  section_title: string | null;
  snippet: string;
  text?: string;
  score: number;
  scores?: { bm25?: number; vector?: number };
}

interface RagResponsePayload {
  query: string;
  kb_id: string;
  normalized_query: string;
  answer: string;
  citations: RagChunk[];
  chunks?: RagChunk[];
  usage?: { embeddingTokens?: number | null; llmTokens?: number | null };
  timings?: {
    total_ms?: number;
    retrieval_ms?: number;
    bm25_ms?: number;
    vector_ms?: number;
    llm_ms?: number;
  };
  debug?: { vectorSearch?: Array<Record<string, unknown>> | null };
}

interface VectorCollectionSummary {
  name: string;
}

interface VectorCollectionsResponse {
  collections: VectorCollectionSummary[];
}

type PlaygroundSettings = {
  knowledgeBaseId: string;
  suggestLimit: number;
  rag: {
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

const DEFAULT_SETTINGS: PlaygroundSettings = {
  knowledgeBaseId: "",
  suggestLimit: 3,
  rag: {
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
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<"search" | "rag">("search");
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [suggestResponse, setSuggestResponse] = useState<SuggestResponsePayload | null>(null);
  const [ragResponse, setRagResponse] = useState<RagResponsePayload | null>(null);
  const [suggestError, setSuggestError] = useState<string | null>(null);
  const [ragError, setRagError] = useState<string | null>(null);
  const [isSuggestLoading, setIsSuggestLoading] = useState(false);
  const [isRagLoading, setIsRagLoading] = useState(false);
  const [streamedAnswer, setStreamedAnswer] = useState("");

  const knowledgeBasesQuery = useQuery<KnowledgeBaseSummary[]>({
    queryKey: ["/api/knowledge/bases"],
    queryFn: async () => {
      const response = await apiRequest("GET", "/api/knowledge/bases");
      return (await response.json()) as KnowledgeBaseSummary[];
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

  const knowledgeBases = knowledgeBasesQuery.data ?? [];
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
    if (!isSettingsOpen) {
      setSettingsTab("search");
    }
  }, [isSettingsOpen]);

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
      setDebouncedQuery("");
      return;
    }

    const timeout = setTimeout(() => {
      setDebouncedQuery(query.trim());
    }, 250);

    return () => clearTimeout(timeout);
  }, [query]);

  const knowledgeBaseName = useMemo(() => {
    return knowledgeBases.find((base) => base.id === settings.knowledgeBaseId)?.name ?? "";
  }, [knowledgeBases, settings.knowledgeBaseId]);

  const vectorLayerReady = useMemo(() => {
    if (settings.rag.vectorWeight <= 0) {
      return false;
    }

    const providerId = settings.rag.embeddingProviderId?.trim() ?? "";
    const collection = settings.rag.collection?.trim() ?? "";

    return Boolean(providerId && collection);
  }, [
    settings.rag.collection,
    settings.rag.embeddingProviderId,
    settings.rag.vectorWeight,
  ]);

  const ragConfigurationError = useMemo(() => {
    if (!settings.rag.llmProviderId) {
      return "Выберите провайдера LLM, чтобы Ask AI сформировал ответ.";
    }

    if (settings.rag.bm25Weight <= 0 && settings.rag.vectorWeight <= 0) {
      return "Включите хотя бы один слой поиска (BM25 или векторный).";
    }

    if (settings.rag.vectorWeight > 0 && !vectorLayerReady) {
      return "Заполните коллекцию Qdrant и сервис эмбеддингов или уменьшите вес векторного поиска.";
    }

    return null;
  }, [
    settings.rag.bm25Weight,
    settings.rag.llmProviderId,
    settings.rag.vectorWeight,
    vectorLayerReady,
  ]);

  const searchKey = useMemo(
    () =>
      JSON.stringify({
        knowledgeBaseId: settings.knowledgeBaseId,
        suggestLimit: settings.suggestLimit,
        rag: {
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
    if (!debouncedQuery || !settings.knowledgeBaseId) {
      setSuggestResponse(null);
      setRagResponse(null);
      setSuggestError(null);
      setRagError(null);
      setIsSuggestLoading(false);
      setIsRagLoading(false);
      setStreamedAnswer("");
      return;
    }

    let cancelled = false;

    const runSuggest = async () => {
      setIsSuggestLoading(true);
      setSuggestError(null);

      try {
        const suggestParams = new URLSearchParams({
          q: debouncedQuery,
          kb_id: settings.knowledgeBaseId,
          limit: String(settings.suggestLimit),
        });

        const suggestResponseRaw = await fetch(`/public/search/suggest?${suggestParams.toString()}`);
        if (!suggestResponseRaw.ok) {
          const fallbackMessage =
            suggestResponseRaw.status === 404
              ? "База знаний не найдена или недоступна."
              : "Не удалось получить подсказки.";
          const errorMessage = (await extractErrorMessage(suggestResponseRaw)) ?? fallbackMessage;
          throw new Error(`${errorMessage} (код ${suggestResponseRaw.status})`);
        }
        const suggestJson = (await suggestResponseRaw.json()) as SuggestResponsePayload;

        if (!cancelled) {
          setSuggestResponse(suggestJson);
        }
      } catch (error) {
        console.error("Search playground suggest error", error);
        if (!cancelled) {
          const message =
            error instanceof Error && error.message
              ? error.message
              : "Не удалось получить подсказки.";
          setSuggestError(message);
          setSuggestResponse(null);
        }
      } finally {
        if (!cancelled) {
          setIsSuggestLoading(false);
        }
      }
    };

    void runSuggest();

    if (ragConfigurationError) {
      setRagResponse(null);
      setIsRagLoading(false);
      setRagError(ragConfigurationError);
      setStreamedAnswer("");
      return () => {
        cancelled = true;
      };
    }

    const runRag = async () => {
      setIsRagLoading(true);
      setRagError(null);
      setStreamedAnswer("");

      try {
        const payload: Record<string, unknown> = {
          q: debouncedQuery,
          kb_id: settings.knowledgeBaseId,
          top_k: settings.rag.topK,
          hybrid: {
            bm25: {
              weight: settings.rag.bm25Weight,
              limit: settings.rag.bm25Limit,
            },
            vector: {
              weight: settings.rag.vectorWeight,
              limit: settings.rag.vectorLimit,
              collection: settings.rag.collection || undefined,
              embedding_provider_id: settings.rag.embeddingProviderId || undefined,
            },
          },
          llm: {
            provider: settings.rag.llmProviderId,
            model: settings.rag.llmModel || undefined,
            temperature: settings.rag.temperature,
            max_tokens: settings.rag.maxTokens,
            system_prompt: settings.rag.systemPrompt || undefined,
            response_format: settings.rag.responseFormat,
          },
        };

        const ragResponseRaw = await fetch("/public/rag/answer", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        if (!ragResponseRaw.ok) {
          const fallbackMessage =
            ragResponseRaw.status === 503
              ? "Сервис RAG временно недоступен. Попробуйте позже."
              : "Не удалось получить ответ от LLM.";
          const errorMessage = (await extractErrorMessage(ragResponseRaw)) ?? fallbackMessage;
          throw new Error(`${errorMessage} (код ${ragResponseRaw.status})`);
        }

        const ragJson = (await ragResponseRaw.json()) as RagResponsePayload;
        if (!cancelled) {
          setRagResponse(ragJson);
        }
      } catch (error) {
        console.error("Search playground RAG error", error);
        if (!cancelled) {
          const message =
            error instanceof Error && error.message
              ? error.message
              : "Не удалось получить ответ от LLM.";
          setRagError(message);
          setRagResponse(null);
          setStreamedAnswer("");
        }
      } finally {
        if (!cancelled) {
          setIsRagLoading(false);
        }
      }
    };

    void runRag();

    return () => {
      cancelled = true;
    };
  }, [debouncedQuery, ragConfigurationError, searchKey, settings.knowledgeBaseId]);

  const resetResults = () => {
    setQuery("");
    setDebouncedQuery("");
    setSuggestResponse(null);
    setRagResponse(null);
    setSuggestError(null);
    setRagError(null);
    setIsSuggestLoading(false);
    setIsRagLoading(false);
    setStreamedAnswer("");
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

  const renderSection = (section: SuggestResponseSection, index: number) => {
    const scoreValue = Number.isFinite(section.score) ? section.score : 0;

    return (
      <div key={`${section.chunk_id}-${index}`} className="rounded border px-3 py-2">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>#{index + 1}</span>
          <span className="font-mono">{scoreValue.toFixed(3)}</span>
        </div>
        <div className="mt-1 text-sm font-semibold text-foreground">
          {section.section_title || section.doc_title || "Без заголовка"}
        </div>
        <div className="text-xs text-muted-foreground">{section.doc_title}</div>
        <p className="mt-2 text-sm leading-snug text-foreground">{section.snippet}</p>
        {section.source && (
          <div className="mt-2 text-[11px] uppercase tracking-wide text-muted-foreground">
            {section.source === "content" ? "BM25" : "Заголовок"}
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
                      Все запросы уходят в публичные эндпоинты `/public/search/suggest` и `/public/rag/answer` с текущими
                      настройками. Так можно воспроизвести интеграцию клиента 1:1.
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
            <div className="flex items-center gap-2">
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Введите вопрос"
                className="flex-1"
              />
              <Button
                variant="secondary"
                onClick={() => setDebouncedQuery(query.trim())}
                disabled={!query.trim() || isSuggestLoading || isRagLoading}
              >
                Найти
              </Button>
            </div>
            <div className="rounded border px-3 py-2 text-xs text-muted-foreground">
              Все запросы уходят в публичные эндпоинты `/public/search/suggest` и `/public/rag/answer` с текущими
              настройками. Так можно воспроизвести интеграцию клиента 1:1.
            </div>

            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Подсказки ({suggestResponse?.sections.length ?? 0})</span>
              {suggestResponse?.timings?.total_ms !== undefined && (
                <span>Ответ за {formatMs(suggestResponse.timings.total_ms)}</span>
              )}
            </div>
            {isSuggestLoading && <div className="rounded border px-3 py-6 text-center text-sm">Ищем подсказки…</div>}
            {suggestError && <div className="rounded border border-destructive px-3 py-2 text-sm text-destructive">{suggestError}</div>}
            {!isSuggestLoading && !suggestError && suggestResponse?.sections.length === 0 && debouncedQuery && (
              <div className="rounded border px-3 py-6 text-center text-sm text-muted-foreground">
                Подсказок не найдено.
              </div>
            )}
            <div className="grid gap-2">
              {suggestResponse?.sections.map(renderSection)}
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
            {!isRagLoading && !ragError && ragResponse && (
              <>
                <div className="rounded border px-3 py-3 text-sm leading-relaxed text-foreground">
                  {streamedAnswer || ragResponse.answer || "Ответ отсутствует."}
                </div>
                <div className="space-y-2">
                  <div className="text-xs font-semibold text-foreground">Цитаты</div>
                  <div className="grid gap-2">
                    {ragResponse.citations.map(renderRagChunk)}
                  </div>
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
          </section>
        </div>
      </main>
    </div>
  );
}
