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
  FileText,
  FolderClosed,
  Library,
  PlusCircle,
  Rows3,
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
  level?: number;
}

function TreeView({
  nodes,
  onAddFolder,
  onAddDocument,
  onSelectDocument,
  selectedDocumentId,
  level = 0,
}: TreeProps) {
  return (
    <div className={cn("space-y-2", level > 0 && "pl-4 border-l border-border/60")}> 
      {nodes.map((node) => (
        <div key={node.id} className="space-y-2">
          <div
            className={cn(
              "flex items-center justify-between rounded-md border bg-card px-3 py-2 text-sm transition",
              node.type === "document" &&
                selectedDocumentId === node.documentId &&
                "border-primary/60 bg-primary/10 text-primary"
            )}
          >
            <button
              type="button"
              className="flex flex-1 items-center gap-2 text-left"
              onClick={() => {
                if (node.type === "document" && node.documentId) {
                  onSelectDocument(node.documentId);
                }
              }}
            >
              {node.type === "folder" ? (
                <FolderClosed className="h-4 w-4 text-muted-foreground" />
              ) : (
                <FileText className="h-4 w-4 text-muted-foreground" />
              )}
              <span className="font-medium">{node.title}</span>
            </button>

            {node.type === "folder" && (
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => onAddFolder(node.id)}
                  title="Добавить раздел"
                >
                  <Rows3 className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => onAddDocument(node.id)}
                  title="Добавить документ"
                >
                  <SquarePen className="h-4 w-4" />
                </Button>
              </div>
            )}
          </div>

          {node.children && node.children.length > 0 && (
            <TreeView
              nodes={node.children}
              onAddFolder={onAddFolder}
              onAddDocument={onAddDocument}
              onSelectDocument={onSelectDocument}
              selectedDocumentId={selectedDocumentId}
              level={level + 1}
            />
          )}
        </div>
      ))}
    </div>
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
    if (!selectedBaseId && knowledgeBases.length > 0) {
      setSelectedBaseId(knowledgeBases[0].id);
    }
  }, [knowledgeBases, selectedBaseId]);

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

  return (
    <div className="flex h-full flex-col gap-6 p-6">
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">Загрузка знаний</h1>
            <p className="text-muted-foreground">
              Управляйте базами знаний, создавайте разделы и добавляйте документы с поддержкой Markdown.
            </p>
          </div>
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

      <div className="flex flex-1 flex-col gap-6 lg:flex-row">
        <Card className="w-full lg:w-80">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Library className="h-5 w-5" />
              Базы знаний
            </CardTitle>
            <CardDescription>
              Выберите базу, чтобы настроить структуру и управлять документами.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {knowledgeBases.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Пока что у вас нет баз знаний. Создайте первую, чтобы начать.
              </p>
            ) : (
              <ScrollArea className="h-[28rem] pr-4">
                <div className="space-y-3">
                  {knowledgeBases.map((base) => {
                    const isActive = base.id === selectedBase?.id;
                    const documentCount = Object.keys(base.documents).length;

                    return (
                      <button
                        key={base.id}
                        type="button"
                        onClick={() => {
                          setSelectedBaseId(base.id);
                          setSelectedDocument(null);
                        }}
                        className={cn(
                          "w-full rounded-lg border bg-card p-4 text-left transition hover:border-primary/70 hover:shadow-sm",
                          isActive && "border-primary bg-primary/10 shadow"
                        )}
                      >
                        <h3 className="text-base font-semibold">{base.name}</h3>
                        {base.description && (
                          <p className="mt-1 line-clamp-3 text-sm text-muted-foreground">
                            {base.description}
                          </p>
                        )}
                        <p className="mt-3 text-xs text-muted-foreground">
                          Документов: {documentCount}
                        </p>
                      </button>
                    );
                  })}
                </div>
              </ScrollArea>
            )}
          </CardContent>
        </Card>

        <Card className="flex-1">
          <CardHeader className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <CardTitle className="text-lg">
                  {selectedBase ? selectedBase.name : "Нет выбранной базы"}
                </CardTitle>
                <CardDescription>
                  {selectedBase?.description ||
                    "Создайте базу знаний и выберите её для настройки."}
                </CardDescription>
              </div>
              {selectedBase && (
                <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                  <span>Всего документов: {totalDocuments}</span>
                </div>
              )}
            </div>
            {selectedBase && (
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => openNodeDialog("folder", null)}>
                  <Rows3 className="mr-2 h-4 w-4" />
                  Добавить раздел
                </Button>
                <Button variant="outline" size="sm" onClick={() => openNodeDialog("document", null)}>
                  <SquarePen className="mr-2 h-4 w-4" />
                  Добавить документ
                </Button>
              </div>
            )}
          </CardHeader>
          <Separator />
          <CardContent className="h-full">
            {selectedBase ? (
              selectedBase.structure.length > 0 ? (
                <ScrollArea className="h-[28rem] pr-4">
                  <TreeView
                    nodes={selectedBase.structure}
                    onAddFolder={(parentId) => openNodeDialog("folder", parentId)}
                    onAddDocument={(parentId) => openNodeDialog("document", parentId)}
                    onSelectDocument={handleSelectDocument}
                    selectedDocumentId={selectedDocument?.documentId}
                  />
                </ScrollArea>
              ) : (
                <div className="flex h-full flex-col items-center justify-center rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
                  <p>Добавьте первый раздел или документ, чтобы начать строить структуру.</p>
                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <Button size="sm" onClick={() => openNodeDialog("folder", null)}>
                      <Rows3 className="mr-2 h-4 w-4" />
                      Добавить раздел
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => openNodeDialog("document", null)}>
                      <SquarePen className="mr-2 h-4 w-4" />
                      Добавить документ
                    </Button>
                  </div>
                </div>
              )
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                Выберите базу знаний для отображения структуры.
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
    </div>
  );
}
