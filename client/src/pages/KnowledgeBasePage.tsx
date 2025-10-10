import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  FilePlus,
  FileText,
  FolderClosed,
  FolderOpen,
  FolderPlus,
  Library,
  PlusCircle,
  SquarePen,
} from "lucide-react";
import { DocumentEditor } from "@/components/knowledge-base/DocumentEditor";
import { DocumentChunksTab } from "@/components/knowledge-base/DocumentChunksTab";
import { DocumentVectorRecordsTab } from "@/components/knowledge-base/DocumentVectorRecordsTab";
import { VectorizeKnowledgeDocumentDialog } from "@/components/knowledge-base/VectorizeKnowledgeDocumentDialog";
import type { PublicEmbeddingProvider } from "@shared/schema";
import {
  convertFileToHtml,
  escapeHtml,
  extractTitleFromContent,
  getSanitizedContent,
} from "@/lib/document-import";
import {
  createKnowledgeBaseEntry,
  createRandomId,
  getKnowledgeBaseSourceLabel,
  KnowledgeBase,
  KnowledgeDocument,
  KnowledgeDocumentChunks,
  KnowledgeDocumentVectorization,
  readKnowledgeBaseStorage,
  SelectedDocumentState,
  touchKnowledgeBase,
  TreeNode,
  updateKnowledgeBaseTimestamp,
  writeKnowledgeBaseStorage,
} from "@/lib/knowledge-base";
import {
  buildDocumentChunkId,
  createKnowledgeDocumentChunks,
  extractPlainTextFromHtml,
} from "@/lib/knowledge-document";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

const formatSummaryTimestamp = (value?: string) => {
  if (!value) {
    return "только что";
  }

  try {
    return new Intl.DateTimeFormat("ru-RU", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value));
  } catch (error) {
    return "только что";
  }
};

const addChildNode = (
  nodes: TreeNode[],
  parentId: string | null,
  newNode: TreeNode
): TreeNode[] => {
  if (parentId === null) {
    return [...nodes, newNode];
  }

  return nodes.map((node) => {
    if (node.id === parentId) {
      const children = node.children ? [...node.children, newNode] : [newNode];
      return { ...node, children };
    }

    if (node.children) {
      return { ...node, children: addChildNode(node.children, parentId, newNode) };
    }

    return node;
  });
};

const updateNodeTitle = (
  nodes: TreeNode[],
  nodeId: string,
  title: string
): TreeNode[] =>
  nodes.map((node) => {
    if (node.id === nodeId) {
      return { ...node, title };
    }

    if (node.children) {
      return { ...node, children: updateNodeTitle(node.children, nodeId, title) };
    }

    return node;
  });

type NodeCreationState = {
  parentId: string | null;
  type: "folder" | "document";
};

interface TreeProps {
  nodes: TreeNode[];
  onAddFolder: (parentId: string | null) => void;
  onAddDocument: (parentId: string | null) => void;
  onSelectDocument: (documentId: string) => void;
  selectedDocumentId?: string;
  expandedNodes: Record<string, boolean>;
  onToggleNode: (nodeId: string) => void;
  level?: number;
}

type KnowledgeBasePageProps = {
  params?: {
    knowledgeBaseId?: string;
  };
};

type DocumentTabKey = "document" | "chunks" | "vectors";


function TreeView({
  nodes,
  onAddFolder,
  onAddDocument,
  onSelectDocument,
  selectedDocumentId,
  expandedNodes,
  onToggleNode,
  level = 0,
}: TreeProps) {
  return (
    <ul className={cn("space-y-1 text-sm", level > 0 && "border-l border-border/60 pl-3")}> 
      {nodes.map((node) => {
        const isFolder = node.type === "folder";
        const hasChildren = Boolean(node.children && node.children.length > 0);
        const isExpanded = !isFolder || expandedNodes[node.id] !== false;
        const isSelected =
          node.type === "document" && node.documentId === selectedDocumentId;

        return (
          <li key={node.id} className="group rounded-md">
            <div
              className={cn(
                "flex items-center gap-2 rounded-md px-2 py-1 transition",
                isSelected && "bg-primary/10 text-primary",
                !isSelected && "hover:bg-muted"
              )}
            >
              {isFolder ? (
                <button
                  type="button"
                  onClick={() => onToggleNode(node.id)}
                  className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition hover:bg-muted-foreground/10"
                  aria-label={isExpanded ? "Свернуть раздел" : "Развернуть раздел"}
                >
                  {isExpanded ? (
                    <ChevronDown className="h-4 w-4" />
                  ) : (
                    <ChevronRight className="h-4 w-4" />
                  )}
                </button>
              ) : (
                <span className="h-6 w-6" />
              )}

              <button
                type="button"
                className="flex flex-1 items-center gap-2 text-left"
                onClick={() => {
                  if (node.type === "document" && node.documentId) {
                    onSelectDocument(node.documentId);
                  } else if (node.type === "folder") {
                    onToggleNode(node.id);
                  }
                }}
              >
                {node.type === "folder" ? (
                  isExpanded ? (
                    <FolderOpen className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <FolderClosed className="h-4 w-4 text-muted-foreground" />
                  )
                ) : (
                  <FileText className="h-4 w-4 text-muted-foreground" />
                )}
                <span className="font-medium leading-none">{node.title}</span>
              </button>

              {isFolder && (
                <div className="ml-auto hidden items-center gap-1 group-hover:flex">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => onAddFolder(node.id)}
                    title="Добавить подраздел"
                  >
                    <FolderPlus className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => onAddDocument(node.id)}
                    title="Добавить документ"
                  >
                    <FilePlus className="h-4 w-4" />
                  </Button>
                </div>
              )}
            </div>

            {hasChildren && isExpanded && (
              <TreeView
                nodes={node.children ?? []}
                onAddFolder={onAddFolder}
                onAddDocument={onAddDocument}
                onSelectDocument={onSelectDocument}
                selectedDocumentId={selectedDocumentId}
                expandedNodes={expandedNodes}
                onToggleNode={onToggleNode}
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
  const routeBaseId = params?.knowledgeBaseId ?? null;
  const hasHydratedFromStorageRef = useRef(false);
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBase[]>([]);
  const [selectedBaseId, setSelectedBaseId] = useState<string | null>(null);
  const [selectedDocument, setSelectedDocument] = useState<SelectedDocumentState | null>(
    null
  );
  const [isCreateBaseOpen, setIsCreateBaseOpen] = useState(false);
  const [newBaseName, setNewBaseName] = useState("");
  const [newBaseDescription, setNewBaseDescription] = useState("");
  const [nodeCreation, setNodeCreation] = useState<NodeCreationState | null>(null);
  const [isNodeDialogOpen, setIsNodeDialogOpen] = useState(false);
  const [nodeTitle, setNodeTitle] = useState("");
  const [isEditing, setIsEditing] = useState(false);
  const [draftContent, setDraftContent] = useState("");
  const [expandedNodes, setExpandedNodes] = useState<Record<string, boolean>>({});
  const [documentTab, setDocumentTab] = useState<DocumentTabKey>("document");
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isImportingDocument, setIsImportingDocument] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const lastVisitedBaseRef = useRef<string | null>(null);

  const { data: embeddingServices } = useQuery<{ providers: PublicEmbeddingProvider[] }>({
    queryKey: ["/api/embedding/services"],
  });

  const activeEmbeddingProviders = useMemo(
    () => (embeddingServices?.providers ?? []).filter((provider) => provider.isActive),
    [embeddingServices],
  );

  const selectedBase = useMemo(
    () => knowledgeBases.find((base) => base.id === selectedBaseId) ?? null,
    [knowledgeBases, selectedBaseId]
  );

  const currentDocument = useMemo(() => {
    if (!selectedBase || !selectedDocument) {
      return null;
    }

    if (selectedDocument.baseId !== selectedBase.id) {
      return null;
    }

    return selectedBase.documents[selectedDocument.documentId] ?? null;
  }, [selectedBase, selectedDocument]);

  useEffect(() => {
    if (!selectedBase) {
      return;
    }

    if (lastVisitedBaseRef.current === selectedBase.id) {
      return;
    }

    lastVisitedBaseRef.current = selectedBase.id;
    const now = new Date();

    setKnowledgeBases((prev) =>
      prev.map((base) => (base.id === selectedBase.id ? touchKnowledgeBase(base, now) : base))
    );
  }, [selectedBase?.id]);

  useEffect(() => {
    const stored = readKnowledgeBaseStorage();
    setKnowledgeBases(stored.knowledgeBases);
    setSelectedBaseId(stored.selectedBaseId);
    setSelectedDocument(stored.selectedDocument);
    hasHydratedFromStorageRef.current = true;
  }, []);

  useEffect(() => {
    if (!hasHydratedFromStorageRef.current) {
      return;
    }

    if (!routeBaseId) {
      return;
    }

    const exists = knowledgeBases.some((base) => base.id === routeBaseId);
    if (exists) {
      setSelectedBaseId(routeBaseId);
    }
  }, [routeBaseId, knowledgeBases]);

  useEffect(() => {
    if (typeof window === "undefined" || !hasHydratedFromStorageRef.current) {
      return;
    }

    try {
      const persistedSelectedDocument = selectedDocument
        ? (() => {
            const relatedBase = knowledgeBases.find(
              (base) => base.id === selectedDocument.baseId
            );
            if (!relatedBase) {
              return null;
            }

            if (!(selectedDocument.documentId in relatedBase.documents)) {
              return null;
            }

            return selectedDocument;
          })()
        : null;

      const payload = {
        knowledgeBases,
        selectedBaseId,
        selectedDocument: persistedSelectedDocument,
      };

      writeKnowledgeBaseStorage(payload);
    } catch (error) {
      console.error("Не удалось сохранить базы знаний в localStorage", error);
    }
  }, [knowledgeBases, selectedBaseId, selectedDocument]);

  useEffect(() => {
    if (!selectedBase) {
      setExpandedNodes({});
      return;
    }

    setExpandedNodes((previous) => {
      const next = { ...previous };

      const ensureFolders = (nodes: TreeNode[]) => {
        nodes.forEach((node) => {
          if (node.type === "folder") {
            if (!(node.id in next)) {
              next[node.id] = true;
            }

            if (node.children && node.children.length > 0) {
              ensureFolders(node.children);
            }
          }
        });
      };

      ensureFolders(selectedBase.structure);
      return next;
    });
  }, [selectedBase]);

  useEffect(() => {
    if (currentDocument) {
      setDraftContent(currentDocument.content);
      setIsEditing(false);
    } else {
      setDraftContent("");
      setIsEditing(false);
    }
    setDocumentTab("document");
  }, [currentDocument?.id]);

  const handleCreateKnowledgeBase = () => {
    if (!newBaseName.trim()) {
      return;
    }

    const base = createKnowledgeBaseEntry({
      name: newBaseName.trim(),
      description: newBaseDescription.trim(),
      sourceType: "blank",
    });

    setKnowledgeBases((prev) => [...prev, base]);
    setSelectedBaseId(base.id);
    setLocation(`/knowledge/${base.id}`);
    setSelectedDocument(null);
    setExpandedNodes({});
    setNewBaseName("");
    setNewBaseDescription("");
    setIsCreateBaseOpen(false);
  };

  const openNodeDialog = (type: "folder" | "document", parentId: string | null) => {
    if (!selectedBase) {
      return;
    }

    setNodeCreation({ type, parentId });
    setNodeTitle("");
    setImportError(null);
    setIsImportingDocument(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
    setIsNodeDialogOpen(true);
  };

  const finalizeNodeDialog = () => {
    setNodeCreation(null);
    setNodeTitle("");
    setIsNodeDialogOpen(false);
    setImportError(null);
    setIsImportingDocument(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const regenerateDocumentChunks = (
    html: string,
    documentId: string,
    sourceChunks: KnowledgeDocumentChunks,
  ): KnowledgeDocumentChunks | null => {
    const safeSize = Math.max(200, Math.min(8000, Math.round(sourceChunks.chunkSize)));
    const safeOverlap = Math.max(
      0,
      Math.min(Math.round(sourceChunks.chunkOverlap), safeSize - 1, 4000),
    );
    const { chunks } = createKnowledgeDocumentChunks(html, safeSize, safeOverlap, {
      idPrefix: documentId,
    });

    if (chunks.length === 0) {
      return null;
    }

    const items = chunks.map((chunk, index) => ({
      ...chunk,
      id: sourceChunks.items[index]?.id ?? chunk.id ?? buildDocumentChunkId(documentId, index),
    }));

    return {
      chunkSize: safeSize,
      chunkOverlap: safeOverlap,
      generatedAt: new Date().toISOString(),
      items,
    };
  };

  const createDocumentEntry = (
    title: string,
    content: string,
    parentId: string | null
  ) => {
    if (!selectedBase) {
      return;
    }

    const documentId = createRandomId();
    const now = new Date();
    const nowIso = now.toISOString();
    const sanitizedContent = getSanitizedContent(content);
    const resolvedTitle = extractTitleFromContent(sanitizedContent) || title;

    const documentNode: TreeNode = {
      id: documentId,
      title: resolvedTitle,
      type: "document",
      documentId,
    };

    const knowledgeDocument: KnowledgeDocument = {
      id: documentId,
      title: resolvedTitle,
      content: sanitizedContent,
      updatedAt: nowIso,
      vectorization: null,
      chunks: null,
    };

    setKnowledgeBases((prev) =>
      prev.map((base) =>
        base.id === selectedBase.id
          ? updateKnowledgeBaseTimestamp(
              {
                ...base,
                structure: addChildNode(base.structure, parentId, documentNode),
                documents: {
                  ...base.documents,
                  [documentId]: knowledgeDocument,
                },
              },
              now
            )
          : base
      )
    );

    setSelectedDocument({ baseId: selectedBase.id, documentId });
    if (parentId) {
      setExpandedNodes((prev) => ({
        ...prev,
        [parentId]: true,
      }));
    }
  };

  const handleCreateNode = () => {
    if (!selectedBase || !nodeCreation) {
      return;
    }

    if (nodeCreation.type === "folder") {
      if (!nodeTitle.trim()) {
        return;
      }
      const folderNode: TreeNode = {
        id: createRandomId(),
        title: nodeTitle.trim(),
        type: "folder",
        children: [],
      };

      const now = new Date();
      setKnowledgeBases((prev) =>
        prev.map((base) =>
          base.id === selectedBase.id
            ? updateKnowledgeBaseTimestamp(
                {
                  ...base,
                  structure: addChildNode(base.structure, nodeCreation.parentId, folderNode),
                },
                now
              )
            : base
        )
      );

      setExpandedNodes((prev) => ({
        ...prev,
        [folderNode.id]: true,
        ...(nodeCreation.parentId ? { [nodeCreation.parentId]: true } : {}),
      }));
    }

    if (nodeCreation.type === "document") {
      if (!nodeTitle.trim()) {
        return;
      }

      const documentTitle = nodeTitle.trim();
      const initialContent = `<h1>${escapeHtml(documentTitle)}</h1>`;
      createDocumentEntry(documentTitle, initialContent, nodeCreation.parentId);
    }

    finalizeNodeDialog();
  };

  const handleImportDocumentClick = () => {
    if (isImportingDocument) {
      return;
    }

    setImportError(null);
    fileInputRef.current?.click();
  };

  const handleFileInputChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    if (!selectedBase || !nodeCreation || nodeCreation.type !== "document") {
      event.target.value = "";
      setImportError("Сначала выберите, где создать документ.");
      return;
    }

    setIsImportingDocument(true);
    setImportError(null);

    try {
      const { title, html } = await convertFileToHtml(file);
      createDocumentEntry(title, html, nodeCreation.parentId);
      finalizeNodeDialog();
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Не удалось импортировать файл. Попробуйте снова.";
      setImportError(message);
    } finally {
      setIsImportingDocument(false);
      event.target.value = "";
    }
  };

  const handleSelectDocument = (documentId: string) => {
    if (!selectedBase) {
      return;
    }

    setSelectedDocument({ baseId: selectedBase.id, documentId });
  };

  const handleSaveDocument = () => {
    if (!selectedBase || !currentDocument || !selectedDocument) {
      return;
    }

    const sanitizedContent = getSanitizedContent(draftContent);
    const nextTitle = extractTitleFromContent(sanitizedContent);
    const now = new Date();
    const currentChunks = currentDocument.chunks;
    const hasText = extractPlainTextFromHtml(sanitizedContent).trim().length > 0;
    const regeneratedChunks =
      currentChunks && hasText
        ? regenerateDocumentChunks(sanitizedContent, currentDocument.id, currentChunks)
        : null;
    const nextChunks = hasText ? regeneratedChunks ?? currentChunks : null;

    setKnowledgeBases((prev) =>
      prev.map((base) => {
        if (base.id !== selectedBase.id) {
          return base;
        }

        const updatedDocument: KnowledgeDocument = {
          ...currentDocument,
          title: nextTitle,
          content: sanitizedContent,
          updatedAt: now.toISOString(),
          chunks: nextChunks,
          vectorization: nextChunks ? currentDocument.vectorization : null,
        };

        return updateKnowledgeBaseTimestamp(
          {
            ...base,
            documents: {
              ...base.documents,
              [currentDocument.id]: updatedDocument,
            },
            structure: updateNodeTitle(
              base.structure,
              currentDocument.id,
              updatedDocument.title
            ),
          },
          now
        );
      })
    );

    setIsEditing(false);
  };

  const handleChunkUpdated = (updatedHtml: string) => {
    setDraftContent(updatedHtml);
    setIsEditing(true);
    setDocumentTab("document");

    if (!selectedBase || !currentDocument || !currentDocument.chunks) {
      return;
    }

    const hasText = extractPlainTextFromHtml(updatedHtml).trim().length > 0;
    const recomputedChunks = hasText
      ? regenerateDocumentChunks(updatedHtml, currentDocument.id, currentDocument.chunks)
      : null;
    const nextChunks = hasText ? recomputedChunks ?? currentDocument.chunks : null;
    const now = new Date();

    setKnowledgeBases((prev) =>
      prev.map((base) => {
        if (base.id !== selectedBase.id) {
          return base;
        }

        const existingDocument = base.documents[currentDocument.id];
        if (!existingDocument) {
          return base;
        }

        return updateKnowledgeBaseTimestamp(
          {
            ...base,
            documents: {
              ...base.documents,
              [currentDocument.id]: {
                ...existingDocument,
                chunks: nextChunks,
                vectorization: nextChunks ? existingDocument.vectorization : null,
              },
            },
          },
          now,
        );
      }),
    );
  };

  const handleChunksSaved = (chunks: KnowledgeDocumentChunks) => {
    if (!selectedBase || !currentDocument) {
      return;
    }

    const generatedAtDate = new Date(chunks.generatedAt);

    setKnowledgeBases((prev) =>
      prev.map((base) => {
        if (base.id !== selectedBase.id) {
          return base;
        }

        const existingDocument = base.documents[currentDocument.id];
        if (!existingDocument) {
          return base;
        }

        return updateKnowledgeBaseTimestamp(
          {
            ...base,
            documents: {
              ...base.documents,
              [currentDocument.id]: {
                ...existingDocument,
                chunks,
                vectorization: null,
              },
            },
          },
          Number.isNaN(generatedAtDate.getTime()) ? new Date() : generatedAtDate,
        );
      }),
    );
  };

  const handleChunksCleared = () => {
    if (!selectedBase || !currentDocument) {
      return;
    }

    const now = new Date();

    setKnowledgeBases((prev) =>
      prev.map((base) => {
        if (base.id !== selectedBase.id) {
          return base;
        }

        const existingDocument = base.documents[currentDocument.id];
        if (!existingDocument) {
          return base;
        }

        return updateKnowledgeBaseTimestamp(
          {
            ...base,
            documents: {
              ...base.documents,
              [currentDocument.id]: {
                ...existingDocument,
                chunks: null,
                vectorization: null,
              },
            },
          },
          now,
        );
      }),
    );
  };

  const handleDocumentVectorized = (
    documentId: string,
    vectorization: KnowledgeDocumentVectorization,
  ) => {
    if (!selectedBase) {
      return;
    }

    const vectorizedAtDate = new Date(vectorization.vectorizedAt);

    setKnowledgeBases((prev) =>
      prev.map((base) => {
        if (base.id !== selectedBase.id) {
          return base;
        }

        const existingDocument = base.documents[documentId];
        if (!existingDocument) {
          return base;
        }

        return updateKnowledgeBaseTimestamp(
          {
            ...base,
            documents: {
              ...base.documents,
              [documentId]: {
                ...existingDocument,
                vectorization,
              },
            },
          },
          Number.isNaN(vectorizedAtDate.getTime()) ? new Date() : vectorizedAtDate,
        );
      }),
    );
  };

  const computedTitle = isEditing
    ? extractTitleFromContent(getSanitizedContent(draftContent))
    : extractTitleFromContent(getSanitizedContent(currentDocument?.content ?? ""));

  const totalDocuments = selectedBase
    ? Object.values(selectedBase.documents).length
    : 0;
  const tasksSummary = selectedBase?.tasks ?? { total: 0, inProgress: 0, completed: 0 };
  const importSummary = selectedBase?.importSummary;
  const hasImportErrors = Boolean(importSummary && importSummary.skippedFiles > 0 && importSummary.errors.length > 0);
  const displayedImportErrors = importSummary ? importSummary.errors.slice(0, 3) : [];

  const handleToggleNode = (nodeId: string) => {
    setExpandedNodes((prev) => ({
      ...prev,
      [nodeId]: !(prev[nodeId] ?? true),
    }));
  };

  const handleBackToList = () => {
    setSelectedBaseId(null);
    setSelectedDocument(null);
    setExpandedNodes({});
    setLocation("/knowledge");
  };

  return (
    <>
      <div className="flex h-full flex-col gap-4 px-4 py-4 lg:px-5 lg:py-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">
              {selectedBase ? selectedBase.name : "Базы знаний"}
            </h1>
            <p className="text-muted-foreground">
              {selectedBase
                ? selectedBase.description ||
                  "Управляйте структурой базы знаний, поддерживайте документы и задания в актуальном состоянии."
                : "Выберите базу знаний или создайте новую, чтобы начать структурировать контент рабочего пространства."}
            </p>
            {selectedBase && (
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <Badge className="border-dashed px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide" variant="outline">
                  {getKnowledgeBaseSourceLabel(selectedBase.sourceType)}
                </Badge>
                {selectedBase.ingestion?.seedUrl && (
                  <span className="truncate">Источник: {selectedBase.ingestion.seedUrl}</span>
                )}
                {selectedBase.ingestion?.archiveName && (
                  <span className="truncate">Архив: {selectedBase.ingestion.archiveName}</span>
                )}
              </div>
            )}
            {selectedBase?.sourceType === "archive" && importSummary && (
              <Alert
                variant={hasImportErrors ? "destructive" : "default"}
                className="mt-3 max-w-2xl"
              >
                <AlertTitle>Импорт архива завершён</AlertTitle>
                <AlertDescription>
                  <div className="space-y-2 text-xs sm:text-sm">
                    <p>
                      Импортировано {importSummary.importedFiles} из {importSummary.totalFiles} файлов.
                      {importSummary.skippedFiles > 0
                        ? ` Пропущено ${importSummary.skippedFiles}.`
                        : ""}
                    </p>
                    <p className="text-muted-foreground">
                      Завершено: {formatSummaryTimestamp(importSummary.completedAt)}
                    </p>
                    {hasImportErrors && (
                      <div className="space-y-1 text-sm">
                        <p className="font-medium text-destructive">Ошибки импорта:</p>
                        <ul className="list-disc space-y-1 pl-4 text-destructive">
                          {displayedImportErrors.map((error) => (
                            <li key={`${error.code}-${error.path}`}>
                              <span className="font-semibold">{error.path}</span> — {error.message}
                            </li>
                          ))}
                        </ul>
                        {importSummary.errors.length > displayedImportErrors.length && (
                          <p className="text-xs text-muted-foreground">
                            Ещё {importSummary.errors.length - displayedImportErrors.length} ошибок скрыто.
                          </p>
                        )}
                        <p className="text-xs text-muted-foreground">
                          Повторите обработку проблемных файлов вручную или обновите архив и выполните импорт заново.
                        </p>
                      </div>
                    )}
                  </div>
                </AlertDescription>
              </Alert>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {selectedBase && (
              <Button variant="outline" onClick={handleBackToList}>
                <ChevronLeft className="mr-2 h-4 w-4" />
                Все базы знаний
              </Button>
            )}
            <Dialog open={isCreateBaseOpen} onOpenChange={setIsCreateBaseOpen}>
              <DialogTrigger asChild>
                <Button>
                  <PlusCircle className="mr-2 h-4 w-4" />
                  Создать базу
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Новая база знаний</DialogTitle>
                  <DialogDescription>
                    Укажите название и описание, чтобы запустить наполнение корпоративной базы знаний.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-2">
                  <div className="space-y-2">
                    <label className="text-sm font-medium" htmlFor="knowledge-name">
                      Название
                    </label>
                    <Input
                      id="knowledge-name"
                      value={newBaseName}
                      onChange={(event) => setNewBaseName(event.target.value)}
                      placeholder="Например, Знания по продукту"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium" htmlFor="knowledge-description">
                      Описание
                    </label>
                    <Textarea
                      id="knowledge-description"
                      value={newBaseDescription}
                      onChange={(event) => setNewBaseDescription(event.target.value)}
                      placeholder="Опишите назначение базы знаний"
                      rows={4}
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button onClick={handleCreateKnowledgeBase}>Создать</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </div>

      {!selectedBase ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-6">
          <Card className="w-full max-w-4xl">
            <CardHeader className="space-y-3 px-5 py-4">
              <CardTitle className="flex items-center gap-2 text-lg">
                <Library className="h-5 w-5" />
                Выберите базу знаний
              </CardTitle>
              <CardDescription>
                Работайте с документами и заданиями, выбрав одну из существующих баз знаний или создайте новую.
              </CardDescription>
            </CardHeader>
            <CardContent className="px-5 pb-5">
              {knowledgeBases.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-3 py-8 text-center text-sm text-muted-foreground">
                  <Library className="h-10 w-10" />
                  <p>Пока что у вас нет баз знаний. Создайте первую, чтобы начать работу с контентом.</p>
                </div>
              ) : (
                <ScrollArea className="max-h-[26rem] pr-3">
                  <div className="grid gap-3 sm:grid-cols-2">
                    {knowledgeBases.map((base) => {
                      const documentCount = Object.keys(base.documents).length;

                      return (
                        <button
                          key={base.id}
                          type="button"
                          onClick={() => {
                            setSelectedBaseId(base.id);
                            setSelectedDocument(null);
                            setLocation(`/knowledge/${base.id}`);
                          }}
                          className="flex h-full flex-col rounded-lg border bg-card p-3.5 text-left transition hover:border-primary/70 hover:shadow-sm"
                        >
                          <h3 className="text-base font-semibold">{base.name}</h3>
                          {base.description && (
                            <p className="mt-2 line-clamp-3 text-sm text-muted-foreground">
                              {base.description}
                            </p>
                          )}
                          <span className="mt-4 text-xs text-muted-foreground">
                            Документов: {documentCount}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </ScrollArea>
              )}
            </CardContent>
          </Card>
        </div>
      ) : (
        <div className="flex flex-1 flex-col gap-4 lg:flex-row">
          <Card className="w-full lg:w-96">
            <CardHeader className="space-y-3 px-5 py-4">
              <CardTitle className="text-lg">Структура базы знаний</CardTitle>
              <CardDescription>
                Управляйте иерархией документов с помощью древовидной навигации.
              </CardDescription>
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span>Документов: {totalDocuments}</span>
                <span className="text-xs font-medium text-amber-600 dark:text-amber-400">
                  В работе: {tasksSummary.inProgress}
                </span>
                <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
                  Завершено: {tasksSummary.completed}
                </span>
                <span>Всего заданий: {tasksSummary.total}</span>
              </div>
              <div className="flex flex-wrap items-center gap-2 pt-2">
                <Button size="sm" onClick={() => openNodeDialog("folder", null)}>
                  <FolderPlus className="mr-2 h-4 w-4" />
                  Раздел
                </Button>
                <Button size="sm" variant="outline" onClick={() => openNodeDialog("document", null)}>
                  <FilePlus className="mr-2 h-4 w-4" />
                  Документ
                </Button>
              </div>
            </CardHeader>
            <CardContent className="px-5 pb-5">
              {selectedBase.structure.length > 0 ? (
                <ScrollArea className="h-[26rem] pr-3">
                  <TreeView
                    nodes={selectedBase.structure}
                    onAddFolder={(parentId) => openNodeDialog("folder", parentId)}
                    onAddDocument={(parentId) => openNodeDialog("document", parentId)}
                    onSelectDocument={handleSelectDocument}
                    selectedDocumentId={selectedDocument?.documentId}
                    expandedNodes={expandedNodes}
                    onToggleNode={handleToggleNode}
                  />
                </ScrollArea>
              ) : (
                <div className="flex flex-col items-center justify-center gap-3 py-8 text-center text-sm text-muted-foreground">
                  <Library className="h-10 w-10" />
                  <p>Добавьте первый раздел или документ, чтобы построить структуру базы знаний.</p>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="flex-1">
            <CardHeader className="space-y-3 px-5 py-4">
              <CardTitle className="text-lg">Документ</CardTitle>
              <CardDescription>
                Создавайте и редактируйте материалы через визуальный редактор с заголовком внутри документа.
              </CardDescription>
            </CardHeader>
            <Separator />
            <CardContent className="h-full px-5 pb-5">
              {currentDocument ? (
                <div className="flex h-full flex-col gap-4">
                  <h2 className="text-xl font-semibold">
                    {computedTitle || "Без названия"}
                  </h2>

                  <Tabs
                    value={documentTab}
                    onValueChange={(value) => setDocumentTab(value as DocumentTabKey)}
                    className="flex h-full flex-col"
                  >
                    <TabsList className="w-full justify-start">
                      <TabsTrigger value="document">Документ</TabsTrigger>
                      <TabsTrigger value="chunks">Чанки</TabsTrigger>
                      <TabsTrigger
                        value="vectors"
                        disabled={
                          !currentDocument.vectorization ||
                          currentDocument.vectorization.recordIds.length === 0
                        }
                      >
                        Векторные записи
                      </TabsTrigger>
                    </TabsList>

                    <TabsContent value="document" className="flex-1 focus-visible:outline-none">
                      <div className="flex h-full flex-col gap-4">
                        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                          <span>
                            Последнее сохранение: {new Date(currentDocument.updatedAt).toLocaleString()}
                          </span>
                          <div className="flex flex-wrap items-center gap-2">
                            {currentDocument.vectorization ? (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Badge className="bg-emerald-100 text-emerald-900 hover:bg-emerald-100 dark:bg-emerald-500/20 dark:text-emerald-200">
                                    Векторизован
                                  </Badge>
                                </TooltipTrigger>
                                <TooltipContent className="max-w-xs text-xs leading-relaxed">
                                  <div className="space-y-1">
                                    <p className="font-medium text-foreground">
                                      Коллекция: <code>{currentDocument.vectorization.collectionName}</code>
                                    </p>
                                    <p>Записей: {currentDocument.vectorization.pointsCount.toLocaleString("ru-RU")}</p>
                                    <p>
                                      Обновлено: {formatSummaryTimestamp(currentDocument.vectorization.vectorizedAt)}
                                    </p>
                                  </div>
                                </TooltipContent>
                              </Tooltip>
                            ) : (
                              <Badge className="border border-dashed border-muted-foreground/60 bg-background text-muted-foreground">
                                Не векторизован
                              </Badge>
                            )}
                            <VectorizeKnowledgeDocumentDialog
                              document={{
                                id: currentDocument.id,
                                title: computedTitle || currentDocument.title || "Без названия",
                                content: draftContent,
                                updatedAt: currentDocument.updatedAt,
                                vectorization: currentDocument.vectorization,
                              }}
                              base={
                                selectedBase
                                  ? {
                                      id: selectedBase.id,
                                      name: selectedBase.name,
                                      description: selectedBase.description,
                                    }
                                  : null
                              }
                              providers={activeEmbeddingProviders}
                              onVectorizationComplete={({ documentId, vectorization }) =>
                                handleDocumentVectorized(documentId, vectorization)
                              }
                            />
                            {isEditing ? (
                              <>
                                <Button size="sm" onClick={handleSaveDocument}>
                                  Сохранить изменения
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => {
                                    setIsEditing(false);
                                    setDraftContent(currentDocument.content);
                                  }}
                                >
                                  Отмена
                                </Button>
                              </>
                            ) : (
                              <Button size="sm" variant="outline" onClick={() => setIsEditing(true)}>
                                Редактировать
                              </Button>
                            )}
                          </div>
                        </div>

                        {currentDocument.vectorization && (
                          <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-4 text-xs text-emerald-900 dark:bg-emerald-500/10 dark:text-emerald-100">
                            <div className="flex flex-wrap items-center gap-3 text-sm">
                              <span className="font-semibold text-emerald-900 dark:text-emerald-200">
                                Документ векторизован
                              </span>
                              <span>
                                Коллекция: <code>{currentDocument.vectorization.collectionName}</code>
                              </span>
                              <span>
                                Записей: {currentDocument.vectorization.pointsCount.toLocaleString("ru-RU")}
                              </span>
                              <span>
                                Чанк: {currentDocument.vectorization.chunkSize.toLocaleString("ru-RU")} символов,
                                перехлёст {currentDocument.vectorization.chunkOverlap.toLocaleString("ru-RU")}
                              </span>
                              {currentDocument.vectorization.vectorSize && (
                                <span>
                                  Размер вектора: {currentDocument.vectorization.vectorSize.toLocaleString("ru-RU")}
                                </span>
                              )}
                            </div>
                            <div className="mt-3 space-y-1">
                              <p className="text-[11px] uppercase tracking-wide text-emerald-800 dark:text-emerald-300">
                                Идентификаторы записей
                              </p>
                              <ScrollArea className="max-h-28 rounded-md border border-emerald-500/30 bg-background/90 p-2">
                                <pre className="whitespace-pre-wrap break-all font-mono text-[11px] leading-snug text-emerald-900 dark:text-emerald-100">
                                  {currentDocument.vectorization.recordIds.length > 0
                                    ? currentDocument.vectorization.recordIds.join("\n")
                                    : "—"}
                                </pre>
                              </ScrollArea>
                            </div>
                          </div>
                        )}

                        <div className="min-h-[20rem] flex-1 rounded-lg border bg-muted/30 p-3.5">
                          {isEditing ? (
                            <DocumentEditor value={draftContent} onChange={setDraftContent} />
                          ) : draftContent ? (
                            <ScrollArea className="h-full pr-3">
                              <div
                                className="prose prose-sm max-w-none dark:prose-invert"
                                dangerouslySetInnerHTML={{
                                  __html: getSanitizedContent(currentDocument.content),
                                }}
                              />
                            </ScrollArea>
                          ) : (
                            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                              Документ пока пуст. Включите режим редактирования, чтобы добавить контент.
                            </div>
                          )}
                        </div>
                      </div>
                    </TabsContent>

                    <TabsContent value="chunks" className="flex-1 focus-visible:outline-none">
                      <DocumentChunksTab
                        documentId={currentDocument.id}
                        contentHtml={draftContent}
                        storedChunks={currentDocument.chunks ?? null}
                        onChunksSaved={handleChunksSaved}
                        onChunksCleared={handleChunksCleared}
                        onChunkUpdated={handleChunkUpdated}
                        onSwitchToDocumentTab={() => setDocumentTab("document")}
                      />
                    </TabsContent>

                    <TabsContent value="vectors" className="flex-1 focus-visible:outline-none">
                      <DocumentVectorRecordsTab
                        collectionName={currentDocument.vectorization?.collectionName ?? ""}
                        recordIds={currentDocument.vectorization?.recordIds ?? []}
                        documentId={currentDocument.id}
                      />
                    </TabsContent>
                  </Tabs>
                </div>
              ) : (
                <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-sm text-muted-foreground">
                  <SquarePen className="h-10 w-10" />
                  <p>Выберите документ в структуре базы знаний или создайте новый.</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
    <Dialog open={isNodeDialogOpen} onOpenChange={setIsNodeDialogOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {nodeCreation?.type === "folder" ? "Новый раздел" : "Новый документ"}
          </DialogTitle>
          <DialogDescription>
            {nodeCreation?.type === "folder"
              ? "Создайте раздел, чтобы сгруппировать документы или подкатегории."
              : "Создайте документ с пустым содержимым или импортируйте материал из файла и начните работу в визуальном редакторе."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="node-title">
            Название
          </label>
          <Input
            id="node-title"
            autoFocus
            value={nodeTitle}
            onChange={(event) => setNodeTitle(event.target.value)}
            placeholder={
              nodeCreation?.type === "folder"
                ? "Например, Раздел по продукту"
                : "Например, Инструкция для команды"
            }
          />
        </div>
        {nodeCreation?.type === "document" && (
          <input
            ref={fileInputRef}
            type="file"
            accept=".txt,.pdf,.doc,.docx"
            className="hidden"
            onChange={handleFileInputChange}
          />
        )}
        {importError && (
          <p className="text-sm text-destructive">{importError}</p>
        )}
        <DialogFooter className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          {nodeCreation?.type === "document" && (
            <Button
              type="button"
              variant="outline"
              onClick={handleImportDocumentClick}
              disabled={isImportingDocument}
            >
              {isImportingDocument ? "Импортируем..." : "Импортировать из файла"}
            </Button>
          )}
          <Button
            onClick={handleCreateNode}
            disabled={isImportingDocument || !nodeTitle.trim()}
          >
            {isImportingDocument ? "Подождите..." : "Создать"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
}
