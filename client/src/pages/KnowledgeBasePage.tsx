import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { Link, useLocation } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import DocumentEditor from "@/components/knowledge-base/DocumentEditor";
import DocumentChunksPanel from "@/components/knowledge-base/DocumentChunksPanel";
import MarkdownRenderer from "@/components/ui/markdown";
import { AskAiRunJournalDialog } from "@/components/knowledge-base/AskAiRunJournalDialog";
import SearchQuickSwitcher from "@/components/search/SearchQuickSwitcher";
import KnowledgeBaseSearchSettingsForm, {
  type KnowledgeBaseSearchSettings,
  type VectorCollectionSummary,
} from "@/components/knowledge-base/KnowledgeBaseSearchSettingsForm";
import VectorizeKnowledgeDocumentDialog, {
  type KnowledgeDocumentVectorizationSelection,
} from "@/components/knowledge-base/VectorizeKnowledgeDocumentDialog";
import DocumentVectorizationProgress, {
  type DocumentVectorizationProgressStatus,
} from "@/components/knowledge-base/DocumentVectorizationProgress";
import { CreateKnowledgeBaseDialog } from "@/components/knowledge-base/CreateKnowledgeBaseDialog";
import { JsonImportWizard } from "@/components/knowledge-base/JsonImportWizard";
import { JsonImportCard } from "@/components/knowledge-base/JsonImportCard";
import { IndexingWizardModal } from "@/components/knowledge-base/indexing";
import { useKnowledgeBaseIndexingPolicy } from "@/hooks/useKnowledgeBaseIndexingPolicy";
import { useIndexingRules } from "@/hooks/useIndexingRules";
import { convertPolicyToWizardConfig, convertRulesToWizardConfig } from "@/lib/indexing-config-converter";
import { DEFAULT_SCHEMA_FIELDS } from "@shared/knowledge-base-indexing";
import { ragDefaults, searchDefaults } from "@/constants/searchSettings";
import {
  mergeChunkSearchSettings,
  mergeRagSearchSettings,
  type KnowledgeBaseSearchSettingsResponsePayload,
  type KnowledgeBaseSearchSettingsUpdatePayload,
} from "@shared/knowledge-base-search";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { CreateKnowledgeDocumentDialog, type CreateKnowledgeDocumentFormValues } from "@/components/knowledge-base/CreateKnowledgeDocumentDialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useSuggestSearch } from "@/hooks/useSuggestSearch";
import { ToastAction } from "@/components/ui/toast";
import { escapeHtml, getSanitizedContent } from "@/lib/document-import";
import {
  KNOWLEDGE_BASE_EVENT,
  readKnowledgeBaseStorage,
  syncKnowledgeBaseStorageFromSummaries,
  type KnowledgeBase as LocalKnowledgeBase,
  type KnowledgeBaseSourceType,
} from "@/lib/knowledge-base";
import { CrawlInlineProgress, type CrawlInlineState } from "@/components/knowledge-base/CrawlInlineProgress";
import { useStartKnowledgeBaseIndexing } from "@/hooks/useKnowledgeBaseIndexing";
import { useResetKnowledgeBaseIndexing } from "@/hooks/useResetKnowledgeBaseIndexing";
import { useKnowledgeBaseIndexingStatus } from "@/hooks/useKnowledgeBaseIndexingStatus";
import { useKnowledgeBaseIndexingSummary } from "@/hooks/useKnowledgeBaseIndexingSummary";
import { useKnowledgeBaseIndexingChanges } from "@/hooks/useKnowledgeBaseIndexingChanges";
import { useActiveIndexingActions } from "@/hooks/useActiveIndexingActions";
import { Progress } from "@/components/ui/progress";
import type {
  KnowledgeBaseSummary,
  KnowledgeBaseTreeNode,
  KnowledgeBaseNodeDetail,
  KnowledgeBaseChildNode,
  DeleteKnowledgeNodeResponse,
  CreateKnowledgeDocumentResponse,
  CreateCrawledKnowledgeDocumentResponse,
  DeleteKnowledgeBaseResponse,
  KnowledgeBaseDocumentDetail,
  KnowledgeDocumentChunkSet,
  KnowledgeDocumentVectorizationJobStatus,
  KnowledgeBaseCrawlJobStatus,
} from "@shared/knowledge-base";
import type {
  PublicEmbeddingProvider,
  PublicLlmProvider,
  KnowledgeBaseIndexStatus,
  KnowledgeDocumentIndexStatus,
} from "@shared/schema";
import type { SessionResponse } from "@/types/session";
import type { UseKnowledgeBaseAskAiOptions } from "@/hooks/useKnowledgeBaseAskAi";
import {
  ChevronDown,
  ChevronRight,
  Database,
  FileDown,
  FileJson,
  FileText,
  FileType,
  Folder,
  GitBranch,
  Globe2,
  History,
  Loader2,
  MoreVertical,
  PencilLine,
  Search,
  Plus,
  RefreshCw,
  Settings,
  SquareStack,
  Sparkles,
  Trash2,
  Layers,
  ExternalLink,
} from "lucide-react";

// Import from decomposed modules
import {
  ROOT_PARENT_VALUE,
  TERMINAL_CRAWL_STATUSES,
  DOCUMENT_STATUS_LABELS,
  DOCUMENT_SOURCE_LABELS,
} from "./KnowledgeBasePage/constants";
import {
  buildSearchSettingsFromResolved,
  createDefaultSearchSettings,
  composeSearchSettingsFromApi,
  parseStoredSearchSettings,
  buildSearchSettingsUpdatePayload,
  buildSearchSettingsHash,
  cloneSearchSettings,
  clampTopKValue,
  clampVectorLimitValue,
  clampTemperatureValue,
  clampMaxTokensValue,
  clampWeightValue,
} from "./KnowledgeBasePage/utils/search-settings";
import { hasNode, collectFolderOptions, buildDescendantMap, buildParentMap } from "./KnowledgeBasePage/utils/tree-operations";
import { formatDateTime, normalizeBlockText, extractDocumentBlocks, buildDocumentFileName } from "./KnowledgeBasePage/utils/document-utils";
import type { DocumentContentBlock } from "./KnowledgeBasePage/utils/document-utils";
import { QuickSearchTrigger } from "./KnowledgeBasePage/components";
import { TreeMenu } from "./KnowledgeBasePage/components/TreeMenu";
import type {
  KnowledgeBasePageParams,
  KnowledgeBasePageProps,
  FolderOption,
  MoveNodeVariables,
  DeleteNodeVariables,
  CreateDocumentVariables,
  DocumentVectorizationProgressState,
  VectorCollectionsResponse,
} from "./KnowledgeBasePage/types";

export default function KnowledgeBasePage({ params }: KnowledgeBasePageProps = {}) {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const knowledgeBaseId = params?.knowledgeBaseId ?? null;
  const selectedNodeId = params?.nodeId ?? null;
  const [deleteTarget, setDeleteTarget] = useState<{
    type: "folder" | "document";
    id: string;
    title: string;
  } | null>(null);
  const [baseDeleteTarget, setBaseDeleteTarget] = useState<KnowledgeBaseSummary | null>(null);
  const [baseDeleteConfirmation, setBaseDeleteConfirmation] = useState<string>("");
  const [isResetIndexDialogOpen, setIsResetIndexDialogOpen] = useState(false);
  const [resetDeleteCollection, setResetDeleteCollection] = useState(true);
  const [resetReindex, setResetReindex] = useState(true);
  const [resetConfirmed, setResetConfirmed] = useState(false);
  const [movingNodeId, setMovingNodeId] = useState<string | null>(null);
  const [isCreateDocumentDialogOpen, setIsCreateDocumentDialogOpen] = useState(false);
  const [documentDialogParentId, setDocumentDialogParentId] = useState<string | null>(null);
  const [documentDialogParentTitle, setDocumentDialogParentTitle] = useState<string>("В корне базы");
  const [editingDocumentId, setEditingDocumentId] = useState<string | null>(null);
  const [documentDraftTitle, setDocumentDraftTitle] = useState<string>("");
  const [documentDraftContent, setDocumentDraftContent] = useState<string>("");
  const [documentActiveTab, setDocumentActiveTab] = useState<"content" | "chunks">("content");
  const [vectorizeDialogState, setVectorizeDialogState] = useState<{
    document: KnowledgeBaseDocumentDetail;
    base: KnowledgeBaseSummary | null;
    isOpen: boolean;
  } | null>(null);
  const [isQuickSwitcherOpen, setIsQuickSwitcherOpen] = useState(false);
  const [quickSearchQuery, setQuickSearchQuery] = useState("");
  const [documentVectorizationProgress, setDocumentVectorizationProgress] =
    useState<DocumentVectorizationProgressState | null>(null);
  const [shouldPollVectorizationJob, setShouldPollVectorizationJob] = useState(false);
  const [chunkDialogSignal, setChunkDialogSignal] = useState(0);
  const [, setLocalKnowledgeBases] = useState<LocalKnowledgeBase[]>(() => {
    if (typeof window === "undefined") {
      return [];
    }

    return readKnowledgeBaseStorage().knowledgeBases;
  });
  const handleDocumentTabChange = (value: string) => {
    if (value === "content" || value === "chunks") {
      setDocumentActiveTab(value);
    }
  };
  const [exportingFormat, setExportingFormat] = useState<"doc" | "pdf" | null>(null);
  const [isCreateBaseDialogOpen, setIsCreateBaseDialogOpen] = useState(false);
  const [createBaseMode, setCreateBaseMode] = useState<KnowledgeBaseSourceType>("blank");
  const [isJsonImportWizardOpen, setIsJsonImportWizardOpen] = useState(false);
  const [activeJsonImportJobId, setActiveJsonImportJobId] = useState<string | null>(null);
  const [isIndexingWizardOpen, setIsIndexingWizardOpen] = useState(false);
  const isDeleteDialogOpen = Boolean(deleteTarget);
  const [hierarchyDialogState, setHierarchyDialogState] = useState<{
    nodeId: string;
    nodeTitle: string;
    nodeType: "folder" | "document";
    currentParentId: string | null;
    structure: KnowledgeBaseTreeNode[];
  } | null>(null);
  const [hierarchySelectedParentId, setHierarchySelectedParentId] =
    useState<string>(ROOT_PARENT_VALUE);
  const [expandedNodeIds, setExpandedNodeIds] = useState<Set<string>>(() => new Set());
  const [searchSettings, setSearchSettings] = useState<KnowledgeBaseSearchSettings>(() =>
    createDefaultSearchSettings(),
  );
  const searchSettingsBaselineHashRef = useRef<string>(buildSearchSettingsHash(searchSettings));
  const searchSettingsBaselineRef = useRef<KnowledgeBaseSearchSettings>(
    cloneSearchSettings(searchSettings),
  );
  const [isSearchSettingsDirty, setIsSearchSettingsDirty] = useState(false);
  const [isSearchSettingsReady, setIsSearchSettingsReady] = useState(false);
  const [isSearchSettingsOpen, setIsSearchSettingsOpen] = useState(false);
  const [isAskAiJournalOpen, setIsAskAiJournalOpen] = useState(false);
  const [searchSettingsError, setSearchSettingsError] = useState<string | null>(null);
  const [searchSettingsUpdatedAt, setSearchSettingsUpdatedAt] = useState<string | null>(null);

  const commitSearchSettingsBaseline = useCallback((next: KnowledgeBaseSearchSettings) => {
    searchSettingsBaselineHashRef.current = buildSearchSettingsHash(next);
    searchSettingsBaselineRef.current = cloneSearchSettings(next);
    setIsSearchSettingsDirty(false);
  }, []);

  useEffect(() => {
    const hash = buildSearchSettingsHash(searchSettings);
    const dirty = hash !== searchSettingsBaselineHashRef.current;
    setIsSearchSettingsDirty((prev) => (prev === dirty ? prev : dirty));
  }, [searchSettings]);

  const {
    mutate: saveSearchSettings,
    reset: resetSearchSettingsMutation,
    isPending: isSavingSearchSettings,
  } = useMutation<
    KnowledgeBaseSearchSettingsResponsePayload,
    Error,
    { knowledgeBaseId: string; payload: KnowledgeBaseSearchSettingsUpdatePayload }
  >({
    mutationFn: async ({ knowledgeBaseId, payload }) => {
      const res = await apiRequest(
        "PUT",
        `/api/knowledge/bases/${knowledgeBaseId}/search/settings`,
        payload,
      );
      return (await res.json()) as KnowledgeBaseSearchSettingsResponsePayload;
    },
    onSuccess: (data, variables) => {
      queryClient.setQueryData(
        ["/api/knowledge/bases", variables.knowledgeBaseId, "search", "settings"],
        data,
      );
      const normalized = composeSearchSettingsFromApi(data);
      setSearchSettings(normalized);
      commitSearchSettingsBaseline(normalized);
      setSearchSettingsUpdatedAt(data.updatedAt ?? new Date().toISOString());
      setSearchSettingsError(null);
    },
    onError: (error) => {
      const message = error.message || "Не удалось сохранить настройки поиска";
      setSearchSettingsError(message);
      toast({
        variant: "destructive",
        title: "Не удалось сохранить настройки поиска",
        description: message,
      });
    },
  });

  useEffect(() => {
    resetSearchSettingsMutation();
    setSearchSettingsError(null);
  }, [resetSearchSettingsMutation, knowledgeBaseId]);
  const handleOpenCreateBase = (mode: KnowledgeBaseSourceType = "blank") => {
    setCreateBaseMode(mode);
    setIsCreateBaseDialogOpen(true);
  };
  const handleBaseCreated = (base: LocalKnowledgeBase) => {
    setIsCreateBaseDialogOpen(false);
    setLocation(`/knowledge/${base.id}`);
    setCreateBaseMode("blank");
  };
  const handleQuickSwitcherOpenState = useCallback(
    (open: boolean) => {
      setIsQuickSwitcherOpen(open);
    },
    [setIsQuickSwitcherOpen],
  );
  const handleQuickSwitcherClose = useCallback(() => {
    setIsQuickSwitcherOpen(false);
  }, [setIsQuickSwitcherOpen]);
  const handleTopKInputChange = (value: string) => {
    setSearchSettings((prev) => {
      if (value === "") {
        return { ...prev, topK: searchDefaults.topK.defaultValue };
      }

      const parsed = Number(value);
      if (Number.isNaN(parsed)) {
        return prev;
      }

      return { ...prev, topK: clampTopKValue(parsed) };
    });
  };
  const handleVectorLimitChange = (value: string) => {
    setSearchSettings((prev) => {
      if (value === "") {
        return { ...prev, vectorLimit: ragDefaults.vectorLimit.defaultValue };
      }

      const parsed = Number(value);
      if (Number.isNaN(parsed)) {
        return prev;
      }

      return { ...prev, vectorLimit: clampVectorLimitValue(parsed) };
    });
  };
  const handleBm25LimitChange = (value: string) => {
    setSearchSettings((prev) => {
      if (value === "") {
        return { ...prev, bm25Limit: null };
      }

      const parsed = Number(value);
      if (Number.isNaN(parsed)) {
        return prev;
      }

      return { ...prev, bm25Limit: clampVectorLimitValue(parsed) };
    });
  };
  const handleBm25WeightChange = (value: string) => {
    setSearchSettings((prev) => {
      if (value === "") {
        return { ...prev, bm25Weight: searchDefaults.bm25Weight.defaultValue };
      }

      const parsed = Number(value);
      if (Number.isNaN(parsed)) {
        return prev;
      }

      return { ...prev, bm25Weight: clampWeightValue(parsed) };
    });
  };
  const handleVectorWeightChange = (value: string) => {
    setSearchSettings((prev) => {
      if (value === "") {
        return { ...prev, vectorWeight: ragDefaults.vectorWeight.defaultValue };
      }

      const parsed = Number(value);
      if (Number.isNaN(parsed)) {
        return prev;
      }

      return { ...prev, vectorWeight: clampWeightValue(parsed) };
    });
  };
  const handleEmbeddingProviderChange = (value: string) => {
    setSearchSettings((prev) => ({
      ...prev,
      embeddingProviderId: value && value !== "none" ? value : null,
    }));
  };
  const handleLlmProviderChange = (value: string) => {
    setSearchSettings((prev) => {
      const nextProviderId = value && value !== "none" ? value : null;
      if (prev.llmProviderId === nextProviderId) {
        return prev;
      }

      return {
        ...prev,
        llmProviderId: nextProviderId,
        llmModel: null,
      };
    });
  };
  const handleLlmModelChange = (value: string) => {
    setSearchSettings((prev) => ({
      ...prev,
      llmModel: value && value.trim().length > 0 ? value.trim() : null,
    }));
  };
  const handleCollectionChange = (value: string) => {
    setSearchSettings((prev) => ({
      ...prev,
      collection: value && value.trim().length > 0 ? value.trim() : null,
    }));
  };
  const handleSynonymsChange = (synonyms: string[]) => {
    const limit = searchDefaults.synonyms.maxItems ?? synonyms.length;
    setSearchSettings((prev) => ({
      ...prev,
      synonyms: synonyms.slice(0, limit),
    }));
  };
  const handleIncludeDraftsChange = (checked: boolean) => {
    setSearchSettings((prev) => ({ ...prev, includeDrafts: checked }));
  };
  const handleHighlightResultsChange = (checked: boolean) => {
    setSearchSettings((prev) => ({ ...prev, highlightResults: checked }));
  };
  const handleFiltersChange = (value: string, isValid: boolean) => {
    setSearchSettings((prev) => ({ ...prev, filters: value, filtersValid: isValid }));
  };
  const handleTemperatureChange = (value: string) => {
    setSearchSettings((prev) => {
      if (value === "") {
        return { ...prev, temperature: null };
      }

      const parsed = Number(value);
      if (Number.isNaN(parsed)) {
        return prev;
      }

      return { ...prev, temperature: clampTemperatureValue(parsed) };
    });
  };
  const handleMaxTokensChange = (value: string) => {
    setSearchSettings((prev) => {
      if (value === "") {
        return { ...prev, maxTokens: null };
      }

      const parsed = Number(value);
      if (Number.isNaN(parsed)) {
        return prev;
      }

      return { ...prev, maxTokens: clampMaxTokensValue(parsed) };
    });
  };
  const handleSystemPromptChange = (value: string) => {
    setSearchSettings((prev) => ({ ...prev, systemPrompt: value }));
  };
  const handleResponseFormatChange = (value: string) => {
    setSearchSettings((prev) => ({
      ...prev,
      responseFormat: value && value.length > 0 ? (value as "text" | "markdown" | "html") : null,
    }));
  };

  const { data: session } = useQuery<SessionResponse>({
    queryKey: ["/api/auth/session"],
    staleTime: 0,
  });
  
  const workspaceId = session?.workspace?.active?.id ?? null;
  const workspaceRole = session?.workspace?.active?.role ?? null;

  const basesQuery = useQuery({
    queryKey: ["knowledge-bases", workspaceId],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/knowledge/bases");
      const data = await res.json();
      // Поддержка обоих форматов: массив или { bases: [...] }
      if (Array.isArray(data)) return data;
      if (data?.bases && Array.isArray(data.bases)) return data.bases;
      return [];
    },
    enabled: Boolean(workspaceId),
  });

  useEffect(() => {
    if (!basesQuery.data || !Array.isArray(basesQuery.data)) {
      return;
    }

    const updated = syncKnowledgeBaseStorageFromSummaries(basesQuery.data);
    setLocalKnowledgeBases(updated.knowledgeBases);
  }, [basesQuery.data]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const sync = () => {
      setLocalKnowledgeBases(readKnowledgeBaseStorage().knowledgeBases);
    };

    window.addEventListener(KNOWLEDGE_BASE_EVENT, sync);
    window.addEventListener("storage", sync);

    return () => {
      window.removeEventListener(KNOWLEDGE_BASE_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const bases = Array.isArray(basesQuery.data) ? basesQuery.data : [];
  const { data: embeddingServices } = useQuery<{ providers: PublicEmbeddingProvider[] }>({
    queryKey: ["/api/embedding/services"],
  });
  const activeEmbeddingProviders = useMemo(
    () => (embeddingServices?.providers ?? []).filter((provider) => provider.isActive),
    [embeddingServices?.providers],
  );
  const { data: llmProvidersResponse } = useQuery<{ providers: PublicLlmProvider[] }>({
    queryKey: ["/api/llm/providers"],
  });
  const activeLlmProviders = useMemo(
    () => (llmProvidersResponse?.providers ?? []).filter((provider) => provider.isActive),
    [llmProvidersResponse?.providers],
  );
  const canManageKnowledgeBase = workspaceRole === "owner" || workspaceRole === "manager";
  const { data: vectorCollectionsResponse, isLoading: isVectorCollectionsLoading } =
    useQuery<VectorCollectionsResponse>({
      queryKey: ["/api/vector/collections"],
      staleTime: 5 * 60 * 1000,
      enabled: Boolean(workspaceId),
    });
  const vectorCollections = vectorCollectionsResponse?.collections ?? [];
  const selectedBase = useMemo(
    () => bases.find((base) => base.id === knowledgeBaseId) ?? null,
    [bases, knowledgeBaseId],
  );
  const startIndexingMutation = useStartKnowledgeBaseIndexing();
  const resetIndexingMutation = useResetKnowledgeBaseIndexing();
  const indexingSummaryQuery = useKnowledgeBaseIndexingSummary(
    workspaceId,
    selectedBase?.id ?? null,
    { enabled: Boolean(workspaceId && selectedBase?.id) },
  );

  // Загрузка политики индексации базы знаний
  const { data: policyData } = useKnowledgeBaseIndexingPolicy(selectedBase?.id ?? null, workspaceId ?? "");

  // Загрузка глобальных правил индексации
  const { data: globalRules, isLoading: isGlobalRulesLoading } = useIndexingRules();

  // Преобразование в конфиг визарда
  const indexingPolicyConfig = useMemo(() => {
    if (policyData?.hasCustomPolicy && policyData.policy) {
      return convertPolicyToWizardConfig(policyData.policy);
    }
    return null;
  }, [policyData]);

  // Конфиг готов только когда globalRules загружены
  const globalIndexingConfig = useMemo(() => {
    if (!globalRules) {
      return null;
    }
    return convertRulesToWizardConfig(globalRules);
  }, [globalRules]);

  // Флаг готовности конфигурации индексации
  const isIndexingConfigReady = Boolean(globalIndexingConfig);
  const [isIndexingChangesOpen, setIsIndexingChangesOpen] = useState(false);
  const indexingChangesQuery = useKnowledgeBaseIndexingChanges(
    workspaceId,
    selectedBase?.id ?? null,
    {
      limit: 50,
      offset: 0,
      enabled: Boolean(workspaceId && selectedBase?.id && isIndexingChangesOpen),
    },
  );
  const [indexingActionId, setIndexingActionId] = useState<string | null>(null);
  const indexingStatusQuery = useKnowledgeBaseIndexingStatus(
    workspaceId,
    selectedBase?.id ?? null,
    indexingActionId,
    { enabled: Boolean(workspaceId && selectedBase?.id && indexingActionId) },
  );
  const { data: activeIndexingActions = [] } = useActiveIndexingActions(workspaceId);
  const activeIndexingActionForBase = selectedBase?.id
    ? activeIndexingActions.find((action) => action.baseId === selectedBase.id)
    : undefined;
  const searchSettingsQueryKey = useMemo(
    () =>
      selectedBase
        ? ["/api/knowledge/bases", selectedBase.id, "search", "settings"] as const
        : null,
    [selectedBase?.id],
  );
  const searchSettingsQuery = useQuery<KnowledgeBaseSearchSettingsResponsePayload>({
    queryKey: searchSettingsQueryKey ?? ["/api/knowledge/bases", "search", "settings"],
    enabled: Boolean(searchSettingsQueryKey),
  });
  const isSearchSettingsInitialLoading = Boolean(searchSettingsQueryKey) && searchSettingsQuery.isPending;
  const isSearchSettingsRefetching =
    Boolean(searchSettingsQueryKey) && searchSettingsQuery.isFetching && !searchSettingsQuery.isPending;
  const storageKey = useMemo(() => {
    if (!workspaceId || !selectedBase?.id) {
      return null;
    }

    return `${workspaceId}/${selectedBase.id}`;
  }, [workspaceId, selectedBase?.id]);
  useEffect(() => {
    setIsSearchSettingsOpen(false);
  }, [selectedBase?.id, storageKey]);

  useEffect(() => {
    setIsAskAiJournalOpen(false);
  }, [selectedBase?.id]);
  useEffect(() => {
    setIsIndexingChangesOpen(false);
  }, [selectedBase?.id]);
  useEffect(() => {
    if (!isQuickSwitcherOpen) {
      return;
    }

    setIsSearchSettingsOpen(false);
  }, [isQuickSwitcherOpen]);
  const normalizedTopK = useMemo(() => clampTopKValue(searchSettings.topK), [searchSettings.topK]);
  const normalizedVectorLimit = useMemo(
    () => clampVectorLimitValue(searchSettings.vectorLimit),
    [searchSettings.vectorLimit],
  );
  const normalizedBm25Limit = useMemo(
    () => clampVectorLimitValue(searchSettings.bm25Limit),
    [searchSettings.bm25Limit],
  );
  const normalizedBm25Weight = useMemo(
    () => clampWeightValue(searchSettings.bm25Weight),
    [searchSettings.bm25Weight],
  );
  const normalizedVectorWeight = useMemo(
    () => clampWeightValue(searchSettings.vectorWeight),
    [searchSettings.vectorWeight],
  );
  const normalizedTemperature = useMemo(
    () => clampTemperatureValue(searchSettings.temperature),
    [searchSettings.temperature],
  );
  const normalizedMaxTokens = useMemo(
    () => clampMaxTokensValue(searchSettings.maxTokens),
    [searchSettings.maxTokens],
  );
  const suggestLimit = normalizedTopK ?? 8;
  const { 
    data: suggestData,
    error: suggestError,
    status: suggestStatus,
    search: runSuggestSearch,
    prefetch: prefetchSuggest,
    reset: resetSuggest,
  } = useSuggestSearch({
    knowledgeBaseId: selectedBase?.id ?? "",
    limit: suggestLimit,
  });
  const askOptions = useMemo<UseKnowledgeBaseAskAiOptions | null>(() => {
    if (!selectedBase) {
      return null;
    }

    const bm25Options =
      normalizedBm25Weight !== null || normalizedBm25Limit !== null
        ? {
            weight: normalizedBm25Weight,
            limit: normalizedBm25Limit,
          }
        : null;

    const vectorOptions =
      normalizedVectorWeight !== null ||
      normalizedVectorLimit !== null ||
      Boolean(searchSettings.collection) ||
      Boolean(searchSettings.embeddingProviderId)
        ? {
            weight: normalizedVectorWeight,
            limit: normalizedVectorLimit,
            collection: searchSettings.collection ?? null,
            embeddingProviderId: searchSettings.embeddingProviderId ?? null,
          }
        : null;

    const systemPrompt = searchSettings.systemPrompt?.trim() ?? "";

    return {
      knowledgeBaseId: selectedBase.id,
      workspaceId,
      collection: searchSettings.collection ?? null,
      embeddingProviderId: searchSettings.embeddingProviderId ?? null,
      hybrid: {
        topK: normalizedTopK,
        bm25: bm25Options,
        vector: vectorOptions,
      },
      llm: {
        providerId: searchSettings.llmProviderId ?? null,
        model: searchSettings.llmModel ?? null,
        temperature: normalizedTemperature,
        maxTokens: normalizedMaxTokens,
        systemPrompt: systemPrompt.length > 0 ? systemPrompt : null,
        responseFormat: searchSettings.responseFormat ?? null,
      },
    } satisfies UseKnowledgeBaseAskAiOptions;
  }, [
    normalizedBm25Limit,
    normalizedBm25Weight,
    normalizedTopK,
    normalizedVectorLimit,
    normalizedVectorWeight,
    normalizedMaxTokens,
    normalizedTemperature,
    searchSettings.collection,
    searchSettings.embeddingProviderId,
    searchSettings.llmProviderId,
    searchSettings.llmModel,
    searchSettings.responseFormat,
    searchSettings.systemPrompt,
    selectedBase,
    workspaceId,
  ]);
  const handleQuickSearchQueryChange = useCallback(
    (value: string) => {
      setQuickSearchQuery(value);
      runSuggestSearch(value);
    },
    [runSuggestSearch],
  );
  const handleQuickSearchPrefetch = useCallback(
    (value: string) => {
      prefetchSuggest(value);
    },
    [prefetchSuggest],
  );

  const searchSettingsStatus = useMemo(() => {
    if (isSearchSettingsInitialLoading) {
      return (
        <>
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Загрузка настроек…
        </>
      );
    }

    if (isSearchSettingsRefetching) {
      return (
        <>
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Обновление…
        </>
      );
    }

    if (isSavingSearchSettings) {
      return (
        <>
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Сохранение…
        </>
      );
    }

    if (searchSettingsError) {
      return <>Ошибка синхронизации</>;
    }

    if (isSearchSettingsDirty) {
      return <>Изменения не сохранены</>;
    }

    if (searchSettingsUpdatedAt) {
      return <>Сохранено {formatDateTime(searchSettingsUpdatedAt)}</>;
    }

    return <>Локальные настройки</>;
  }, [
    isSearchSettingsInitialLoading,
    isSearchSettingsRefetching,
    isSavingSearchSettings,
    searchSettingsError,
    isSearchSettingsDirty,
    searchSettingsUpdatedAt,
  ]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    if (!storageKey) {
      setIsSearchSettingsReady(false);
      const defaults = createDefaultSearchSettings();
      setSearchSettings(defaults);
      commitSearchSettingsBaseline(defaults);
      setSearchSettingsUpdatedAt(null);
      setSearchSettingsError(null);
      return;
    }

    setSearchSettingsUpdatedAt(null);
    setIsSearchSettingsReady(false);

    try {
      const raw = window.localStorage.getItem(storageKey);
      if (!raw) {
        const defaults = createDefaultSearchSettings();
        setSearchSettings(defaults);
        commitSearchSettingsBaseline(defaults);
        setSearchSettingsError(null);
        return;
      }

      const parsed = JSON.parse(raw) as unknown;
      const normalized = parseStoredSearchSettings(parsed);
      setSearchSettings(normalized);
      commitSearchSettingsBaseline(normalized);
      setSearchSettingsError(null);
    } catch (error) {
      console.error("Не удалось прочитать параметры поиска из localStorage", error);
      const defaults = createDefaultSearchSettings();
      setSearchSettings(defaults);
      commitSearchSettingsBaseline(defaults);
    } finally {
      setIsSearchSettingsReady(true);
    }
  }, [storageKey, commitSearchSettingsBaseline]);

  useEffect(() => {
    if (!storageKey || typeof window === "undefined") {
      return;
    }

    const handleStorage = (event: StorageEvent) => {
      if (event.key !== storageKey) {
        return;
      }

      if (!event.newValue) {
        const defaults = createDefaultSearchSettings();
        setSearchSettings(defaults);
        commitSearchSettingsBaseline(defaults);
        return;
      }

      try {
        const parsed = JSON.parse(event.newValue) as unknown;
        const normalized = parseStoredSearchSettings(parsed);
        setSearchSettings(normalized);
        commitSearchSettingsBaseline(normalized);
        setSearchSettingsError(null);
      } catch (error) {
        console.error("Не удалось синхронизировать параметры поиска", error);
      }
    };

    window.addEventListener("storage", handleStorage);

    return () => {
      window.removeEventListener("storage", handleStorage);
    };
  }, [storageKey, commitSearchSettingsBaseline]);

  useEffect(() => {
    if (!searchSettingsQueryKey) {
      return;
    }

    if (searchSettingsQuery.isPending) {
      return;
    }

    if (searchSettingsQuery.isError) {
      const message =
        (searchSettingsQuery.error as Error | undefined)?.message ||
        "Не удалось получить настройки поиска";
      setSearchSettingsError(message);
      setSearchSettingsUpdatedAt(null);
      setIsSearchSettingsReady(true);
      return;
    }

    if (searchSettingsQuery.data) {
      const next = composeSearchSettingsFromApi(searchSettingsQuery.data);
      setSearchSettings(next);
      commitSearchSettingsBaseline(next);
      setSearchSettingsUpdatedAt(searchSettingsQuery.data.updatedAt ?? null);
      setSearchSettingsError(null);
      setIsSearchSettingsReady(true);
    }
  }, [
    searchSettingsQueryKey,
    searchSettingsQuery.data,
    searchSettingsQuery.isError,
    searchSettingsQuery.error,
    searchSettingsQuery.isPending,
    commitSearchSettingsBaseline,
  ]);

  useEffect(() => {
    if (!storageKey || !isSearchSettingsReady || typeof window === "undefined") {
      return;
    }

    try {
      window.localStorage.setItem(storageKey, JSON.stringify(searchSettings));
    } catch (error) {
      console.error("Не удалось сохранить параметры поиска", error);
    }
  }, [searchSettings, storageKey, isSearchSettingsReady]);

  const handleSaveSearchSettings = useCallback(() => {
    if (
      !selectedBase?.id ||
      !isSearchSettingsReady ||
      !isSearchSettingsDirty ||
      isSavingSearchSettings
    ) {
      return;
    }

    const payload = buildSearchSettingsUpdatePayload(searchSettings);
    saveSearchSettings({ knowledgeBaseId: selectedBase.id, payload });
  }, [
    isSearchSettingsReady,
    isSavingSearchSettings,
    isSearchSettingsDirty,
    saveSearchSettings,
    searchSettings,
    selectedBase?.id,
  ]);

  const handleResetSearchSettingsChanges = useCallback(() => {
    setSearchSettings(cloneSearchSettings(searchSettingsBaselineRef.current));
    setSearchSettingsError(null);
  }, []);
  const [latestCrawlJob, setLatestCrawlJob] = useState<KnowledgeBaseCrawlJobStatus | null>(null);
  const crawlJobPreviousRef = useRef<KnowledgeBaseCrawlJobStatus | null>(null);
  const handleCrawlStateChange = useCallback((state: CrawlInlineState) => {
    if (state.running && state.job) {
      setLatestCrawlJob(state.job);
      return;
    }

    if (!state.running) {
      setLatestCrawlJob(state.lastRun ?? null);
    }
  }, []);
  const [isRetryingCrawl, setIsRetryingCrawl] = useState(false);

  useEffect(() => {
    const job = latestCrawlJob;
    if (!job || selectedBase?.id !== job.baseId) {
      crawlJobPreviousRef.current = job ?? null;
      return;
    }

    const previous = crawlJobPreviousRef.current;
    const isSameJob = previous?.jobId === job.jobId;
    if (!previous || !isSameJob || previous.status !== job.status) {
      if (job.status === "done") {
        toast({
          title: "Краулинг завершён",
          description: `Добавлено ${job.saved.toLocaleString("ru-RU")} документов`,
          action: (
            <ToastAction
              altText="Открыть библиотеку"
              onClick={() => setLocation(`/knowledge/${job.baseId}`)}
            >
              Открыть библиотеку
            </ToastAction>
          ),
        });
      } else if (job.status === "failed") {
        toast({
          variant: "destructive",
          title: "Краулинг завершился с ошибкой",
          description: job.lastError ?? "Попробуйте изменить настройки и перезапустить краулинг.",
        });
      } else if (job.status === "canceled") {
        toast({
          title: "Краулинг остановлен",
          description: "Задача была отменена.",
        });
      }
    }

    crawlJobPreviousRef.current = job;
  }, [latestCrawlJob, selectedBase?.id, setLocation, toast]);

  useEffect(() => {
    setExpandedNodeIds(new Set());
  }, [selectedBase?.id]);

  useEffect(() => {
    if (!selectedBase?.id) {
      setIsQuickSwitcherOpen(false);
      setQuickSearchQuery("");
      resetSuggest();
      return;
    }

    setIsQuickSwitcherOpen(false);
    setQuickSearchQuery("");
    resetSuggest();
  }, [selectedBase?.id, resetSuggest]);

  useEffect(() => {
    if (!bases.length) {
      return;
    }

    if (knowledgeBaseId) {
      const exists = bases.some((base) => base.id === knowledgeBaseId);
      if (!exists) {
        setLocation(`/knowledge/${bases[0]?.id}`);
      }
      return;
    }

    setLocation(`/knowledge/${bases[0]?.id}`);
  }, [bases, knowledgeBaseId, setLocation]);

  useEffect(() => {
    if (!selectedBase || !selectedNodeId) {
      return;
    }

    if (!hasNode(selectedBase.rootNodes, selectedNodeId)) {
      setLocation(`/knowledge/${selectedBase.id}`);
    }
  }, [selectedBase, selectedNodeId, setLocation]);

  useEffect(() => {
    if (!vectorizeDialogState) {
      return;
    }

    if (!selectedNodeId || vectorizeDialogState.document.id !== selectedNodeId) {
      setVectorizeDialogState(null);
    }
  }, [selectedNodeId, vectorizeDialogState]);

  useEffect(() => {
    if (!vectorizeDialogState) {
      return;
    }

    if (selectedBase?.id !== vectorizeDialogState.base?.id) {
      setVectorizeDialogState(null);
    }
  }, [selectedBase?.id, vectorizeDialogState]);

  useEffect(() => {
    if (!selectedBase || !selectedNodeId) {
      return;
    }

    const parentMap = buildParentMap(selectedBase.rootNodes);
    if (!parentMap.has(selectedNodeId)) {
      return;
    }

    setExpandedNodeIds((prev) => {
      const next = new Set(prev);
      let current = parentMap.get(selectedNodeId) ?? null;
      let changed = false;

      while (current) {
        if (!next.has(current)) {
          next.add(current);
          changed = true;
        }

        current = parentMap.get(current) ?? null;
      }

      if (!changed) {
        return prev;
      }

      return next;
    });
  }, [selectedBase, selectedNodeId]);

  const nodeKey = selectedNodeId ?? "root";

  const nodeDetailQuery = useQuery({
    queryKey: ["knowledge-node", selectedBase?.id, nodeKey],
    enabled: Boolean(selectedBase?.id),
    queryFn: async () => {
      const baseId = selectedBase?.id;
      if (!baseId) {
        throw new Error("База знаний не выбрана");
      }
      const res = await apiRequest("GET", `/api/knowledge/bases/${baseId}/nodes/${nodeKey}`, undefined, undefined, workspaceId ? { workspaceId } : undefined);
      const data = (await res.json()) as { node: KnowledgeBaseNodeDetail };
      return data.node;
    },
  });

  const handleCrawlDocumentsSaved = useCallback(
    (delta: number, job: KnowledgeBaseCrawlJobStatus) => {
      if (delta <= 0) {
        return;
      }

      void basesQuery.refetch();
      if (selectedBase?.id === job.baseId) {
        void nodeDetailQuery.refetch();
      }
    },
    [basesQuery, nodeDetailQuery, selectedBase?.id],
  );

  const retryCrawl = useCallback(async () => {
    const job = latestCrawlJob;
    if (!job || job.baseId !== selectedBase?.id) {
      return;
    }

    setIsRetryingCrawl(true);
    try {
      const response = await apiRequest(
        "POST",
        `/api/jobs/${encodeURIComponent(job.jobId)}/retry`,
      );
      const payload = (await response.json()) as { job: KnowledgeBaseCrawlJobStatus };
      handleCrawlStateChange({ running: true, job: payload.job });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Не удалось перезапустить краулинг",
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setIsRetryingCrawl(false);
    }
  }, [handleCrawlStateChange, latestCrawlJob, selectedBase?.id, toast]);

  const crawlJobForSelectedBase =
    latestCrawlJob && selectedBase?.id === latestCrawlJob.baseId ? latestCrawlJob : null;
  const isCrawlJobTerminalForSelectedBase = crawlJobForSelectedBase
    ? TERMINAL_CRAWL_STATUSES.includes(crawlJobForSelectedBase.status)
    : false;

  const documentDetail =
    nodeDetailQuery.data?.type === "document" ? nodeDetailQuery.data : null;
  const vectorizationJobId = documentVectorizationProgress?.jobId ?? null;
  const vectorizationJobQuery = useQuery<{ job: KnowledgeDocumentVectorizationJobStatus }>({
    queryKey: ["knowledge-document-vectorize-job", vectorizationJobId ?? ""],
    enabled: Boolean(vectorizationJobId),
    refetchInterval: shouldPollVectorizationJob ? 1500 : false,
    queryFn: async () => {
      if (!vectorizationJobId) {
        throw new Error("Нет идентификатора задачи");
      }

      const response = await apiRequest(
        "GET",
        `/api/knowledge/documents/vectorize/jobs/${encodeURIComponent(vectorizationJobId)}`,
      );
      return (await response.json()) as { job: KnowledgeDocumentVectorizationJobStatus };
    },
  });
  const vectorizationSuccessToastRef = useRef<string | null>(null);
  const vectorizationFailureToastRef = useRef<string | null>(null);
  useEffect(() => {
    vectorizationSuccessToastRef.current = null;
    vectorizationFailureToastRef.current = null;
  }, [documentVectorizationProgress?.jobId]);

  useEffect(() => {
    if (!documentDetail) {
      setEditingDocumentId(null);
      setDocumentDraftTitle("");
      setDocumentDraftContent("");
      return;
    }

    if (editingDocumentId && editingDocumentId !== documentDetail.id) {
      setEditingDocumentId(null);
    }

    if (editingDocumentId !== documentDetail.id) {
      setDocumentDraftTitle(documentDetail.title);
      setDocumentDraftContent(getSanitizedContent(documentDetail.content ?? ""));
    }
  }, [documentDetail?.id, documentDetail?.title, documentDetail?.content, editingDocumentId]);

  useEffect(() => {
    setDocumentActiveTab("content");
  }, [documentDetail?.id]);

  useEffect(() => {
    if (!documentVectorizationProgress?.jobId) {
      setShouldPollVectorizationJob(false);
      return;
    }

    const job = vectorizationJobQuery.data?.job;
    if (!job) {
      return;
    }

    setDocumentVectorizationProgress((current) => {
      if (!current || current.jobId !== job.id) {
        return current;
      }

      return {
        ...current,
        totalChunks: job.totalChunks,
        processedChunks: job.processedChunks,
        status: job.status,
        errorMessage: job.error ?? null,
      };
    });

    if (job.status === "completed" || job.status === "failed") {
      setShouldPollVectorizationJob(false);
    }
  }, [documentVectorizationProgress?.jobId, vectorizationJobQuery.data]);

  useEffect(() => {
    if (!documentVectorizationProgress?.jobId && documentVectorizationProgress) {
      setShouldPollVectorizationJob(false);
    }
  }, [documentVectorizationProgress]);

  useEffect(() => {
    if (!documentVectorizationProgress?.jobId) {
      return;
    }

    if (!vectorizationJobQuery.isError) {
      return;
    }

    setShouldPollVectorizationJob(false);
    setDocumentVectorizationProgress((current) => {
      if (!current || current.jobId !== documentVectorizationProgress.jobId) {
        return current;
      }

      return {
        ...current,
        status: "failed",
        errorMessage: "Не удалось обновить прогресс векторизации",
      };
    });
  }, [
    documentVectorizationProgress?.jobId,
    setDocumentVectorizationProgress,
    setShouldPollVectorizationJob,
    vectorizationJobQuery.isError,
  ]);

  useEffect(() => {
    if (!documentVectorizationProgress?.jobId) {
      return;
    }

    const job = vectorizationJobQuery.data?.job;
    if (!job || job.id !== documentVectorizationProgress.jobId) {
      return;
    }

      if (job.status === "completed" && job.result) {
        setVectorizeDialogState(null);
      setDocumentVectorizationProgress((current) => {
        if (!current || current.jobId !== job.id) {
          return current;
        }

        if (current.status === "completed") {
          return current;
        }

        const processed = job.result?.pointsCount ?? job.processedChunks ?? 0;
        return {
          ...current,
          status: "completed",
          processedChunks: processed,
          totalChunks: Math.max(current.totalChunks, processed),
          errorMessage: null,
        };
      });
      setShouldPollVectorizationJob(false);

        if (vectorizationSuccessToastRef.current !== job.id) {
          const processed = job.result?.pointsCount ?? job.processedChunks ?? 0;
          const collectionName = job.result?.collectionName ?? "коллекцию";
          const completionDescription =
            processed > 0
              ? `Добавлено ${processed.toLocaleString("ru-RU")} записей в коллекцию ${collectionName}.`
              : "Векторизация завершена.";
          toast({
            title: "Векторизация завершена",
            description: completionDescription,
          });
          vectorizationSuccessToastRef.current = job.id;
        }

        void nodeDetailQuery.refetch();
        return;
    }

      if (job.status === "failed" && job.error) {
        setShouldPollVectorizationJob(false);
      setDocumentVectorizationProgress((current) => {
        if (!current || current.jobId !== job.id) {
          return current;
        }

        if (current.status === "failed") {
          return current;
        }

        return {
          ...current,
          status: "failed",
          errorMessage: job.error ?? "Не удалось завершить векторизацию",
        };
      });

        if (vectorizationFailureToastRef.current !== job.id) {
          toast({
            title: "Не удалось завершить векторизацию",
            description: job.error ?? "Не удалось завершить векторизацию",
            variant: "destructive",
          });
          vectorizationFailureToastRef.current = job.id;
        }
      }
  }, [
    documentVectorizationProgress?.jobId,
    nodeDetailQuery,
    setDocumentVectorizationProgress,
    setShouldPollVectorizationJob,
    toast,
    vectorizationJobQuery.data?.job,
  ]);

  const sanitizedDocumentContent = useMemo(
    () => (documentDetail ? getSanitizedContent(documentDetail.content ?? "") : ""),
    [documentDetail?.content],
  );

  const hierarchyDialogOptions = useMemo(() => {
    if (!hierarchyDialogState) {
      return { allOptions: [] as FolderOption[], availableOptions: [] as FolderOption[] };
    }

    const { structure, nodeId, nodeType } = hierarchyDialogState;
    const allOptions = collectFolderOptions(structure);
    const descendantMap = buildDescendantMap(structure);
    const excluded = new Set<string>([nodeId]);
    const descendants = descendantMap.get(nodeId);

    if (descendants) {
      for (const value of descendants) {
        excluded.add(value);
      }
    }

    const availableOptions = allOptions.filter((option) => {
      if (excluded.has(option.id)) {
        return false;
      }

      if (nodeType === "folder" && option.type !== "folder") {
        return false;
      }

      return true;
    });

    return { allOptions, availableOptions };
  }, [hierarchyDialogState]);

  const hierarchyCurrentParentLabel = useMemo(() => {
    if (!hierarchyDialogState) {
      return "В корне базы";
    }

    if (!hierarchyDialogState.currentParentId) {
      return "В корне базы";
    }

    const parent = hierarchyDialogOptions.allOptions.find(
      (option) => option.id === hierarchyDialogState.currentParentId,
    );

    return parent?.title ?? "В корне базы";
  }, [hierarchyDialogOptions.allOptions, hierarchyDialogState]);

  const exportingDoc = exportingFormat === "doc";
  const exportingPdf = exportingFormat === "pdf";

  const moveNodeMutation = useMutation<unknown, Error, MoveNodeVariables>({
    mutationFn: async ({ baseId, nodeId, parentId }) => {
      const res = await apiRequest("PATCH", `/api/knowledge/bases/${baseId}/nodes/${nodeId}` , {
        parentId,
      });
      await res.json();
    },
    onSuccess: (_, variables) => {
      toast({ title: "Структура обновлена" });
      queryClient.invalidateQueries({ queryKey: ["knowledge-bases"] });
      queryClient.invalidateQueries({
        predicate: (query) => {
          const [key, baseId] = query.queryKey as [unknown, unknown];
          return key === "knowledge-node" && baseId === variables.baseId;
        },
      });
    },
    onError: (error) => {
      toast({
        title: "Не удалось изменить структуру",
        description: error.message,
        variant: "destructive",
      });
    },
    onSettled: () => {
      setMovingNodeId(null);
    },
  });

  const deleteBaseMutation = useMutation<
    DeleteKnowledgeBaseResponse,
    Error,
    { baseId: string; confirmation: string }
  >({
    mutationFn: async ({ baseId, confirmation }) => {
      const res = await apiRequest("DELETE", `/api/knowledge/bases/${baseId}`, {
        confirmation,
      });
      // 204 No Content не имеет тела, возвращаем объект с baseId
      if (res.status === 204) {
        return { deletedId: baseId } as DeleteKnowledgeBaseResponse;
      }
      return (await res.json()) as DeleteKnowledgeBaseResponse;
    },
    onSuccess: (_, variables) => {
      toast({
        title: "База знаний удалена",
        description: "База и связанные документы удалены без возможности восстановления.",
      });
      setBaseDeleteTarget(null);
      setBaseDeleteConfirmation("");
      queryClient.invalidateQueries({ queryKey: ["knowledge-bases"] });
      queryClient.removeQueries({
        predicate: (query) => {
          const [key, baseId] = query.queryKey as [unknown, unknown?, ...unknown[]];
          return key === "knowledge-node" && baseId === variables.baseId;
        },
      });
      if (knowledgeBaseId === variables.baseId) {
        setLocation("/knowledge");
      }
    },
    onError: (error) => {
      toast({
        title: "Не удалось удалить базу знаний",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const deleteNodeMutation = useMutation<DeleteKnowledgeNodeResponse, Error, DeleteNodeVariables>({
    mutationFn: async ({ baseId, nodeId }) => {
      const res = await apiRequest("DELETE", `/api/knowledge/bases/${baseId}/nodes/${nodeId}`);
      return (await res.json()) as DeleteKnowledgeNodeResponse;
    },
    onSuccess: (_, variables) => {
      const label = deleteTarget?.type === "document" ? "Документ" : "Подраздел";
      toast({ title: `${label ?? "Элемент"} удалён` });
      setDeleteTarget(null);
      queryClient.invalidateQueries({ queryKey: ["knowledge-bases"] });
      queryClient.invalidateQueries({
        predicate: (query) => {
          const [key, baseId] = query.queryKey as [unknown, unknown, unknown];
          return key === "knowledge-node" && baseId === variables.baseId;
        },
      });
      setLocation(`/knowledge/${variables.baseId}`);
    },
    onError: (error) => {
      setDeleteTarget(null);
      toast({
        title:
          deleteTarget?.type === "document"
            ? "Не удалось удалить документ"
            : "Не удалось удалить подраздел",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const createDocumentMutation = useMutation<
    CreateKnowledgeDocumentResponse,
    Error,
    CreateDocumentVariables
  >({
    mutationFn: async ({ baseId, ...payload }) => {
      const res = await apiRequest("POST", `/api/knowledge/bases/${baseId}/documents`, {
        title: payload.title,
        content: payload.content,
        parentId: payload.parentId,
        sourceType: payload.sourceType,
        importFileName: payload.importFileName,
      });
      return (await res.json()) as CreateKnowledgeDocumentResponse;
    },
    onSuccess: (document, variables) => {
      toast({ title: "Документ создан", description: "Документ успешно добавлен в базу знаний." });
      setIsCreateDocumentDialogOpen(false);
      queryClient.invalidateQueries({ queryKey: ["knowledge-bases"] });
      queryClient.invalidateQueries({
        queryKey: ["/api/knowledge/bases", variables.baseId, "indexing", "summary"],
      });
      queryClient.invalidateQueries({
        queryKey: ["/api/knowledge/bases", variables.baseId, "indexing", "changes"],
      });
      queryClient.invalidateQueries({
        predicate: (query) => {
          const [key, baseId] = query.queryKey as [unknown, unknown, ...unknown[]];
          return key === "knowledge-node" && baseId === variables.baseId;
        },
      });
      setLocation(`/knowledge/${variables.baseId}/node/${document.id}`);
    },
    onError: (error) => {
      toast({
        title: "Не удалось создать документ",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const crawlDocumentMutation = useMutation<
    CreateCrawledKnowledgeDocumentResponse,
    Error,
    { baseId: string; parentId: string | null; url: string }
  >({
    mutationFn: async ({ baseId, parentId, url }) => {
      const res = await apiRequest("POST", `/api/knowledge/bases/${baseId}/documents/crawl`, {
        url,
        parentId,
      });
      return (await res.json()) as CreateCrawledKnowledgeDocumentResponse;
    },
    onSuccess: (result, variables) => {
      const document = result.document;
      const title =
        result.status === "updated"
          ? "Документ обновлён"
          : result.status === "skipped"
            ? "Документ уже актуален"
            : "Документ создан";
      const description =
        result.status === "created"
          ? "Страница успешно импортирована в базу знаний."
          : result.status === "updated"
            ? "Содержимое страницы обновлено."
            : "Изменений не обнаружено, документ остался без изменений.";

      toast({ title, description });
      setIsCreateDocumentDialogOpen(false);
      queryClient.invalidateQueries({ queryKey: ["knowledge-bases"] });
      queryClient.invalidateQueries({
        queryKey: ["/api/knowledge/bases", variables.baseId, "indexing", "summary"],
      });
      queryClient.invalidateQueries({
        queryKey: ["/api/knowledge/bases", variables.baseId, "indexing", "changes"],
      });
      queryClient.invalidateQueries({
        predicate: (query) => {
          const [key, baseId] = query.queryKey as [unknown, unknown, ...unknown[]];
          return key === "knowledge-node" && baseId === variables.baseId;
        },
      });
      setLocation(`/knowledge/${variables.baseId}/node/${document.id}`);
    },
    onError: (error) => {
      toast({
        title: "Не удалось импортировать страницу",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const updateDocumentMutation = useMutation<
    KnowledgeBaseDocumentDetail,
    Error,
    { baseId: string; nodeId: string; title: string; content: string }
  >({
    mutationFn: async ({ baseId, nodeId, title, content }) => {
      const res = await apiRequest("PATCH", `/api/knowledge/bases/${baseId}/documents/${nodeId}`, {
        title,
        content,
      });
      return (await res.json()) as KnowledgeBaseDocumentDetail;
    },
    onSuccess: (document, variables) => {
      toast({ title: "Документ сохранён", description: "Изменения успешно сохранены." });
      setEditingDocumentId(null);
      setDocumentDraftTitle(document.title);
      setDocumentDraftContent(getSanitizedContent(document.content ?? ""));
      queryClient.setQueryData(
        ["knowledge-node", variables.baseId, variables.nodeId],
        document,
      );
      queryClient.invalidateQueries({ queryKey: ["knowledge-bases"] });
      queryClient.invalidateQueries({
        queryKey: ["/api/knowledge/bases", variables.baseId, "indexing", "summary"],
      });
      queryClient.invalidateQueries({
        queryKey: ["/api/knowledge/bases", variables.baseId, "indexing", "changes"],
      });
    },
    onError: (error) => {
      toast({
        title: "Не удалось сохранить документ",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleOpenCreateDocument = (parentId: string | null, parentTitle: string) => {
    if (!selectedBase) {
      toast({
        title: "База знаний не выбрана",
        description: "Выберите базу, чтобы добавить документ.",
        variant: "destructive",
      });
      return;
    }
    setDocumentDialogParentId(parentId);
    setDocumentDialogParentTitle(parentTitle);
    setIsCreateDocumentDialogOpen(true);
  };

  const closeHierarchyDialog = () => {
    setHierarchyDialogState(null);
    setHierarchySelectedParentId(ROOT_PARENT_VALUE);
  };

  const handleToggleNode = (nodeId: string) => {
    setExpandedNodeIds((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) {
        next.delete(nodeId);
      } else {
        next.add(nodeId);
      }
      return next;
    });
  };

  const handleOpenHierarchyDialog = (
    detail: Extract<KnowledgeBaseNodeDetail, { type: "folder" | "document" }>,
  ) => {
    const parentMap = buildParentMap(detail.structure);
    const currentParentId = parentMap.get(detail.id) ?? null;

    setHierarchyDialogState({
      nodeId: detail.id,
      nodeTitle: detail.title,
      nodeType: detail.type,
      currentParentId,
      structure: detail.structure,
    });
    setHierarchySelectedParentId(currentParentId ?? ROOT_PARENT_VALUE);
  };

  const handleStartEditingDocument = (detail: KnowledgeBaseDocumentDetail) => {
    setDocumentDraftTitle(detail.title);
    setDocumentDraftContent(getSanitizedContent(detail.content ?? ""));
    setEditingDocumentId(detail.id);
  };

  const handleCancelEditingDocument = (detail: KnowledgeBaseDocumentDetail) => {
    setEditingDocumentId(null);
    setDocumentDraftTitle(detail.title);
    setDocumentDraftContent(getSanitizedContent(detail.content ?? ""));
  };

  const handleSaveDocument = async (detail: KnowledgeBaseDocumentDetail) => {
    if (!selectedBase) {
      toast({
        title: "База знаний не выбрана",
        description: "Выберите базу, чтобы сохранить документ.",
        variant: "destructive",
      });
      return;
    }

    const trimmedTitle = documentDraftTitle.trim();
    if (!trimmedTitle) {
      toast({
        title: "Укажите название документа",
        description: "Название документа не может быть пустым.",
        variant: "destructive",
      });
      return;
    }

    const sanitizedContent = getSanitizedContent(documentDraftContent);
    await updateDocumentMutation.mutateAsync({
      baseId: selectedBase.id,
      nodeId: detail.id,
      title: trimmedTitle,
      content: sanitizedContent,
    });
  };

  const handleDownloadDoc = async (detail: KnowledgeBaseDocumentDetail) => {
    try {
      setExportingFormat("doc");
      const sanitizedHtml = getSanitizedContent(detail.content ?? "");
      const title = detail.title?.trim() ? detail.title.trim() : "Документ";
      const template = `<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8" /><title>${escapeHtml(title)}</title><style>body{font-family:'Geist',Arial,Helvetica,sans-serif;line-height:1.6;color:#111827;margin:1.5rem;}h1,h2,h3{color:#0f172a;}ul,ol{margin-left:1.5rem;}blockquote{border-left:4px solid #e2e8f0;padding-left:1rem;color:#475569;}</style></head><body>${sanitizedHtml || "<p></p>"}</body></html>`;
      const blob = new Blob([template], {
        type: "application/msword;charset=utf-8",
      });
      const url = window.URL.createObjectURL(blob);
      const link = window.document.createElement("a");
      link.href = url;
      link.download = buildDocumentFileName(title, "doc");
      window.document.body.appendChild(link);
      link.click();
      window.document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
      toast({ title: "Документ выгружен", description: "Файл .doc успешно скачан." });
    } catch (error) {
      toast({
        title: "Не удалось сохранить .doc",
        description:
          error instanceof Error
            ? error.message
            : "Попробуйте выполнить выгрузку чуть позже.",
        variant: "destructive",
      });
    } finally {
      setExportingFormat(null);
    }
  };

  const handleDownloadPdf = async (detail: KnowledgeBaseDocumentDetail) => {
    try {
      setExportingFormat("pdf");
      const sanitizedHtml = getSanitizedContent(detail.content ?? "");
      const blocks = extractDocumentBlocks(sanitizedHtml);
      const title = detail.title?.trim() ? detail.title.trim() : "Документ";
      const { jsPDF } = await import("jspdf");
      const { notoSansRegularBase64, notoSansBoldBase64 } = await import("../pdfFonts/notoSans");

      const doc = new jsPDF({ unit: "pt", format: "a4" });
      doc.addFileToVFS("NotoSans-Regular.ttf", notoSansRegularBase64);
      doc.addFont("NotoSans-Regular.ttf", "NotoSans", "normal");
      doc.addFileToVFS("NotoSans-Bold.ttf", notoSansBoldBase64);
      doc.addFont("NotoSans-Bold.ttf", "NotoSans", "bold");
      doc.setFont("NotoSans", "normal");
      doc.setFontSize(12);

      const margin = 48;
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      let cursor = margin;

      const ensureSpace = (lineHeight: number) => {
        if (cursor + lineHeight > pageHeight - margin) {
          doc.addPage();
          doc.setFont("NotoSans", "normal");
          cursor = margin;
        }
      };

      const addParagraph = (
        text: string,
        options?: { fontSize?: number; bold?: boolean; spacingAfter?: number },
      ) => {
        const fontSize = options?.fontSize ?? 12;
        const bold = options?.bold ?? false;
        const spacingAfter = options?.spacingAfter ?? fontSize * 0.6;

        if (!text) {
          cursor += spacingAfter;
          return;
        }

        doc.setFont("NotoSans", bold ? "bold" : "normal");
        doc.setFontSize(fontSize);
        const lines = doc.splitTextToSize(text, pageWidth - margin * 2);
        const lineHeight = fontSize * 1.4;

        lines.forEach((line: string) => {
          ensureSpace(lineHeight);
          doc.text(line, margin, cursor);
          cursor += lineHeight;
        });

        cursor += spacingAfter;
      };

      const addList = (items: string[], ordered: boolean) => {
        if (!items.length) {
          return;
        }

        const fontSize = 12;
        const lineHeight = fontSize * 1.4;
        doc.setFont("NotoSans", "normal");
        doc.setFontSize(fontSize);

        items.forEach((item, index) => {
          const bullet = ordered ? `${index + 1}.` : "•";
          const lines = doc.splitTextToSize(item, pageWidth - margin * 2 - 18);

          lines.forEach((line: string, lineIndex: number) => {
            ensureSpace(lineHeight);
            const prefix = lineIndex === 0 ? `${bullet} ` : "   ";
            doc.text(`${prefix}${line}`, margin, cursor);
            cursor += lineHeight;
          });

          cursor += fontSize * 0.4;
        });

        cursor += fontSize * 0.6;
      };

      addParagraph(title, { fontSize: 20, bold: true, spacingAfter: 18 });

      if (detail.updatedAt) {
        const updatedAt = new Date(detail.updatedAt);
        if (!Number.isNaN(updatedAt.getTime())) {
          addParagraph(`Обновлено: ${updatedAt.toLocaleString("ru-RU")}`, {
            fontSize: 10,
            spacingAfter: 14,
          });
        }
      }

      if (blocks.length === 0) {
        addParagraph("Документ пока пуст.");
      } else {
        blocks.forEach((block) => {
          switch (block.type) {
            case "heading": {
              const size = block.level === 1 ? 18 : block.level === 2 ? 16 : 14;
              addParagraph(block.text, {
                fontSize: size,
                bold: true,
                spacingAfter: size * 0.4,
              });
              break;
            }
            case "paragraph": {
              addParagraph(block.text, { fontSize: 12 });
              break;
            }
            case "list": {
              addList(block.items, block.ordered);
              break;
            }
            default:
              break;
          }
        });
      }

      doc.save(buildDocumentFileName(title, "pdf"));
      toast({ title: "PDF выгружен", description: "Файл успешно сохранён." });
    } catch (error) {
      toast({
        title: "Не удалось сохранить PDF",
        description:
          error instanceof Error
            ? error.message
            : "Попробуйте выполнить выгрузку чуть позже.",
        variant: "destructive",
      });
    } finally {
      setExportingFormat(null);
    }
  };

  const renderBreadcrumbs = (detail: KnowledgeBaseNodeDetail) => {
    if (detail.type === "base") {
      return null;
    }

    const crumbs = detail.breadcrumbs;
    return (
      <Breadcrumb className="mb-4">
        <BreadcrumbList className="flex-wrap">
          {crumbs.map((crumb, index) => {
            const isLast = index === crumbs.length - 1;
            const href =
              crumb.type === "base"
                ? `/knowledge/${selectedBase?.id}`
                : `/knowledge/${selectedBase?.id}/node/${crumb.id}`;

            return (
              <BreadcrumbItem key={crumb.id} className="max-w-full">
                {isLast ? (
                  <BreadcrumbPage className="truncate max-w-full">{crumb.title}</BreadcrumbPage>
                ) : (
                  <BreadcrumbLink asChild>
                    <Link href={href} className="truncate max-w-full block">{crumb.title}</Link>
                  </BreadcrumbLink>
                )}
                {!isLast && <BreadcrumbSeparator />}
              </BreadcrumbItem>
            );
          })}
        </BreadcrumbList>
      </Breadcrumb>
    );
  };

  const handleChangeParent = (child: KnowledgeBaseChildNode, newValue: string) => {
    if (!selectedBase) {
      return;
    }

    const parentId = newValue === ROOT_PARENT_VALUE ? null : newValue;

    if (parentId === child.parentId) {
      return;
    }

    setMovingNodeId(child.id);
    moveNodeMutation.mutate({ baseId: selectedBase.id, nodeId: child.id, parentId });
  };

  const handleApplyHierarchySettings = () => {
    if (!hierarchyDialogState) {
      closeHierarchyDialog();
      return;
    }

    if (!selectedBase) {
      closeHierarchyDialog();
      return;
    }

    const targetParentId =
      hierarchySelectedParentId === ROOT_PARENT_VALUE ? null : hierarchySelectedParentId;

    if (targetParentId === hierarchyDialogState.currentParentId) {
      closeHierarchyDialog();
      return;
    }

    setMovingNodeId(hierarchyDialogState.nodeId);
    moveNodeMutation.mutate(
      {
        baseId: selectedBase.id,
        nodeId: hierarchyDialogState.nodeId,
        parentId: targetParentId,
      },
      {
        onSuccess: () => {
          closeHierarchyDialog();
        },
      },
    );
  };

  const renderFolderSettings = (detail: Extract<KnowledgeBaseNodeDetail, { type: "folder" }>) => {
    const folderOptions = collectFolderOptions(detail.structure);
    const descendantMap = buildDescendantMap(detail.structure);

    return (
      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 flex-1">
            <CardTitle className="text-xl break-words">{detail.title}</CardTitle>
            <CardDescription>
              Управляйте подразделом и меняйте вложенность документов. Обновлено {" "}
              {formatDateTime(detail.updatedAt)}.
            </CardDescription>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-2">
            <Button
              type="button"
              onClick={() => handleOpenCreateDocument(detail.id, detail.title)}
              className="w-full sm:w-auto"
            >
              <Plus className="mr-2 h-4 w-4" /> Добавить знания
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" aria-label="Действия с подразделом">
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => handleOpenHierarchyDialog(detail)}>
                  <GitBranch className="mr-2 h-4 w-4" /> Настройки иерархии
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onSelect={() =>
                    setDeleteTarget({ type: "folder", id: detail.id, title: detail.title })
                  }
                >
                  Удалить подраздел
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </CardHeader>
        <CardContent>
          {renderBreadcrumbs(detail)}
          <Separator className="my-4" />
          <div className="space-y-4">
            <div>
              <h3 className="text-sm font-semibold">Вложенные элементы</h3>
              <p className="text-sm text-muted-foreground">
                Изменяйте уровни вложенности документов и подразделов через выпадающий список.
              </p>
            </div>
            {(!detail.children || detail.children.length === 0) ? (
              <p className="text-sm text-muted-foreground">
                В этом подразделе пока нет документов. Используйте кнопку «Добавить знания», чтобы добавить материалы.
              </p>
            ) : (
              <div className="space-y-3">
                {detail.children.map((child) => {
                  const excluded = new Set<string>([
                    child.id,
                    ...(descendantMap.get(child.id) ?? new Set<string>()),
                  ]);
                  const availableParents = folderOptions.filter((folder) => !excluded.has(folder.id));

                  return (
                      <div
                      key={child.id}
                      className="flex flex-col gap-3 rounded-md border p-3 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 min-w-0">
                          {child.type === "folder" ? (
                            <Folder className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                          ) : (
                            <FileText className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                          )}
                          <span className="font-medium break-words min-w-0">{child.title}</span>
                          {child.type === "folder" && (
                            <Badge variant="outline" className="flex-shrink-0">{child.childCount} элементов</Badge>
                          )}
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Обновлено {formatDateTime(child.updatedAt)}
                        </p>
                      </div>
                      <Select
                        value={child.parentId ?? ROOT_PARENT_VALUE}
                        onValueChange={(value) => handleChangeParent(child, value)}
                        disabled={movingNodeId === child.id && moveNodeMutation.isPending}
                      >
                        <SelectTrigger className="w-full sm:w-64">
                          <SelectValue placeholder="Выберите родительский раздел" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={ROOT_PARENT_VALUE}>В корне базы</SelectItem>
                          {availableParents.map((option) => (
                            <SelectItem key={option.id} value={option.id}>
                              <span className="flex items-center gap-2">
                                {" ".repeat(option.level * 2)}
                                {option.type === "folder" ? (
                                  <Folder className="h-3.5 w-3.5 text-muted-foreground" />
                                ) : (
                                  <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                                )}
                                {option.title}
                              </span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    );
  };

  const renderDocument = (detail: Extract<KnowledgeBaseNodeDetail, { type: "document" }>) => {
    const isCurrentEditing = editingDocumentId === detail.id;
    const sanitizedContent =
      detail.id === documentDetail?.id
        ? sanitizedDocumentContent
        : getSanitizedContent(detail.content ?? "");
    const markdownContent = detail.contentMarkdown ?? null;
    const statusLabel = DOCUMENT_STATUS_LABELS[detail.status] ?? detail.status;
    const sourceLabel = DOCUMENT_SOURCE_LABELS[detail.sourceType] ?? "Документ";
    const versionLabel = detail.versionNumber ? `v${detail.versionNumber}` : null;
    const isSaving = updateDocumentMutation.isPending;
    const chunkSet = detail.chunkSet ?? null;
    const hasChunks = Boolean(chunkSet && chunkSet.chunks.length > 0);
    const handleChunkSetCreated = (chunkSet: KnowledgeDocumentChunkSet) => {
      setDocumentActiveTab("chunks");
      queryClient.setQueryData<KnowledgeBaseNodeDetail>(
        ["knowledge-node", selectedBase?.id, nodeKey],
        (previous) => {
          if (!previous || previous.type !== "document") {
            return previous;
          }

          return { ...previous, chunkSet };
        },
      );
      void nodeDetailQuery.refetch();
      setVectorizeDialogState((current) => {
        if (!current || current.document.id !== detail.id) {
          return current;
        }

        return {
          ...current,
          document: { ...current.document, chunkSet },
        };
      });
    };
    const handleOpenChunksDialogFromMenu = () => {
      setDocumentActiveTab("chunks");
      setChunkDialogSignal((value) => value + 1);
    };
    const handleOpenVectorizeDialog = () => {
      if (!hasChunks) {
        handleOpenChunksDialogFromMenu();
        return;
      }

      setVectorizeDialogState({ document: detail, base: selectedBase, isOpen: true });
    };

    return (
      <Card>
        <CardHeader className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex-1 space-y-2">
            {isCurrentEditing ? (
              <div className="space-y-2">
                <Label htmlFor="knowledge-document-edit-title">Название документа</Label>
                <Input
                  id="knowledge-document-edit-title"
                  value={documentDraftTitle}
                  onChange={(event) => setDocumentDraftTitle(event.target.value)}
                  placeholder="Введите название документа"
                  autoFocus
                />
                <p className="text-xs text-muted-foreground">
                  Последнее обновление: {formatDateTime(detail.updatedAt)}
                </p>
              </div>
            ) : (
              <>
                <CardTitle className="flex flex-wrap items-center gap-2 min-w-0">
                  <span className="break-words">{detail.title}</span>
                  {detail.sourceType === "crawl" && (
                    <span className="flex items-center flex-shrink-0">
                      <Globe2 aria-hidden="true" className="h-4 w-4 text-emerald-500" />
                      <span className="sr-only">Документ создан краулингом</span>
                    </span>
                  )}
                </CardTitle>
                <CardDescription>Обновлено {formatDateTime(detail.updatedAt)}</CardDescription>
              </>
            )}
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
            {isCurrentEditing ? (
              <>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => handleCancelEditingDocument(detail)}
                  disabled={isSaving}
                >
                  Отмена
                </Button>
                <Button
                  type="button"
                  onClick={() => handleSaveDocument(detail)}
                  disabled={isSaving || !documentDraftTitle.trim()}
                >
                  {isSaving ? "Сохраняем..." : "Сохранить"}
                </Button>
              </>
            ) : (
              <>
                <Button
                  type="button"
                  onClick={() => handleOpenCreateDocument(detail.id, detail.title)}
                  className="w-full sm:w-auto"
                >
                  <Plus className="mr-2 h-4 w-4" /> Добавить знания
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" aria-label="Действия с документом">
                      <MoreVertical className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => handleOpenHierarchyDialog(detail)}>
                      <GitBranch className="mr-2 h-4 w-4" /> Настройки иерархии
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => handleStartEditingDocument(detail)}>
                      <PencilLine className="mr-2 h-4 w-4" /> Редактировать
                    </DropdownMenuItem>
                    {hasChunks ? (
                      <DropdownMenuItem onSelect={handleOpenVectorizeDialog}>
                        <Sparkles className="mr-2 h-4 w-4" /> Векторизовать документ
                      </DropdownMenuItem>
                    ) : (
                      <DropdownMenuItem onSelect={handleOpenChunksDialogFromMenu}>
                        <SquareStack className="mr-2 h-4 w-4" /> Создать чанки
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      disabled={exportingDoc || exportingPdf}
                      onSelect={() => {
                        void handleDownloadDoc(detail);
                      }}
                    >
                      <FileType className="mr-2 h-4 w-4" /> Скачать .doc
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      disabled={exportingDoc || exportingPdf}
                      onSelect={() => {
                        void handleDownloadPdf(detail);
                      }}
                    >
                      <FileDown className="mr-2 h-4 w-4" /> Скачать PDF
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className="text-destructive focus:text-destructive"
                      onSelect={() => {
                        setDeleteTarget({ type: "document", id: detail.id, title: detail.title });
                      }}
                    >
                      <Trash2 className="mr-2 h-4 w-4" /> Удалить
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {renderBreadcrumbs(detail)}
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <Badge variant="outline">{sourceLabel}</Badge>
            <Badge variant="outline">{statusLabel}</Badge>
            {versionLabel && <Badge variant="secondary">Версия {versionLabel}</Badge>}
            {detail.sourceType === "import" && detail.importFileName && (
              <span>
                Файл: <code className="text-xs text-foreground">{detail.importFileName}</code>
              </span>
            )}
            <span>
              ID документа: <code className="text-xs text-foreground">{detail.documentId}</code>
            </span>
            {detail.versionId && (
              <span>
                Версия ID: <code className="text-xs text-foreground">{detail.versionId}</code>
              </span>
            )}
          </div>
          <Tabs value={documentActiveTab} onValueChange={handleDocumentTabChange} className="w-full">
            <TabsList className="w-full justify-start">
              <TabsTrigger value="content">Содержимое</TabsTrigger>
              <TabsTrigger value="chunks">Чанки</TabsTrigger>
            </TabsList>
            <TabsContent value="content" className="mt-4">
              {isCurrentEditing ? (
                <div className="space-y-3">
                  <Label className="text-sm font-medium" htmlFor="knowledge-document-editor">
                    Содержимое
                  </Label>
                  <div id="knowledge-document-editor">
                    <DocumentEditor
                      value={documentDraftContent}
                      onChange={(value) => setDocumentDraftContent(getSanitizedContent(value))}
                    />
                  </div>
                </div>
              ) : markdownContent && markdownContent.trim().length > 0 ? (
                <MarkdownRenderer markdown={markdownContent} />
              ) : sanitizedContent ? (
                <div
                  className="prose prose-sm max-w-none dark:prose-invert"
                  dangerouslySetInnerHTML={{ __html: sanitizedContent }}
                />
              ) : (
                <p className="text-sm text-muted-foreground">Документ пока пуст.</p>
              )}
            </TabsContent>
            <TabsContent value="chunks" className="mt-4">
              <DocumentChunksPanel
                baseId={selectedBase!.id}
                nodeId={detail.id}
                documentId={detail.documentId}
                chunkSet={detail.chunkSet}
                onChunkSetCreated={handleChunkSetCreated}
                externalOpenDialogSignal={chunkDialogSignal}
                sourceType={detail.sourceType}
              />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    );
  };

  // Обработчик успешного запуска индексации из визарда
  const handleIndexingStarted = useCallback(
    (actionId: string) => {
      setIndexingActionId(actionId);
      setIsIndexingWizardOpen(false);

      toast({
        title: "Индексация запущена",
        description: "Прогресс отображается на странице базы знаний",
      });

      // Обновить данные
      void indexingSummaryQuery.refetch();
      if (isIndexingChangesOpen) {
        void indexingChangesQuery.refetch();
      }
    },
    [toast, indexingSummaryQuery, indexingChangesQuery, isIndexingChangesOpen],
  );

  const handleOpenResetIndexDialog = useCallback(() => {
    setResetDeleteCollection(true);
    setResetReindex(true);
    setResetConfirmed(false);
    setIsResetIndexDialogOpen(true);
  }, []);

  const handleResetIndexing = useCallback(async () => {
    if (!selectedBase) {
      return;
    }

    try {
      const result = await resetIndexingMutation.mutateAsync({
        baseId: selectedBase.id,
        deleteCollection: resetDeleteCollection,
        reindex: resetReindex,
      });
      setIsResetIndexDialogOpen(false);
      setResetConfirmed(false);

      const collectionNote = resetDeleteCollection
        ? result.deletedCollection
          ? "Коллекция Qdrant удалена."
          : "Коллекция Qdrant уже отсутствовала."
        : "Коллекция Qdrant сохранена.";

      if (!resetReindex) {
        toast({
          title: "Индекс сброшен",
          description: `${collectionNote} Документы помечены для переиндексации.`,
        });
      } else if (result.jobCount === 0) {
        toast({
          title: "Индекс сброшен",
          description: `${collectionNote} Документов для индексации нет.`,
        });
      } else {
        toast({
          title: "Индекс сброшен",
          description: `${collectionNote} Запущена полная переиндексация.`,
        });
      }

      if (result.actionId) {
        setIndexingActionId(result.actionId);
      }
      void indexingSummaryQuery.refetch();
      if (isIndexingChangesOpen) {
        void indexingChangesQuery.refetch();
      }
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Не удалось сбросить индекс",
        description: error instanceof Error ? error.message : "Попробуйте позже",
      });
    }
  }, [
    selectedBase,
    resetIndexingMutation,
    resetDeleteCollection,
    resetReindex,
    toast,
    indexingSummaryQuery,
    indexingChangesQuery,
    isIndexingChangesOpen,
  ]);

  const indexingSummary = indexingSummaryQuery.data ?? null;
  const indexingStatus = indexingSummary?.status ?? null;
  const hasIndexingDocuments = indexingSummary ? (indexingSummary.totalDocuments ?? 0) > 0 : null;
  const isIndexingInProgress = indexingStatus === "indexing";
  const isIndexingUpToDate = indexingStatus === "up_to_date";
  const isIndexingNotIndexed = indexingStatus === "not_indexed";
  const indexingButtonDisabledReason = (() => {
    if (!indexingSummary) {
      if (indexingSummaryQuery.isError) {
        return null;
      }
      return "Загружаем статус индексации";
    }
    if (!hasIndexingDocuments) {
      return "Нет документов для индексации";
    }
    if (isIndexingInProgress) {
      return "Индексация выполняется";
    }
    if (isIndexingUpToDate) {
      return "База знаний актуальна, все документы проиндексированы";
    }
    if (isIndexingNotIndexed) {
      return "В базе знаний нет документов для индексации";
    }
    return null;
  })();

  // Функция для построения имени коллекции Qdrant для базы знаний
  const buildKnowledgeCollectionName = useCallback((baseId: string, workspaceId: string): string => {
    const sanitize = (source: string): string => {
      const normalized = source.replace(/[^a-zA-Z0-9_-]/g, "").toLowerCase();
      return normalized.length > 0 ? normalized.slice(0, 60) : "default";
    };
    const baseSlug = sanitize(baseId);
    const workspaceSlug = sanitize(workspaceId);
    return `kb_${baseSlug}_ws_${workspaceSlug}`;
  }, []);

  const renderOverview = (detail: Extract<KnowledgeBaseNodeDetail, { type: "base" }>) => {
    const collectionName = workspaceId && detail.id ? buildKnowledgeCollectionName(detail.id, workspaceId) : null;
    
    return (
    <Card>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <CardTitle>{detail.name}</CardTitle>
          <CardDescription>Последнее обновление: {formatDateTime(detail.updatedAt)}</CardDescription>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-2">
          <Button
            type="button"
            onClick={() => handleOpenCreateDocument(null, detail.name)}
            className="w-full sm:w-auto"
          >
            <Plus className="mr-2 h-4 w-4" /> Добавить знания
          </Button>
          <div className="flex flex-col items-start gap-1">
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                className="w-full sm:w-auto"
                disabled={Boolean(
                  startIndexingMutation.isPending ||
                    indexingButtonDisabledReason ||
                    !detail.rootNodes || detail.rootNodes.length === 0 ||
                    !isIndexingConfigReady,
                )}
                title={
                  !isIndexingConfigReady
                    ? "Загрузка настроек индексации..."
                    : indexingButtonDisabledReason ??
                      ((!detail.rootNodes || detail.rootNodes.length === 0) ? "Нет документов для индексации" : undefined)
                }
                onClick={() => setIsIndexingWizardOpen(true)}
              >
                {startIndexingMutation.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Database className="mr-2 h-4 w-4" />
                )}
                Индексировать
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setLocation(`/knowledge/${detail.id}/indexing/history`)}
                disabled={!detail.id}
                className="w-full sm:w-auto"
              >
                <History className="mr-2 h-4 w-4" />
                История индексаций
              </Button>
            </div>
            {/* Информация о статусе индексации */}
            {indexingSummary && !activeIndexingActionForBase && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                {isIndexingUpToDate && (
                  <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200 dark:bg-green-950 dark:text-green-300 dark:border-green-800">
                    База знаний актуальна
                  </Badge>
                )}
                {isIndexingNotIndexed && hasIndexingDocuments && (
                  <Badge variant="outline" className="bg-yellow-50 text-yellow-700 border-yellow-200 dark:bg-yellow-950 dark:text-yellow-300 dark:border-yellow-800">
                    Требуется индексация
                  </Badge>
                )}
                {!hasIndexingDocuments && (
                  <Badge variant="outline" className="bg-gray-50 text-gray-700 border-gray-200 dark:bg-gray-950 dark:text-gray-300 dark:border-gray-800">
                    Нет документов
                  </Badge>
                )}
              </div>
            )}
            {activeIndexingActionForBase && (
              <div className="flex flex-col gap-1.5 w-full sm:w-auto mt-1">
                <div className="flex items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <Progress
                      value={
                        (() => {
                          const processedDocuments = activeIndexingActionForBase.payload?.processedDocuments ?? 0;
                          const totalDocumentsInBase = indexingSummary?.totalDocuments ?? 0;
                          return totalDocumentsInBase > 0
                            ? Math.round((processedDocuments / totalDocumentsInBase) * 100)
                            : 0;
                        })()
                      }
                      className="h-1.5"
                    />
                  </div>
                  <span className="text-xs text-muted-foreground whitespace-nowrap">
                    {(() => {
                      const processedDocuments = activeIndexingActionForBase.payload?.processedDocuments ?? 0;
                      const totalDocumentsInBase = indexingSummary?.totalDocuments ?? 0;
                      return totalDocumentsInBase > 0
                        ? `${Math.round((processedDocuments / totalDocumentsInBase) * 100)}%`
                        : "0%";
                    })()}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setLocation(`/knowledge/${detail.id}/indexing/history`)}
                  className="text-xs text-muted-foreground hover:text-foreground underline cursor-pointer text-left"
                >
                  {activeIndexingActionForBase.status === "processing" && "Индексация выполняется"}
                  {activeIndexingActionForBase.status === "paused" && "Индексация на паузе"}
                  {activeIndexingActionForBase.status === "canceled" && "Индексация отменена"}
                  {activeIndexingActionForBase.status === "done" && "Индексация завершена"}
                  {activeIndexingActionForBase.status === "error" && "Ошибка индексации"}
                  {" • Перейти в историю"}
                </button>
              </div>
            )}
            {!activeIndexingActionForBase && (indexingButtonDisabledReason || !detail.rootNodes || detail.rootNodes.length === 0) && (
              <span className="text-xs text-muted-foreground">
                {indexingButtonDisabledReason ?? "Нет документов для индексации"}
              </span>
            )}
          </div>
          {crawlJobForSelectedBase && (
            <Button
              type="button"
              variant="outline"
              className="w-full sm:w-auto"
              disabled={!isCrawlJobTerminalForSelectedBase || isRetryingCrawl}
              onClick={() => {
                if (!isCrawlJobTerminalForSelectedBase) {
                  return;
                }
                void retryCrawl();
              }}
            >
              {isRetryingCrawl ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-2 h-4 w-4" />
              )}
              {crawlJobForSelectedBase.status === "failed"
                ? "Повторить краулинг"
                : "Перезапустить краулинг"}
            </Button>
          )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" aria-label="Действия с базой знаний">
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {canManageKnowledgeBase && (
                  <>
                    <DropdownMenuItem onSelect={handleOpenResetIndexDialog}>
                      <RefreshCw className="mr-2 h-4 w-4" /> Сбросить индекс
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                  </>
                )}
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onSelect={(event) => {
                    event.preventDefault();
                  setBaseDeleteTarget({
                    id: detail.id,
                    name: detail.name,
                    description: detail.description,
                    updatedAt: detail.updatedAt,
                    rootNodes: detail.rootNodes,
                  });
                  setBaseDeleteConfirmation("");
                }}
              >
                <Trash2 className="mr-2 h-4 w-4" /> Удалить базу знаний
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">{detail.description}</p>
        {collectionName && vectorCollections.some((c) => c.name === collectionName) && (
          <div className="flex items-center gap-2 text-sm">
            <Layers className="h-4 w-4 text-muted-foreground" />
            <span className="text-muted-foreground">Коллекция Qdrant:</span>
            <Link
              href={`/vector/collections/${encodeURIComponent(collectionName)}`}
              className="flex items-center text-primary hover:text-primary/80 transition-colors"
              title="Перейти к коллекции в Qdrant"
            >
              <ExternalLink className="h-4 w-4" />
            </Link>
          </div>
        )}
        <Separator />
        <div>
          <h3 className="text-sm font-semibold mb-2">Структура базы</h3>
          {(!detail.rootNodes || detail.rootNodes.length === 0) ? (
            <p className="text-sm text-muted-foreground">
              В базе ещё нет документов. Нажмите «Добавить знания», чтобы создать первый материал.
            </p>
          ) : (
            <TreeMenu
              baseId={detail.id}
              nodes={detail.rootNodes ?? []}
              activeNodeId={selectedNodeId}
              expandedNodes={expandedNodeIds}
              onToggle={handleToggleNode}
            />
          )}
        </div>
        {activeJsonImportJobId && workspaceId && (
          <>
            <Separator />
            <div className="pt-4">
              <JsonImportCard
                jobId={activeJsonImportJobId}
                baseId={detail.id}
                workspaceId={workspaceId}
                onComplete={() => {
                  void basesQuery.refetch();
                  void nodeDetailQuery.refetch();
                  void indexingSummaryQuery.refetch();
                  if (isIndexingChangesOpen) {
                    void indexingChangesQuery.refetch();
                  }
                  setActiveJsonImportJobId(null);
                }}
              />
            </div>
          </>
        )}
      </CardContent>
    </Card>
    );
  };

  const renderContent = () => {
    if (nodeDetailQuery.isLoading) {
      return (
        <div className="flex h-full items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      );
    }

    if (nodeDetailQuery.error) {
      return (
        <Alert variant="destructive">
          <AlertTitle>Не удалось загрузить данные</AlertTitle>
          <AlertDescription>
            {(nodeDetailQuery.error as Error).message || "Попробуйте обновить страницу чуть позже."}
          </AlertDescription>
        </Alert>
      );
    }

    const detail = nodeDetailQuery.data;
    if (!detail) {
      return null;
    }

    let detailContent: ReactNode = null;
    if (detail.type === "folder") {
      detailContent = renderFolderSettings(detail);
    } else if (detail.type === "document") {
      detailContent = renderDocument(detail);
    } else {
      detailContent = renderOverview(detail);
    }

    return detailContent;

    const baseName = selectedBase?.name ?? "База знаний";
    const searchPlaceholder = selectedBase?.name
      ? `Быстрый поиск по базе «${baseName}»`
      : "Быстрый поиск по базе";

    const isSearchSettingsAvailable = Boolean(selectedBase && storageKey);

    return (
      <div className="space-y-6">
        <div className="flex items-start gap-2">
          <div className="flex-1">
            <SearchQuickSwitcher
              key={selectedBase?.id ?? "no-base"}
              query={quickSearchQuery}
              suggest={suggestData}
              status={suggestStatus}
              error={suggestError ?? null}
              onQueryChange={handleQuickSearchQueryChange}
              onPrefetch={handleQuickSearchPrefetch}
              onClose={handleQuickSwitcherClose}
              askOptions={askOptions}
              renderTrigger={({ open, isOpen }) => (
                <QuickSearchTrigger
                  query={quickSearchQuery}
                  placeholder={searchPlaceholder}
                  isOpen={isOpen}
                  onOpen={() => {
                    if (!selectedBase?.id || isQuickSwitcherOpen) {
                      return;
                    }

                    open();
                  }}
                  onOpenStateChange={handleQuickSwitcherOpenState}
                />
              )}
            />
          </div>
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label="Журнал Ask AI"
            disabled={!selectedBase?.id}
            onClick={() => {
              if (!selectedBase?.id) {
                return;
              }

              setIsAskAiJournalOpen(true);
            }}
          >
            <History className="h-4 w-4" />
          </Button>
          <Popover
            open={isSearchSettingsOpen}
            onOpenChange={(open) => {
              if (!isSearchSettingsAvailable) {
                setIsSearchSettingsOpen(false);
                return;
              }

              setIsSearchSettingsOpen(open);
            }}
          >
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label="Настройки поиска"
                disabled={!isSearchSettingsAvailable}
              >
                <Settings className="h-4 w-4" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-[420px] p-0">
              {isSearchSettingsAvailable && selectedBase && storageKey ? (
                <div className="max-h-[70vh] overflow-y-auto">
                  <div className="flex items-center justify-between border-b px-4 py-2 text-xs text-muted-foreground">
                    <span className="flex items-center gap-2">
                      {searchSettingsStatus}
                    </span>
                  </div>
                  {searchSettingsError ? (
                    <Alert variant="destructive" className="m-4">
                      <AlertTitle>Ошибка синхронизации</AlertTitle>
                      <AlertDescription>{searchSettingsError}</AlertDescription>
                    </Alert>
                  ) : null}
                    <KnowledgeBaseSearchSettingsForm
                      baseName={baseName}
                    searchSettings={searchSettings}
                    isSearchSettingsReady={isSearchSettingsReady}
                    isDirty={isSearchSettingsDirty}
                    isSaving={isSavingSearchSettings}
                    isSaveDisabled={!searchSettings.filtersValid}
                    onSave={handleSaveSearchSettings}
                    onCancel={handleResetSearchSettingsChanges}
                    activeEmbeddingProviders={activeEmbeddingProviders}
                    activeLlmProviders={activeLlmProviders}
                    vectorCollections={vectorCollections}
                    isVectorCollectionsLoading={isVectorCollectionsLoading}
                    onTopKChange={handleTopKInputChange}
                    onVectorLimitChange={handleVectorLimitChange}
                    onBm25LimitChange={handleBm25LimitChange}
                    onBm25WeightChange={handleBm25WeightChange}
                    onVectorWeightChange={handleVectorWeightChange}
                    onEmbeddingProviderChange={handleEmbeddingProviderChange}
                    onLlmProviderChange={handleLlmProviderChange}
                    onLlmModelChange={handleLlmModelChange}
                    onCollectionChange={handleCollectionChange}
                    onSynonymsChange={handleSynonymsChange}
                    onIncludeDraftsChange={handleIncludeDraftsChange}
                    onHighlightResultsChange={handleHighlightResultsChange}
                    onFiltersChange={handleFiltersChange}
                    onTemperatureChange={handleTemperatureChange}
                    onMaxTokensChange={handleMaxTokensChange}
                    onSystemPromptChange={handleSystemPromptChange}
                    onResponseFormatChange={handleResponseFormatChange}
                  />
                </div>
              ) : (
                <div className="p-4 text-sm text-muted-foreground">
                  Выберите базу знаний, чтобы настроить параметры поиска.
                </div>
              )}
            </PopoverContent>
          </Popover>
        </div>
        <CrawlInlineProgress
          baseId={selectedBase?.id}
          onStateChange={handleCrawlStateChange}
          onDocumentsSaved={handleCrawlDocumentsSaved}
        />
        {detailContent}
      </div>
    );
  };

  const handleCreateDocumentSubmit = async (values: CreateKnowledgeDocumentFormValues) => {
    if (!selectedBase) {
      throw new Error("База знаний не выбрана");
    }

    if (values.sourceType === "crawl") {
      const url = values.crawlUrl?.trim();
      if (!url) {
        throw new Error("Укажите ссылку на страницу");
      }

      await crawlDocumentMutation.mutateAsync({
        baseId: selectedBase.id,
        parentId: values.parentId ?? null,
        url,
      });
      return;
    }

    await createDocumentMutation.mutateAsync({ ...values, baseId: selectedBase.id });
  };

  const normalizedHierarchySelectedParentId =
    hierarchySelectedParentId === ROOT_PARENT_VALUE ? null : hierarchySelectedParentId;
  const isHierarchySaving =
    Boolean(hierarchyDialogState) &&
    moveNodeMutation.isPending &&
    movingNodeId === hierarchyDialogState?.nodeId;
  const hasHierarchyChanges =
    Boolean(hierarchyDialogState) &&
    normalizedHierarchySelectedParentId !== hierarchyDialogState?.currentParentId;

  return (
    <div className="flex h-full min-h-[calc(100vh-4rem)] bg-background">
      <aside className="flex w-80 flex-col border-r">
        <div className="space-y-4 border-b p-4">
          <div>
            <p className="text-sm font-semibold">База знаний</p>
            <p className="text-xs text-muted-foreground">
              Выберите раздел или документ. Содержимое загружается при переходе.
            </p>
          </div>
          {basesQuery.isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Загрузка баз...
            </div>
          ) : bases.length === 0 ? (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">
                Пока нет доступных баз знаний.
              </p>
              <p className="text-xs text-muted-foreground">
                Создайте первую базу через основную панель, чтобы начать работу с документами.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              <Select
                value={selectedBase?.id ?? ""}
                onValueChange={(value) => setLocation(`/knowledge/${value}`)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Выберите базу" />
                </SelectTrigger>
                <SelectContent>
                  {bases.map((base) => (
                    <SelectItem key={base.id} value={base.id}>
                      {base.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="w-full"
                onClick={() => handleOpenCreateBase("blank")}
              >
                <Plus className="mr-2 h-4 w-4" /> Новая база знаний
              </Button>
            </div>
          )}
          {selectedBase && (
            <Button
              asChild
              variant={!selectedNodeId ? "default" : "outline"}
              size="sm"
              className="w-full"
            >
              <Link href={`/knowledge/${selectedBase.id}`}>Обзор базы</Link>
            </Button>
          )}
        </div>
        <ScrollArea className="flex-1 p-4">
          {!selectedBase ? (
            bases.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Создайте базу знаний через кнопку на главной панели, чтобы увидеть структуру документов и загрузить материалы.
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">
                Выберите базу знаний, чтобы увидеть структуру документов.
              </p>
            )
          ) : (!selectedBase.rootNodes || selectedBase.rootNodes.length === 0) ? (
            <p className="text-sm text-muted-foreground">
              В этой базе ещё нет документов.
            </p>
          ) : (
            <TreeMenu
              baseId={selectedBase.id}
              nodes={selectedBase.rootNodes ?? []}
              activeNodeId={selectedNodeId}
              expandedNodes={expandedNodeIds}
              onToggle={handleToggleNode}
            />
          )}
        </ScrollArea>
      </aside>
      <main className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto flex max-w-4xl flex-col gap-6">
          {bases.length === 0 ? (
            <Card className="border border-dashed">
              <CardHeader className="space-y-2 text-center">
                <CardTitle>Нет ни одной базы знаний</CardTitle>
                <CardDescription>
                  Создайте базу, чтобы организовать документы, сформировать структуру и подключить векторный поиск.
                </CardDescription>
              </CardHeader>
              <CardFooter className="justify-center pb-6">
                <Button onClick={() => handleOpenCreateBase("blank")}>
                  <Plus className="mr-2 h-4 w-4" /> Создать базу знаний
                </Button>
              </CardFooter>
            </Card>
          ) : (
            renderContent()
          )}
        </div>
      </main>
      {vectorizeDialogState && (
        <VectorizeKnowledgeDocumentDialog
          open={vectorizeDialogState.isOpen}
          hideTrigger
          document={{
            id: vectorizeDialogState.document.documentId ?? vectorizeDialogState.document.id,
            title: vectorizeDialogState.document.title,
            content: vectorizeDialogState.document.content,
            sourceUrl: vectorizeDialogState.document.sourceUrl ?? null,
            updatedAt: vectorizeDialogState.document.updatedAt,
            chunkSet: vectorizeDialogState.document.chunkSet ?? undefined,
          }}
          base={
            vectorizeDialogState.base
              ? {
                  id: vectorizeDialogState.base.id,
                  name: vectorizeDialogState.base.name,
                  description: vectorizeDialogState.base.description,
                }
              : null
          }
          providers={activeEmbeddingProviders}
          onVectorizationStart={(info) => {
            setVectorizeDialogState((current) => {
              if (!current || current.document.id !== info.documentId) {
                return current;
              }

              return { ...current, isOpen: false };
            });
            setDocumentVectorizationProgress({
              documentId: info.documentId,
              documentTitle: info.documentTitle,
              jobId: null,
              totalChunks: info.totalChunks > 0 ? info.totalChunks : 0,
              processedChunks: 0,
              status: "pending",
              errorMessage: null,
              selection: info.selection ?? null,
            });
            setShouldPollVectorizationJob(false);
          }}
          onVectorizationJobCreated={(info) => {
            setDocumentVectorizationProgress((current) => {
              if (!current || current.documentId !== info.documentId) {
                return current;
              }

              return {
                ...current,
                jobId: info.jobId,
                totalChunks:
                  info.totalChunks > 0
                    ? info.totalChunks
                    : Math.max(current.totalChunks, current.processedChunks),
                status: current.status === "pending" ? "running" : current.status,
              };
            });
            setShouldPollVectorizationJob(true);
          }}
          onVectorizationError={(payload) => {
            setDocumentVectorizationProgress((current) => {
              if (!current || current.documentId !== payload.documentId) {
                return current;
              }

              return {
                ...current,
                status: "failed",
                errorMessage: payload.error.message,
              };
            });
            setShouldPollVectorizationJob(false);
            setVectorizeDialogState((current) => {
              if (!current || current.document.id !== payload.documentId) {
                return current;
              }

              return { ...current, isOpen: true };
            });
          }}
          onVectorizationComplete={(payload) => {
            setVectorizeDialogState(null);
            setDocumentVectorizationProgress((current) => {
              if (!current || current.documentId !== payload.documentId) {
                return current;
              }

              return {
                ...current,
                status: "completed",
                processedChunks: payload.vectorization.pointsCount,
                totalChunks: Math.max(
                  current.totalChunks,
                  payload.vectorization.pointsCount,
                ),
                errorMessage: null,
              };
            });
            setShouldPollVectorizationJob(false);
            void nodeDetailQuery.refetch();
          }}
          onOpenChange={(open) => {
            if (open) {
              setVectorizeDialogState((current) => {
                if (!current) {
                  return current;
                }

                return { ...current, isOpen: true };
              });
              return;
            }

            setVectorizeDialogState((current) => {
              if (!current) {
                return current;
              }

              const isVectorizingCurrent =
                documentVectorizationProgress &&
                documentVectorizationProgress.documentId === current.document.id &&
                (documentVectorizationProgress.status === "pending" ||
                  documentVectorizationProgress.status === "running");

              if (isVectorizingCurrent) {
                return { ...current, isOpen: false };
              }

              return null;
            });
          }}
        />
      )}
      <AskAiRunJournalDialog
        open={isAskAiJournalOpen}
        onOpenChange={setIsAskAiJournalOpen}
        knowledgeBaseId={selectedBase?.id ?? null}
      />
      <CreateKnowledgeBaseDialog
        open={isCreateBaseDialogOpen}
        onOpenChange={(open) => {
          setIsCreateBaseDialogOpen(open);
          if (!open) {
            setCreateBaseMode("blank");
          }
        }}
        workspaceId={workspaceId}
        initialMode={createBaseMode}
        onCreated={handleBaseCreated}
        onJsonImportStarted={(jobId) => {
          setActiveJsonImportJobId(jobId);
        }}
      />
      <CreateKnowledgeDocumentDialog
        open={isCreateDocumentDialogOpen}
        onOpenChange={(open) => {
          setIsCreateDocumentDialogOpen(open);
          if (!open) {
            setDocumentDialogParentId(null);
            setDocumentDialogParentTitle("В корне базы");
          }
        }}
        structure={selectedBase?.rootNodes ?? []}
        defaultParentId={documentDialogParentId}
        baseName={selectedBase?.name ?? "База знаний"}
        parentLabel={documentDialogParentTitle}
        isSubmitting={createDocumentMutation.isPending || crawlDocumentMutation.isPending}
        onSubmit={handleCreateDocumentSubmit}
        workspaceId={workspaceId}
        baseId={selectedBase?.id}
        onJsonImportStarted={(jobId) => {
          setActiveJsonImportJobId(jobId);
        }}
      />
      <Dialog
        open={Boolean(hierarchyDialogState)}
        onOpenChange={(open) => {
          if (!open) {
            closeHierarchyDialog();
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Настройки иерархии</DialogTitle>
            <DialogDescription>
              {hierarchyDialogState?.nodeType === "folder"
                ? "Выберите подраздел, в который нужно переместить текущий раздел, или сделайте его корневым."
                : "Назначьте родительскую страницу для документа или оставьте его в корне базы."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-md border bg-muted/40 p-3 text-sm">
              <p className="font-medium">{hierarchyDialogState?.nodeTitle}</p>
              <p className="text-muted-foreground">Текущий уровень: {hierarchyCurrentParentLabel}</p>
            </div>
            <div className="space-y-2">
              <Label>Родительская страница</Label>
              <Select
                value={hierarchySelectedParentId}
                onValueChange={setHierarchySelectedParentId}
                disabled={isHierarchySaving}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Выберите элемент" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ROOT_PARENT_VALUE}>В корне базы</SelectItem>
                  {hierarchyDialogOptions.availableOptions.map((option) => (
                    <SelectItem key={option.id} value={option.id}>
                      <span className="flex items-center gap-2">
                        <span
                          className="inline-block"
                          style={{ width: option.level * 12 }}
                          aria-hidden="true"
                        />
                        {option.type === "folder" ? (
                          <Folder className="h-3.5 w-3.5 text-muted-foreground" />
                        ) : (
                          <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                        )}
                        {option.title}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {hierarchyDialogState?.nodeType === "folder"
                  ? "Подраздел можно вложить только в другой подраздел."
                  : "Документ может находиться в подразделе или внутри другого документа."}
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={closeHierarchyDialog} disabled={isHierarchySaving}>
              Отмена
            </Button>
            <Button type="button" onClick={handleApplyHierarchySettings} disabled={!hasHierarchyChanges || isHierarchySaving}>
              {isHierarchySaving ? "Сохраняем..." : "Сохранить"}
            </Button>
          </DialogFooter>
        </DialogContent>
        </Dialog>
        <Dialog
          open={isResetIndexDialogOpen}
          onOpenChange={(open) => {
            if (!open) {
              setIsResetIndexDialogOpen(false);
              setResetConfirmed(false);
              resetIndexingMutation.reset();
            }
          }}
        >
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Сбросить индекс?</DialogTitle>
              <DialogDescription>
                Индекс будет пересобран для базы «{selectedBase?.name ?? "Без названия"}».
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <Alert variant="destructive">
                <AlertTitle>Внимание</AlertTitle>
                <AlertDescription>
                  Сброс индекса удаляет текущие векторные данные. Поиск будет недоступен до завершения переиндексации.
                </AlertDescription>
              </Alert>
              <div className="rounded-md border bg-muted/40 p-3 text-sm">
                <p className="font-medium">База: {selectedBase?.name ?? "Без названия"}</p>
                <p className="text-muted-foreground">
                  Все документы будут помечены как требующие индексации.
                </p>
              </div>
              <div className="space-y-3">
                <div className="flex items-start gap-3">
                  <Checkbox
                    id="reset-delete-collection"
                    checked={resetDeleteCollection}
                    onCheckedChange={(checked) => setResetDeleteCollection(Boolean(checked))}
                    disabled={resetIndexingMutation.isPending}
                  />
                  <div className="space-y-1">
                    <Label htmlFor="reset-delete-collection">Удалить коллекцию Qdrant</Label>
                    <p className="text-xs text-muted-foreground">
                      Полный ресет: коллекция будет удалена и создана заново при переиндексации.
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <Checkbox
                    id="reset-reindex"
                    checked={resetReindex}
                    onCheckedChange={(checked) => setResetReindex(Boolean(checked))}
                    disabled={resetIndexingMutation.isPending}
                  />
                  <div className="space-y-1">
                    <Label htmlFor="reset-reindex">Запустить переиндексацию сразу</Label>
                    <p className="text-xs text-muted-foreground">
                      Если отключить, индексацию нужно будет запустить вручную.
                    </p>
                  </div>
                </div>
              </div>
              <div className="flex items-start gap-3 rounded-md border border-destructive/40 bg-destructive/5 p-3">
                <Checkbox
                  id="reset-confirmed"
                  checked={resetConfirmed}
                  onCheckedChange={(checked) => setResetConfirmed(Boolean(checked))}
                  disabled={resetIndexingMutation.isPending}
                />
                <Label htmlFor="reset-confirmed" className="text-sm">
                  Я понимаю последствия и хочу сбросить индекс.
                </Label>
              </div>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsResetIndexDialogOpen(false)}
                disabled={resetIndexingMutation.isPending}
              >
                Отмена
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={handleResetIndexing}
                disabled={!resetConfirmed || resetIndexingMutation.isPending}
              >
                {resetIndexingMutation.isPending ? "Сбрасываем..." : "Сбросить индекс"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        <AlertDialog
          open={Boolean(baseDeleteTarget)}
          onOpenChange={(open) => {
            if (!open) {
              setBaseDeleteTarget(null);
            setBaseDeleteConfirmation("");
            deleteBaseMutation.reset();
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить базу знаний?</AlertDialogTitle>
            <AlertDialogDescription>
              Это действие удалит базу «{baseDeleteTarget?.name}» и все её документы без возможности восстановления.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-3">
            <div className="rounded-md border bg-muted/40 p-3 text-sm">
              <p className="font-medium">{baseDeleteTarget?.name}</p>
              <p className="text-muted-foreground">
                Для подтверждения введите точное название базы знаний.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="knowledge-base-delete-confirmation">Название базы знаний</Label>
              <Input
                id="knowledge-base-delete-confirmation"
                value={baseDeleteConfirmation}
                onChange={(event) => setBaseDeleteConfirmation(event.target.value)}
                placeholder="Введите название базы"
                autoComplete="off"
                autoFocus
              />
            </div>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                if (!baseDeleteTarget) {
                  return;
                }
                void deleteBaseMutation.mutate({
                  baseId: baseDeleteTarget.id,
                  confirmation: baseDeleteConfirmation.trim(),
                });
              }}
              disabled={
                deleteBaseMutation.isPending ||
                !baseDeleteTarget ||
                baseDeleteConfirmation.trim() !== baseDeleteTarget.name
              }
            >
              {deleteBaseMutation.isPending ? "Удаляем..." : "Удалить"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog
        open={isDeleteDialogOpen}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteTarget(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {deleteTarget?.type === "document" ? "Удалить документ?" : "Удалить подраздел?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget?.type === "document"
                ? `Документ «${deleteTarget?.title}» и связанные данные будут удалены. Это действие нельзя отменить.`
                : `Подраздел «${deleteTarget?.title ?? ""}» и все вложенные документы будут удалены. Это действие нельзя отменить.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteNodeMutation.isPending}>Отмена</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (!selectedBase || !deleteTarget) {
                  setDeleteTarget(null);
                  return;
                }
                deleteNodeMutation.mutate({ baseId: selectedBase.id, nodeId: deleteTarget.id });
              }}
              disabled={deleteNodeMutation.isPending}
            >
              {deleteNodeMutation.isPending ? "Удаляем..." : "Удалить"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <JsonImportWizard
        open={isJsonImportWizardOpen}
        onOpenChange={setIsJsonImportWizardOpen}
        baseId={selectedBase?.id ?? ""}
        workspaceId={workspaceId ?? ""}
        onImportStarted={(jobId) => {
          setActiveJsonImportJobId(jobId);
          setIsJsonImportWizardOpen(false);
        }}
      />
      {selectedBase && globalIndexingConfig && (
        <IndexingWizardModal
          open={isIndexingWizardOpen}
          onOpenChange={setIsIndexingWizardOpen}
          baseId={selectedBase.id}
          workspaceId={workspaceId ?? ""}
          initialConfig={indexingPolicyConfig ?? undefined}
          defaultConfig={globalIndexingConfig}
          onIndexingStarted={handleIndexingStarted}
          baseInfo={{
            id: selectedBase.id,
            name: selectedBase.name ?? "База знаний",
            documentCount: indexingSummaryQuery.data?.totalDocuments ?? 0,
          }}
        />
      )}
      {documentVectorizationProgress && (
        <DocumentVectorizationProgress
          title={`Векторизация: ${documentVectorizationProgress.documentTitle}`}
          totalChunks={Math.max(
            documentVectorizationProgress.totalChunks,
            documentVectorizationProgress.processedChunks,
          )}
          processedChunks={documentVectorizationProgress.processedChunks}
          status={documentVectorizationProgress.status}
          errorMessage={documentVectorizationProgress.errorMessage}
          dismissible={
            documentVectorizationProgress.status === "completed" ||
            documentVectorizationProgress.status === "failed"
          }
          onDismiss={() => setDocumentVectorizationProgress(null)}
        />
      )}
    </div>
  );
}
