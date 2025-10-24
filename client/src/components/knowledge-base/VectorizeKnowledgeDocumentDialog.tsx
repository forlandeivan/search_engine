import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import DOMPurify from "dompurify";
import {
  Loader2,
  Sparkles,
  Hash,
  FileText,
  Gauge,
} from "lucide-react";
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
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { buildDocumentChunkId, extractPlainTextFromHtml } from "@/lib/knowledge-document";
import {
  castValueToType,
  normalizeArrayValue,
  renderLiquidTemplate,
  type CollectionSchemaFieldInput,
  type VectorizeCollectionSchema,
} from "@shared/vectorization";
import { GIGACHAT_EMBEDDING_VECTOR_SIZE } from "@shared/constants";
import type { PublicEmbeddingProvider } from "@shared/schema";
import type { KnowledgeDocumentChunkSet } from "@shared/knowledge-base";
import type { KnowledgeDocumentVectorization } from "@/lib/knowledge-base";

interface KnowledgeDocumentForVectorization {
  id: string;
  title: string;
  content: string;
  updatedAt?: string | null;
  vectorization?: KnowledgeDocumentVectorization | null;
  chunkSet?: KnowledgeDocumentChunkSet | null;
}

interface KnowledgeBaseForVectorization {
  id: string;
  name: string;
  description?: string | null;
}

interface VectorCollectionListResponse {
  collections: Array<{
    name: string;
    status: string;
    vectorSize: number | null;
  }>;
}

interface VectorizeKnowledgeDocumentResponse {
  message?: string;
  pointsCount: number;
  collectionName: string;
  vectorSize?: number | null;
  totalUsageTokens?: number;
  collectionCreated?: boolean;
  recordIds: string[];
  chunkSize: number;
  chunkOverlap: number;
  documentId?: string;
  provider?: {
    id?: string;
    name?: string;
  };
  jobId?: string;
}

interface VectorizeKnowledgeDocumentDialogProps {
  document: KnowledgeDocumentForVectorization;
  base: KnowledgeBaseForVectorization | null;
  providers: PublicEmbeddingProvider[];
  onVectorizationComplete: (payload: {
    documentId: string;
    vectorization: KnowledgeDocumentVectorization;
  }) => void;
  onVectorizationStart?: (payload: {
    documentId: string;
    documentTitle: string;
    totalChunks: number;
  }) => void;
  onVectorizationJobCreated?: (payload: {
    documentId: string;
    jobId: string;
    totalChunks: number;
  }) => void;
  onVectorizationError?: (payload: { documentId: string; error: Error }) => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  hideTrigger?: boolean;
}

interface VectorizeRequestPayload {
  providerId: string;
  collectionName?: string;
  createCollection?: boolean;
  schema?: VectorizeCollectionSchema | null;
  chunkSize: number;
  chunkOverlap: number;
}

interface CollectionSchemaField extends CollectionSchemaFieldInput {
  id: string;
}

const TEMPLATE_PATH_LIMIT = 400;
const TEMPLATE_SUGGESTION_LIMIT = 150;
const CONTEXT_PREVIEW_VALUE_LIMIT = 160;
const DEFAULT_NEW_COLLECTION_NAME = "New Collection";
const DEFAULT_CHUNK_SIZE = 800;
const DEFAULT_CHUNK_OVERLAP = 200;

const pickPositiveInteger = (value?: number | null): number | null => {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.round(value);
  }

  return null;
};

const pickNonNegativeInteger = (value?: number | null): number | null => {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return Math.max(0, Math.round(value));
  }

  return null;
};

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
    createSchemaField({
      name: "title",
      template: "{{ chunk.heading | default: document.title }}",
    }),
    createSchemaField({
      name: "url",
      template: "{{ chunk.deepLink | default: document.path }}",
    }),
    createSchemaField({ name: "chunk_id", template: "{{ chunk.id }}" }),
    createSchemaField({ name: "chunk_index", template: "{{ chunk.index }}" }),
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

function sanitizeChunkConfigForRequest(
  config: KnowledgeDocumentChunkSet["config"] | null | undefined,
): Record<string, unknown> | undefined {
  if (!config) {
    return undefined;
  }

  const sanitized: Record<string, unknown> = {};

  const maxTokens = pickPositiveInteger(config.maxTokens);
  if (maxTokens !== null) {
    sanitized.maxTokens = maxTokens;
  }

  const maxChars = pickPositiveInteger(config.maxChars);
  if (maxChars !== null) {
    sanitized.maxChars = maxChars;
  }

  const overlapTokens = pickNonNegativeInteger(config.overlapTokens);
  if (overlapTokens !== null) {
    sanitized.overlapTokens = overlapTokens;
  }

  const overlapChars = pickNonNegativeInteger(config.overlapChars);
  if (overlapChars !== null) {
    sanitized.overlapChars = overlapChars;
  }

  if (typeof config.splitByPages === "boolean") {
    sanitized.splitByPages = config.splitByPages;
  }

  if (typeof config.respectHeadings === "boolean") {
    sanitized.respectHeadings = config.respectHeadings;
  }

  return Object.keys(sanitized).length > 0 ? sanitized : undefined;
}

function sanitizeChunkItemForRequest(
  chunk: KnowledgeDocumentChunkSet["chunks"][number],
  fallbackId: string,
): Record<string, unknown> {
  const normalizedId =
    typeof chunk.id === "string" && chunk.id.trim().length > 0 ? chunk.id.trim() : fallbackId;

  const normalizedSectionPath = Array.isArray(chunk.sectionPath)
    ? chunk.sectionPath
        .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
        .filter((entry) => entry.length > 0)
    : undefined;

  const metadata = chunk.metadata && Object.keys(chunk.metadata).length > 0 ? chunk.metadata : undefined;

  const vectorRecordId =
    typeof chunk.vectorRecordId === "string"
      ? chunk.vectorRecordId.trim()
      : typeof chunk.vectorRecordId === "number" && Number.isFinite(chunk.vectorRecordId)
      ? String(chunk.vectorRecordId)
      : "";

  const payload: Record<string, unknown> = {
    id: normalizedId,
    index: Math.max(0, Math.round(chunk.index ?? 0)),
    text: chunk.text,
    charStart: pickNonNegativeInteger(chunk.charStart) ?? undefined,
    charEnd: pickNonNegativeInteger(chunk.charEnd) ?? undefined,
    tokenCount: pickNonNegativeInteger(chunk.tokenCount) ?? undefined,
    pageNumber: pickNonNegativeInteger(chunk.pageNumber ?? null) ?? undefined,
    sectionPath: normalizedSectionPath,
    metadata,
    contentHash:
      typeof chunk.contentHash === "string" && chunk.contentHash.trim().length > 0
        ? chunk.contentHash.trim()
        : undefined,
  };

  if (vectorRecordId.length > 0) {
    payload.vectorRecordId = vectorRecordId;
  }

  return removeUndefinedDeep(payload);
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

function sanitizeCollectionName(source: string): string {
  const normalized = source.replace(/[^a-zA-Z0-9_-]/g, "").toLowerCase();
  return normalized.length > 0 ? normalized.slice(0, 60) : "default";
}

function buildDocumentContext(
  document: KnowledgeDocumentForVectorization,
  base: KnowledgeBaseForVectorization | null,
  provider: PublicEmbeddingProvider | undefined,
  text: string,
  charCount: number,
  wordCount: number,
) {
  const sanitizedHtml = DOMPurify.sanitize(document.content ?? "");
  const path = `knowledge://${base?.id ?? "library"}/${document.id}`;

  return removeUndefinedDeep({
    document: {
      id: document.id,
      title: document.title ?? null,
      text,
      html: sanitizedHtml,
      path,
      updatedAt: document.updatedAt ?? null,
      charCount,
      wordCount,
      excerpt: text.slice(0, CONTEXT_PREVIEW_VALUE_LIMIT) || null,
    },
    base: base
      ? {
          id: base.id,
          name: base.name ?? null,
          description: base.description ?? null,
        }
      : null,
    provider: {
      id: provider?.id ?? null,
      name: provider?.name ?? null,
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
  });
}

function formatNumber(value: number | null | undefined): string {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "недоступно";
  }

  return value.toLocaleString("ru-RU");
}

function formatTimestamp(value?: string | null): string {
  if (!value) {
    return "недоступно";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "недоступно";
  }

  return date.toLocaleString("ru-RU");
}

export function VectorizeKnowledgeDocumentDialog({
  document,
  base,
  providers,
  onVectorizationComplete,
  onVectorizationStart,
  onVectorizationJobCreated,
  onVectorizationError,
  open,
  onOpenChange,
  hideTrigger = false,
}: VectorizeKnowledgeDocumentDialogProps) {
  const { toast } = useToast();
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = typeof open === "boolean";
  const isOpen = isControlled ? open : internalOpen;
  const setOpenState = (next: boolean) => {
    if (!isControlled) {
      setInternalOpen(next);
    }
    onOpenChange?.(next);
  };
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
  const chunkSet = document.chunkSet ?? null;
  const chunkSetConfig = chunkSet?.config ?? null;
  const configMaxChars = pickPositiveInteger(chunkSetConfig?.maxChars);
  const configMaxTokens = pickPositiveInteger(chunkSetConfig?.maxTokens);
  const configOverlapChars = pickNonNegativeInteger(chunkSetConfig?.overlapChars);
  const configOverlapTokens = pickNonNegativeInteger(chunkSetConfig?.overlapTokens);
  const vectorizationChunkSize =
    typeof document.vectorization?.chunkSize === "number" &&
    Number.isFinite(document.vectorization.chunkSize) &&
    document.vectorization.chunkSize > 0
      ? Math.max(200, Math.min(8000, Math.round(document.vectorization.chunkSize)))
      : null;
  const vectorizationChunkOverlap =
    typeof document.vectorization?.chunkOverlap === "number" &&
    Number.isFinite(document.vectorization.chunkOverlap) &&
    document.vectorization.chunkOverlap >= 0
      ? Math.max(0, Math.round(document.vectorization.chunkOverlap))
      : null;
  const defaultChunkSize =
    configMaxChars ?? configMaxTokens ?? vectorizationChunkSize ?? DEFAULT_CHUNK_SIZE;
  const rawDefaultOverlap =
    configOverlapChars ?? configOverlapTokens ?? vectorizationChunkOverlap ?? DEFAULT_CHUNK_OVERLAP;
  const defaultChunkOverlap = Math.min(rawDefaultOverlap, Math.max(defaultChunkSize - 1, 0));
  const [chunkSizeInput, setChunkSizeInput] = useState<string>(String(defaultChunkSize));
  const [chunkOverlapInput, setChunkOverlapInput] = useState<string>(String(defaultChunkOverlap));
  const availableChunks = chunkSet?.chunks ?? [];
  const chunkSettingsLocked = availableChunks.length > 0;
  const [selectedChunkIds, setSelectedChunkIds] = useState<string[]>(() =>
    availableChunks.map((chunk) => chunk.id ?? buildDocumentChunkId(document.id, chunk.index)),
  );
  const lastVectorizationSelectionRef = useRef<{
    usingStoredChunks: boolean;
    chunkIndices: number[];
    totalChunks: number;
  } | null>(null);
  const jobReportedRef = useRef(false);

  const { data: collectionsData, isLoading: collectionsLoading, isFetching: collectionsFetching, error: collectionsError } =
    useQuery<VectorCollectionListResponse>({
      queryKey: ["/api/vector/collections"],
      enabled: isOpen,
      staleTime: 30_000,
    });

  useEffect(() => {
    if (isOpen) {
      return;
    }

    setChunkSizeInput(String(defaultChunkSize));
    setChunkOverlapInput(String(defaultChunkOverlap));
    setSelectedChunkIds([]);
  }, [defaultChunkSize, defaultChunkOverlap, document.id, isOpen]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const items = chunkSet?.chunks ?? [];
    if (items.length === 0) {
      setSelectedChunkIds([]);
      return;
    }

    setSelectedChunkIds(
      items.map((chunk) => chunk.id ?? buildDocumentChunkId(document.id, chunk.index)),
    );
  }, [chunkSet?.updatedAt, chunkSet?.id, document.id, isOpen]);

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

  const sanitizedHtml = useMemo(() => DOMPurify.sanitize(document.content ?? ""), [document.content]);
  const documentText = useMemo(() => extractPlainTextFromHtml(sanitizedHtml), [sanitizedHtml]);
  const documentCharCount = documentText.length;
  const documentWordCount = documentText
    ? documentText.split(/\s+/).filter(Boolean).length
    : 0;
  const chunkSizeNumberRaw = Number.parseInt(chunkSizeInput, 10);
  const chunkOverlapNumberRaw = Number.parseInt(chunkOverlapInput, 10);
  const chunkSizeNumber = chunkSettingsLocked
    ? defaultChunkSize
    : chunkSizeNumberRaw;
  const chunkOverlapNumber = chunkSettingsLocked
    ? defaultChunkOverlap
    : chunkOverlapNumberRaw;
  const chunkSizeValid =
    chunkSettingsLocked ||
    (Number.isFinite(chunkSizeNumberRaw) && chunkSizeNumberRaw >= 200 && chunkSizeNumberRaw <= 8000);
  const chunkOverlapValid =
    chunkSettingsLocked ||
    (Number.isFinite(chunkOverlapNumberRaw) &&
      chunkOverlapNumberRaw >= 0 &&
      chunkOverlapNumberRaw <= 4000 &&
      (!chunkSizeValid || chunkOverlapNumberRaw < chunkSizeNumberRaw));
  const chunkSettingsValid = chunkSettingsLocked
    ? availableChunks.length > 0
    : chunkSizeValid && chunkOverlapValid;
  const estimatedChunks = useMemo(() => {
    if (chunkSettingsLocked) {
      return selectedChunkIds.length;
    }

    if (!chunkSettingsValid) {
      return 0;
    }

    const effectiveOverlap = Math.min(chunkOverlapNumber, chunkSizeNumber - 1);
    const step = Math.max(1, chunkSizeNumber - effectiveOverlap);
    const effectiveLength = Math.max(0, documentCharCount - effectiveOverlap);
    return Math.max(1, Math.ceil(effectiveLength / step));
  }, [
    chunkSettingsLocked,
    chunkSettingsValid,
    chunkOverlapNumber,
    chunkSizeNumber,
    documentCharCount,
    selectedChunkIds.length,
  ]);
  const chunkSizeDisplay = chunkSizeNumber.toLocaleString("ru-RU");
  const chunkOverlapDisplay = chunkOverlapNumber.toLocaleString("ru-RU");
  const estimatedChunksDisplay =
    chunkSettingsValid && estimatedChunks >= 0
      ? estimatedChunks.toLocaleString("ru-RU")
      : "—";
  const showChunkSettingsError =
    !chunkSettingsLocked &&
    chunkSizeInput.trim().length > 0 &&
    chunkOverlapInput.trim().length > 0 &&
    !chunkSettingsValid;
  const estimatedTokens = documentCharCount > 0 ? Math.ceil(documentCharCount / 4) : 0;
  const documentPath = useMemo(
    () => `knowledge://${base?.id ?? "library"}/${document.id}`,
    [base?.id, document.id],
  );

  const availableCollections = useMemo(() => {
    if (!providerVectorSize) {
      return collections;
    }

    return collections.filter((collection) => parseVectorSize(collection.vectorSize) === providerVectorSize);
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
    if (!documentText) {
      return null;
    }

    return buildDocumentContext(
      document,
      base,
      selectedProvider,
      documentText,
      documentCharCount,
      documentWordCount,
    );
  }, [document, base, selectedProvider, documentText, documentCharCount, documentWordCount]);

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

  const handleToggleChunkSelection = (chunkId: string, checked: boolean) => {
    setSelectedChunkIds((prev) => {
      const next = new Set(prev);
      if (checked) {
        next.add(chunkId);
      } else {
        next.delete(chunkId);
      }

      return availableChunks
        .map((chunk) => chunk.id ?? buildDocumentChunkId(document.id, chunk.index))
        .filter((id) => next.has(id));
    });
  };

  const handleSelectAllChunks = () => {
    setSelectedChunkIds(
      availableChunks.map((chunk) => chunk.id ?? buildDocumentChunkId(document.id, chunk.index)),
    );
  };

  const handleClearChunkSelection = () => {
    setSelectedChunkIds([]);
  };

  const limitedTemplateVariableSuggestions = useMemo(
    () => templateVariableSuggestions.slice(0, TEMPLATE_SUGGESTION_LIMIT),
    [templateVariableSuggestions],
  );
  const hasMoreTemplateSuggestions = templateVariableSuggestions.length > TEMPLATE_SUGGESTION_LIMIT;

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

  const vectorizeMutation = useMutation<VectorizeKnowledgeDocumentResponse, Error, VectorizeRequestPayload>({
    mutationFn: async ({
      providerId,
      collectionName,
      createCollection: createNew,
      schema,
      chunkSize,
      chunkOverlap,
    }) => {
      const sanitizedName = collectionName?.trim() ?? "";
      const chunkData = chunkSet;
      const usingStoredChunks = Boolean(chunkData && chunkData.chunks.length > 0);
      const selectionSet = new Set(selectedChunkIds);
      const chunkItemsForRequest = usingStoredChunks
        ? (chunkData?.chunks ?? []).filter((chunk) =>
            selectionSet.has(chunk.id ?? buildDocumentChunkId(document.id, chunk.index)),
          )
        : [];
      const totalChunksForRequest = usingStoredChunks ? chunkItemsForRequest.length : estimatedChunks;

      if (usingStoredChunks && chunkItemsForRequest.length === 0) {
        throw new Error("Не удалось определить выбранные чанки. Обновите список и попробуйте снова.");
      }

      if (usingStoredChunks) {
        const chunkIndices = (chunkData?.chunks ?? []).reduce<number[]>((accumulator, chunk, index) => {
          const chunkId = chunk.id ?? buildDocumentChunkId(document.id, chunk.index);
          if (selectionSet.has(chunkId)) {
            accumulator.push(index);
          }
          return accumulator;
        }, []);

        lastVectorizationSelectionRef.current = {
          usingStoredChunks: true,
          chunkIndices,
          totalChunks: chunkData?.chunks.length ?? 0,
        };
      } else {
        lastVectorizationSelectionRef.current = {
          usingStoredChunks: false,
          chunkIndices: [],
          totalChunks: 0,
        };
      }

      const storedChunkSize = usingStoredChunks
        ? pickPositiveInteger(chunkData?.config?.maxChars) ??
          pickPositiveInteger(chunkData?.config?.maxTokens) ??
          defaultChunkSize
        : null;
      const storedChunkOverlap = usingStoredChunks
        ? pickNonNegativeInteger(chunkData?.config?.overlapChars) ??
          pickNonNegativeInteger(chunkData?.config?.overlapTokens) ??
          defaultChunkOverlap
        : null;
      const effectiveChunkSize = usingStoredChunks ? storedChunkSize ?? defaultChunkSize : chunkSize;
      const effectiveChunkOverlap = usingStoredChunks
        ? Math.min(storedChunkOverlap ?? defaultChunkOverlap, Math.max((storedChunkSize ?? defaultChunkSize) - 1, 0))
        : chunkOverlap;
      const body: Record<string, unknown> = {
        embeddingProviderId: providerId,
        collectionName: sanitizedName || undefined,
        createCollection: createNew,
        chunkSize: effectiveChunkSize,
        chunkOverlap: effectiveChunkOverlap,
        document: {
          id: document.id,
          title: document.title ?? null,
          text: documentText,
          html: sanitizedHtml,
          path: documentPath,
          updatedAt: document.updatedAt ?? null,
          charCount: documentCharCount,
          wordCount: documentWordCount,
          excerpt: documentText.slice(0, CONTEXT_PREVIEW_VALUE_LIMIT) || null,
        },
      };

      if (usingStoredChunks) {
        const chunkPayload: Record<string, unknown> = {
          chunkSetId: chunkData?.id,
          documentId: chunkData?.documentId,
          versionId: chunkData?.versionId,
          totalCount: chunkData?.chunkCount ?? chunkData?.chunks.length ?? chunkItemsForRequest.length,
          items: chunkItemsForRequest.map((chunk) =>
            sanitizeChunkItemForRequest(
              chunk,
              chunk.id ?? buildDocumentChunkId(document.id, chunk.index),
            ),
          ),
        };

        const sanitizedConfig = sanitizeChunkConfigForRequest(chunkData?.config);
        if (sanitizedConfig) {
          chunkPayload.config = sanitizedConfig;
        }

        (body.document as Record<string, unknown>).chunks = chunkPayload;
      }

      if (base) {
        body.base = {
          id: base.id,
          name: base.name ?? null,
          description: base.description ?? null,
        };
      }

      if (schema && schema.fields.length > 0) {
        body.schema = schema;
      }

      const response = await apiRequest("POST", "/api/knowledge/documents/vectorize", body);
      const jobId = response.headers.get("x-vectorization-job-id")?.trim() ?? "";
      const totalChunksHeader = response.headers.get("x-vectorization-total-chunks");

      if (jobId) {
        const parsedTotal = totalChunksHeader ? Number.parseInt(totalChunksHeader, 10) : Number.NaN;
        const normalizedTotal = Number.isFinite(parsedTotal) && parsedTotal > 0 ? parsedTotal : totalChunksForRequest;

        onVectorizationJobCreated?.({
          documentId: document.id,
          jobId,
          totalChunks: normalizedTotal > 0 ? normalizedTotal : totalChunksForRequest,
        });
        jobReportedRef.current = true;
      }

      const payload = (await response.json()) as VectorizeKnowledgeDocumentResponse;
      if (jobId) {
        payload.jobId = jobId;
      }

      return payload;
    },
    onSuccess: (data) => {
      if (data.jobId && typeof onVectorizationJobCreated === "function" && !jobReportedRef.current) {
        const completedTotal = data.pointsCount > 0 ? data.pointsCount : estimatedChunks;
        onVectorizationJobCreated({
          documentId: data.documentId ?? document.id,
          jobId: data.jobId,
          totalChunks: completedTotal > 0 ? completedTotal : estimatedChunks,
        });
        jobReportedRef.current = true;
      }

      const rawRecordIds = Array.isArray(data.recordIds) ? data.recordIds : [];
      const orderedRecordIds = rawRecordIds.map((value) => {
        if (typeof value === "number" || typeof value === "string") {
          const trimmed = String(value).trim();
          return trimmed.length > 0 ? trimmed : "";
        }

        return "";
      });

      const selectionInfo = lastVectorizationSelectionRef.current;
      lastVectorizationSelectionRef.current = null;

      let recordIds = orderedRecordIds.filter((value) => value.length > 0);
      let pointsCount = data.pointsCount;

      if (selectionInfo?.usingStoredChunks && selectionInfo.totalChunks > 0) {
        const totalChunks = selectionInfo.totalChunks > 0 ? selectionInfo.totalChunks : availableChunks.length;
        const existingRecordIds = document.vectorization?.recordIds ?? [];
        const mergedRecordIdsByIndex = Array.from({ length: totalChunks }, (_, index) => {
          const existing = existingRecordIds[index];
          return typeof existing === "string" && existing.trim().length > 0 ? existing.trim() : "";
        });

        selectionInfo.chunkIndices.forEach((chunkIndex, position) => {
          if (chunkIndex < 0 || chunkIndex >= mergedRecordIdsByIndex.length) {
            return;
          }

          const newId = position < orderedRecordIds.length ? orderedRecordIds[position] : "";
          mergedRecordIdsByIndex[chunkIndex] = newId;
        });

        const mergedRecordIds = mergedRecordIdsByIndex.filter((value) => value.length > 0);

        if (mergedRecordIds.length > 0) {
          const deduplicated: string[] = [];
          const seen = new Set<string>();

          mergedRecordIds.forEach((id) => {
            if (!seen.has(id)) {
              seen.add(id);
              deduplicated.push(id);
            }
          });

          recordIds = deduplicated;
          pointsCount = deduplicated.length;
        } else {
          recordIds = [];
          pointsCount = 0;
        }
      } else {
        if (recordIds.length > 0) {
          const deduplicated: string[] = [];
          const seen = new Set<string>();

          recordIds.forEach((id) => {
            if (!seen.has(id)) {
              seen.add(id);
              deduplicated.push(id);
            }
          });

          recordIds = deduplicated;
          pointsCount = deduplicated.length;
        } else {
          pointsCount = Math.max(data.pointsCount, 0);
        }
      }

      const fallbackChunkSize = chunkSizeValid ? chunkSizeNumber : DEFAULT_CHUNK_SIZE;
      const fallbackChunkOverlap = Math.min(
        chunkOverlapValid ? chunkOverlapNumber : DEFAULT_CHUNK_OVERLAP,
        Math.max(fallbackChunkSize - 1, 0),
      );

      const vectorization: KnowledgeDocumentVectorization = {
        collectionName: data.collectionName,
        providerId: data.provider?.id ?? selectedProviderId,
        providerName: data.provider?.name ?? selectedProvider?.name,
        recordIds,
        vectorSize:
          typeof data.vectorSize === "number" && Number.isFinite(data.vectorSize) && data.vectorSize > 0
            ? data.vectorSize
            : null,
        chunkSize:
          typeof data.chunkSize === "number" && Number.isFinite(data.chunkSize) && data.chunkSize > 0
            ? data.chunkSize
            : fallbackChunkSize,
        chunkOverlap:
          typeof data.chunkOverlap === "number" && Number.isFinite(data.chunkOverlap) && data.chunkOverlap >= 0
            ? Math.min(data.chunkOverlap, Math.max(fallbackChunkSize - 1, 0))
            : fallbackChunkOverlap,
        pointsCount,
        totalUsageTokens:
          typeof data.totalUsageTokens === "number" && Number.isFinite(data.totalUsageTokens) && data.totalUsageTokens >= 0
            ? data.totalUsageTokens
            : null,
        vectorizedAt: new Date().toISOString(),
      };

      onVectorizationComplete({
        documentId: data.documentId ?? document.id,
        vectorization,
      });

      const collectionNote = data.collectionCreated
        ? `Коллекция ${data.collectionName} создана автоматически.`
        : "";
      const chunkSummary = chunkSettingsLocked
        ? `Выбранных чанков: ${data.pointsCount.toLocaleString("ru-RU")} из ${availableChunks.length.toLocaleString(
            "ru-RU",
          )} (размер ${vectorization.chunkSize.toLocaleString("ru-RU")}, перехлёст ${vectorization.chunkOverlap.toLocaleString(
            "ru-RU",
          )}).`
        : `Чанков: ${data.pointsCount.toLocaleString("ru-RU")} (размер ${vectorization.chunkSize.toLocaleString(
            "ru-RU",
          )}, перехлёст ${vectorization.chunkOverlap.toLocaleString("ru-RU")}).`;

      toast({
        title: "Документ отправлен",
        description:
          data.message ??
          `Добавлено ${data.pointsCount.toLocaleString("ru-RU")} записей в коллекцию ${data.collectionName}. ${chunkSummary} ${collectionNote}`.trim(),
      });
      setOpenState(false);
    },
    onError: (error) => {
      lastVectorizationSelectionRef.current = null;
      if (typeof onVectorizationError === "function") {
        onVectorizationError({ documentId: document.id, error });
      }
      toast({
        title: "Не удалось отправить документ",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const disabled =
    providers.length === 0 ||
    !documentText ||
    (chunkSettingsLocked && selectedChunkIds.length === 0);
  const confirmDisabled =
    disabled ||
    vectorizeMutation.isPending ||
    !selectedProviderId ||
    !chunkSettingsValid ||
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
    setSchemaFields((prev) => prev.map((field) => (field.id === id ? { ...field, ...patch } : field)));
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

  const handleSelectEmbeddingField = (id: string | null) => {
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

  const handleOpenChange = (open: boolean) => {
    setOpenState(open);
    if (open) {
      setActiveTab("settings");
      setActiveSuggestionsFieldId(null);
      templateFieldRefs.current = {};
      setChunkSizeInput(String(defaultChunkSize));
      setChunkOverlapInput(String(defaultChunkOverlap));
      return;
    }

    vectorizeMutation.reset();
    setCollectionMode(availableCollections.length > 0 ? "existing" : "new");
    setSelectedCollectionName(availableCollections[0]?.name ?? "");
    setNewCollectionName(DEFAULT_NEW_COLLECTION_NAME);
    resetSchemaBuilder();
    setActiveSuggestionsFieldId(null);
    setActiveTab("settings");
    templateFieldRefs.current = {};
    setChunkSizeInput(String(defaultChunkSize));
    setChunkOverlapInput(String(defaultChunkOverlap));
  };

  const handleConfirm = () => {
    if (!selectedProviderId) {
      toast({
        title: "Выберите сервис",
        description: "Чтобы отправить документ, выберите активный сервис эмбеддингов.",
        variant: "destructive",
      });
      return;
    }

    if (!chunkSettingsValid) {
      toast({
        title: "Некорректные параметры чанка",
        description:
          "Убедитесь, что размер находится в пределах 200–8000 символов, а перехлёст меньше размера чанка.",
        variant: "destructive",
      });
      return;
    }

    if (chunkSettingsLocked && selectedChunkIds.length === 0) {
      toast({
        title: "Выберите чанки",
        description: "Отметьте хотя бы один чанк, который нужно отправить в коллекцию.",
        variant: "destructive",
      });
      return;
    }

    const normalizedChunkOverlap = Math.min(
      chunkOverlapNumber,
      Math.max(chunkSizeNumber - 1, 0),
    );

    const totalChunksToProcess = chunkSettingsLocked ? selectedChunkIds.length : estimatedChunks;
    if (typeof onVectorizationStart === "function") {
      const safeTotalChunks = Number.isFinite(totalChunksToProcess)
        ? Math.max(0, totalChunksToProcess)
        : 0;
      onVectorizationStart({
        documentId: document.id,
        documentTitle: document.title?.trim() ? document.title : "Без названия",
        totalChunks: safeTotalChunks,
      });
    }
    jobReportedRef.current = false;

    if (collectionMode === "existing") {
      if (!selectedCollectionName) {
        toast({
          title: "Выберите коллекцию",
          description: "Укажите коллекцию Qdrant для загрузки документа.",
          variant: "destructive",
        });
        return;
      }

      vectorizeMutation.mutate({
        providerId: selectedProviderId,
        collectionName: selectedCollectionName,
        createCollection: false,
        chunkSize: chunkSizeNumber,
        chunkOverlap: normalizedChunkOverlap,
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
      chunkSize: chunkSizeNumber,
      chunkOverlap: normalizedChunkOverlap,
    });
  };

  const renderDialogHeader = () => (
    <DialogHeader className="space-y-2 border-b border-border/60 bg-muted/40 px-6 py-4">
      <DialogTitle className="text-xl font-semibold">Векторизация документа</DialogTitle>
      <p className="text-sm text-muted-foreground">
        Подготовим документ базы знаний к загрузке в Qdrant. Выберите сервис эмбеддингов и подходящую коллекцию
        либо создайте новую с нужной схемой.
      </p>
      <div className="grid gap-3 pt-2 sm:grid-cols-3">
        <div className="rounded-md border bg-background p-3">
          <div className="flex items-center gap-2 text-xs uppercase text-muted-foreground">
            <FileText className="h-3.5 w-3.5" /> Документ
          </div>
          <p className="mt-1 line-clamp-2 text-sm font-semibold leading-snug">
            {document.title?.trim() ? document.title : "Без названия"}
          </p>
        </div>
        <div className="rounded-md border bg-background p-3">
          <div className="flex items-center gap-2 text-xs uppercase text-muted-foreground">
            <Hash className="h-3.5 w-3.5" /> Символов
          </div>
          <p className="mt-1 text-lg font-semibold">{formatNumber(documentCharCount)}</p>
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

  const renderSchemaField = (field: CollectionSchemaField, index: number) => {
    const isEmbeddingField = embeddingFieldId === field.id;
    const suggestionsVisible = activeSuggestionsFieldId === field.id;

    return (
      <div key={field.id} className="space-y-3 rounded-lg border p-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-1 flex-col gap-2 sm:flex-row sm:items-center">
            <div className="flex-1">
              <label className="text-xs font-medium">Название поля</label>
              <Input
                value={field.name}
                placeholder={`Поле ${index + 1}`}
                onChange={(event) => handleUpdateSchemaField(field.id, { name: event.target.value })}
              />
            </div>
            <div>
              <label className="text-xs font-medium">Тип</label>
              <Select
                value={field.type}
                onValueChange={(value) => handleUpdateSchemaField(field.id, { type: value as CollectionSchemaFieldInput["type"] })}
              >
                <SelectTrigger className="w-28">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="string">Строка</SelectItem>
                  <SelectItem value="double">Число</SelectItem>
                  <SelectItem value="object">Объект</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2 pt-5 sm:pt-0">
              <Checkbox
                id={`schema-field-array-${field.id}`}
                checked={field.isArray}
                onCheckedChange={(checked) => handleUpdateSchemaField(field.id, { isArray: Boolean(checked) })}
              />
              <label htmlFor={`schema-field-array-${field.id}`} className="text-xs">
                Массив
              </label>
            </div>
            <div className="flex items-center gap-2 pt-5 sm:pt-0">
              <Switch
                id={`schema-field-embedding-${field.id}`}
                checked={isEmbeddingField}
                onCheckedChange={(checked) => handleSelectEmbeddingField(checked ? field.id : null)}
              />
              <label htmlFor={`schema-field-embedding-${field.id}`} className="text-xs">
                Поле вектора
              </label>
            </div>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => handleRemoveSchemaField(field.id)}
            disabled={schemaFields.length === 1}
          >
            Удалить
          </Button>
        </div>
        <div className="space-y-2">
          <label className="text-xs font-medium">Liquid шаблон</label>
          <Textarea
            value={field.template}
            rows={4}
            onChange={(event) => handleTemplateInputChange(field.id, event)}
            onKeyDown={handleTemplateKeyDown}
            placeholder="Например, {{ document.text }}"
          />
          {suggestionsVisible && limitedTemplateVariableSuggestions.length > 0 && (
            <div className="rounded-md border bg-muted/60 p-3 text-xs">
              <div className="mb-2 font-medium">Подставьте значение:</div>
              <div className="flex flex-wrap gap-2">
                {limitedTemplateVariableSuggestions.map((path) => (
                  <Button
                    key={path}
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => handleInsertTemplateVariable(field.id, path)}
                    className="text-xs"
                  >
                    {path}
                  </Button>
                ))}
              </div>
              {hasMoreTemplateSuggestions && (
                <div className="mt-2 text-muted-foreground">
                  Показаны первые {TEMPLATE_SUGGESTION_LIMIT} вариантов.
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderSchemaBuilder = () => (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="space-y-1">
          <h4 className="text-sm font-semibold">Схема коллекции</h4>
          <p className="text-xs text-muted-foreground">
            Настройте поля, которые будут сохраняться в коллекции. Поле вектора должно содержать текст документа.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={resetSchemaBuilder}>
            Сбросить
          </Button>
          <Button type="button" size="sm" onClick={handleAddSchemaField}>
            Добавить поле
          </Button>
        </div>
      </div>
      <div className="space-y-3">
        {schemaFields.map((field, index) => renderSchemaField(field, index))}
      </div>
      <div className="rounded-lg border bg-muted/50 p-3 text-xs">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-muted-foreground">Поле для вектора:</span>
          {embeddingFieldName ? (
            <span className="font-medium">{embeddingFieldName}</span>
          ) : (
            <span className="text-destructive">не выбрано</span>
          )}
        </div>
      </div>
    </div>
  );

  const renderCollectionsSection = () => (
    <div className="space-y-3">
      <p className="text-xs uppercase text-muted-foreground">Коллекция Qdrant</p>
      <Tabs value={collectionMode} onValueChange={(value) => setCollectionMode(value as "existing" | "new")}>
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger
            value="existing"
            disabled={
              availableCollections.length === 0 && !isCollectionsLoading && !collectionsErrorMessage
            }
          >
            Существующая
          </TabsTrigger>
          <TabsTrigger value="new">Новая</TabsTrigger>
        </TabsList>
        <TabsContent value="existing" className="mt-4 space-y-2">
          <Select
            value={selectedCollectionName}
            onValueChange={setSelectedCollectionName}
            disabled={availableCollections.length === 0}
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
              Скрыто {filteredOutCollectionsCount.toLocaleString("ru-RU")} коллекций из-за несовпадения размера вектора.
            </p>
          )}
          {availableCollections.length === 0 && !isCollectionsLoading && (
            <p className="text-xs text-muted-foreground">
              Для выбранного сервиса нет подходящих коллекций. Создайте новую.
            </p>
          )}
          {collectionsErrorMessage && (
            <p className="text-xs text-destructive">{collectionsErrorMessage}</p>
          )}
        </TabsContent>
        <TabsContent value="new" className="mt-4 space-y-3">
          <Input
            id="knowledge-new-collection-name"
            value={newCollectionName}
            onChange={(event) => setNewCollectionName(event.target.value)}
            placeholder="Название новой коллекции"
            maxLength={60}
          />
          <p className="text-xs text-muted-foreground">
            Допустимы латинские буквы, цифры, символы подчёркивания и дефисы. Максимум 60 символов.
          </p>
          {renderSchemaBuilder()}
        </TabsContent>
      </Tabs>
    </div>
  );

  const renderChunkingSection = () => (
    <div className="space-y-3">
      <div className="space-y-1">
        <h4 className="text-sm font-semibold">Разбиение документа</h4>
        <p className="text-xs text-muted-foreground">
          {chunkSettingsLocked
            ? "Выбранные ниже чанки будут отправлены в коллекцию. Изменить параметры можно на вкладке «Чанки»."
            : "Укажите размер чанка и перехлёст, чтобы оценить количество записей."}
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label className="text-xs font-medium" htmlFor="knowledge-chunk-size">
            Размер чанка (символов)
          </label>
          <Input
            id="knowledge-chunk-size"
            inputMode="numeric"
            value={chunkSizeInput}
            onChange={(event) => setChunkSizeInput(event.target.value.replace(/[^0-9]/g, ""))}
            placeholder="Например, 800"
            disabled={chunkSettingsLocked}
          />
          <p className="text-[11px] text-muted-foreground">Допустимо от 200 до 8000 символов.</p>
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-medium" htmlFor="knowledge-chunk-overlap">
            Перехлёст (символов)
          </label>
          <Input
            id="knowledge-chunk-overlap"
            inputMode="numeric"
            value={chunkOverlapInput}
            onChange={(event) => setChunkOverlapInput(event.target.value.replace(/[^0-9]/g, ""))}
            placeholder="Например, 200"
            disabled={chunkSettingsLocked}
          />
          <p className="text-[11px] text-muted-foreground">Перехлёст должен быть меньше размера чанка.</p>
        </div>
      </div>
      {showChunkSettingsError ? (
        <p className="text-[11px] text-destructive">
          Проверьте значения: размер 200–8000, перехлёст 0–4000 и меньше размера чанка.
        </p>
      ) : (
        <p className="text-[11px] text-muted-foreground">
          {chunkSettingsLocked
            ? `Выбрано чанков: ${selectedChunkIds.length.toLocaleString("ru-RU")}`
            : `Оценочно чанков: ${estimatedChunksDisplay}.`}
        </p>
      )}
      {chunkSettingsLocked ? (
        <div className="space-y-3 rounded-md border bg-muted/40 p-3">
          <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
            <span>
              Выбрано чанков: {selectedChunkIds.length.toLocaleString("ru-RU")} из {" "}
              {availableChunks.length.toLocaleString("ru-RU")}
            </span>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleSelectAllChunks}
                disabled={selectedChunkIds.length === availableChunks.length}
              >
                Выбрать все
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleClearChunkSelection}
                disabled={selectedChunkIds.length === 0}
              >
                Сбросить
              </Button>
            </div>
          </div>
          <ScrollArea className="max-h-64 rounded-md border bg-background/80 p-3">
            <div className="space-y-3">
              {availableChunks.map((chunk) => {
                const chunkId = chunk.id ?? buildDocumentChunkId(document.id, chunk.index);
                const isSelected = selectedChunkIds.includes(chunkId);
                const charCount = chunk.text.length;
                const tokensLabel =
                  typeof chunk.tokenCount === "number" && Number.isFinite(chunk.tokenCount)
                    ? `${chunk.tokenCount.toLocaleString("ru-RU")} токенов`
                    : null;
                const excerptSource = chunk.text.replace(/\s+/g, " ").trim();
                const excerpt =
                  excerptSource.length > 0
                    ? `${excerptSource.slice(0, 200)}${excerptSource.length > 200 ? "…" : ""}`
                    : "";

                return (
                  <label
                    key={chunkId}
                    className="flex cursor-pointer gap-3 rounded-md border bg-muted/20 p-3 transition hover:border-primary/40"
                  >
                    <Checkbox
                      checked={isSelected}
                      onCheckedChange={(checked) => handleToggleChunkSelection(chunkId, Boolean(checked))}
                    />
                    <div className="flex-1 space-y-1">
                      <div className="flex flex-wrap items-center justify-between text-xs font-medium text-muted-foreground">
                        <span>Чанк #{chunk.index + 1}</span>
                        <div className="flex items-center gap-2">
                          <span>{charCount.toLocaleString("ru-RU")} символов</span>
                          {tokensLabel && <span>{tokensLabel}</span>}
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground/80">{excerpt || "Чанк пуст"}</p>
                    </div>
                  </label>
                );
              })}
            </div>
          </ScrollArea>
        </div>
      ) : (
        <div className="rounded-md border border-dashed bg-muted/20 p-3 text-xs text-muted-foreground">
          Сначала сохраните разбиение документа на вкладке «Чанки», чтобы выбрать конкретные фрагменты для
          векторизации.
        </div>
      )}
    </div>
  );

  const renderInfoSection = () => (
    <div className="space-y-4">
      <div className="space-y-2">
        <p className="text-xs uppercase text-muted-foreground">Состояние коллекций</p>
        {isCollectionsLoading ? (
          <p className="text-sm text-muted-foreground">Загружаем список коллекций…</p>
        ) : collectionsErrorMessage ? (
          <p className="text-sm text-destructive">Не удалось загрузить коллекции: {collectionsErrorMessage}</p>
        ) : collections.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Коллекции отсутствуют. Создайте новую коллекцию, чтобы отправить документ.
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            Доступно коллекций: {collections.length.toLocaleString("ru-RU")}
          </p>
        )}
      </div>
      <div className="space-y-2">
        <p className="text-xs uppercase text-muted-foreground">Документ</p>
        <div className="rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground">
          <p className="font-medium text-foreground">{document.title?.trim() ? document.title : "Без названия"}</p>
          <p className="break-all">{documentPath}</p>
          <p>Символов: {formatNumber(documentCharCount)}</p>
          <p>Оценка токенов: {tokensHint}</p>
          <p>Размер чанка: {chunkSizeDisplay}</p>
          <p>Перехлёст: {chunkOverlapDisplay}</p>
          {chunkSettingsLocked ? (
            <p>
              Выбрано чанков: {selectedChunkIds.length.toLocaleString("ru-RU")} из {" "}
              {availableChunks.length.toLocaleString("ru-RU")}
            </p>
          ) : (
            <p>Оценка чанков: {estimatedChunksDisplay}</p>
          )}
          {!chunkSettingsLocked && (
            <p className="text-xs text-muted-foreground/80">
              Чтобы отправить документ, сохраните разбиение на вкладке «Чанки» и при необходимости выберите конкретные
              фрагменты.
            </p>
          )}
        </div>
      </div>
      <div className="space-y-2">
        <p className="text-xs uppercase text-muted-foreground">Векторизация</p>
        {document.vectorization ? (
          <div className="rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground">
            <p className="font-medium text-foreground">
              Коллекция: <code>{document.vectorization.collectionName}</code>
            </p>
            <p>Записей: {document.vectorization.pointsCount.toLocaleString("ru-RU")}</p>
            <p>Размер чанка: {document.vectorization.chunkSize.toLocaleString("ru-RU")}</p>
            <p>Перехлёст: {document.vectorization.chunkOverlap.toLocaleString("ru-RU")}</p>
            <p>Обновлено: {formatTimestamp(document.vectorization.vectorizedAt)}</p>
            <ScrollArea className="mt-2 max-h-28 rounded-md border bg-background/90 p-2">
              <pre className="whitespace-pre-wrap break-all font-mono text-[11px] leading-snug text-foreground">
                {document.vectorization.recordIds.join("\n") || "—"}
              </pre>
            </ScrollArea>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Документ ещё не отправлялся в Qdrant.</p>
        )}
      </div>
      {base && (
        <div className="space-y-2">
          <p className="text-xs uppercase text-muted-foreground">База знаний</p>
          <div className="rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground">
            <p className="font-medium text-foreground">{base.name}</p>
            {base.description && <p className="mt-1 text-xs leading-relaxed">{base.description}</p>}
          </div>
        </div>
      )}
    </div>
  );

  const renderProviderSection = () => (
    <div className="space-y-4">
      <div className="space-y-1">
        <h4 className="text-sm font-semibold">Сервис эмбеддингов</h4>
        <p className="text-xs text-muted-foreground">
          Активные сервисы преобразуют текст документа в вектор нужного размера.
        </p>
      </div>
      <Select value={selectedProviderId} onValueChange={setSelectedProviderId}>
        <SelectTrigger className="w-full sm:w-80">
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
      {selectedProvider && (
        <div className="rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground">
          <div className="flex flex-wrap items-center gap-3">
            <span>Модель: {selectedProvider.model}</span>
            <span>
              Размер вектора: {providerVectorSize ? providerVectorSize.toLocaleString("ru-RU") : "недоступно"}
            </span>
          </div>
        </div>
      )}
    </div>
  );

  const renderSettingsTab = () => (
    <div className="space-y-6 px-6 pb-6">
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-6">
          {renderProviderSection()}
          {renderChunkingSection()}
          {renderCollectionsSection()}
        </div>
        {renderInfoSection()}
      </div>
    </div>
  );

  const renderContextTab = () => (
    <div className="space-y-6 px-6 pb-6">
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-2">
          <h4 className="text-sm font-semibold">JSON документа</h4>
          <p className="text-xs text-muted-foreground">
            Контекст, который можно использовать в Liquid шаблонах. Значения доступны для формирования payload.
          </p>
          <ScrollArea className="h-64 rounded-lg border bg-muted/30 p-4">
            <pre className="text-xs">{liquidContextJson || "{}"}</pre>
          </ScrollArea>
        </div>
        <div className="space-y-2">
          <h4 className="text-sm font-semibold">Предпросмотр схемы</h4>
          <p className="text-xs text-muted-foreground">
            Проверяйте, какие значения будут записаны в коллекцию по текущей схеме.
          </p>
          <ScrollArea className="h-64 rounded-lg border bg-muted/30 p-4">
            <pre className="text-xs">{schemaPreviewJson || "{}"}</pre>
          </ScrollArea>
        </div>
      </div>
    </div>
  );

  const renderDialogBody = () => (
    <div className="flex-1">
      <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as "settings" | "context")}>
        <TabsList className="mx-6 mt-2">
          <TabsTrigger value="settings">Настройки</TabsTrigger>
          <TabsTrigger value="context" disabled={!liquidContext}>
            Контекст
          </TabsTrigger>
        </TabsList>
        <TabsContent value="settings">{renderSettingsTab()}</TabsContent>
        <TabsContent value="context">{renderContextTab()}</TabsContent>
      </Tabs>
    </div>
  );

  const renderDialogFooter = () => (
    <DialogFooter className="gap-2 border-t px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="text-xs text-muted-foreground">
        {collectionMode === "new"
          ? "Для новой коллекции укажите схему и название."
          : "Документ будет отправлен в выбранную коллекцию без изменения схемы."}
      </div>
      <Button onClick={handleConfirm} disabled={confirmDisabled}>
        {vectorizeMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        Отправить
      </Button>
    </DialogFooter>
  );

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      {!hideTrigger && (
        <DialogTrigger asChild>
          <Button variant="outline" size="sm" disabled={disabled} className="whitespace-nowrap">
            <Sparkles className="mr-1 h-4 w-4" />
            Векторизация
          </Button>
        </DialogTrigger>
      )}
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

export default VectorizeKnowledgeDocumentDialog;
