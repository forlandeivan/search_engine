import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Settings, Search as SearchIcon, RefreshCcw } from "lucide-react";
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
import type { KnowledgeBaseSummary } from "@shared/knowledge-base";
import type { PublicEmbeddingProvider, PublicLlmProvider } from "@shared/schema";

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

const DEFAULT_SETTINGS: PlaygroundSettings = {
  knowledgeBaseId: "",
  suggestLimit: 3,
  rag: {
    topK: 4,
    bm25Weight: 0.5,
    vectorWeight: 0.5,
    bm25Limit: 4,
    vectorLimit: 4,
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

export default function SearchPlaygroundPage() {
  const [settings, setSettings] = useState<PlaygroundSettings>(DEFAULT_SETTINGS);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [suggestResponse, setSuggestResponse] = useState<SuggestResponsePayload | null>(null);
  const [ragResponse, setRagResponse] = useState<RagResponsePayload | null>(null);
  const [suggestError, setSuggestError] = useState<string | null>(null);
  const [ragError, setRagError] = useState<string | null>(null);
  const [isSuggestLoading, setIsSuggestLoading] = useState(false);
  const [isRagLoading, setIsRagLoading] = useState(false);

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

  const knowledgeBases = knowledgeBasesQuery.data ?? [];
  const activeEmbeddingProviders = useMemo(() => {
    const providers = embeddingProvidersQuery.data?.providers ?? [];
    return providers.filter((provider) => provider.isActive);
  }, [embeddingProvidersQuery.data?.providers]);

  const activeLlmProviders = useMemo(() => {
    const providers = llmProvidersQuery.data?.providers ?? [];
    return providers.filter((provider) => provider.isActive);
  }, [llmProvidersQuery.data?.providers]);

  useEffect(() => {
    if (!settings.knowledgeBaseId && knowledgeBases.length > 0) {
      setSettings((prev) => ({
        ...prev,
        knowledgeBaseId: knowledgeBases[0]?.id ?? "",
      }));
    }
  }, [knowledgeBases, settings.knowledgeBaseId]);

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
          llmModel: provider?.model ?? "",
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
      return () => {
        cancelled = true;
      };
    }

    const runRag = async () => {
      setIsRagLoading(true);
      setRagError(null);

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
    setSettings((prev) => ({
      ...prev,
      rag: {
        ...prev.rag,
        [key]: value,
      },
    }));
  };

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
            <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
              <DialogHeader>
                <DialogTitle>Настройки песочницы</DialogTitle>
                <DialogDescription>
                  Настройте базу знаний, параметры поиска и генерации ответа. Все параметры применяются сразу после
                  сохранения.
                </DialogDescription>
              </DialogHeader>
              <div className="mt-4 space-y-6">
                <section className="space-y-3">
                  <h3 className="text-sm font-semibold text-foreground">База знаний</h3>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="playground-kb">База знаний</Label>
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
                      <p className="text-xs text-muted-foreground">
                        Выберите базу знаний, по которой будут искаться подсказки и формироваться RAG-ответ.
                      </p>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="playground-limit">Количество подсказок</Label>
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
                      <p className="text-xs text-muted-foreground">
                        Сколько чанков показывать в блоке подсказок (верхний слой поиска).
                      </p>
                    </div>
                  </div>
                </section>

                <section className="space-y-3">
                  <h3 className="text-sm font-semibold text-foreground">RAG</h3>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="playground-topk">Top-K</Label>
                      <Input
                        id="playground-topk"
                        type="number"
                        min={1}
                        max={10}
                        value={settings.rag.topK}
                        onChange={(event) =>
                          handleRagSettingsChange("topK", Math.max(1, Number(event.target.value) || 1))
                        }
                      />
                      <p className="text-xs text-muted-foreground">Количество чанков, которое попадёт в итоговый ответ.</p>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="playground-bm25-weight">Вес BM25</Label>
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
                      <p className="text-xs text-muted-foreground">Вклад полнотекстового поиска при ранжировании чанков.</p>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="playground-vector-weight">Вес векторов</Label>
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
                      <p className="text-xs text-muted-foreground">
                        Вклад векторного поиска. При отсутствии коллекции вес будет проигнорирован.
                      </p>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="playground-bm25-limit">Чанков BM25</Label>
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
                      <p className="text-xs text-muted-foreground">
                        Сколько результатов BM25 учитывать перед объединением.
                      </p>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="playground-vector-limit">Чанков векторов</Label>
                      <Input
                        id="playground-vector-limit"
                        type="number"
                        min={1}
                        max={20}
                        value={settings.rag.vectorLimit}
                        onChange={(event) =>
                          handleRagSettingsChange("vectorLimit", Math.max(1, Number(event.target.value) || 1))
                        }
                      />
                      <p className="text-xs text-muted-foreground">
                        Ограничение на количество векторных совпадений.
                      </p>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="playground-embedding-provider">Сервис эмбеддингов</Label>
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
                      <p className="text-xs text-muted-foreground">
                        Используется для построения вектора запроса перед обращением к Qdrant.
                      </p>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="playground-collection">Коллекция Qdrant</Label>
                      <Input
                        id="playground-collection"
                        value={settings.rag.collection}
                        onChange={(event) => handleRagSettingsChange("collection", event.target.value)}
                        placeholder="knowledge-collection"
                      />
                      <p className="text-xs text-muted-foreground">
                        Имя коллекции Qdrant. Оставьте пустым, чтобы отключить векторный слой.
                      </p>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="playground-llm-provider">Провайдер LLM</Label>
                      <Select
                        value={settings.rag.llmProviderId}
                        onValueChange={(value) => handleRagSettingsChange("llmProviderId", value)}
                      >
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
                      <p className="text-xs text-muted-foreground">
                        Модель LLM, которая будет формировать итоговый ответ.
                      </p>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="playground-llm-model">Модель</Label>
                      <Input
                        id="playground-llm-model"
                        value={settings.rag.llmModel}
                        onChange={(event) => handleRagSettingsChange("llmModel", event.target.value)}
                        placeholder="gigachat-pro"
                      />
                      <p className="text-xs text-muted-foreground">
                        Оставьте пустым, чтобы использовать модель по умолчанию из настроек провайдера.
                      </p>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="playground-temperature">Temperature</Label>
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
                      <p className="text-xs text-muted-foreground">Контролирует креативность ответа.</p>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="playground-max-tokens">Максимум токенов</Label>
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
                      <p className="text-xs text-muted-foreground">Лимит токенов для ответа LLM.</p>
                    </div>
                    <div className="flex flex-col gap-1.5 sm:col-span-2">
                      <Label htmlFor="playground-system-prompt">Системный промпт</Label>
                      <Textarea
                        id="playground-system-prompt"
                        rows={4}
                        value={settings.rag.systemPrompt}
                        onChange={(event) => handleRagSettingsChange("systemPrompt", event.target.value)}
                        placeholder="Опционально: задайте контекст ассистенту"
                      />
                      <p className="text-xs text-muted-foreground">
                        Если оставить поле пустым, будет использован промпт из настроек провайдера LLM.
                      </p>
                    </div>
                    <div className="flex items-center justify-between rounded border px-3 py-2 sm:col-span-2">
                      <div>
                        <p className="text-sm font-medium text-foreground">Сырые данные в ответе</p>
                        <p className="text-xs text-muted-foreground">
                          Отображать отладочную информацию (контекст, сырые ответы сервисов).
                        </p>
                      </div>
                      <Switch
                        checked={settings.rag.includeDebug}
                        onCheckedChange={(checked) => handleRagSettingsChange("includeDebug", checked)}
                      />
                    </div>
                  </div>
                </section>
              </div>
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
                  {ragResponse.answer || "Ответ отсутствует."}
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
