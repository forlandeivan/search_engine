import { useEffect, useMemo, useState } from "react";
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
import {
  Card,
  CardContent,
  CardDescription,
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
import { cn } from "@/lib/utils";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { escapeHtml, getSanitizedContent } from "@/lib/document-import";
import { syncKnowledgeBaseStorageFromSummaries } from "@/lib/knowledge-base";
import type {
  KnowledgeBaseSummary,
  KnowledgeBaseTreeNode,
  KnowledgeBaseNodeDetail,
  KnowledgeBaseChildNode,
  DeleteKnowledgeNodeResponse,
  CreateKnowledgeDocumentResponse,
  KnowledgeBaseDocumentDetail,
} from "@shared/knowledge-base";
import {
  ChevronRight,
  FileDown,
  FileText,
  FileType,
  Folder,
  Loader2,
  MoreVertical,
  PencilLine,
  Plus,
  Trash2,
} from "lucide-react";

const ROOT_PARENT_VALUE = "__root__";

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
    if (node.type === "folder") {
      accumulator.push({ id: node.id, title: node.title, level });
      if (node.children) {
        collectFolderOptions(node.children, level + 1, accumulator);
      }
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
  level?: number;
};

function TreeMenu({ baseId, nodes, activeNodeId, level = 0 }: TreeMenuProps) {
  return (
    <ul className={cn("space-y-1 text-sm", level > 0 && "border-l border-border/40 pl-4")}> 
      {nodes.map((node) => {
        const isActive = activeNodeId === node.id;
        return (
          <li key={node.id}>
            <Link
              href={`/knowledge/${baseId}/node/${node.id}`}
              className={cn(
                "flex items-center gap-2 rounded-md px-2 py-1 transition", 
                isActive ? "bg-primary/10 text-primary" : "hover:bg-muted"
              )}
            >
              {node.type === "folder" ? (
                <Folder className="h-4 w-4" />
              ) : (
                <FileText className="h-4 w-4" />
              )}
              <span className="flex-1 truncate">{node.title}</span>
              {node.children && node.children.length > 0 && (
                <ChevronRight className="h-3 w-3 text-muted-foreground" />
              )}
            </Link>
            {node.children && node.children.length > 0 && (
              <TreeMenu
                baseId={baseId}
                nodes={node.children}
                activeNodeId={activeNodeId}
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
  const [movingNodeId, setMovingNodeId] = useState<string | null>(null);
  const [isCreateDocumentDialogOpen, setIsCreateDocumentDialogOpen] = useState(false);
  const [documentDialogParentId, setDocumentDialogParentId] = useState<string | null>(null);
  const [documentDialogParentTitle, setDocumentDialogParentTitle] = useState<string>("В корне базы");
  const [editingDocumentId, setEditingDocumentId] = useState<string | null>(null);
  const [documentDraftTitle, setDocumentDraftTitle] = useState<string>("");
  const [documentDraftContent, setDocumentDraftContent] = useState<string>("");
  const [exportingFormat, setExportingFormat] = useState<"doc" | "pdf" | null>(null);
  const isDeleteDialogOpen = Boolean(deleteTarget);

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

    syncKnowledgeBaseStorageFromSummaries(basesQuery.data);
  }, [basesQuery.data]);

  const bases = basesQuery.data ?? [];
  const selectedBase = useMemo(
    () => bases.find((base) => base.id === knowledgeBaseId) ?? null,
    [bases, knowledgeBaseId],
  );

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

  const documentDetail =
    nodeDetailQuery.data?.type === "document" ? nodeDetailQuery.data : null;

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

  const sanitizedDocumentContent = useMemo(
    () => (documentDetail ? getSanitizedContent(documentDetail.content ?? "") : ""),
    [documentDetail?.content],
  );

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
                              {`${" ".repeat(option.level * 2)}${option.title}`}
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
    const statusLabel = DOCUMENT_STATUS_LABELS[detail.status] ?? detail.status;
    const sourceLabel = DOCUMENT_SOURCE_LABELS[detail.sourceType] ?? "Документ";
    const versionLabel = detail.versionNumber ? `v${detail.versionNumber}` : null;
    const isSaving = updateDocumentMutation.isPending;

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
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" aria-label="Действия с документом">
                    <MoreVertical className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => handleStartEditingDocument(detail)}>
                    <PencilLine className="mr-2 h-4 w-4" /> Редактировать
                  </DropdownMenuItem>
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
          ) : sanitizedContent ? (
            <div
              className="prose prose-sm max-w-none dark:prose-invert"
              dangerouslySetInnerHTML={{ __html: sanitizedContent }}
            />
          ) : (
            <p className="text-sm text-muted-foreground">Документ пока пуст.</p>
          )}
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
        <Button
          type="button"
          onClick={() => handleOpenCreateDocument(null, detail.name)}
          className="w-full sm:w-auto"
        >
          <Plus className="mr-2 h-4 w-4" /> Новый документ
        </Button>
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
            <TreeMenu baseId={detail.id} nodes={detail.rootNodes} activeNodeId={selectedNodeId} />
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

    if (detail.type === "folder") {
      return renderFolderSettings(detail);
    }

    if (detail.type === "document") {
      return renderDocument(detail);
    }

    return renderOverview(detail);
  };

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
            <p className="text-sm text-muted-foreground">
              Пока нет доступных баз знаний.
            </p>
          ) : (
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
            <p className="text-sm text-muted-foreground">
              Выберите базу знаний, чтобы увидеть структуру документов.
            </p>
          ) : selectedBase.rootNodes.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              В этой базе ещё нет документов.
            </p>
          ) : (
            <TreeMenu
              baseId={selectedBase.id}
              nodes={selectedBase.rootNodes}
              activeNodeId={selectedNodeId}
            />
          )}
        </ScrollArea>
      </aside>
      <main className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto flex max-w-4xl flex-col gap-6">
          {renderContent()}
        </div>
      </main>
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
    </div>
  );
}
