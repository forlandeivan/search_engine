import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
import VectorizeKnowledgeDocumentDialog, {
  type KnowledgeDocumentVectorizationSelection,
} from "@/components/knowledge-base/VectorizeKnowledgeDocumentDialog";
import DocumentVectorizationProgress, {
  type DocumentVectorizationProgressStatus,
} from "@/components/knowledge-base/DocumentVectorizationProgress";
import { CreateKnowledgeBaseDialog } from "@/components/knowledge-base/CreateKnowledgeBaseDialog";
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
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
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
import type {
  KnowledgeBaseSummary,
  KnowledgeBaseTreeNode,
  KnowledgeBaseNodeDetail,
  KnowledgeBaseChildNode,
  DeleteKnowledgeNodeResponse,
  CreateKnowledgeDocumentResponse,
  DeleteKnowledgeBaseResponse,
  KnowledgeBaseDocumentDetail,
  KnowledgeDocumentChunkSet,
  KnowledgeDocumentVectorizationJobStatus,
  KnowledgeBaseCrawlJobStatus,
} from "@shared/knowledge-base";
import type { PublicEmbeddingProvider } from "@shared/schema";
import {
  ChevronDown,
  ChevronRight,
  FileDown,
  FileText,
  FileType,
  Folder,
  GitBranch,
  Loader2,
  MoreVertical,
  PencilLine,
  Plus,
  RefreshCw,
  SquareStack,
  Sparkles,
  Trash2,
} from "lucide-react";

const ROOT_PARENT_VALUE = "__root__";
const TERMINAL_CRAWL_STATUSES: Array<KnowledgeBaseCrawlJobStatus["status"]> = [
  "failed",
  "canceled",
  "done",
];

type KnowledgeBasePageParams = {
  knowledgeBaseId?: string;
  nodeId?: string;
};

type KnowledgeBasePageProps = {
  params?: KnowledgeBasePageParams;
};

type FolderOption = {
  id: string;
  title: string;
  level: number;
  type: "folder" | "document";
};

type MoveNodeVariables = {
  baseId: string;
  nodeId: string;
  parentId: string | null;
};

type DeleteNodeVariables = {
  baseId: string;
  nodeId: string;
};

type CreateDocumentVariables = CreateKnowledgeDocumentFormValues & {
  baseId: string;
};

type DocumentVectorizationProgressState = {
  documentId: string;
  documentTitle: string;
  jobId: string | null;
  totalChunks: number;
  processedChunks: number;
  status: DocumentVectorizationProgressStatus;
  errorMessage: string | null;
  selection?: KnowledgeDocumentVectorizationSelection | null;
};

const formatDateTime = (value?: string | null) => {
  if (!value) {
    return "Недавно";
  }

  try {
    return new Intl.DateTimeFormat("ru-RU", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value));
  } catch (error) {
    return "Недавно";
  }
};

const hasNode = (nodes: KnowledgeBaseTreeNode[], nodeId: string): boolean => {
  for (const node of nodes) {
    if (node.id === nodeId) {
      return true;
    }

    if (node.children && hasNode(node.children, nodeId)) {
      return true;
    }
  }

  return false;
};

const collectFolderOptions = (
  nodes: KnowledgeBaseTreeNode[],
  level = 0,
  accumulator: FolderOption[] = [],
): FolderOption[] => {
  for (const node of nodes) {
    accumulator.push({ id: node.id, title: node.title, level, type: node.type });
    if (node.children) {
      collectFolderOptions(node.children, level + 1, accumulator);
    }
  }

  return accumulator;
};

const buildDescendantMap = (
  nodes: KnowledgeBaseTreeNode[],
  accumulator = new Map<string, Set<string>>(),
): Map<string, Set<string>> => {
  const traverse = (node: KnowledgeBaseTreeNode): Set<string> => {
    const descendants = new Set<string>();

    if (node.children) {
      for (const child of node.children) {
        descendants.add(child.id);
        const childDesc = traverse(child);
        for (const value of childDesc) {
          descendants.add(value);
        }
      }
    }

    accumulator.set(node.id, descendants);
    return descendants;
  };

  for (const node of nodes) {
    traverse(node);
  }

  return accumulator;
};

const buildParentMap = (
  nodes: KnowledgeBaseTreeNode[],
  parentId: string | null = null,
  accumulator: Map<string, string | null> = new Map(),
): Map<string, string | null> => {
  for (const node of nodes) {
    accumulator.set(node.id, parentId);
    if (node.children) {
      buildParentMap(node.children, node.id, accumulator);
    }
  }

  return accumulator;
};

type DocumentContentBlock =
  | { type: "heading"; level: 1 | 2 | 3; text: string }
  | { type: "paragraph"; text: string }
  | { type: "list"; ordered: boolean; items: string[] };

const DOCUMENT_STATUS_LABELS: Record<string, string> = {
  draft: "Черновик",
  published: "Опубликован",
  archived: "Архивирован",
};

const DOCUMENT_SOURCE_LABELS: Record<string, string> = {
  manual: "Создан вручную",
  import: "Импортированный документ",
};

const normalizeBlockText = (value: string): string =>
  value.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();

const extractDocumentBlocks = (html: string): DocumentContentBlock[] => {
  if (!html || !html.trim()) {
    return [];
  }

  if (typeof window === "undefined") {
    const text = normalizeBlockText(html.replace(/<[^>]+>/g, " "));
    return text ? [{ type: "paragraph", text }] : [];
  }

  const container = window.document.createElement("div");
  container.innerHTML = html;
  const blocks: DocumentContentBlock[] = [];

  const processElement = (element: Element) => {
    const tag = element.tagName.toLowerCase();

    if (/^h[1-6]$/.test(tag)) {
      const text = normalizeBlockText(element.textContent ?? "");
      if (text) {
        const level = Number.parseInt(tag.slice(1), 10);
        const bounded = Math.min(Math.max(level, 1), 3) as 1 | 2 | 3;
        blocks.push({ type: "heading", level: bounded, text });
      }
      return;
    }

    if (tag === "p" || tag === "pre" || tag === "blockquote") {
      const text = normalizeBlockText(element.textContent ?? "");
      if (text) {
        blocks.push({ type: "paragraph", text });
      }
      return;
    }

    if (tag === "ul" || tag === "ol") {
      const items = Array.from(element.querySelectorAll(":scope > li"))
        .map((item) => normalizeBlockText(item.textContent ?? ""))
        .filter(Boolean);
      if (items.length > 0) {
        blocks.push({ type: "list", ordered: tag === "ol", items });
      }
      return;
    }

    if (tag === "div" || tag === "section" || tag === "article") {
      const children = Array.from(element.children);
      if (children.length === 0) {
        const text = normalizeBlockText(element.textContent ?? "");
        if (text) {
          blocks.push({ type: "paragraph", text });
        }
      } else {
        children.forEach(processElement);
      }
      return;
    }

    const text = normalizeBlockText(element.textContent ?? "");
    if (text) {
      blocks.push({ type: "paragraph", text });
    }
  };

  Array.from(container.childNodes).forEach((node) => {
    if (node.nodeType === Node.ELEMENT_NODE) {
      processElement(node as Element);
    } else if (node.nodeType === Node.TEXT_NODE) {
      const text = normalizeBlockText(node.textContent ?? "");
      if (text) {
        blocks.push({ type: "paragraph", text });
      }
    }
  });

  return blocks;
};

const buildDocumentFileName = (title: string, extension: string): string => {
  const normalized = title.replace(/[<>:"/\\|?*]+/g, "").trim();
  const collapsed = normalized.replace(/\s+/g, "_").slice(0, 80);
  const safeBase = collapsed || "document";
  return `${safeBase}.${extension}`;
};

type TreeMenuProps = {
  baseId: string;
  nodes: KnowledgeBaseTreeNode[];
  activeNodeId: string | null;
  expandedNodes: Set<string>;
  onToggle: (nodeId: string) => void;
  level?: number;
};

function TreeMenu({
  baseId,
  nodes,
  activeNodeId,
  expandedNodes,
  onToggle,
  level = 0,
}: TreeMenuProps) {
  return (
    <ul className={cn("space-y-1 text-sm", level > 0 && "border-l border-border/40 pl-4")}>
      {nodes.map((node) => {
        const isActive = activeNodeId === node.id;
        const children = node.children ?? [];
        const hasChildren = children.length > 0;
        const isExpanded = hasChildren && expandedNodes.has(node.id);

        return (
          <li key={node.id} className="space-y-1">
            <div className="flex items-center gap-1">
              {hasChildren ? (
                <button
                  type="button"
                  className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md text-muted-foreground transition hover:bg-muted"
                  onClick={() => onToggle(node.id)}
                  aria-label={isExpanded ? "Свернуть вложенные элементы" : "Развернуть вложенные элементы"}
                  aria-expanded={isExpanded}
                >
                  {isExpanded ? (
                    <ChevronDown className="h-4 w-4" />
                  ) : (
                    <ChevronRight className="h-4 w-4" />
                  )}
                </button>
              ) : (
                <span className="h-6 w-6 flex-shrink-0" />
              )}
              <Link
                href={`/knowledge/${baseId}/node/${node.id}`}
                className={cn(
                  "flex flex-1 items-center gap-2 rounded-md px-2 py-1 transition",
                  isActive ? "bg-primary/10 text-primary" : "hover:bg-muted",
                )}
              >
                {node.type === "folder" ? (
                  <Folder className="h-4 w-4" />
                ) : (
                  <FileText className="h-4 w-4" />
                )}
                <span className="flex-1 truncate">{node.title}</span>
              </Link>
            </div>
            {hasChildren && isExpanded && (
              <TreeMenu
                baseId={baseId}
                nodes={children}
                activeNodeId={activeNodeId}
                expandedNodes={expandedNodes}
                onToggle={onToggle}
                level={level + 1}
              />
            )}
          </li>
        );
      })}
    </ul>
  );
}

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
  const handleOpenCreateBase = (mode: KnowledgeBaseSourceType = "blank") => {
    setCreateBaseMode(mode);
    setIsCreateBaseDialogOpen(true);
  };
  const handleBaseCreated = (base: LocalKnowledgeBase) => {
    setIsCreateBaseDialogOpen(false);
    setLocation(`/knowledge/${base.id}`);
    setCreateBaseMode("blank");
  };

  const basesQuery = useQuery({
    queryKey: ["knowledge-bases"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/knowledge/bases");
      return (await res.json()) as KnowledgeBaseSummary[];
    },
  });

  useEffect(() => {
    if (!basesQuery.data) {
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

  const bases = basesQuery.data ?? [];
  const { data: embeddingServices } = useQuery<{ providers: PublicEmbeddingProvider[] }>({
    queryKey: ["/api/embedding/services"],
  });
  const activeEmbeddingProviders = useMemo(
    () => (embeddingServices?.providers ?? []).filter((provider) => provider.isActive),
    [embeddingServices?.providers],
  );
  const selectedBase = useMemo(
    () => bases.find((base) => base.id === knowledgeBaseId) ?? null,
    [bases, knowledgeBaseId],
  );
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
      const res = await apiRequest("GET", `/api/knowledge/bases/${baseId}/nodes/${nodeKey}`);
      return (await res.json()) as KnowledgeBaseNodeDetail;
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

      const processed = job.result?.pointsCount ?? job.processedChunks ?? 0;
      const collectionName = job.result?.collectionName ?? "коллекцию";
      const completionMessage = job.result?.message?.trim().length
        ? job.result?.message
        : `Добавлено ${processed.toLocaleString("ru-RU")} записей в коллекцию ${collectionName}.`;
      toast({
        title: "Документ отправлен",
        description: completionMessage ?? undefined,
      });

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

      toast({
        title: "Не удалось завершить векторизацию",
        description: job.error ?? "Не удалось завершить векторизацию",
        variant: "destructive",
      });
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
      const template = `<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8" /><title>${escapeHtml(title)}</title><style>body{font-family:Arial,Helvetica,sans-serif;line-height:1.6;color:#111827;margin:1.5rem;}h1,h2,h3{color:#0f172a;}ul,ol{margin-left:1.5rem;}blockquote{border-left:4px solid #e2e8f0;padding-left:1rem;color:#475569;}</style></head><body>${sanitizedHtml || "<p></p>"}</body></html>`;
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
        <BreadcrumbList>
          {crumbs.map((crumb, index) => {
            const isLast = index === crumbs.length - 1;
            const href =
              crumb.type === "base"
                ? `/knowledge/${selectedBase?.id}`
                : `/knowledge/${selectedBase?.id}/node/${crumb.id}`;

            return (
              <BreadcrumbItem key={crumb.id}>
                {isLast ? (
                  <BreadcrumbPage>{crumb.title}</BreadcrumbPage>
                ) : (
                  <BreadcrumbLink asChild>
                    <Link href={href}>{crumb.title}</Link>
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
          <div>
            <CardTitle className="text-xl">{detail.title}</CardTitle>
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
              <Plus className="mr-2 h-4 w-4" /> Новый документ
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
            {detail.children.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                В этом подразделе пока нет документов. Используйте кнопку «Новый документ», чтобы добавить материалы.
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
                      <div>
                        <div className="flex items-center gap-2">
                          {child.type === "folder" ? (
                            <Folder className="h-4 w-4 text-muted-foreground" />
                          ) : (
                            <FileText className="h-4 w-4 text-muted-foreground" />
                          )}
                          <span className="font-medium">{child.title}</span>
                          {child.type === "folder" && (
                            <Badge variant="outline">{child.childCount} элементов</Badge>
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
                <CardTitle>{detail.title}</CardTitle>
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
                  <Plus className="mr-2 h-4 w-4" /> Новый документ
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
              />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    );
  };

  const renderOverview = (detail: Extract<KnowledgeBaseNodeDetail, { type: "base" }>) => (
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
            <Plus className="mr-2 h-4 w-4" /> Новый документ
          </Button>
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
        <Separator />
        <div>
          <h3 className="text-sm font-semibold mb-2">Структура базы</h3>
          {detail.rootNodes.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              В базе ещё нет документов. Нажмите «Новый документ», чтобы создать первый материал.
            </p>
          ) : (
            <TreeMenu
              baseId={detail.id}
              nodes={detail.rootNodes}
              activeNodeId={selectedNodeId}
              expandedNodes={expandedNodeIds}
              onToggle={handleToggleNode}
            />
          )}
        </div>
      </CardContent>
    </Card>
  );

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

    return (
      <div className="space-y-6">
        <CrawlInlineProgress
          baseId={selectedBase?.id}
          onStateChange={handleCrawlStateChange}
          onDocumentsSaved={handleCrawlDocumentsSaved}
        />
        {detailContent}
      </div>
    );
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
          ) : selectedBase.rootNodes.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              В этой базе ещё нет документов.
            </p>
          ) : (
            <TreeMenu
              baseId={selectedBase.id}
              nodes={selectedBase.rootNodes}
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
      <CreateKnowledgeBaseDialog
        open={isCreateBaseDialogOpen}
        onOpenChange={(open) => {
          setIsCreateBaseDialogOpen(open);
          if (!open) {
            setCreateBaseMode("blank");
          }
        }}
        initialMode={createBaseMode}
        onCreated={handleBaseCreated}
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
        isSubmitting={createDocumentMutation.isPending}
        onSubmit={async (values) => {
          if (!selectedBase) {
            throw new Error("База знаний не выбрана");
          }
          await createDocumentMutation.mutateAsync({ ...values, baseId: selectedBase.id });
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
