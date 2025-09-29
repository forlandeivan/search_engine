import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Loader2, Sparkles, Hash, ListOrdered, Gauge } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  castValueToType,
  normalizeArrayValue,
  renderLiquidTemplate,
  type CollectionSchemaFieldInput,
  type VectorizeCollectionSchema,
} from "@shared/vectorization";
import {
  type Page,
  type Site,
  type ContentChunk,
  type PublicEmbeddingProvider,
} from "@shared/schema";
import { GIGACHAT_EMBEDDING_VECTOR_SIZE } from "@shared/constants";

interface VectorCollectionListResponse {
  collections: Array<{
    name: string;
    status: string;
    vectorSize: number | null;
  }>;
}

interface VectorizeRequestPayload {
  providerId: string;
  collectionName?: string;
  createCollection?: boolean;
  schema?: VectorizeCollectionSchema | null;
}

interface VectorizeProjectResponse {
  message?: string;
  pointsCount: number;
  collectionName: string;
  vectorSize?: number | null;
  totalUsageTokens?: number;
  collectionCreated?: boolean;
  pagesProcessed?: number;
}

interface CollectionSchemaField extends CollectionSchemaFieldInput {
  id: string;
}

interface ProjectChunkEntry {
  page: Page;
  chunk: ContentChunk;
  index: number;
  totalChunks: number;
}

interface VectorizeProjectDialogProps {
  site: Site;
  pages: Page[];
  providers: PublicEmbeddingProvider[];
}

const TEMPLATE_PATH_LIMIT = 400;
const TEMPLATE_SUGGESTION_LIMIT = 150;
const DEFAULT_NEW_COLLECTION_NAME = "New Collection";

function generateFieldId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return Math.random().toString(36).slice(2);
}

function createSchemaField(partial?: Partial<Omit<CollectionSchemaField, "id">>): CollectionSchemaField {
  return {
    id: generateFieldId(),
    name: "",
    type: "string",
    isArray: false,
    template: "",
    ...partial,
  };
}

function getDefaultSchemaFields(): CollectionSchemaField[] {
  return [
    createSchemaField({ name: "content", template: "{{ chunk.text }}" }),
    createSchemaField({ name: "title", template: "{{ page.title }}" }),
    createSchemaField({ name: "url", template: "{{ page.url }}" }),
  ];
}

function collectTemplatePaths(source: unknown, limit = TEMPLATE_PATH_LIMIT): string[] {
  if (!source || typeof source !== "object") {
    return [];
  }

  const paths = new Set<string>();
  const visited = new WeakSet<object>();

  const visit = (value: unknown, path: string) => {
    if (paths.size >= limit) {
      return;
    }

    if (value && typeof value === "object") {
      const objectValue = value as object;
      if (visited.has(objectValue)) {
        return;
      }
      visited.add(objectValue);
    }

    if (path) {
      paths.add(path);
    }

    if (paths.size >= limit) {
      return;
    }

    if (Array.isArray(value)) {
      value.slice(0, 5).forEach((item, index) => {
        const nextPath = path ? `${path}[${index}]` : `[${index}]`;
        visit(item, nextPath);
      });
      return;
    }

    if (value && typeof value === "object") {
      Object.entries(value as Record<string, unknown>).forEach(([key, child]) => {
        if (paths.size >= limit) {
          return;
        }
        const nextPath = path ? `${path}.${key}` : key;
        visit(child, nextPath);
      });
    }
  };

  visit(source, "");

  return Array.from(paths).sort((a, b) => a.localeCompare(b, "ru"));
}

function sanitizeCollectionName(source: string): string {
  return source.replace(/[^a-zA-Z0-9_-]/g, "").toLowerCase();
}

function removeUndefinedDeep<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => removeUndefinedDeep(item)) as unknown as T;
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, current]) => current !== undefined)
      .map(([key, current]) => [key, removeUndefinedDeep(current)]);
    return Object.fromEntries(entries) as unknown as T;
  }

  return value;
}

function parseVectorSize(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      return null;
    }

    const parsed = Number.parseInt(trimmed, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }

  return null;
}

function buildLiquidContext(
  site: Site,
  page: Page,
  chunk: ContentChunk,
  provider: PublicEmbeddingProvider | undefined,
  totalChunks: number,
) {
  const chunkPositionRaw = chunk.metadata?.position;
  const chunkPosition = typeof chunkPositionRaw === "number" ? chunkPositionRaw : 0;
  const chunkIndex = chunkPosition;
  const chunkCharCount = chunk.metadata?.charCount ?? chunk.content.length;
  const chunkWordCount = chunk.metadata?.wordCount ?? null;
  const baseChunkId =
    chunk.id && chunk.id.trim().length > 0
      ? chunk.id
      : `${page.id}-chunk-${chunkIndex}`;

  const metadataRecord =
    page.metadata && typeof page.metadata === "object"
      ? (page.metadata as unknown as Record<string, unknown>)
      : undefined;
  const siteNameValue = metadataRecord?.["siteName"];
  const siteUrlValue = metadataRecord?.["siteUrl"];

  const payload = {
    page: {
      id: page.id,
      url: page.url,
      title: page.title ?? null,
      totalChunks,
      chunkCharLimit: site?.maxChunkSize ?? null,
      metadata: page.metadata ?? null,
    },
    site: {
      id: site.id,
      name: typeof siteNameValue === "string" ? siteNameValue : site?.name ?? null,
      url: typeof siteUrlValue === "string" ? siteUrlValue : site?.url ?? null,
    },
    provider: {
      id: provider?.id ?? null,
      name: provider?.name ?? null,
    },
    chunk: {
      id: baseChunkId,
      index: chunkIndex,
      position: chunkPosition,
      heading: chunk.heading ?? null,
      level: chunk.level ?? null,
      deepLink: chunk.deepLink ?? null,
      text: chunk.content,
      charCount: chunkCharCount,
      wordCount: chunkWordCount,
      excerpt: chunk.metadata?.excerpt ?? null,
      metadata: chunk.metadata ?? null,
    },
    embedding: {
      model: provider?.model ?? null,
      vectorSize:
        typeof provider?.qdrantConfig?.vectorSize === "number"
          ? provider?.qdrantConfig?.vectorSize
          : typeof provider?.qdrantConfig?.vectorSize === "string"
          ? provider?.qdrantConfig?.vectorSize
          : null,
      tokens: null,
      id: null,
    },
  };

  return removeUndefinedDeep(payload);
}

export default function VectorizeProjectDialog({ site, pages, providers }: VectorizeProjectDialogProps) {
  const { toast } = useToast();
  const [isOpen, setIsOpen] = useState(false);
  const [selectedProviderId, setSelectedProviderId] = useState<string>("");
  const [collectionMode, setCollectionMode] = useState<"existing" | "new">("existing");
  const [selectedCollectionName, setSelectedCollectionName] = useState<string>("");
  const [newCollectionName, setNewCollectionName] = useState<string>(DEFAULT_NEW_COLLECTION_NAME);
  const initialEmbeddingFieldIdRef = useRef<string | null>(null);
  const [schemaFields, setSchemaFields] = useState<CollectionSchemaField[]>(() => {
    const defaults = getDefaultSchemaFields();
    initialEmbeddingFieldIdRef.current =
      defaults.find((field) => field.name === "content")?.id ?? defaults[0]?.id ?? null;
    return defaults;
  });
  const [embeddingFieldId, setEmbeddingFieldId] = useState<string | null>(
    () => initialEmbeddingFieldIdRef.current,
  );
  const [activeTab, setActiveTab] = useState<"settings" | "context">("settings");
  const [activeSuggestionsFieldId, setActiveSuggestionsFieldId] = useState<string | null>(null);
  const templateFieldRefs = useRef<Record<string, HTMLTextAreaElement | null>>({});

  const projectChunks = useMemo<ProjectChunkEntry[]>(() => {
    return pages.flatMap((page) => {
      const chunks = Array.isArray(page.chunks) ? (page.chunks as ContentChunk[]) : [];
      const nonEmptyChunks = chunks.filter(
        (chunk) => typeof chunk.content === "string" && chunk.content.trim().length > 0,
      );

      return nonEmptyChunks.map((chunk, index) => ({
        page,
        chunk,
        index,
        totalChunks: nonEmptyChunks.length,
      }));
    });
  }, [pages]);

  const totalChunks = projectChunks.length;
  const totalCharacters = useMemo(() => {
    return projectChunks.reduce((sum, entry) => {
      const charCount = entry.chunk.metadata?.charCount ?? entry.chunk.content.length;
      return sum + charCount;
    }, 0);
  }, [projectChunks]);
  const estimatedTokens = totalCharacters > 0 ? Math.ceil(totalCharacters / 4) : 0;
  const processedPagesCount = useMemo(() => {
    return new Set(projectChunks.map((entry) => entry.page.id)).size;
  }, [projectChunks]);
  const firstEntry = projectChunks[0] ?? null;

  const {
    data: collectionsData,
    isLoading: collectionsLoading,
    isFetching: collectionsFetching,
    error: collectionsError,
  } = useQuery<VectorCollectionListResponse>({
    queryKey: ["/api/vector/collections"],
    enabled: isOpen,
    staleTime: 30_000,
  });

  const collections = collectionsData?.collections ?? [];
  const isCollectionsLoading = collectionsLoading || collectionsFetching;
  const selectedProvider = useMemo(
    () => providers.find((provider) => provider.id === selectedProviderId),
    [providers, selectedProviderId],
  );
  const providerVectorSize = useMemo(() => {
    if (!selectedProvider) {
      return null;
    }

    const configuredSize = parseVectorSize(selectedProvider.qdrantConfig?.vectorSize);
    if (configuredSize) {
      return configuredSize;
    }

    if (selectedProvider.providerType === "gigachat") {
      return GIGACHAT_EMBEDDING_VECTOR_SIZE;
    }

    return null;
  }, [selectedProvider]);
  const availableCollections = useMemo(() => {
    if (!providerVectorSize) {
      return collections;
    }

    return collections.filter(
      (collection) => parseVectorSize(collection.vectorSize) === providerVectorSize,
    );
  }, [collections, providerVectorSize]);
  const filteredOutCollectionsCount = collections.length - availableCollections.length;

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    if (providers.length > 0) {
      setSelectedProviderId(providers[0].id);
    } else {
      setSelectedProviderId("");
    }
  }, [providers, isOpen]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    if (!newCollectionName) {
      setNewCollectionName(DEFAULT_NEW_COLLECTION_NAME);
    }
  }, [isOpen, newCollectionName]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    if (availableCollections.length === 0) {
      if (collectionMode !== "new") {
        setCollectionMode("new");
      }
      if (selectedCollectionName) {
        setSelectedCollectionName("");
      }
      return;
    }

    if (collectionMode !== "existing") {
      return;
    }

    if (!availableCollections.some((collection) => collection.name === selectedCollectionName)) {
      setSelectedCollectionName(availableCollections[0].name);
    }
  }, [availableCollections, collectionMode, isOpen, selectedCollectionName]);

  const liquidContext = useMemo(() => {
    if (!firstEntry) {
      return null;
    }

    return buildLiquidContext(site, firstEntry.page, firstEntry.chunk, selectedProvider, firstEntry.totalChunks);
  }, [firstEntry, site, selectedProvider]);

  const liquidContextJson = useMemo(() => {
    if (!liquidContext) {
      return "";
    }

    try {
      return JSON.stringify(liquidContext, null, 2);
    } catch (error) {
      console.error("Не удалось подготовить JSON контекста проекта", error);
      return "";
    }
  }, [liquidContext]);

  const templateVariableSuggestions = useMemo(() => {
    if (!liquidContext) {
      return [];
    }

    return collectTemplatePaths(liquidContext);
  }, [liquidContext]);

  const limitedTemplateVariableSuggestions = useMemo(
    () => templateVariableSuggestions.slice(0, TEMPLATE_SUGGESTION_LIMIT),
    [templateVariableSuggestions],
  );
  const hasMoreTemplateSuggestions =
    templateVariableSuggestions.length > TEMPLATE_SUGGESTION_LIMIT;

  useEffect(() => {
    if (templateVariableSuggestions.length === 0) {
      setActiveSuggestionsFieldId(null);
    }
  }, [templateVariableSuggestions.length]);

  const schemaPayload = useMemo(() => {
    const normalizedFields = schemaFields
      .map((field) => {
        const trimmedName = field.name.trim();
        if (!trimmedName) {
          return null;
        }

        return {
          name: trimmedName,
          type: field.type,
          isArray: field.isArray,
          template: field.template ?? "",
        } satisfies CollectionSchemaFieldInput;
      })
      .filter((field): field is CollectionSchemaFieldInput => field !== null);

    if (normalizedFields.length === 0) {
      return null;
    }

    const embeddingName =
      embeddingFieldId && schemaFields.find((field) => field.id === embeddingFieldId)?.name;

    return {
      fields: normalizedFields,
      embeddingFieldName:
        embeddingName && normalizedFields.some((field) => field.name === embeddingName)
          ? embeddingName
          : null,
    } satisfies VectorizeCollectionSchema;
  }, [schemaFields, embeddingFieldId]);

  const disabled = providers.length === 0 || totalChunks === 0;
  const confirmDisabled =
    disabled ||
    !selectedProviderId ||
    (collectionMode === "existing"
      ? availableCollections.length === 0 || !selectedCollectionName
      : newCollectionName.trim().length === 0 || !schemaPayload);

  const collectionsErrorMessage =
    collectionsError instanceof Error ? collectionsError.message : undefined;

  const tokensHint =
    estimatedTokens > 0 ? `${estimatedTokens.toLocaleString("ru-RU")} токенов` : "недоступно";

  const resetSchemaBuilder = () => {
    const defaults = getDefaultSchemaFields();
    const defaultEmbedding = defaults.find((field) => field.name === "content") ?? defaults[0] ?? null;
    setSchemaFields(defaults);
    setEmbeddingFieldId(defaultEmbedding?.id ?? null);
  };

  const handleAddSchemaField = () => {
    const newField = createSchemaField();
    setSchemaFields((prev) => [...prev, newField]);
    setEmbeddingFieldId((current) => current ?? newField.id);
  };

  const handleUpdateSchemaField = (
    id: string,
    patch: Partial<Omit<CollectionSchemaField, "id">>,
  ) => {
    setSchemaFields((prev) =>
      prev.map((field) => (field.id === id ? { ...field, ...patch } : field)),
    );
  };

  const handleDeleteSchemaField = (id: string) => {
    setSchemaFields((prev) => prev.filter((field) => field.id !== id));
    setEmbeddingFieldId((current) => (current === id ? null : current));
  };

  const handleSchemaFieldKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>, id: string) => {
    if (event.key === "Tab" && !event.shiftKey) {
      event.preventDefault();
      const textarea = templateFieldRefs.current[id];
      if (!textarea) {
        return;
      }

      const { selectionStart, selectionEnd, value } = textarea;
      const before = value.slice(0, selectionStart);
      const after = value.slice(selectionEnd);
      const nextValue = `${before}  ${after}`;
      textarea.value = nextValue;
      textarea.selectionStart = textarea.selectionEnd = selectionStart + 2;
      handleUpdateSchemaField(id, { template: nextValue });
    }
  };

  const handleToggleArrayField = (id: string, checked: boolean) => {
    handleUpdateSchemaField(id, { isArray: checked });
  };

  const handleCollectionModeChange = (value: string) => {
    setCollectionMode(value === "existing" ? "existing" : "new");
  };

  const handleOpenChange = (open: boolean) => {
    setIsOpen(open);
    if (open) {
      setActiveTab("settings");
      setActiveSuggestionsFieldId(null);
      templateFieldRefs.current = {};
      return;
    }

    setCollectionMode(availableCollections.length > 0 ? "existing" : "new");
    setSelectedCollectionName(availableCollections[0]?.name ?? "");
    setNewCollectionName(DEFAULT_NEW_COLLECTION_NAME);
    resetSchemaBuilder();
    setActiveSuggestionsFieldId(null);
    setActiveTab("settings");
    templateFieldRefs.current = {};
  };

  const vectorizeMutation = useMutation<VectorizeProjectResponse, Error, VectorizeRequestPayload>({
    mutationFn: async ({ providerId, collectionName, createCollection: createNew, schema }) => {
      const body: Record<string, unknown> = {
        embeddingProviderId: providerId,
        collectionName,
        createCollection: createNew,
      };

      if (schema && schema.fields.length > 0) {
        body.schema = schema;
      }

      const response = await apiRequest("POST", `/api/sites/${site.id}/vectorize`, body);
      return (await response.json()) as VectorizeProjectResponse;
    },
    onSuccess: (data) => {
      const collectionNote = data.collectionCreated
        ? `Коллекция ${data.collectionName} создана автоматически.`
        : "";
      const pagesCount = data.pagesProcessed ?? processedPagesCount;
      toast({
        title: "Чанки отправлены",
        description:
          data.message ??
          `Добавлено ${data.pointsCount} чанков из ${pagesCount} страниц в коллекцию ${data.collectionName}. ${collectionNote}`.trim(),
      });
      setIsOpen(false);
    },
    onError: (error) => {
      toast({
        title: "Не удалось отправить чанки",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleConfirm = () => {
    if (!selectedProviderId) {
      toast({
        title: "Выберите сервис",
        description: "Чтобы отправить чанки, выберите активный сервис эмбеддингов.",
        variant: "destructive",
      });
      return;
    }

    if (collectionMode === "existing") {
      if (!selectedCollectionName) {
        toast({
          title: "Выберите коллекцию",
          description: "Укажите коллекцию Qdrant для загрузки чанков.",
          variant: "destructive",
        });
        return;
      }

      vectorizeMutation.mutate({
        providerId: selectedProviderId,
        collectionName: selectedCollectionName,
        createCollection: false,
      });
      return;
    }

    const trimmedName = newCollectionName.trim();
    if (!trimmedName) {
      toast({
        title: "Укажите название коллекции",
        description: "Название новой коллекции не может быть пустым.",
        variant: "destructive",
      });
      return;
    }

    const normalizedName = sanitizeCollectionName(trimmedName).slice(0, 60);
    if (!normalizedName) {
      toast({
        title: "Некорректное название",
        description: "Используйте латиницу, цифры, символы подчёркивания или дефисы.",
        variant: "destructive",
      });
      return;
    }

    if (normalizedName !== trimmedName) {
      setNewCollectionName(normalizedName);
    }

    if (!schemaPayload) {
      toast({
        title: "Добавьте поля",
        description: "Схема новой коллекции должна содержать хотя бы одно поле.",
        variant: "destructive",
      });
      return;
    }

    vectorizeMutation.mutate({
      providerId: selectedProviderId,
      collectionName: normalizedName,
      createCollection: true,
      schema: schemaPayload,
    });
  };

  const renderDialogHeader = () => (
    <DialogHeader className="space-y-2 border-b border-border/60 bg-muted/40 px-6 py-4">
      <DialogTitle className="text-xl font-semibold">Векторизация проекта</DialogTitle>
      <p className="text-sm text-muted-foreground">
        Отправим чанки всех страниц проекта в коллекцию Qdrant. Выберите сервис эмбеддингов и подходящую коллекцию.
      </p>
      <div className="grid gap-3 pt-2 sm:grid-cols-3">
        <div className="rounded-md border bg-background p-3">
          <div className="flex items-center gap-2 text-xs uppercase text-muted-foreground">
            <Hash className="h-3.5 w-3.5" /> Страниц
          </div>
          <p className="mt-1 text-lg font-semibold">{processedPagesCount.toLocaleString("ru-RU")}</p>
        </div>
        <div className="rounded-md border bg-background p-3">
          <div className="flex items-center gap-2 text-xs uppercase text-muted-foreground">
            <ListOrdered className="h-3.5 w-3.5" /> Чанков
          </div>
          <p className="mt-1 text-lg font-semibold">{totalChunks.toLocaleString("ru-RU")}</p>
        </div>
        <div className="rounded-md border bg-background p-3">
          <div className="flex items-center gap-2 text-xs uppercase text-muted-foreground">
            <Gauge className="h-3.5 w-3.5" /> Оценка токенов
          </div>
          <p className="mt-1 text-lg font-semibold">{tokensHint}</p>
        </div>
      </div>
    </DialogHeader>
  );

  const renderCollectionsSelect = () => (
    <div className="space-y-2">
      <p className="text-xs uppercase text-muted-foreground">Коллекция Qdrant</p>
      <Select
        value={collectionMode}
        onValueChange={handleCollectionModeChange}
        disabled={vectorizeMutation.isPending}
      >
        <SelectTrigger>
          <SelectValue placeholder="Выберите способ" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="existing" disabled={availableCollections.length === 0}>
            Использовать существующую
          </SelectItem>
          <SelectItem value="new">Создать новую</SelectItem>
        </SelectContent>
      </Select>

      {collectionMode === "existing" ? (
        <div className="space-y-2">
          <Select
            value={selectedCollectionName}
            onValueChange={setSelectedCollectionName}
            disabled={availableCollections.length === 0 || vectorizeMutation.isPending}
          >
            <SelectTrigger>
              <SelectValue placeholder="Выберите коллекцию" />
            </SelectTrigger>
            <SelectContent>
              {availableCollections.map((collection) => (
                <SelectItem key={collection.name} value={collection.name}>
                  {collection.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {filteredOutCollectionsCount > 0 && (
            <p className="text-xs text-muted-foreground">
              Скрыто {filteredOutCollectionsCount.toLocaleString("ru-RU")} коллекций с другой размерностью.
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          <Input
            value={newCollectionName}
            onChange={(event) => setNewCollectionName(event.target.value)}
            placeholder="Название новой коллекции"
            maxLength={60}
            disabled={vectorizeMutation.isPending}
          />
          <p className="text-xs text-muted-foreground">
            Допустимы латинские буквы, цифры, символы подчёркивания и дефисы. Максимум 60 символов.
          </p>
        </div>
      )}
    </div>
  );

  const renderProviderSelect = () => (
    <div className="space-y-2">
      <p className="text-xs uppercase text-muted-foreground">Сервис эмбеддингов</p>
      <Select
        value={selectedProviderId}
        onValueChange={setSelectedProviderId}
        disabled={providers.length === 0 || vectorizeMutation.isPending}
      >
        <SelectTrigger>
          <SelectValue placeholder="Выберите сервис" />
        </SelectTrigger>
        <SelectContent>
          {providers.map((provider) => (
            <SelectItem key={provider.id} value={provider.id}>
              {provider.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {providers.length === 0 && (
        <p className="text-xs text-muted-foreground">
          Активные сервисы эмбеддингов отсутствуют. Добавьте сервис в разделе «Настройки → Эмбеддинги».
        </p>
      )}
    </div>
  );

  const renderSchemaField = (field: CollectionSchemaField) => (
    <div key={field.id} className="rounded-md border p-4">
      <div className="grid gap-3 sm:grid-cols-[1fr_180px_100px]">
        <Input
          value={field.name}
          onChange={(event) => handleUpdateSchemaField(field.id, { name: event.target.value })}
          placeholder="Название поля"
          disabled={vectorizeMutation.isPending}
        />
        <Select
          value={field.type}
          onValueChange={(value) => handleUpdateSchemaField(field.id, { type: value as CollectionSchemaFieldInput["type"] })}
          disabled={vectorizeMutation.isPending}
        >
          <SelectTrigger>
            <SelectValue placeholder="Тип" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="string">Строка</SelectItem>
            <SelectItem value="text">Текст</SelectItem>
            <SelectItem value="boolean">Логический</SelectItem>
            <SelectItem value="integer">Целое число</SelectItem>
            <SelectItem value="float">Число с плавающей точкой</SelectItem>
            <SelectItem value="json">JSON</SelectItem>
            <SelectItem value="datetime">Дата и время</SelectItem>
          </SelectContent>
        </Select>
        <div className="flex items-center gap-2">
          <Switch
            id={`array-${field.id}`}
            checked={field.isArray}
            onCheckedChange={(checked) => handleToggleArrayField(field.id, checked)}
            disabled={vectorizeMutation.isPending}
          />
          <label htmlFor={`array-${field.id}`} className="text-sm text-muted-foreground">
            Массив
          </label>
        </div>
      </div>
      <div className="mt-3 space-y-2">
        <Textarea
          ref={(element) => {
            templateFieldRefs.current[field.id] = element;
          }}
          value={field.template}
          onChange={(event: ChangeEvent<HTMLTextAreaElement>) =>
            handleUpdateSchemaField(field.id, { template: event.target.value })
          }
          onKeyDown={(event) => handleSchemaFieldKeyDown(event, field.id)}
          placeholder="Шаблон значения (Liquid)"
          rows={3}
          className="font-mono"
          disabled={vectorizeMutation.isPending}
        />
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => handleDeleteSchemaField(field.id)}
            disabled={schemaFields.length === 1 || vectorizeMutation.isPending}
          >
            Удалить поле
          </Button>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Checkbox
              id={`embedding-${field.id}`}
              checked={embeddingFieldId === field.id}
              onCheckedChange={(checked) => setEmbeddingFieldId(checked ? field.id : null)}
              disabled={vectorizeMutation.isPending}
            />
            <label htmlFor={`embedding-${field.id}`}>Поле с текстом для эмбеддинга</label>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className={cn(
              "text-xs text-muted-foreground",
              activeSuggestionsFieldId === field.id && "text-primary",
            )}
            onClick={() =>
              setActiveSuggestionsFieldId((current) => (current === field.id ? null : field.id))
            }
          >
            {activeSuggestionsFieldId === field.id
              ? "Скрыть переменные"
              : "Показать переменные"}
          </Button>
        </div>
        {activeSuggestionsFieldId === field.id && limitedTemplateVariableSuggestions.length > 0 && (
          <div className="rounded-md border bg-muted/40 p-2">
            <div className="flex flex-wrap gap-2">
              {limitedTemplateVariableSuggestions.map((path) => (
                <code key={path} className="rounded bg-muted px-2 py-1 text-xs font-mono text-muted-foreground">
                  {`{{ ${path} }}`}
                </code>
              ))}
            </div>
            {hasMoreTemplateSuggestions && (
              <p className="mt-2 text-[11px] text-muted-foreground">
                Показаны первые {TEMPLATE_SUGGESTION_LIMIT.toLocaleString("ru-RU")} переменных. Полный список см. в JSON выше.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );

  const renderSchemaBuilder = () => (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs uppercase text-muted-foreground">Схема коллекции</p>
          <p className="text-sm text-muted-foreground">
            Настройте набор полей, которые будут записаны в коллекцию Qdrant при создании новой коллекции.
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={handleAddSchemaField}>
          Добавить поле
        </Button>
      </div>
      <div className="space-y-3">
        {schemaFields.map((field) => renderSchemaField(field))}
      </div>
      <div className="rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground">
        Поле, отмеченное как «Поле с текстом для эмбеддинга», будет использоваться при создании новой коллекции как источник текстов.
      </div>
    </div>
  );

  const renderSettingsTab = () => (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-4">
          {renderProviderSelect()}
          {renderCollectionsSelect()}
        </div>
        <div className="space-y-4">
          <div className="space-y-2">
            <p className="text-xs uppercase text-muted-foreground">Состояние коллекций</p>
            {isCollectionsLoading ? (
              <p className="text-sm text-muted-foreground">Загружаем список коллекций...</p>
            ) : collectionsErrorMessage ? (
              <p className="text-sm text-destructive">Не удалось загрузить коллекции: {collectionsErrorMessage}</p>
            ) : collections.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Коллекции отсутствуют. Создайте новую коллекцию, чтобы отправить чанки проекта.
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">
                Доступно коллекций: {collections.length.toLocaleString("ru-RU")}
              </p>
            )}
          </div>
          <div className="space-y-2">
            <p className="text-xs uppercase text-muted-foreground">Выбранный проект</p>
            <div className="rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground">
              <p className="font-medium text-foreground">{site.name ?? site.url ?? "Проект"}</p>
              <p>{site.url}</p>
              <p>Максимальный размер чанка: {site.maxChunkSize?.toLocaleString("ru-RU") ?? "—"}</p>
            </div>
          </div>
        </div>
      </div>

      {collectionMode === "new" && renderSchemaBuilder()}
    </div>
  );

  const schemaPreview = useMemo(() => {
    if (!liquidContext) {
      return null;
    }

    return schemaFields.reduce<Record<string, unknown>>((acc, field) => {
      const fieldName = field.name.trim();
      if (!fieldName) {
        return acc;
      }

      const rendered = renderLiquidTemplate(field.template, liquidContext);
      const typedValue = castValueToType(rendered, field.type);
      acc[fieldName] = normalizeArrayValue(typedValue, field.isArray);
      return acc;
    }, {});
  }, [liquidContext, schemaFields]);

  const renderContextTab = () => (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Ниже показан пример данных страницы и чанка, которые доступны в шаблонизаторе Liquid для первой страницы проекта.
      </p>
      {liquidContextJson ? (
        <div className="max-h-[60vh] overflow-auto rounded-md border bg-background">
          <pre className="w-full min-w-full whitespace-pre-wrap break-words p-4 text-xs font-mono leading-relaxed">
            {liquidContextJson}
          </pre>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          Добавьте контент в страницы проекта или выберите сервис, чтобы построить JSON контекста.
        </p>
      )}
      {schemaPreview && (
        <div className="space-y-2">
          <p className="text-xs uppercase text-muted-foreground">Предпросмотр схемы</p>
          <div className="max-h-64 overflow-auto rounded-md border bg-background">
            <pre className="w-full min-w-full whitespace-pre-wrap break-words p-4 text-xs font-mono leading-relaxed">
              {JSON.stringify(schemaPreview, null, 2)}
            </pre>
          </div>
        </div>
      )}
    </div>
  );

  const renderDialogTabs = () => (
    <Tabs
      value={activeTab}
      onValueChange={(value) => setActiveTab(value as "settings" | "context")}
      className="space-y-4"
    >
      <TabsList className="w-fit">
        <TabsTrigger value="settings">Настройки</TabsTrigger>
        <TabsTrigger value="context">JSON проекта</TabsTrigger>
      </TabsList>
      <TabsContent value="settings" className="space-y-6">
        {renderSettingsTab()}
      </TabsContent>
      <TabsContent value="context">{renderContextTab()}</TabsContent>
    </Tabs>
  );

  const renderDialogBody = () => (
    <ScrollArea className="flex-1 min-h-0">
      <div className="px-6 pb-6">
        <div className="pr-4">{renderDialogTabs()}</div>
      </div>
    </ScrollArea>
  );

  const renderDialogFooter = () => (
    <DialogFooter className="border-t border-border/60 bg-background/80 px-6 py-4">
      <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={vectorizeMutation.isPending}>
        Отмена
      </Button>
      <Button onClick={handleConfirm} disabled={confirmDisabled || vectorizeMutation.isPending}>
        {vectorizeMutation.isPending ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Отправка...
          </>
        ) : (
          <>
            <Sparkles className="mr-2 h-4 w-4" />
            Отправить
          </>
        )}
      </Button>
    </DialogFooter>
  );

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button
          variant="default"
          size="sm"
          disabled={disabled || vectorizeMutation.isPending}
          className="gap-2"
        >
          <Sparkles className="h-4 w-4" />
          Векторизация проекта
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-4xl lg:max-w-5xl gap-0 p-0">
        <div className="flex max-h-[inherit] min-h-0 flex-col">
          {renderDialogHeader()}
          {renderDialogBody()}
          {renderDialogFooter()}
        </div>
      </DialogContent>
    </Dialog>
  );
}
