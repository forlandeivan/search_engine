import { useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
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

type TreeNode = {
  id: string;
  title: string;
  type: "folder" | "document";
  children?: TreeNode[];
  documentId?: string;
};

type KnowledgeDocument = {
  id: string;
  title: string;
  content: string;
  updatedAt: string;
};

type KnowledgeBase = {
  id: string;
  name: string;
  description: string;
  structure: TreeNode[];
  documents: Record<string, KnowledgeDocument>;
};

const createId = () => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return Math.random().toString(36).slice(2, 10);
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

type SelectedDocumentState = {
  baseId: string;
  documentId: string;
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

export default function KnowledgeBasePage() {
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
  const [draftTitle, setDraftTitle] = useState("");
  const [draftContent, setDraftContent] = useState("");
  const [expandedNodes, setExpandedNodes] = useState<Record<string, boolean>>({});

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
      setDraftTitle(currentDocument.title);
      setDraftContent(currentDocument.content);
      setIsEditing(false);
    } else {
      setDraftTitle("");
      setDraftContent("");
      setIsEditing(false);
    }
  }, [currentDocument?.id]);

  const handleCreateKnowledgeBase = () => {
    if (!newBaseName.trim()) {
      return;
    }

    const id = createId();
    const base: KnowledgeBase = {
      id,
      name: newBaseName.trim(),
      description: newBaseDescription.trim(),
      structure: [],
      documents: {},
    };

    setKnowledgeBases((prev) => [...prev, base]);
    setSelectedBaseId(id);
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
    setIsNodeDialogOpen(true);
  };

  const handleCreateNode = () => {
    if (!selectedBase || !nodeCreation || !nodeTitle.trim()) {
      return;
    }

    if (nodeCreation.type === "folder") {
      const folderNode: TreeNode = {
        id: createId(),
        title: nodeTitle.trim(),
        type: "folder",
        children: [],
      };

      setKnowledgeBases((prev) =>
        prev.map((base) =>
          base.id === selectedBase.id
            ? { ...base, structure: addChildNode(base.structure, nodeCreation.parentId, folderNode) }
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
      const documentId = createId();
      const now = new Date().toISOString();
      const documentTitle = nodeTitle.trim();

      const documentNode: TreeNode = {
        id: documentId,
        title: documentTitle,
        type: "document",
        documentId,
      };

      const knowledgeDocument: KnowledgeDocument = {
        id: documentId,
        title: documentTitle,
        content: "",
        updatedAt: now,
      };

      setKnowledgeBases((prev) =>
        prev.map((base) =>
          base.id === selectedBase.id
            ? {
                ...base,
                structure: addChildNode(base.structure, nodeCreation.parentId, documentNode),
                documents: {
                  ...base.documents,
                  [documentId]: knowledgeDocument,
                },
              }
            : base
        )
      );

      setSelectedDocument({ baseId: selectedBase.id, documentId });
      if (nodeCreation.parentId) {
        setExpandedNodes((prev) => ({
          ...prev,
          [nodeCreation.parentId as string]: true,
        }));
      }
    }

    setNodeCreation(null);
    setNodeTitle("");
    setIsNodeDialogOpen(false);
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

    setKnowledgeBases((prev) =>
      prev.map((base) => {
        if (base.id !== selectedBase.id) {
          return base;
        }

        const updatedDocument: KnowledgeDocument = {
          ...currentDocument,
          title: draftTitle.trim() || "Без названия",
          content: draftContent,
          updatedAt: new Date().toISOString(),
        };

        return {
          ...base,
          documents: {
            ...base.documents,
            [currentDocument.id]: updatedDocument,
          },
          structure: updateNodeTitle(base.structure, currentDocument.id, updatedDocument.title),
        };
      })
    );

    setIsEditing(false);
  };

  const totalDocuments = selectedBase
    ? Object.values(selectedBase.documents).length
    : 0;

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
  };

  return (
    <>
      <div className="flex h-full flex-col gap-6 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">
              {selectedBase ? selectedBase.name : "Загрузка знаний"}
            </h1>
            <p className="text-muted-foreground">
              {selectedBase
                ? selectedBase.description ||
                  "Управляйте структурой базы знаний и редактируйте документы."
                : "Выберите базу знаний или создайте новую, чтобы начать работу с документами."}
            </p>
          </div>
        <div className="flex flex-wrap items-center gap-2">
          {selectedBase && (
            <Button variant="outline" onClick={handleBackToList}>
              <ChevronLeft className="mr-2 h-4 w-4" />
              Список баз
            </Button>
          )}
          <Dialog open={isCreateBaseOpen} onOpenChange={setIsCreateBaseOpen}>
            <DialogTrigger asChild>
              <Button>
                <PlusCircle className="mr-2 h-4 w-4" />
                Создать базу знаний
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Новая база знаний</DialogTitle>
                <DialogDescription>
                  Укажите название и описание, чтобы начать структурирование знаний.
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
                    placeholder="Например, База по продукту"
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
                    placeholder="Кратко опишите назначение базы"
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
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Library className="h-5 w-5" />
                Выберите базу знаний
              </CardTitle>
              <CardDescription>
                Работайте с документами, выбрав одну из существующих баз или создайте новую.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {knowledgeBases.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-3 py-10 text-center text-sm text-muted-foreground">
                  <Library className="h-10 w-10" />
                  <p>Пока что у вас нет баз знаний. Создайте первую, чтобы начать работу с документами.</p>
                </div>
              ) : (
                <ScrollArea className="max-h-[28rem] pr-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    {knowledgeBases.map((base) => {
                      const documentCount = Object.keys(base.documents).length;

                      return (
                        <button
                          key={base.id}
                          type="button"
                          onClick={() => {
                            setSelectedBaseId(base.id);
                            setSelectedDocument(null);
                          }}
                          className="flex h-full flex-col rounded-lg border bg-card p-4 text-left transition hover:border-primary/70 hover:shadow-sm"
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
        <div className="flex flex-1 flex-col gap-6 lg:flex-row">
          <Card className="w-full lg:w-96">
            <CardHeader>
              <CardTitle className="text-lg">Структура базы</CardTitle>
              <CardDescription>
                Управляйте иерархией документов с помощью древовидной навигации.
              </CardDescription>
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span>Документов: {totalDocuments}</span>
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
            <CardContent>
              {selectedBase.structure.length > 0 ? (
                <ScrollArea className="h-[28rem] pr-4">
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
                <div className="flex flex-col items-center justify-center gap-3 py-10 text-center text-sm text-muted-foreground">
                  <Library className="h-10 w-10" />
                  <p>Добавьте первый раздел или документ, чтобы построить дерево страницы.</p>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="flex-1">
            <CardHeader>
              <CardTitle className="text-lg">Документ</CardTitle>
              <CardDescription>
                Создавайте и редактируйте материалы в формате Markdown, переключаясь между режимами.
              </CardDescription>
            </CardHeader>
            <Separator />
            <CardContent className="h-full">
              {currentDocument ? (
                <div className="flex h-full flex-col gap-4">
                  {isEditing ? (
                    <Input
                      value={draftTitle}
                      onChange={(event) => setDraftTitle(event.target.value)}
                      placeholder="Название документа"
                    />
                  ) : (
                    <h2 className="text-xl font-semibold">{currentDocument.title}</h2>
                  )}

                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                    <span>
                      Последнее сохранение: {new Date(currentDocument.updatedAt).toLocaleString()}
                    </span>
                    <div className="flex items-center gap-2">
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
                              setDraftTitle(currentDocument.title);
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

                  <div className="min-h-[20rem] flex-1 rounded-lg border bg-muted/30 p-4">
                    {isEditing ? (
                      <Textarea
                        className="h-full min-h-[18rem]"
                        value={draftContent}
                        onChange={(event) => setDraftContent(event.target.value)}
                        placeholder="Введите содержимое в формате Markdown"
                      />
                    ) : draftContent ? (
                      <ScrollArea className="h-full pr-4">
                        <div className="prose prose-sm max-w-none dark:prose-invert">
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>
                            {currentDocument.content || ""}
                          </ReactMarkdown>
                        </div>
                      </ScrollArea>
                    ) : (
                      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                        Документ пока пуст. Включите режим редактирования, чтобы добавить контент.
                      </div>
                    )}
                  </div>
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
              : "Создайте документ с пустым содержимым и начните работу в редакторе Markdown."}
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
        <DialogFooter>
          <Button onClick={handleCreateNode}>Создать</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
}
