import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
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
import DOMPurify from "dompurify";
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
import { DocumentEditor } from "@/components/knowledge-base/DocumentEditor";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf";
import pdfWorkerSrc from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";
import type { PDFTextItem } from "pdfjs-dist/legacy/build/pdf";
import mammoth from "mammoth/mammoth.browser";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerSrc;

const KNOWLEDGE_BASE_STORAGE_KEY = "knowledge-base-state";

const normalizeTitleFromFilename = (filename: string) => {
  const baseName = filename.replace(/\.[^./\\]+$/u, "");
  const cleaned = baseName.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  if (!cleaned) {
    return "Новый документ";
  }

  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
};

const buildHtmlFromPlainText = (text: string, title: string) => {
  const normalized = text.replace(/\r\n/g, "\n");
  const paragraphs = normalized
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

  const paragraphsHtml = paragraphs
    .map((paragraph) => `<p>${escapeHtml(paragraph.replace(/\n/g, " "))}</p>`)
    .join("");

  return `<h1>${escapeHtml(title)}</h1>${paragraphsHtml}`;
};

const decodeDocBinaryToText = (buffer: ArrayBuffer) => {
  const view = new Uint8Array(buffer);
  const encodings: string[] = ["utf-16le", "windows-1251", "utf-8"];

  for (const encoding of encodings) {
    try {
      const decoder = new TextDecoder(encoding, { fatal: false });
      const decoded = decoder.decode(view);
      const cleaned = decoded
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "\n")
        .replace(/[\r\f]+/g, "\n")
        .split(/\n+/)
        .map((line) => line.trim())
        .filter(Boolean)
        .join("\n");
      if (cleaned.length > 0) {
        return cleaned;
      }
    } catch (error) {
      // Переходим к следующей кодировке, если текущая недоступна.
      continue;
    }
  }

  return "";
};

const ensureHeadingInHtml = (html: string, title: string) => {
  if (!html.trim()) {
    return `<h1>${escapeHtml(title)}</h1>`;
  }

  if (/<h[1-6][^>]*>/i.test(html)) {
    return html;
  }

  return `<h1>${escapeHtml(title)}</h1>${html}`;
};

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

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const getSanitizedContent = (html: string) => {
  if (!html) {
    return "";
  }

  if (typeof window === "undefined") {
    return html;
  }

  return DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
};

const extractTitleFromContent = (html: string) => {
  if (!html) {
    return "Без названия";
  }

  if (typeof window === "undefined") {
    return "Без названия";
  }

  const container = window.document.createElement("div");
  container.innerHTML = html;

  const heading = container.querySelector("h1, h2, h3, h4, h5, h6");
  const headingText = heading?.textContent?.trim();
  if (headingText) {
    return headingText;
  }

  const textContent = container
    .textContent?.split(/\n+/)
    .map((line) => line.trim())
    .find(Boolean);
  return textContent || "Без названия";
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
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isImportingDocument, setIsImportingDocument] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);

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
    if (typeof window === "undefined") {
      hasHydratedFromStorageRef.current = true;
      return;
    }

    try {
      const raw = window.localStorage.getItem(KNOWLEDGE_BASE_STORAGE_KEY);
      if (!raw) {
        return;
      }

      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") {
        return;
      }

      const { knowledgeBases: storedBases, selectedBaseId: storedBaseId, selectedDocument: storedDocument } =
        parsed as {
          knowledgeBases?: KnowledgeBase[];
          selectedBaseId?: string | null;
          selectedDocument?: SelectedDocumentState | null;
        };

      if (Array.isArray(storedBases)) {
        setKnowledgeBases(storedBases);
      }

      if (typeof storedBaseId === "string" && storedBaseId) {
        setSelectedBaseId(storedBaseId);
      }

      if (
        storedDocument &&
        typeof storedDocument === "object" &&
        typeof storedDocument.baseId === "string" &&
        typeof storedDocument.documentId === "string"
      ) {
        setSelectedDocument(storedDocument);
      }
    } catch (error) {
      console.error("Не удалось загрузить базы знаний из localStorage", error);
    } finally {
      hasHydratedFromStorageRef.current = true;
    }
  }, []);

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

      window.localStorage.setItem(KNOWLEDGE_BASE_STORAGE_KEY, JSON.stringify(payload));
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

  const createDocumentEntry = (
    title: string,
    content: string,
    parentId: string | null
  ) => {
    if (!selectedBase) {
      return;
    }

    const documentId = createId();
    const now = new Date().toISOString();
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
      updatedAt: now,
    };

    setKnowledgeBases((prev) =>
      prev.map((base) =>
        base.id === selectedBase.id
          ? {
              ...base,
              structure: addChildNode(base.structure, parentId, documentNode),
              documents: {
                ...base.documents,
                [documentId]: knowledgeDocument,
              },
            }
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
      if (!nodeTitle.trim()) {
        return;
      }

      const documentTitle = nodeTitle.trim();
      const initialContent = `<h1>${escapeHtml(documentTitle)}</h1>`;
      createDocumentEntry(documentTitle, initialContent, nodeCreation.parentId);
    }

    finalizeNodeDialog();
  };

  const convertPdfToHtml = async (file: File, title: string) => {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const textChunks: string[] = [];

    for (let pageIndex = 1; pageIndex <= pdf.numPages; pageIndex += 1) {
      const page = await pdf.getPage(pageIndex);
      const textContent = await page.getTextContent();
      const pageText = textContent.items
        .map((item: PDFTextItem) => (typeof item.str === "string" ? item.str : ""))
        .join(" ");
      if (pageText.trim()) {
        textChunks.push(pageText.trim());
      }
    }

    const plainText = textChunks.join("\n\n");
    if (!plainText.trim()) {
      return `<h1>${escapeHtml(title)}</h1>`;
    }

    return buildHtmlFromPlainText(plainText, title);
  };

  const convertDocFileToHtml = async (file: File, title: string) => {
    const arrayBuffer = await file.arrayBuffer();

    try {
      const result = await mammoth.convertToHtml({ arrayBuffer });
      const html = ensureHeadingInHtml(result.value || "", title);
      if (html.trim()) {
        return html;
      }
    } catch (error) {
      // Переходим к эвристическому извлечению текста ниже.
    }

    const extractedText = decodeDocBinaryToText(arrayBuffer);
    if (!extractedText) {
      throw new Error("Не удалось прочитать содержимое документа.");
    }

    return buildHtmlFromPlainText(extractedText, title);
  };

  const convertFileToHtml = async (file: File) => {
    const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
    const title = normalizeTitleFromFilename(file.name);

    if (extension === "txt") {
      const text = await file.text();
      return { title, html: buildHtmlFromPlainText(text, title) };
    }

    if (extension === "pdf") {
      return { title, html: await convertPdfToHtml(file, title) };
    }

    if (extension === "doc" || extension === "docx") {
      return { title, html: await convertDocFileToHtml(file, title) };
    }

    throw new Error("Поддерживаются только файлы PDF, DOC/DOCX и TXT.");
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

    setKnowledgeBases((prev) =>
      prev.map((base) => {
        if (base.id !== selectedBase.id) {
          return base;
        }

        const updatedDocument: KnowledgeDocument = {
          ...currentDocument,
          title: nextTitle,
          content: sanitizedContent,
          updatedAt: new Date().toISOString(),
        };

        return {
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
        };
      })
    );

    setIsEditing(false);
  };

  const computedTitle = isEditing
    ? extractTitleFromContent(getSanitizedContent(draftContent))
    : extractTitleFromContent(getSanitizedContent(currentDocument?.content ?? ""));

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
      <div className="flex h-full flex-col gap-4 px-4 py-4 lg:px-5 lg:py-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">
              {selectedBase ? selectedBase.name : "База знаний"}
            </h1>
            <p className="text-muted-foreground">
              {selectedBase
                ? selectedBase.description ||
                  "Управляйте структурой библиотеки и редактируйте документы."
                : "Выберите библиотеку или создайте новую, чтобы начать работу с документами."}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {selectedBase && (
              <Button variant="outline" onClick={handleBackToList}>
                <ChevronLeft className="mr-2 h-4 w-4" />
                Список библиотек
              </Button>
            )}
            <Dialog open={isCreateBaseOpen} onOpenChange={setIsCreateBaseOpen}>
              <DialogTrigger asChild>
                <Button>
                  <PlusCircle className="mr-2 h-4 w-4" />
                  Создать библиотеку
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Новая библиотека</DialogTitle>
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
                      placeholder="Например, Библиотека по продукту"
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
                      placeholder="Кратко опишите назначение библиотеки"
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
                Выберите библиотеку
              </CardTitle>
              <CardDescription>
                Работайте с документами, выбрав одну из существующих библиотек или создайте новую.
              </CardDescription>
            </CardHeader>
            <CardContent className="px-5 pb-5">
              {knowledgeBases.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-3 py-8 text-center text-sm text-muted-foreground">
                  <Library className="h-10 w-10" />
                  <p>Пока что у вас нет библиотек. Создайте первую, чтобы начать работу с документами.</p>
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
              <CardTitle className="text-lg">Структура библиотеки</CardTitle>
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
                  <p>Добавьте первый раздел или документ, чтобы построить дерево библиотеки.</p>
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

                  <div className="min-h-[20rem] flex-1 rounded-lg border bg-muted/30 p-3.5">
                    {isEditing ? (
                      <DocumentEditor value={draftContent} onChange={setDraftContent} />
                    ) : draftContent ? (
                      <ScrollArea className="h-full pr-3">
                        <div
                          className="prose prose-sm max-w-none dark:prose-invert"
                          dangerouslySetInnerHTML={{
                            __html: getSanitizedContent(currentDocument.content)
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
              ) : (
                <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-sm text-muted-foreground">
                  <SquarePen className="h-10 w-10" />
                  <p>Выберите документ в структуре библиотеки или создайте новый.</p>
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
