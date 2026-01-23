import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type FormEvent,
} from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { convertFileToHtml, getSanitizedContent, buildHtmlFromPlainText } from "@/lib/document-import";
import { cn } from "@/lib/utils";
import { apiRequest } from "@/lib/queryClient";
import type { KnowledgeBaseTreeNode } from "@shared/knowledge-base";
import type { KnowledgeNodeSourceType } from "@shared/schema";
import type { StructureAnalysis, PreviewError } from "@/lib/json-import-types";
import type { MappingConfigV2, HierarchyConfig, CreateJsonImportRequest } from "@shared/json-import";
import {
  AlertCircle,
  FileText,
  Folder,
  Globe,
  Loader2,
  Trash2,
  Upload,
  FileJson,
  ChevronLeft,
  ChevronRight,
  X,
  AlertTriangle,
  type ComponentType,
} from "lucide-react";
import { FileImportPanel, type FileImportMode } from "./import/FileImportPanel";
import { CrawlImportPanel, type CrawlMode, type CrawlConfig } from "./import/CrawlImportPanel";
import { ImportModeSelector } from "./import/ImportModeSelector";
import { useJsonImportUpload } from "@/hooks/useJsonImportUpload";
import { useBulkDocumentImport } from "@/hooks/useBulkDocumentImport";
import { StructurePreview } from "./json-import/StructurePreview";
import { DocumentFieldMappingEditor } from "./json-import/DocumentFieldMappingEditor";
import { HierarchyConfigEditor } from "./json-import/HierarchyConfig";

const ROOT_PARENT_VALUE = "__root__";
const MAX_CONTENT_LENGTH = 20_000_000;
const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024;
const ACCEPTED_FILE_TYPES =
  ".pdf,.doc,.docx,.pptx,.xlsx,.txt,.md,.markdown,.html,.htm,.eml,.csv" +
  ",application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document" +
  ",application/vnd.openxmlformats-officedocument.presentationml.presentation,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" +
  ",text/plain,text/markdown,text/csv,text/html,message/rfc822";
const SUPPORTED_FORMAT_LABEL = "PDF, DOC, DOCX, TXT, Markdown, HTML, CSV, EML, PPTX, XLSX";

type DocumentCreationOption = {
  value: KnowledgeNodeSourceType;
  title: string;
  description: string;
  icon: ComponentType<{ className?: string }>;
};

type JsonImportStep = "upload" | "preview" | "mapping" | "hierarchy";

const DOCUMENT_CREATION_OPTIONS: DocumentCreationOption[] = [
  {
    value: "manual",
    title: "Пустой документ",
    description: "Создайте чистый документ и заполните его позже или добавьте текст прямо сейчас.",
    icon: FileText,
  },
  {
    value: "import",
    title: "Импорт из файла",
    description: `Загрузите текстовый документ до 20 МБ. Поддерживаются ${SUPPORTED_FORMAT_LABEL}.`,
    icon: Upload,
  },
  {
    value: "crawl",
    title: "Импорт со страницы",
    description: "Укажите ссылку, и мы извлечём контент так же, как при краулинге базы знаний.",
    icon: Globe,
  },
  {
    value: "json_import",
    title: "Импорт JSON/JSONL",
    description: "Импортируйте структурированные данные из JSON или JSONL файлов.",
    icon: FileJson,
  },
];

export type CreateKnowledgeDocumentFormValues = {
  title: string;
  parentId: string | null;
  content: string;
  sourceType: KnowledgeNodeSourceType;
  importFileName: string | null;
  crawlUrl?: string | null;
};

interface CreateKnowledgeDocumentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  structure: KnowledgeBaseTreeNode[];
  defaultParentId: string | null;
  baseName: string;
  parentLabel: string;
  isSubmitting: boolean;
  onSubmit: (values: CreateKnowledgeDocumentFormValues) => Promise<void> | void;
  workspaceId?: string | null;
  baseId?: string;
  onJsonImportStarted?: (jobId: string) => void;
}

type FolderOption = {
  id: string;
  title: string;
  level: number;
  type: "folder" | "document";
};

function buildFolderOptions(nodes: KnowledgeBaseTreeNode[], level = 0, acc: FolderOption[] = []): FolderOption[] {
  for (const node of nodes) {
    acc.push({ id: node.id, title: node.title, level, type: node.type });
    if (node.children && node.children.length > 0) {
      buildFolderOptions(node.children, level + 1, acc);
    }
  }

  return acc;
}

function resolveDefaultParentValue(parentId: string | null): string {
  return parentId ?? ROOT_PARENT_VALUE;
}

export function CreateKnowledgeDocumentDialog({
  open,
  onOpenChange,
  structure,
  defaultParentId,
  baseName,
  parentLabel,
  isSubmitting,
  onSubmit,
  workspaceId,
  baseId,
  onJsonImportStarted,
}: CreateKnowledgeDocumentDialogProps) {
  const [title, setTitle] = useState("");
  const [parentValue, setParentValue] = useState<string>(resolveDefaultParentValue(defaultParentId));
  const [mode, setMode] = useState<KnowledgeNodeSourceType>("manual");
  const [manualContent, setManualContent] = useState("");
  const [crawlUrl, setCrawlUrl] = useState("");
  const [crawlMode, setCrawlMode] = useState<CrawlMode>("single");
  const [crawlConfig, setCrawlConfig] = useState<CrawlConfig>({
    startUrls: [],
    robotsTxt: true,
  });
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importHtml, setImportHtml] = useState("");
  const [importDetectedTitle, setImportDetectedTitle] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [isReadingFile, setIsReadingFile] = useState(false);
  const [hasTitleBeenEdited, setHasTitleBeenEdited] = useState(false);
  const [isDragActive, setIsDragActive] = useState(false);
  
  // Множественный импорт файлов
  const [importFiles, setImportFiles] = useState<File[]>([]);
  const [fileImportMode, setFileImportMode] = useState<FileImportMode>("single");
  const [isBulkImporting, setIsBulkImporting] = useState(false);
  const [bulkImportProgress, setBulkImportProgress] = useState<{ current: number; total: number } | undefined>();
  const [bulkImportResult, setBulkImportResult] = useState<{ created: number; failed: number; errors: Array<{ title: string; error: string }> } | null>(null);
  const [jsonStep, setJsonStep] = useState<JsonImportStep>("upload");
  const [jsonFile, setJsonFile] = useState<File | null>(null);
  const [jsonUploadedFileKey, setJsonUploadedFileKey] = useState<string | null>(null);
  const [jsonStructureAnalysis, setJsonStructureAnalysis] = useState<StructureAnalysis | null>(null);
  const [jsonPreviewError, setJsonPreviewError] = useState<PreviewError | null>(null);
  const [jsonMappingConfig, setJsonMappingConfig] = useState<MappingConfigV2 | null>(null);
  const [jsonIsMappingValid, setJsonIsMappingValid] = useState(false);
  const [jsonShowMappingValidationErrors, setJsonShowMappingValidationErrors] = useState(false);
  const [jsonHierarchyConfig, setJsonHierarchyConfig] = useState<HierarchyConfig | null>(null);
  const [jsonIsAnalyzing, setJsonIsAnalyzing] = useState(false);
  const [jsonIsSubmitting, setJsonIsSubmitting] = useState(false);
  const [jsonError, setJsonError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const jsonFileInputRef = useRef<HTMLInputElement | null>(null);
  
  // Bulk import hook
  const { uploadFile, uploadProgress, isUploading, error: uploadError, abort } = useJsonImportUpload(
    workspaceId ?? "",
  );

  const folderOptions = useMemo(() => buildFolderOptions(structure), [structure]);

  const resetJsonImportState = () => {
    abort();
    setJsonStep("upload");
    setJsonFile(null);
    setJsonUploadedFileKey(null);
    setJsonStructureAnalysis(null);
    setJsonPreviewError(null);
    setJsonMappingConfig(null);
    setJsonIsMappingValid(false);
    setJsonShowMappingValidationErrors(false);
    setJsonHierarchyConfig(null);
    setJsonIsAnalyzing(false);
    setJsonIsSubmitting(false);
    setJsonError(null);
    if (jsonFileInputRef.current) {
      jsonFileInputRef.current.value = "";
    }
  };

  useEffect(() => {
    if (open) {
      setParentValue(resolveDefaultParentValue(defaultParentId));
    } else {
      setTitle("");
      setManualContent("");
      setCrawlUrl("");
      setCrawlMode("single");
      setCrawlConfig({ startUrls: [], robotsTxt: true });
      setImportFile(null);
      setImportHtml("");
      setImportDetectedTitle(null);
      setImportError(null);
      setFormError(null);
      setMode("manual");
      setIsReadingFile(false);
      setHasTitleBeenEdited(false);
      setIsDragActive(false);
      setImportFiles([]);
      setFileImportMode("single");
      setIsBulkImporting(false);
      setBulkImportProgress(undefined);
      setBulkImportResult(null);
      resetJsonImportState();
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  }, [open, defaultParentId]);

  const handleTitleChange = (event: ChangeEvent<HTMLInputElement>) => {
    setTitle(event.target.value);
    setHasTitleBeenEdited(true);
  };

  const handleModeChange = (newMode: KnowledgeNodeSourceType) => {
    setMode(newMode);
    setFormError(null);
    setJsonError(null);
    resetJsonImportState();

    if (newMode === "manual") {
      setImportFile(null);
      setImportHtml("");
      setImportDetectedTitle(null);
      setImportError(null);
      setIsDragActive(false);
      setCrawlUrl("");
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    } else if (newMode === "import") {
      setManualContent("");
      setCrawlUrl("");
    } else if (newMode === "crawl") {
      setManualContent("");
      setImportFile(null);
      setImportHtml("");
      setImportDetectedTitle(null);
      setImportError(null);
      setIsDragActive(false);
      setCrawlUrl("");
      setCrawlMode("single");
      setCrawlConfig({ startUrls: [], robotsTxt: true });
      setTitle("");
      setHasTitleBeenEdited(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    } else if (newMode === "json_import") {
      setManualContent("");
      setImportFile(null);
      setImportHtml("");
      setImportDetectedTitle(null);
      setImportError(null);
      setIsDragActive(false);
      setCrawlUrl("");
      setTitle("");
      setHasTitleBeenEdited(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const applyTitleToImportedHtml = (html: string, newTitle: string) => {
    if (!html.trim()) {
      return html;
    }

    if (typeof window === "undefined") {
      return html;
    }

    const container = window.document.createElement("div");
    container.innerHTML = html;
    const heading = container.querySelector("h1, h2, h3, h4, h5, h6");

    if (heading) {
      heading.textContent = newTitle;
    } else {
      const h1 = window.document.createElement("h1");
      h1.textContent = newTitle;
      container.prepend(h1);
    }

    return container.innerHTML;
  };

  const processImportedFile = async (file: File) => {
    setImportError(null);
    setFormError(null);

    if (file.size > MAX_FILE_SIZE_BYTES) {
      setImportError("Файл слишком большой. Максимальный размер — 20 МБ.");
      setImportFile(null);
      setImportHtml("");
      setImportDetectedTitle(null);
      return;
    }

    setIsReadingFile(true);
    try {
      const { title: detectedTitle, html } = await convertFileToHtml(file);
      const sanitizedContent = getSanitizedContent(html);

      if (!sanitizedContent.trim()) {
        throw new Error("Файл не содержит текстового контента.");
      }

      if (sanitizedContent.length > MAX_CONTENT_LENGTH) {
        throw new Error("Содержимое файла превышает допустимый размер 20 МБ.");
      }

      setImportFile(file);
      setImportHtml(sanitizedContent);
      setImportDetectedTitle(detectedTitle);
      if ((!hasTitleBeenEdited && !title.trim()) || !title.trim()) {
        setTitle(detectedTitle);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Не удалось обработать файл.";
      setImportError(message);
      setImportFile(null);
      setImportHtml("");
      setImportDetectedTitle(null);
    } finally {
      setIsReadingFile(false);
    }
  };

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    await processImportedFile(file);
  };

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragActive(true);
  };

  const handleDragLeave = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragActive(false);
  };

  const handleFileDrop = async (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragActive(false);

    const file = event.dataTransfer?.files?.[0];
    if (!file) {
      return;
    }

    await processImportedFile(file);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleRemoveFile = () => {
    setImportFile(null);
    setImportHtml("");
    setImportDetectedTitle(null);
    setImportError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleJsonFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0] ?? null;
    setJsonFile(selectedFile);
    setJsonError(null);
    setJsonUploadedFileKey(null);
    setJsonStructureAnalysis(null);
    setJsonPreviewError(null);
    setJsonMappingConfig(null);
    setJsonIsMappingValid(false);
    setJsonShowMappingValidationErrors(false);
    setJsonHierarchyConfig(null);
  };

  const analyzeJsonStructure = async (fileKey: string) => {
    if (!workspaceId) {
      setJsonError("Не указан workspaceId для импорта JSON");
      return false;
    }

    setJsonIsAnalyzing(true);
    setJsonPreviewError(null);
    setJsonError(null);

    try {
      const response = await apiRequest(
        "POST",
        "/api/knowledge/json-import/preview",
        { fileKey, sampleSize: 100 },
        undefined,
        { workspaceId },
      );

      if (!response.ok) {
        const errorData = (await response.json()) as PreviewError;
        setJsonPreviewError(errorData);
        setJsonError(errorData.error);
        return false;
      }

      const analysis = (await response.json()) as StructureAnalysis;
      setJsonStructureAnalysis(analysis);
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Не удалось проанализировать файл";
      setJsonPreviewError({
        error: message,
        code: "PARSE_ERROR",
      });
      setJsonError(message);
      return false;
    } finally {
      setJsonIsAnalyzing(false);
    }
  };

  const handleJsonNext = async () => {
    if (jsonStep === "upload") {
      if (!workspaceId || !baseId) {
        setJsonError("Не указаны workspaceId или baseId для импорта JSON");
        return;
      }
      if (!jsonFile) {
        setJsonError("Выберите файл для импорта");
        return;
      }

      const fileName = jsonFile.name.toLowerCase();
      if (!fileName.endsWith(".json") && !fileName.endsWith(".jsonl")) {
        setJsonError("Поддерживаются только файлы .json и .jsonl");
        return;
      }

      const maxSize = 2 * 1024 * 1024 * 1024; // 2GB
      if (jsonFile.size > maxSize) {
        setJsonError("Размер файла превышает максимально допустимый (2GB)");
        return;
      }

      setJsonError(null);

      if (jsonUploadedFileKey && jsonStructureAnalysis) {
        setJsonStep("preview");
        return;
      }

      try {
        if (jsonUploadedFileKey) {
          const analysisOk = await analyzeJsonStructure(jsonUploadedFileKey);
          if (analysisOk) {
            setJsonStep("preview");
          }
          return;
        }

        const result = await uploadFile(jsonFile);
        setJsonUploadedFileKey(result.fileKey);
        const analysisOk = await analyzeJsonStructure(result.fileKey);
        if (analysisOk) {
          setJsonStep("preview");
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Не удалось загрузить файл";
        setJsonError(message);
      }
      return;
    }

    if (jsonStep === "preview") {
      setJsonError(null);
      setJsonShowMappingValidationErrors(false);
      setJsonStep("mapping");
      return;
    }

    if (jsonStep === "mapping") {
      setJsonShowMappingValidationErrors(true);
      if (jsonIsMappingValid) {
        setJsonError(null);
        setJsonStep("hierarchy");
      }
      return;
    }

    if (jsonStep === "hierarchy") {
      await handleJsonImport();
    }
  };

  const handleJsonBack = () => {
    setJsonError(null);
    if (jsonStep === "preview") {
      setJsonStep("upload");
    } else if (jsonStep === "mapping") {
      setJsonStep("preview");
    } else if (jsonStep === "hierarchy") {
      setJsonStep("mapping");
    }
  };

  const handleJsonImport = async () => {
    if (!workspaceId || !baseId) {
      setJsonError("Не указаны workspaceId или baseId для импорта JSON");
      return;
    }
    if (jsonIsSubmitting || isSubmitting) {
      return;
    }
    if (!jsonUploadedFileKey || !jsonFile) {
      setJsonError("Сначала загрузите файл");
      return;
    }
    if (!jsonMappingConfig || !jsonIsMappingValid) {
      setJsonError("Настройте маппинг полей");
      return;
    }

    setJsonIsSubmitting(true);
    setJsonError(null);

    try {
      const finalHierarchyConfig: HierarchyConfig = {
        ...(jsonHierarchyConfig ?? { mode: "flat" }),
        baseParentId: parentValue === ROOT_PARENT_VALUE ? null : parentValue,
      };

      const importRequest: CreateJsonImportRequest = {
        fileKey: jsonUploadedFileKey,
        fileName: jsonFile.name,
        fileSize: jsonFile.size,
        mappingConfig: jsonMappingConfig,
        hierarchyConfig: finalHierarchyConfig,
      };

      const response = await apiRequest(
        "POST",
        `/api/knowledge/bases/${baseId}/json-import`,
        importRequest,
        undefined,
        { workspaceId },
      );

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Не удалось запустить импорт");
      }

      const data = (await response.json()) as { jobId: string; status: "pending" };

      onJsonImportStarted?.(data.jobId);
      onOpenChange(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Не удалось запустить импорт";
      setJsonError(message);
    } finally {
      setJsonIsSubmitting(false);
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);

    // JSON import обрабатывается отдельным пошаговым сценарием
    if (mode === "json_import") {
      return;
    }
    
    // Bulk import обрабатывается отдельно
    if (mode === "import" && (fileImportMode === "multiple" || fileImportMode === "archive")) {
      await handleBulkImport();
      return;
    }

    const trimmedTitle = title.trim();
    const parentId = parentValue === ROOT_PARENT_VALUE ? null : parentValue;

    if (mode === "crawl") {
      if (crawlMode === "single") {
        // Одна страница - используем существующий API
        const trimmedUrl = crawlUrl.trim();
        if (!trimmedUrl) {
          setFormError("Укажите ссылку на страницу для импорта.");
          return;
        }

        try {
          const parsed = new URL(trimmedUrl);
          if (!parsed.protocol.startsWith("http")) {
            throw new Error("Invalid protocol");
          }
        } catch {
          setFormError("Укажите корректный URL страницы.");
          return;
        }

        try {
          await onSubmit({
            title: trimmedTitle,
            parentId,
            content: "",
            sourceType: "crawl",
            importFileName: null,
            crawlUrl: trimmedUrl,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Не удалось импортировать страницу";
          setFormError(message);
        }
      } else {
        // Несколько страниц - используем API множественного краулинга
        if (!baseId) {
          setFormError("База знаний не указана");
          return;
        }

        if (!crawlConfig.startUrls || crawlConfig.startUrls.length === 0) {
          setFormError("Укажите хотя бы один стартовый URL");
          return;
        }

        // Валидация URL
        const invalidUrls: string[] = [];
        for (const url of crawlConfig.startUrls) {
          try {
            const parsed = new URL(url.trim());
            if (!parsed.protocol.startsWith("http")) {
              invalidUrls.push(url);
            }
          } catch {
            invalidUrls.push(url);
          }
        }

        if (invalidUrls.length > 0) {
          setFormError(`Некорректные URL: ${invalidUrls.join(", ")}`);
          return;
        }

        try {
          const { apiRequest } = await import("@/lib/queryClient");
          
          // Преобразуем конфигурацию в формат API
          const crawlConfigPayload = {
            start_urls: crawlConfig.startUrls,
            sitemap_url: crawlConfig.sitemapUrl || null,
            allowed_domains: crawlConfig.allowedDomains || [],
            include: crawlConfig.include || [],
            exclude: crawlConfig.exclude || [],
            max_pages: crawlConfig.maxPages || null,
            max_depth: crawlConfig.maxDepth || null,
            rate_limit_rps: crawlConfig.rateLimitRps || null,
            robots_txt: crawlConfig.robotsTxt ?? true,
            selectors: crawlConfig.selectors
              ? {
                  title: crawlConfig.selectors.title || null,
                  content: crawlConfig.selectors.content || null,
                }
              : null,
            language: crawlConfig.language || null,
            version: crawlConfig.version || null,
            auth: crawlConfig.authHeaders
              ? { headers: crawlConfig.authHeaders }
              : null,
          };

          const response = await apiRequest(
            "POST",
            `/api/kb/${baseId}/crawl`,
            { crawl_config: crawlConfigPayload },
            undefined,
            { workspaceId: workspaceId ?? undefined }
          );

          if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || "Не удалось запустить краулинг");
          }

          const result = (await response.json()) as {
            kb_id: string;
            job_id: string;
            job: unknown;
          };

          // Закрываем диалог после успешного запуска
          onOpenChange(false);
        } catch (error) {
          const message = error instanceof Error ? error.message : "Не удалось запустить краулинг";
          setFormError(message);
        }
      }
      return;
    }

    if (!trimmedTitle) {
      setFormError("Укажите название документа.");
      return;
    }

    if (mode === "manual") {
      if (manualContent.length > MAX_CONTENT_LENGTH) {
        setFormError("Содержимое документа превышает допустимый размер 20 МБ.");
        return;
      }

      let sanitizedContent = "";

      if (manualContent.trim()) {
        sanitizedContent = getSanitizedContent(buildHtmlFromPlainText(manualContent, trimmedTitle));
        if (sanitizedContent.length > MAX_CONTENT_LENGTH) {
          setFormError("Содержимое документа превышает допустимый размер 20 МБ после обработки.");
          return;
        }
      }

      try {
        await onSubmit({
          title: trimmedTitle,
          parentId,
          content: sanitizedContent,
          sourceType: "manual",
          importFileName: null,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Не удалось создать документ";
        setFormError(message);
      }
      return;
    }

    if (!importFile || importHtml.length === 0) {
      setFormError("Выберите файл для импорта или перетащите его в область загрузки.");
      return;
    }

    try {
      const htmlWithTitle = applyTitleToImportedHtml(importHtml, trimmedTitle);
      const sanitizedContent = getSanitizedContent(htmlWithTitle);

      if (sanitizedContent.length > MAX_CONTENT_LENGTH) {
        setFormError("Содержимое файла превышает допустимый размер 20 МБ.");
        return;
      }

      await onSubmit({
        title: trimmedTitle,
        parentId,
        content: sanitizedContent,
        sourceType: "import",
        importFileName: importFile.name,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Не удалось создать документ";
      setFormError(message);
    }
  };

  const parentDescription = parentValue === ROOT_PARENT_VALUE ? "В корне базы" : parentLabel;
  const submitLabel =
    mode === "crawl"
      ? crawlMode === "multiple"
        ? "Запустить краулинг"
        : "Импортировать страницу"
      : mode === "import" && (fileImportMode === "multiple" || fileImportMode === "archive")
        ? `Импортировать ${importFiles.length} ${importFiles.length === 1 ? "файл" : importFiles.length < 5 ? "файла" : "файлов"}`
        : mode === "import"
          ? "Импортировать файл"
          : "Создать документ";
  const submitPendingLabel =
    mode === "crawl"
      ? crawlMode === "multiple"
        ? "Запуск..."
        : "Импорт..."
      : mode === "import"
        ? "Импорт..."
        : "Создание...";
  const SubmitIcon = mode === "crawl" ? Globe : mode === "import" ? Upload : FileText;
  const isJsonImport = mode === "json_import";
  const isJsonWizard = isJsonImport && jsonStep !== "upload";
  const jsonStepMeta = {
    preview: { index: 2, title: "Предпросмотр" },
    mapping: { index: 3, title: "Маппинг" },
    hierarchy: { index: 4, title: "Иерархия" },
  } as const;
  const dialogTitle = isJsonWizard
    ? `Создание через импорт. Шаг ${jsonStepMeta[jsonStep as Exclude<JsonImportStep, "upload">].index} из 4. ${
        jsonStepMeta[jsonStep as Exclude<JsonImportStep, "upload">].title
      }`
    : "Добавить знания";
  const isJsonBusy = isSubmitting || jsonIsSubmitting || isUploading || jsonIsAnalyzing;
  const jsonPrimaryLabel =
    jsonStep === "hierarchy"
      ? jsonIsSubmitting
        ? "Импортируем..."
        : "Импортировать"
      : "Далее";
  const jsonAlertMessage = jsonPreviewError ? uploadError : jsonError || uploadError;

  const formId = "knowledge-document-form";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          "flex max-w-3xl flex-col gap-0 overflow-hidden p-0",
          isJsonWizard && "h-[95vh] w-[95vw] max-h-[95vh] max-w-[95vw]",
        )}
      >
        <DialogHeader className="shrink-0 px-6 pt-6 pb-4">
          <DialogTitle>{dialogTitle}</DialogTitle>
        </DialogHeader>

        <form
          id={formId}
          onSubmit={handleSubmit}
          className="flex-1 space-y-4 overflow-x-hidden overflow-y-auto px-6 pb-6 pt-4 min-h-0"
        >
          <div className="space-y-4">
            {(!isJsonImport || jsonStep === "upload") && (
              <>
                {!(mode === "crawl" && crawlMode === "multiple") && (
                  <div className="grid grid-cols-[12rem_1fr] items-start gap-3">
                    <Label htmlFor="knowledge-document-title" className="pt-2">
                      Название
                    </Label>
                    <div className="space-y-1">
                      <Input
                        id="knowledge-document-title"
                        value={title}
                        onChange={handleTitleChange}
                        placeholder={
                          mode === "crawl"
                            ? "Будет заполнено автоматически после импорта"
                            : "Например, Руководство по продукту"
                        }
                        maxLength={500}
                        autoFocus
                        disabled={mode === "crawl" || isSubmitting}
                      />
                      {mode === "crawl" && crawlMode === "single" && (
                        <p className="text-xs text-muted-foreground">
                          После импорта название будет установлено по заголовку страницы.
                        </p>
                      )}
                    </div>
                  </div>
                )}

                {mode !== "json_import" && !(mode === "crawl" && crawlMode === "multiple") && (
                  <div className="grid grid-cols-[12rem_1fr] items-start gap-3">
                    <Label className="pt-2">Размещение</Label>
                    <div className="space-y-1">
                      <Select value={parentValue} onValueChange={setParentValue}>
                        <SelectTrigger>
                          <SelectValue placeholder="Выберите раздел" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={ROOT_PARENT_VALUE}>В корне базы</SelectItem>
                          {folderOptions.map((option) => (
                            <SelectItem key={option.id} value={option.id}>
                              <span className="flex items-center gap-2">
                                {"\u00A0".repeat(option.level * 2)}
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
                  </div>
                )}

                {mode === "json_import" && (
                  <div className="grid grid-cols-[minmax(0,12rem)_1fr] items-start gap-3">
                    <Label className="pt-2">Размещение</Label>
                    <div className="space-y-1">
                      <Select value={parentValue} onValueChange={setParentValue}>
                        <SelectTrigger>
                          <SelectValue placeholder="Выберите раздел" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={ROOT_PARENT_VALUE}>В корне базы</SelectItem>
                          {folderOptions.map((option) => (
                            <SelectItem key={option.id} value={option.id}>
                              <span className="flex items-center gap-2">
                                {"\u00A0".repeat(option.level * 2)}
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
                  </div>
                )}

                <ImportModeSelector
                  mode={mode as any}
                  onModeChange={(value) => handleModeChange(value as KnowledgeNodeSourceType)}
                  options={DOCUMENT_CREATION_OPTIONS.map((opt) => ({
                    value: opt.value as any,
                    title: opt.title,
                    description: opt.description,
                    icon: opt.icon,
                  }))}
                  disabled={isSubmitting || isJsonBusy}
                />
              </>
            )}

            {isJsonImport && jsonStep === "upload" && (
              <div className="grid grid-cols-[minmax(0,12rem)_1fr] items-start gap-3">
                <Label htmlFor="json-import-file" className="pt-2">
                  Файл JSON/JSONL
                </Label>
                <div className="space-y-2">
                  <Input
                    ref={jsonFileInputRef}
                    id="json-import-file"
                    type="file"
                    accept=".json,.jsonl"
                    onChange={handleJsonFileChange}
                    disabled={isJsonBusy}
                    className="cursor-pointer"
                  />
                  <p className="text-xs text-muted-foreground">
                    Поддерживаются .json и .jsonl до 2GB.
                  </p>
                  {jsonFile && (
                    <div className="flex items-center justify-between rounded-md border border-muted-foreground/20 bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                      <span className="flex-1 min-w-0 truncate">
                        {jsonFile.name} · {(jsonFile.size / 1024 / 1024).toFixed(2)} МБ
                      </span>
                      {!isJsonBusy && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setJsonFile(null);
                            setJsonUploadedFileKey(null);
                            setJsonStructureAnalysis(null);
                            setJsonPreviewError(null);
                            setJsonMappingConfig(null);
                            setJsonIsMappingValid(false);
                            setJsonShowMappingValidationErrors(false);
                            setJsonHierarchyConfig(null);
                            if (jsonFileInputRef.current) {
                              jsonFileInputRef.current.value = "";
                            }
                          }}
                          className="h-7 px-2"
                        >
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  )}

                  {isUploading && uploadProgress && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span>
                          Загрузка части {uploadProgress.currentPart} из {uploadProgress.totalParts}
                        </span>
                        <span className="font-medium">{uploadProgress.percent}%</span>
                      </div>
                      <Progress value={uploadProgress.percent} />
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={abort}
                        disabled={isJsonBusy}
                        className="w-full"
                      >
                        <X className="mr-2 h-4 w-4" />
                        Отменить загрузку
                      </Button>
                    </div>
                  )}

                  {jsonIsAnalyzing && (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Анализ структуры файла...
                    </div>
                  )}

                  {jsonUploadedFileKey && jsonStructureAnalysis && (
                    <Alert className="border-emerald-200 bg-emerald-50">
                      <AlertDescription className="text-xs">
                        Файл загружен и проанализирован. Нажмите «Далее» для предпросмотра.
                      </AlertDescription>
                    </Alert>
                  )}

                  {jsonPreviewError && (
                    <Alert variant="destructive">
                      <AlertDescription>
                        <p className="text-xs font-medium">{jsonPreviewError.error}</p>
                        {jsonPreviewError.details && (
                          <p className="mt-1 text-xs">{jsonPreviewError.details}</p>
                        )}
                      </AlertDescription>
                    </Alert>
                  )}
                </div>
              </div>
            )}

            {mode === "manual" ? (
              <div className="grid grid-cols-[12rem_1fr] items-start gap-3">
                <Label htmlFor="knowledge-document-content" className="pt-2">
                  Стартовое содержимое (необязательно)
                </Label>
                <div className="space-y-1">
                  <Textarea
                    id="knowledge-document-content"
                    value={manualContent}
                    onChange={(event) => setManualContent(event.target.value)}
                    placeholder="Добавьте текст документа или оставьте поле пустым"
                    className="min-h-[8rem]"
                    maxLength={MAX_CONTENT_LENGTH}
                  />
                  <p className="text-xs text-muted-foreground">
                    Длина: {manualContent.length.toLocaleString("ru-RU")} символов из {MAX_CONTENT_LENGTH.toLocaleString("ru-RU")}.
                  </p>
                </div>
              </div>
            ) : mode === "import" ? (
              <div className="space-y-3">
                {/* Toggle режима импорта */}
                <div className="grid grid-cols-[12rem_1fr] items-center gap-3">
                  <Label className="pt-2">Режим импорта</Label>
                  <Tabs
                    value={fileImportMode}
                    onValueChange={(value) => {
                      const nextMode = value as FileImportMode;
                      setFileImportMode(nextMode);
                      setBulkImportResult(null);
                      if (nextMode === "single") {
                        setImportFiles([]);
                      } else {
                        setImportFile(null);
                        setImportHtml("");
                        setImportDetectedTitle(null);
                      }
                    }}
                  >
                    <TabsList className="grid w-full max-w-md grid-cols-3">
                      <TabsTrigger value="single" disabled={isSubmitting || isBulkImporting}>
                        Один файл
                      </TabsTrigger>
                      <TabsTrigger value="multiple" disabled={isSubmitting || isBulkImporting}>
                        Несколько файлов
                      </TabsTrigger>
                      <TabsTrigger value="archive" disabled={isSubmitting || isBulkImporting}>
                        ZIP-архив
                      </TabsTrigger>
                    </TabsList>
                  </Tabs>
                </div>
                
                {fileImportMode === "single" ? (
                  // Одиночный импорт (старая логика)
                  <>
                    <div className="grid grid-cols-[12rem_1fr] items-start gap-3">
                      <Label htmlFor="knowledge-document-file" className="pt-2">
                        Файл документа
                      </Label>
                      <div
                        className={cn(
                          "flex flex-col gap-3 rounded-md border border-dashed p-4 text-sm transition",
                          isDragActive ? "border-primary bg-primary/5" : "border-muted-foreground/30",
                        )}
                        onDragOver={handleDragOver}
                        onDragEnter={handleDragOver}
                        onDragLeave={handleDragLeave}
                        onDrop={handleFileDrop}
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <Input
                            ref={fileInputRef}
                            id="knowledge-document-file"
                            type="file"
                            accept={ACCEPTED_FILE_TYPES}
                            onChange={handleFileChange}
                            disabled={isSubmitting || isReadingFile}
                          />
                          {isReadingFile && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Перетащите файл сюда или выберите на компьютере. Максимальный размер — 20 МБ.
                        </p>
                        {importFile && (
                          <div className="flex flex-wrap items-center gap-3 rounded-md border border-muted-foreground/20 bg-muted/40 p-3 text-xs text-muted-foreground">
                            <FileText className="h-4 w-4" />
                            <span>
                              {importFile.name} · {(importFile.size / 1024).toFixed(1)} КБ
                            </span>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={handleRemoveFile}
                              className="h-7 px-2"
                            >
                              <Trash2 className="mr-1 h-3.5 w-3.5" /> Удалить
                            </Button>
                          </div>
                        )}
                        {importError && (
                          <p className="flex items-center gap-2 text-xs text-destructive">
                            <AlertCircle className="h-4 w-4" /> {importError}
                          </p>
                        )}
                      </div>
                    </div>

                    {importHtml && (
                      <div className="space-y-2">
                        <Label>Предпросмотр содержимого</Label>
                        <div className="prose prose-sm max-h-64 w-full max-w-none overflow-auto rounded-md border bg-muted/40 p-3">
                          <div
                            dangerouslySetInnerHTML={{
                              __html: applyTitleToImportedHtml(
                                importHtml,
                                title.trim() || importDetectedTitle || "Документ",
                              ),
                            }}
                          />
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  // Множественный импорт или архив
                  <FileImportPanel
                    mode={fileImportMode}
                    onModeChange={setFileImportMode}
                    files={importFiles}
                    onFilesChange={setImportFiles}
                    isProcessing={isBulkImporting}
                    processingProgress={bulkImportProgress}
                    error={formError}
                    disabled={isSubmitting || isBulkImporting}
                    allowArchives={true}
                  />
                )}
                
                {/* Результат bulk импорта */}
                {bulkImportResult && (
                  <div className="space-y-2 rounded-md border p-4">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      {bulkImportResult.failed === 0 ? (
                        <>
                          <AlertCircle className="h-4 w-4 text-green-500" />
                          Импорт завершён успешно
                        </>
                      ) : (
                        <>
                          <AlertCircle className="h-4 w-4 text-yellow-500" />
                          Импорт завершён с ошибками
                        </>
                      )}
                    </div>
                    <div className="text-sm text-muted-foreground">
                      <p>Импортировано: {bulkImportResult.created} документов</p>
                      {bulkImportResult.failed > 0 && (
                        <>
                          <p>Ошибок: {bulkImportResult.failed}</p>
                          {bulkImportResult.errors.length > 0 && (
                            <div className="mt-2 space-y-1">
                              {bulkImportResult.errors.slice(0, 5).map((err, idx) => (
                                <p key={idx} className="text-xs text-destructive">
                                  {err.title}: {err.error}
                                </p>
                              ))}
                              {bulkImportResult.errors.length > 5 && (
                                <p className="text-xs text-muted-foreground">
                                  ... и ещё {bulkImportResult.errors.length - 5} ошибок
                                </p>
                              )}
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ) : mode === "crawl" ? (
              <CrawlImportPanel
                mode={crawlMode}
                onModeChange={setCrawlMode}
                singleUrl={crawlUrl}
                onSingleUrlChange={setCrawlUrl}
                config={crawlConfig}
                onConfigChange={setCrawlConfig}
                isSubmitting={isSubmitting}
                error={formError}
                disabled={isSubmitting}
              />
            ) : null}

            {isJsonImport && jsonStep === "preview" && jsonStructureAnalysis && (
              <div className="min-h-0">
                <StructurePreview analysis={jsonStructureAnalysis} />
              </div>
            )}

            {isJsonImport && jsonStep === "mapping" && jsonStructureAnalysis && (
              <div className="min-h-0">
                <DocumentFieldMappingEditor
                  analysis={jsonStructureAnalysis}
                  initialConfig={jsonMappingConfig ?? undefined}
                  onConfigChange={(config) => {
                    setJsonMappingConfig(config);
                  }}
                  onValidationChange={(isValid) => {
                    setJsonIsMappingValid(isValid);
                  }}
                  showValidationErrors={jsonShowMappingValidationErrors}
                  workspaceId={workspaceId ?? ""}
                />
              </div>
            )}

            {isJsonImport && jsonStep === "hierarchy" && jsonStructureAnalysis && (
              <div className="min-h-0">
                <HierarchyConfigEditor
                  analysis={jsonStructureAnalysis}
                  initialConfig={jsonHierarchyConfig ?? undefined}
                  onConfigChange={(config) => {
                    setJsonHierarchyConfig(config);
                  }}
                />
              </div>
            )}

            {isJsonImport && jsonStep === "upload" && (!workspaceId || !baseId) && (
              <Alert variant="destructive">
                <AlertDescription>Не указаны workspaceId или baseId для JSON импорта.</AlertDescription>
              </Alert>
            )}

            {isJsonImport && jsonAlertMessage && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>{jsonAlertMessage}</AlertDescription>
              </Alert>
            )}
          </div>

          {formError && !isJsonImport && (
            <p className="text-sm text-destructive">{formError}</p>
          )}
        </form>

        <DialogFooter className="sticky bottom-0 z-10 shrink-0 border-t bg-muted/50 px-6 py-4">
          {isJsonImport ? (
            <div className="flex w-full items-center justify-between">
              <div>
                {jsonStep !== "upload" && (
                  <Button type="button" variant="outline" onClick={handleJsonBack} disabled={isJsonBusy}>
                    <ChevronLeft className="mr-2 h-4 w-4" />
                    Назад
                  </Button>
                )}
              </div>
              <div className="flex gap-2">
                <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isJsonBusy}>
                  Отмена
                </Button>
                <Button type="button" onClick={handleJsonNext} disabled={isJsonBusy}>
                  {jsonPrimaryLabel}
                  {jsonStep !== "hierarchy" && <ChevronRight className="ml-2 h-4 w-4" />}
                </Button>
              </div>
            </div>
          ) : (
            <>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={isSubmitting || isReadingFile || isBulkImporting}
              >
                Отмена
              </Button>
              <Button
                type="submit"
                form={formId}
                disabled={
                  isSubmitting ||
                  isReadingFile ||
                  isBulkImporting ||
                  (mode === "import" && (fileImportMode === "multiple" || fileImportMode === "archive") && importFiles.length === 0)
                }
                className="min-w-[10rem]"
              >
                {isSubmitting || isBulkImporting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> {submitPendingLabel}
                  </>
                ) : (
                  <>
                    <SubmitIcon className="mr-2 h-4 w-4" /> {submitLabel}
                  </>
                )}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default CreateKnowledgeDocumentDialog;
