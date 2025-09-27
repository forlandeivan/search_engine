import {
  useState,
  useEffect,
  useMemo,
  useRef,
  type ChangeEvent,
  type KeyboardEvent,
} from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Search,
  ExternalLink,
  FileText,
  Calendar,
  Hash,
  Trash2,
  ListOrdered,
  Gauge,
  Loader2,
  Sparkles,
  MoreVertical,
  Plus,
  Check,
} from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { formatDistanceToNow } from "date-fns";
import { ru } from "date-fns/locale";
import type { ContentChunk, PageMetadata, PublicEmbeddingProvider } from "@shared/schema";
import { GIGACHAT_EMBEDDING_VECTOR_SIZE } from "@shared/constants";
import {
  castValueToType,
  normalizeArrayValue,
  renderLiquidTemplate,
  type CollectionFieldType,
  type CollectionSchemaFieldInput,
  type VectorizeCollectionSchema,
} from "@shared/vectorization";
import { cn } from "@/lib/utils";

interface Page {
  id: string;
  url: string;
  title: string;
  content: string;
  metaDescription?: string;
  contentHash: string;
  createdAt: string;
  lastModified?: string;
  siteId: string;
  metadata?: PageMetadata;
  chunks?: ContentChunk[];
}

interface Site {
  id: string;
  url: string;
  status: string;
  name?: string;
  maxChunkSize?: number;
  chunkOverlap?: boolean;
  chunkOverlapSize?: number;
}

interface PagesBySite {
  site: Site;
  pages: Page[];
}

interface StatsData {
  sites: {
    total: number;
    crawling: number;
    completed: number;
    failed: number;
  };
}

interface VectorizePageResponse {
  message?: string;
  pointsCount: number;
  collectionName: string;
  vectorSize?: number | null;
  totalUsageTokens?: number;
  collectionCreated?: boolean;
}

interface VectorizePageDialogProps {
  page: Page;
  providers: PublicEmbeddingProvider[];
}

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

interface CollectionSchemaField extends CollectionSchemaFieldInput {
  id: string;
}

const TEMPLATE_PATH_LIMIT = 400;
const TEMPLATE_SUGGESTION_LIMIT = 150;

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

function suggestCollectionName(page: Page): string {
  const base = page.siteId || page.id;
  const normalized = sanitizeCollectionName(base).slice(0, 60);
  const suffix = normalized.length > 0 ? normalized : "default";
  return `kb_${suffix}`;
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

  const siteMetadata =
    page.metadata && typeof page.metadata === "object"
      ? (page.metadata as unknown as Record<string, unknown>)
      : undefined;
  const siteNameValue = siteMetadata?.["siteName"];
  const siteUrlValue = siteMetadata?.["siteUrl"];

  const payload = {
    page: {
      id: page.id,
      url: page.url,
      title: page.title ?? null,
      totalChunks,
      chunkCharLimit: null,
      metadata: page.metadata ?? null,
    },
    site: {
      id: page.siteId,
      name: typeof siteNameValue === "string" ? siteNameValue : null,
      url: typeof siteUrlValue === "string" ? siteUrlValue : null,
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

function VectorizePageDialog({ page, providers }: VectorizePageDialogProps) {
  const { toast } = useToast();
  const [isOpen, setIsOpen] = useState(false);
  const [selectedProviderId, setSelectedProviderId] = useState<string>("");
  const [collectionMode, setCollectionMode] = useState<"existing" | "new">("existing");
  const [selectedCollectionName, setSelectedCollectionName] = useState<string>("");
  const [newCollectionName, setNewCollectionName] = useState<string>("");
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

  const defaultCollectionName = useMemo(() => suggestCollectionName(page), [page]);
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
      setNewCollectionName(defaultCollectionName);
    }
  }, [defaultCollectionName, isOpen, newCollectionName]);

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

  const vectorizeMutation = useMutation<VectorizePageResponse, Error, VectorizeRequestPayload>({
    mutationFn: async ({ providerId, collectionName, createCollection: createNew, schema }) => {
      const body: Record<string, unknown> = {
        embeddingProviderId: providerId,
        collectionName,
        createCollection: createNew,
      };

      if (schema && schema.fields.length > 0) {
        body.schema = schema;
      }

      const response = await apiRequest("POST", `/api/pages/${page.id}/vectorize`, body);
      return (await response.json()) as VectorizePageResponse;
    },
    onSuccess: (data) => {
      const collectionNote = data.collectionCreated
        ? `Коллекция ${data.collectionName} создана автоматически.`
        : "";
      toast({
        title: "Чанки отправлены",
        description:
          data.message ??
          `Добавлено ${data.pointsCount} чанков в коллекцию ${data.collectionName}. ${collectionNote}`.trim(),
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

  const handleOpenChange = (open: boolean) => {
    setIsOpen(open);
    if (open) {
      setActiveTab("settings");
      setActiveSuggestionsFieldId(null);
      templateFieldRefs.current = {};
      return;
    }

    vectorizeMutation.reset();
    setCollectionMode(availableCollections.length > 0 ? "existing" : "new");
    setSelectedCollectionName(availableCollections[0]?.name ?? "");
    setNewCollectionName(defaultCollectionName);
    resetSchemaBuilder();
    setActiveSuggestionsFieldId(null);
    setActiveTab("settings");
    templateFieldRefs.current = {};
  };

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

  const allChunks = Array.isArray(page.chunks) ? page.chunks : [];
  const nonEmptyChunks = allChunks.filter(
    (chunk) => typeof chunk.content === "string" && chunk.content.trim().length > 0,
  );
  const totalChunks = nonEmptyChunks.length;
  const totalCharacters = nonEmptyChunks.reduce((sum, chunk) => sum + chunk.content.length, 0);
  const estimatedTokens = totalCharacters > 0 ? Math.ceil(totalCharacters / 4) : 0;
  const firstChunk = nonEmptyChunks[0];
  const liquidContext = useMemo(() => {
    if (!firstChunk) {
      return null;
    }

    return buildLiquidContext(page, firstChunk, selectedProvider, totalChunks);
  }, [firstChunk, page, selectedProvider, totalChunks]);
  const liquidContextJson = useMemo(() => {
    if (!liquidContext) {
      return "";
    }

    try {
      return JSON.stringify(liquidContext, null, 2);
    } catch (error) {
      console.error("Не удалось подготовить JSON контекста", error);
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

  const schemaPreviewJson = useMemo(() => {
    if (!schemaPreview || schemaFields.length === 0) {
      return "";
    }

    try {
      return JSON.stringify(schemaPreview, null, 2);
    } catch (error) {
      console.error("Не удалось подготовить предпросмотр схемы", error);
      return "";
    }
  }, [schemaFields.length, schemaPreview]);

  const embeddingFieldName = useMemo(() => {
    if (!embeddingFieldId) {
      return null;
    }

    const field = schemaFields.find((current) => current.id === embeddingFieldId);
    if (!field) {
      return null;
    }

    const trimmed = field.name.trim();
    return trimmed.length > 0 ? trimmed : null;
  }, [embeddingFieldId, schemaFields]);

  const schemaPayload = useMemo<VectorizeCollectionSchema | null>(() => {
    const normalizedFields = schemaFields
      .map<CollectionSchemaFieldInput | null>((field) => {
        const trimmedName = field.name.trim();
        if (!trimmedName) {
          return null;
        }

        return {
          name: trimmedName,
          type: field.type,
          isArray: field.isArray,
          template: field.template ?? "",
        };
      })
      .filter((field): field is CollectionSchemaFieldInput => field !== null);

    if (normalizedFields.length === 0) {
      return null;
    }

    const embeddingName =
      embeddingFieldName && normalizedFields.some((field) => field.name === embeddingFieldName)
        ? embeddingFieldName
        : null;

    return {
      fields: normalizedFields,
      embeddingFieldName: embeddingName,
    };
  }, [schemaFields, embeddingFieldName]);

  const disabled = providers.length === 0 || totalChunks === 0;
  const confirmDisabled =
    disabled ||
    vectorizeMutation.isPending ||
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

  const handleRemoveSchemaField = (id: string) => {
    setSchemaFields((prev) => {
      const next = prev.filter((field) => field.id !== id);
      if (prev.length !== next.length) {
        setEmbeddingFieldId((current) => {
          if (!next.length) {
            return null;
          }

          if (current && current !== id && next.some((field) => field.id === current)) {
            return current;
          }

          return next[0]?.id ?? null;
        });
      }
      return next;
    });
  };

  const handleSelectEmbeddingField = (id: string) => {
    setEmbeddingFieldId(id);
  };

  const handleTemplateInputChange = (
    fieldId: string,
    event: ChangeEvent<HTMLTextAreaElement>,
  ) => {
    const { value, selectionStart } = event.target;
    templateFieldRefs.current[fieldId] = event.target;
    handleUpdateSchemaField(fieldId, { template: value });

    setActiveSuggestionsFieldId((current) => {
      if (selectionStart === null) {
        return current === fieldId ? null : current;
      }

      if (selectionStart < 2 && current === fieldId) {
        return null;
      }

      if (selectionStart >= 2) {
        const lastTwo = value.slice(selectionStart - 2, selectionStart);
        if (lastTwo === "{{") {
          return fieldId;
        }

        if (current === fieldId) {
          const beforeCaret = value.slice(0, selectionStart);
          if (beforeCaret.trimEnd().endsWith("}}")) {
            return null;
          }
        }
      }

      if (current === fieldId && !value.includes("{{")) {
        return null;
      }

      return current;
    });
  };

  const handleTemplateKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Escape") {
      setActiveSuggestionsFieldId(null);
    }
  };

  const handleInsertTemplateVariable = (fieldId: string, path: string) => {
    const textarea = templateFieldRefs.current[fieldId];
    if (!textarea) {
      return;
    }

    const { selectionStart, selectionEnd, value } = textarea;
    const start = selectionStart ?? value.length;
    const end = selectionEnd ?? start;
    const before = value.slice(0, start);
    const after = value.slice(end);
    const trimmedBefore = before.trimEnd();
    const hasOpenBraces = trimmedBefore.endsWith("{{");
    const needsLeadingSpace = hasOpenBraces && before.slice(trimmedBefore.length).length === 0;
    const insertion = hasOpenBraces
      ? `${needsLeadingSpace ? " " : ""}${path} }}`
      : `{{ ${path} }}`;
    const nextValue = `${before}${insertion}${after}`;

    handleUpdateSchemaField(fieldId, { template: nextValue });
    setActiveSuggestionsFieldId(null);

    requestAnimationFrame(() => {
      textarea.focus();
      const caretPosition = before.length + insertion.length;
      textarea.setSelectionRange(caretPosition, caretPosition);
    });
  };

  const renderDialogHeader = () => (
    <div className="px-6 pb-4 pt-6">
      <DialogHeader className="space-y-3">
        <DialogTitle>Отправка чанков в Qdrant</DialogTitle>
        <p className="text-sm text-muted-foreground">
          Страница содержит {totalChunks.toLocaleString("ru-RU")} чанков. Они будут преобразованы в
          эмбеддинги выбранным сервисом и записаны в коллекцию Qdrant.
        </p>
      </DialogHeader>
    </div>
  );

  const renderEmptyProvidersState = () => (
    <div className="space-y-4">
      <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
        Нет активных сервисов эмбеддингов. Добавьте и включите сервис на вкладке «Эмбеддинги», чтобы
        выполнять загрузку чанков в Qdrant.
      </p>
    </div>
  );

  const renderExistingCollectionSelector = () => {
    if (isCollectionsLoading) {
      return <p className="text-xs text-muted-foreground">Загружаем список коллекций…</p>;
    }

    if (collections.length === 0) {
      return (
        <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
          Коллекции не найдены. Создайте новую, чтобы загрузить данные.
        </p>
      );
    }

    if (availableCollections.length === 0) {
      return (
        <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
          {providerVectorSize
            ? `Нет коллекций с размером вектора ${providerVectorSize.toLocaleString("ru-RU")}. Создайте новую коллекцию.`
            : "Подходящие коллекции не найдены. Создайте новую, чтобы загрузить данные."}
        </p>
      );
    }

    return (
      <>
        <Select value={selectedCollectionName} onValueChange={setSelectedCollectionName}>
          <SelectTrigger>
            <SelectValue placeholder="Выберите коллекцию" />
          </SelectTrigger>
          <SelectContent>
            {availableCollections.map((collection) => {
              const normalizedSize = parseVectorSize(collection.vectorSize);
              const label = normalizedSize ? `${collection.name} · ${normalizedSize}d` : collection.name;

              return (
                <SelectItem key={collection.name} value={collection.name}>
                  {label}
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
        {providerVectorSize && (
          <p className="text-xs text-muted-foreground">
            Показаны только коллекции с размером вектора {providerVectorSize.toLocaleString("ru-RU")}.
            {filteredOutCollectionsCount > 0
              ? ` Скрыто ${filteredOutCollectionsCount.toLocaleString("ru-RU")} коллекций с другой размерностью.`
              : ""}
          </p>
        )}
      </>
    );
  };

  const renderCollectionSelector = () => (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="text-sm font-medium">Коллекция Qdrant</label>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant={collectionMode === "existing" ? "secondary" : "outline"}
            onClick={() => setCollectionMode("existing")}
            disabled={availableCollections.length === 0 && !isCollectionsLoading}
          >
            Существующая
          </Button>
          <Button
            type="button"
            size="sm"
            variant={collectionMode === "new" ? "secondary" : "outline"}
            onClick={() => setCollectionMode("new")}
          >
            Создать новую
          </Button>
        </div>
      </div>
      {collectionMode === "existing" ? (
        <>
          {renderExistingCollectionSelector()}
          {collectionsErrorMessage && (
            <p className="text-xs text-destructive">
              Не удалось загрузить коллекции: {collectionsErrorMessage}
            </p>
          )}
        </>
      ) : (
        <div className="space-y-2">
          <Input
            value={newCollectionName}
            onChange={(event) => setNewCollectionName(event.target.value)}
            placeholder={defaultCollectionName}
          />
          <p className="text-xs text-muted-foreground">
            Коллекция будет создана автоматически перед отправкой чанков. Допустимы латинские буквы, цифры, символы «_» и
            «-».
          </p>
        </div>
      )}
    </div>
  );

  const renderEmbeddingSummary = () => (
    <div className="space-y-4 rounded-lg border bg-muted/20 p-4">
      <div>
        <p className="text-xs uppercase text-muted-foreground">Эмбеддинги</p>
        <div className="mt-1 space-y-1 text-sm">
          <p>Сервис: {selectedProvider?.name ?? "—"}</p>
          {selectedProvider?.model && <p>Модель: {selectedProvider.model}</p>}
          {providerVectorSize && <p>Размер вектора: {providerVectorSize.toLocaleString("ru-RU")}</p>}
          <p>Чанков к обработке: {totalChunks.toLocaleString("ru-RU")}</p>
          <p>Оценка расхода токенов: {tokensHint}</p>
        </div>
      </div>
      {firstChunk && (
        <div className="space-y-2">
          <p className="text-xs uppercase text-muted-foreground">Текст первого чанка</p>
          <div className="rounded-md border bg-background p-3">
            <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-muted-foreground">
              {firstChunk.content}
            </p>
          </div>
        </div>
      )}
    </div>
  );

  const renderSchemaField = (field: CollectionSchemaField) => (
    <div
      key={field.id}
      className={cn(
        "space-y-3 rounded-lg border bg-background p-3",
        embeddingFieldId === field.id && "border-primary/70 shadow-sm",
      )}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex-1 space-y-2">
          <label className="text-xs font-medium uppercase text-muted-foreground">Название поля</label>
          <Input
            value={field.name}
            onChange={(event) => handleUpdateSchemaField(field.id, { name: event.target.value })}
            placeholder="Например, content"
          />
        </div>
        <div className="flex items-start justify-end gap-2">
          {embeddingFieldId === field.id && (
            <Badge variant="secondary" className="self-center text-[10px] uppercase">
              Поле эмбеддингов
            </Badge>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground">
                <MoreVertical className="h-4 w-4" />
                <span className="sr-only">Дополнительные действия</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>Действия</DropdownMenuLabel>
              <DropdownMenuItem
                className="gap-2"
                onSelect={(event) => {
                  event.preventDefault();
                  handleSelectEmbeddingField(field.id);
                }}
              >
                {embeddingFieldId === field.id ? (
                  <Check className="h-4 w-4 text-primary" />
                ) : (
                  <Sparkles className="h-4 w-4 text-muted-foreground" />
                )}
                Использовать для эмбеддингов
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="gap-2 text-destructive focus:text-destructive"
                onSelect={(event) => {
                  event.preventDefault();
                  handleRemoveSchemaField(field.id);
                }}
              >
                <Trash2 className="h-4 w-4" /> Удалить поле
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,220px)] md:items-start">
        <div className="space-y-2">
          <label className="text-xs font-medium uppercase text-muted-foreground">Liquid шаблон</label>
          <Textarea
            value={field.template}
            onChange={(event) => handleTemplateInputChange(field.id, event)}
            onKeyDown={handleTemplateKeyDown}
            onBlur={() => setActiveSuggestionsFieldId((current) => (current === field.id ? null : current))}
            onFocus={() => {
              setActiveSuggestionsFieldId(null);
            }}
            ref={(element) => {
              if (element) {
                templateFieldRefs.current[field.id] = element;
              } else {
                delete templateFieldRefs.current[field.id];
              }
            }}
            placeholder="Например, {{ chunk.text }}"
            rows={3}
          />
          <p className="text-xs text-muted-foreground">
            Используйте переменные <code className="rounded bg-muted px-1">chunk</code>{" "}
            <code className="rounded bg-muted px-1">page</code>{" "}
            <code className="rounded bg-muted px-1">site</code> и <code className="rounded bg-muted px-1">provider</code>.
          </p>
          {activeSuggestionsFieldId === field.id && limitedTemplateVariableSuggestions.length > 0 && (
            <div className="space-y-2 rounded-md border bg-background p-2 text-xs shadow-sm">
              <p className="font-medium text-muted-foreground">Подставьте одно из доступных полей:</p>
              <div className="flex flex-wrap gap-2">
                {limitedTemplateVariableSuggestions.map((path) => (
                  <button
                    key={path}
                    type="button"
                    className="rounded border border-muted-foreground/30 bg-muted/40 px-2 py-1 font-mono text-[11px] text-muted-foreground transition hover:bg-muted hover:text-foreground"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => handleInsertTemplateVariable(field.id, path)}
                  >
                    {`{{ ${path} }}`}
                  </button>
                ))}
              </div>
              {hasMoreTemplateSuggestions && (
                <p className="text-[10px] text-muted-foreground">
                  Показаны первые {TEMPLATE_SUGGESTION_LIMIT.toLocaleString("ru-RU")} полей.
                </p>
              )}
            </div>
          )}
        </div>
        <div className="space-y-3">
          <div className="space-y-2">
            <label className="text-xs font-medium uppercase text-muted-foreground">Тип данных</label>
            <Select
              value={field.type}
              onValueChange={(value) =>
                handleUpdateSchemaField(field.id, {
                  type: value as CollectionFieldType,
                })
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="Выберите тип" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="string">Строка</SelectItem>
                <SelectItem value="double">Double</SelectItem>
                <SelectItem value="object">Object (JSON)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center justify-between rounded-md border bg-muted/40 px-3 py-2">
            <div>
              <p className="text-xs font-medium text-muted-foreground">Массив</p>
              <p className="text-[11px] text-muted-foreground">Значение будет сохранено как массив.</p>
            </div>
            <Switch
              checked={field.isArray}
              onCheckedChange={(checked) => handleUpdateSchemaField(field.id, { isArray: checked })}
            />
          </div>
        </div>
      </div>
    </div>
  );

  const renderSchemaBuilder = () => (
    <div className="space-y-4 rounded-lg border bg-muted/20 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs uppercase text-muted-foreground">Схема новой коллекции</p>
        <Button type="button" variant="outline" size="sm" className="h-8 gap-1" onClick={handleAddSchemaField}>
          <Plus className="h-4 w-4" /> Поле
        </Button>
      </div>
      {schemaFields.length === 0 ? (
        <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
          Добавьте хотя бы одно поле, чтобы задать структуру новой коллекции.
        </p>
      ) : (
        <div className="space-y-3">{schemaFields.map((field) => renderSchemaField(field))}</div>
      )}
      <div>
        <p className="text-xs uppercase text-muted-foreground">Пример документа</p>
        {schemaPreviewJson ? (
          <div className="mt-2 max-h-72 overflow-auto rounded-md border bg-background">
            <pre className="w-full min-w-full whitespace-pre-wrap break-words p-3 text-xs font-mono leading-relaxed">
              {schemaPreviewJson}
            </pre>
          </div>
        ) : (
          <p className="mt-2 text-xs text-muted-foreground">
            {firstChunk
              ? "Заполните шаблоны, чтобы увидеть предпросмотр документа."
              : "Добавьте контент на страницу, чтобы построить предпросмотр."}
          </p>
        )}
      </div>
      <div className="rounded-md border bg-background p-3 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">Поле для эмбеддингов:</span>{" "}
        {embeddingFieldName ? <span>{embeddingFieldName}</span> : <span className="text-destructive">не выбрано</span>}
      </div>
    </div>
  );

  const renderSettingsTab = () => {
    if (providers.length === 0) {
      return renderEmptyProvidersState();
    }

    return (
      <>
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] lg:items-start xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Сервис эмбеддингов</label>
              <Select value={selectedProviderId} onValueChange={setSelectedProviderId}>
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
              <p className="text-xs text-muted-foreground">
                Будут использованы настройки Qdrant выбранного сервиса. Убедитесь, что указана правильная коллекция.
              </p>
            </div>
            {renderCollectionSelector()}
            {vectorizeMutation.isError && (
              <p className="rounded-md border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">
                {vectorizeMutation.error.message}
              </p>
            )}
          </div>
          {renderEmbeddingSummary()}
        </div>
        {collectionMode === "new" ? (
          renderSchemaBuilder()
        ) : (
          <div className="rounded-lg border bg-muted/20 p-4">
            <p className="text-xs uppercase text-muted-foreground">Схема коллекции</p>
            <p className="mt-2 rounded-md border border-dashed p-3 text-xs text-muted-foreground">
              При использовании существующей коллекции её схема задана заранее. Создайте новую коллекцию, чтобы изменить
              структуру полей.
            </p>
          </div>
        )}
      </>
    );
  };

  const renderContextTab = () => (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Просмотрите данные страницы и чанка, которые доступны в шаблонизаторе Liquid.
      </p>
      {liquidContextJson ? (
        <div className="max-h-[60vh] overflow-auto rounded-md border bg-background">
          <pre className="w-full min-w-full whitespace-pre-wrap break-words p-4 text-xs font-mono leading-relaxed">
            {liquidContextJson}
          </pre>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          Добавьте контент на страницу или выберите сервис, чтобы построить JSON контекста.
        </p>
      )}
      {limitedTemplateVariableSuggestions.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs uppercase text-muted-foreground">Доступные переменные</p>
          <div className="max-h-48 overflow-auto rounded-md border bg-background p-2">
            <div className="flex flex-wrap gap-2">
              {limitedTemplateVariableSuggestions.map((path) => (
                <code key={path} className="rounded bg-muted px-2 py-1 text-xs font-mono text-muted-foreground">
                  {`{{ ${path} }}`}
                </code>
              ))}
            </div>
          </div>
          {hasMoreTemplateSuggestions && (
            <p className="text-[11px] text-muted-foreground">
              Показаны первые {TEMPLATE_SUGGESTION_LIMIT.toLocaleString("ru-RU")} полей. Полный список см. в JSON выше.
            </p>
          )}
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
        <TabsTrigger value="context">JSON страницы</TabsTrigger>
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
      <Button variant="outline" onClick={() => handleOpenChange(false)}>
        Отмена
      </Button>
      <Button onClick={handleConfirm} disabled={confirmDisabled}>
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
        <Button variant="outline" size="sm" disabled={disabled} className="whitespace-nowrap">
          <Sparkles className="mr-1 h-4 w-4" />
          Векторизация
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

export default function PagesPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedSite, setSelectedSite] = useState<string>("all");
  const [selectedPages, setSelectedPages] = useState<Set<string>>(new Set());
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const { toast } = useToast();

  // Fetch all pages
  const { data: pages = [], isLoading: pagesLoading } = useQuery<Page[]>({
    queryKey: ['/api/pages'],
    refetchOnWindowFocus: true,
    refetchOnMount: true,
  });

  // Fetch sites for grouping
  const { data: sites = [] } = useQuery<Site[]>({
    queryKey: ['/api/sites'],
  });

  // Fetch crawl statistics to track active crawls
  const { data: stats } = useQuery<StatsData>({
    queryKey: ['/api/stats'],
  });

  const { data: embeddingServices } = useQuery<{ providers: PublicEmbeddingProvider[] }>({
    queryKey: ['/api/embedding/services'],
  });

  const activeEmbeddingProviders = (embeddingServices?.providers ?? []).filter(
    (provider) => provider.isActive,
  );

  // Group pages by site
  const pagesBySite: PagesBySite[] = sites.map(site => ({
    site,
    pages: pages.filter(page => page.siteId === site.id)
  })).filter(group => group.pages.length > 0);

  // Filter pages based on search and site selection
  const filteredPagesBySite = pagesBySite.map(group => ({
    ...group,
    pages: group.pages.filter(page => {
      const matchesSearch = searchQuery === "" || 
        page.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        page.url.toLowerCase().includes(searchQuery.toLowerCase()) ||
        page.content.toLowerCase().includes(searchQuery.toLowerCase());
      
      return matchesSearch;
    })
  })).filter(group => {
    if (selectedSite === "all") return group.pages.length > 0;
    return group.site.id === selectedSite && group.pages.length > 0;
  });

  const totalPages = pages.length;
  const totalSites = pagesBySite.length;
  
  // Auto-refresh pages when there are active crawls
  useEffect(() => {
    const hasActiveCrawls = stats?.sites?.crawling && stats.sites.crawling > 0;
    
    if (hasActiveCrawls) {
      const interval = setInterval(() => {
        queryClient.invalidateQueries({ queryKey: ['/api/pages'] });
        queryClient.invalidateQueries({ queryKey: ['/api/stats'] });
      }, 3000); // Refresh every 3 seconds
      
      return () => clearInterval(interval);
    }
  }, [stats?.sites?.crawling]);

  // Get all visible pages for bulk actions
  const allVisiblePages = filteredPagesBySite.flatMap(group => group.pages);
  const allVisiblePageIds = new Set(allVisiblePages.map(p => p.id));
  
  // Bulk delete mutation
  const deleteBulkMutation = useMutation({
    mutationFn: async (pageIds: string[]) => {
      return apiRequest('DELETE', '/api/pages/bulk-delete', { pageIds });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/pages'] });
      queryClient.invalidateQueries({ queryKey: ['/api/stats'] });
      setSelectedPages(new Set());
      toast({ title: "Страницы успешно удалены" });
      setIsDeleteDialogOpen(false);
    },
    onError: (error: any) => {
      toast({ 
        variant: "destructive",
        title: "Ошибка при удалении страниц", 
        description: error.message || "Произошла ошибка" 
      });
    }
  });

  // Selection handlers
  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedPages(new Set(allVisiblePageIds));
    } else {
      setSelectedPages(new Set());
    }
  };

  const handleSelectPage = (pageId: string, checked: boolean) => {
    const newSelected = new Set(selectedPages);
    if (checked) {
      newSelected.add(pageId);
    } else {
      newSelected.delete(pageId);
    }
    setSelectedPages(newSelected);
  };

  const handleBulkDelete = () => {
    if (selectedPages.size > 0) {
      deleteBulkMutation.mutate(Array.from(selectedPages));
    }
  };

  const isAllSelected = allVisiblePages.length > 0 && allVisiblePages.every(page => selectedPages.has(page.id));
  const isPartiallySelected = allVisiblePages.some(page => selectedPages.has(page.id)) && !isAllSelected;

  if (pagesLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">Загрузка страниц...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold">Индексированные страницы</h1>
            {stats?.sites?.crawling && stats.sites.crawling > 0 && (
              <Badge variant="secondary" className="animate-pulse">
                Автообновление: {stats.sites.crawling} активн{stats.sites.crawling === 1 ? 'ый' : 'ых'}
              </Badge>
            )}
          </div>
          <p className="text-muted-foreground">
            Всего проиндексировано {totalPages} страниц с {totalSites} сайтов
            {stats?.sites?.crawling && stats.sites.crawling > 0 && (
              <span className="ml-2 text-primary">• Обновляется каждые 3 сек</span>
            )}
          </p>
        </div>
      </div>

      {/* Filters */}
      {/* Bulk Actions Bar */}
      {selectedPages.size > 0 && (
        <Card className="bg-muted/50">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Badge variant="secondary" data-testid="text-selected-count">
                  Выбрано: {selectedPages.size}
                </Badge>
                <Button 
                  variant="ghost" 
                  size="sm" 
                  onClick={() => setSelectedPages(new Set())}
                  data-testid="button-clear-selection"
                >
                  Очистить выбор
                </Button>
              </div>
              <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
                <AlertDialogTrigger asChild>
                  <Button 
                    variant="destructive" 
                    size="sm"
                    disabled={selectedPages.size === 0 || deleteBulkMutation.isPending}
                    data-testid="button-bulk-delete"
                  >
                    <Trash2 className="h-4 w-4 mr-1" />
                    {deleteBulkMutation.isPending ? 'Удаление...' : `Удалить (${selectedPages.size})`}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Подтвердите удаление</AlertDialogTitle>
                    <AlertDialogDescription>
                      Вы действительно хотите удалить {selectedPages.size} {selectedPages.size === 1 ? 'страницу' : selectedPages.size < 5 ? 'страницы' : 'страниц'}?
                      <br />
                      Это действие нельзя отменить.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel data-testid="button-cancel-delete">Отмена</AlertDialogCancel>
                    <AlertDialogAction 
                      onClick={handleBulkDelete}
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      data-testid="button-confirm-delete"
                    >
                      Удалить
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Filters and Selection */}
      <div className="flex gap-4 items-center">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Поиск по названию, URL или содержимому..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
            data-testid="input-search-pages"
          />
        </div>
        
        {allVisiblePages.length > 0 && (
          <div className="flex items-center gap-2">
            <Checkbox
              checked={isAllSelected}
              onCheckedChange={handleSelectAll}
              data-testid="checkbox-select-all"
            />
            <label className="text-sm font-medium cursor-pointer" onClick={() => handleSelectAll(!isAllSelected)}>
              Выбрать все ({allVisiblePages.length})
            </label>
          </div>
        )}
        
        <Tabs value={selectedSite} onValueChange={setSelectedSite}>
          <TabsList>
            <TabsTrigger value="all" data-testid="tab-all-sites">
              Все сайты ({totalPages})
            </TabsTrigger>
            {pagesBySite.map(({ site, pages }) => (
              <TabsTrigger 
                key={site.id} 
                value={site.id}
                data-testid={`tab-site-${site.id}`}
              >
                {new URL(site.url).hostname} ({pages.length})
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      {/* Results */}
      {filteredPagesBySite.length === 0 ? (
        <Card>
          <CardContent className="flex items-center justify-center h-32">
            <div className="text-center">
              <FileText className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
              <p className="text-muted-foreground">
                {searchQuery ? "Страницы не найдены" : "Нет проиндексированных страниц"}
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {filteredPagesBySite.map(({ site, pages }) => (
            <Card key={site.id}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <span>{site.url}</span>
                  <Badge variant="secondary">{pages.length} страниц</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid gap-3">
                  {pages.map((page) => {
                    const siteConfig = sites.find(site => site.id === page.siteId);
                    const aggregatedContent = page.content ?? "";
                    const contentLength = aggregatedContent.length;
                    const aggregatedWordCount = page.metadata?.wordCount ??
                      (aggregatedContent ? aggregatedContent.trim().split(/\s+/).filter(Boolean).length : 0);
                    const chunks = page.chunks ?? [];
                    const chunkCharCounts = chunks.map(chunk => chunk.metadata?.charCount ?? chunk.content.length);
                    const chunkWordCounts = chunks.map(chunk => chunk.metadata?.wordCount ??
                      chunk.content.trim().split(/\s+/).filter(Boolean).length);
                    const chunkCount = chunks.length;
                    const totalChunkChars = chunkCharCounts.reduce((sum, value) => sum + value, 0);
                    const maxChunkLength = chunkCharCounts.reduce((max, value) => Math.max(max, value), 0);
                    const avgChunkLength = chunkCount > 0 ? Math.round(totalChunkChars / chunkCount) : 0;
                    const maxChunkWordCount = chunkWordCounts.reduce((max, value) => Math.max(max, value), 0);
                    const configuredChunkSize = siteConfig?.maxChunkSize ?? null;
                    const chunksOverLimit = configuredChunkSize
                      ? chunkCharCounts.filter(length => length > configuredChunkSize).length
                      : 0;

                    return (
                      <div
                        key={page.id}
                        className="p-4 border rounded-lg hover-elevate transition-colors"
                      >
                        <div className="flex items-start gap-4">
                          <Checkbox
                            checked={selectedPages.has(page.id)}
                            onCheckedChange={(checked) => handleSelectPage(page.id, checked as boolean)}
                            className="mt-1"
                            data-testid={`checkbox-page-${page.id}`}
                          />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-2">
                              <h3 className="font-medium truncate">
                                {page.title || "Без названия"}
                              </h3>
                              <Button
                                variant="ghost"
                                size="sm"
                                asChild
                                data-testid={`button-open-page-${page.id}`}
                              >
                                <a
                                  href={page.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="shrink-0"
                                >
                                  <ExternalLink className="h-3 w-3" />
                                </a>
                              </Button>
                            </div>

                            <p className="text-sm text-muted-foreground mb-2 truncate">
                              {page.url}
                            </p>

                            {page.metaDescription && (
                              <p className="text-sm text-muted-foreground mb-2 line-clamp-2">
                                {page.metaDescription}
                              </p>
                            )}

                            <div className="flex items-center gap-4 text-xs text-muted-foreground">
                              <span className="flex items-center gap-1">
                                <Calendar className="h-3 w-3" />
                                {page.createdAt ? formatDistanceToNow(new Date(page.createdAt), {
                                  addSuffix: true,
                                  locale: ru
                                }) : 'Дата неизвестна'}
                              </span>
                              <span className="flex items-center gap-1">
                                <Hash className="h-3 w-3" />
                                {page.contentHash.substring(0, 8)}
                              </span>
                              {chunkCount > 0 && (
                                <span className="flex items-center gap-1">
                                  <ListOrdered className="h-3 w-3" />
                                  {chunkCount.toLocaleString("ru-RU")} чанков
                                </span>
                              )}
                              {chunkCount > 0 && (
                                <span className="flex items-center gap-1">
                                  <Gauge className="h-3 w-3" />
                                  макс {maxChunkLength.toLocaleString("ru-RU")} симв.
                                </span>
                              )}
                              {configuredChunkSize && (
                                <span className="flex items-center gap-1">
                                  <Gauge className="h-3 w-3" />
                                  настройка {configuredChunkSize.toLocaleString("ru-RU")} симв.
                                </span>
                              )}
                              {chunksOverLimit > 0 && (
                                <span className="text-destructive">
                                  {chunksOverLimit.toLocaleString("ru-RU")} чанков превышают лимит
                                </span>
                              )}
                            </div>
                          </div>

                          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                            <Dialog>
                              <DialogTrigger asChild>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  data-testid={`button-view-content-${page.id}`}
                                >
                                  <FileText className="h-4 w-4 mr-1" />
                                  Содержимое
                                </Button>
                              </DialogTrigger>
                              <DialogContent className="max-w-4xl max-h-[80vh]">
                                <DialogHeader>
                                  <DialogTitle className="flex items-center gap-2">
                                    <span className="truncate">{page.title || "Без названия"}</span>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      asChild
                                    >
                                      <a
                                        href={page.url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                      >
                                        <ExternalLink className="h-3 w-3" />
                                      </a>
                                    </Button>
                                  </DialogTitle>
                                  <p className="text-sm text-muted-foreground truncate">
                                    {page.url}
                                  </p>
                                </DialogHeader>
                                <ScrollArea className="h-96 w-full">
                                  <div className="space-y-4">
                                    {page.metaDescription && (
                                      <div>
                                        <h4 className="font-medium mb-2">Описание:</h4>
                                        <p className="text-sm text-muted-foreground">
                                          {page.metaDescription}
                                        </p>
                                      </div>
                                    )}
                                    <div>
                                      <h4 className="font-medium mb-2">Содержимое:</h4>
                                      <div className="flex flex-wrap gap-4 text-xs text-muted-foreground mb-3">
                                        <span>Символов (агрегировано): {contentLength.toLocaleString("ru-RU")}</span>
                                        <span>Слов (агрегировано): {aggregatedWordCount.toLocaleString("ru-RU")}</span>
                                        {chunkCount > 0 && (
                                          <>
                                            <span>Чанков: {chunkCount.toLocaleString("ru-RU")}</span>
                                            <span>Макс. чанк: {maxChunkLength.toLocaleString("ru-RU")} символов</span>
                                            <span>Сред. чанк: {avgChunkLength.toLocaleString("ru-RU")} символов</span>
                                            <span>Макс. слов в чанке: {maxChunkWordCount.toLocaleString("ru-RU")}</span>
                                            {configuredChunkSize && (
                                              <span>Лимит проекта: {configuredChunkSize.toLocaleString("ru-RU")} символов</span>
                                            )}
                                            {chunksOverLimit > 0 && (
                                              <span className="text-destructive">
                                                {chunksOverLimit.toLocaleString("ru-RU")} чанков превышают лимит
                                              </span>
                                            )}
                                          </>
                                        )}
                                      </div>
                                      {chunkCount > 0 && (
                                        <div className="space-y-3 mb-6">
                                          <h5 className="text-sm font-medium">Разбивка по чанкам:</h5>
                                          {chunks.map((chunk, index) => {
                                            const chunkCharCount = chunk.metadata?.charCount ?? chunk.content.length;
                                            const chunkWordCount = chunk.metadata?.wordCount ??
                                              chunk.content.trim().split(/\s+/).filter(Boolean).length;
                                            return (
                                              <div
                                                key={chunk.id || `${page.id}-chunk-${index}`}
                                                className="rounded-lg border bg-muted/30 p-3"
                                              >
                                                <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                                                  <div className="text-sm font-medium truncate">
                                                    {chunk.heading || `Чанк ${index + 1}`}
                                                  </div>
                                                  <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                                                    <span>Символов: {chunkCharCount.toLocaleString("ru-RU")}</span>
                                                    <span>Слов: {chunkWordCount.toLocaleString("ru-RU")}</span>
                                                    {chunk.metadata?.position !== undefined && (
                                                      <span>Позиция: {chunk.metadata.position + 1}</span>
                                                    )}
                                                  </div>
                                                </div>
                                                <p className="mt-2 text-sm text-muted-foreground whitespace-pre-wrap break-words">
                                                  {chunk.content}
                                                </p>
                                              </div>
                                            );
                                          })}
                                        </div>
                                      )}
                                      <pre className="text-sm bg-muted p-4 rounded-lg whitespace-pre-wrap">
                                        {page.content}
                                      </pre>
                                    </div>
                                  </div>
                                </ScrollArea>
                              </DialogContent>
                            </Dialog>
                            <VectorizePageDialog page={page} providers={activeEmbeddingProviders} />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}