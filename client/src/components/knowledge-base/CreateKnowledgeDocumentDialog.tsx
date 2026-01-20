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
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  RadioGroup,
  RadioGroupItem,
} from "@/components/ui/radio-group";
import { convertFileToHtml, getSanitizedContent, buildHtmlFromPlainText } from "@/lib/document-import";
import { cn } from "@/lib/utils";
import type { KnowledgeBaseTreeNode } from "@shared/knowledge-base";
import type { KnowledgeNodeSourceType } from "@shared/schema";
import {
  AlertCircle,
  FileText,
  Folder,
  Globe,
  Loader2,
  Trash2,
  Upload,
  FileJson,
  ChevronRight,
  ChevronLeft,
  AlertTriangle,
  X,
} from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import { useJsonImportUpload } from "@/hooks/useJsonImportUpload";
import { apiRequest } from "@/lib/queryClient";
import type { StructureAnalysis, PreviewError } from "@/lib/json-import-types";
import type { MappingConfig, HierarchyConfig, CreateJsonImportRequest } from "@shared/json-import";
import { StructurePreview } from "./json-import/StructurePreview";
import { FieldMappingEditor } from "./json-import/FieldMappingEditor";
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
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importHtml, setImportHtml] = useState("");
  const [importDetectedTitle, setImportDetectedTitle] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [isReadingFile, setIsReadingFile] = useState(false);
  const [hasTitleBeenEdited, setHasTitleBeenEdited] = useState(false);
  const [isDragActive, setIsDragActive] = useState(false);

  // JSON Import states
  const [jsonImportStep, setJsonImportStep] = useState<"upload" | "preview" | "mapping" | "hierarchy">("upload");
  const [jsonFile, setJsonFile] = useState<File | null>(null);
  const [uploadedFileKey, setUploadedFileKey] = useState<string | null>(null);
  const [structureAnalysis, setStructureAnalysis] = useState<StructureAnalysis | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [previewError, setPreviewError] = useState<PreviewError | null>(null);
  const [mappingConfig, setMappingConfig] = useState<MappingConfig | null>(null);
  const [isMappingValid, setIsMappingValid] = useState(false);
  const [showMappingValidationErrors, setShowMappingValidationErrors] = useState(false);
  const [hierarchyConfig, setHierarchyConfig] = useState<HierarchyConfig | null>(null);
  const [isSubmittingJsonImport, setIsSubmittingJsonImport] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const jsonFileInputRef = useRef<HTMLInputElement | null>(null);

  // JSON Import upload hook
  const resolvedWorkspaceId = workspaceId ?? "";
  const { uploadFile, uploadProgress, isUploading, error: uploadError, abort } = useJsonImportUpload(resolvedWorkspaceId);

  const folderOptions = useMemo(() => buildFolderOptions(structure), [structure]);

  useEffect(() => {
    if (open) {
      setParentValue(resolveDefaultParentValue(defaultParentId));
    } else {
      setTitle("");
      setManualContent("");
      setCrawlUrl("");
      setImportFile(null);
      setImportHtml("");
      setImportDetectedTitle(null);
      setImportError(null);
      setFormError(null);
      setMode("manual");
      setIsReadingFile(false);
      setHasTitleBeenEdited(false);
      setIsDragActive(false);
      // Reset JSON import states
      setJsonImportStep("upload");
      setJsonFile(null);
      setUploadedFileKey(null);
      setStructureAnalysis(null);
      setIsAnalyzing(false);
      setPreviewError(null);
      setMappingConfig(null);
      setIsMappingValid(false);
      setShowMappingValidationErrors(false);
      setHierarchyConfig(null);
      setIsSubmittingJsonImport(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      if (jsonFileInputRef.current) {
        jsonFileInputRef.current.value = "";
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

  // JSON Import handlers
  const handleJsonFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0] ?? null;
    setJsonFile(selectedFile);
    setFormError(null);
    setUploadedFileKey(null);
    setStructureAnalysis(null);
    setPreviewError(null);
  };

  const handleJsonFileUpload = async () => {
    if (!jsonFile) {
      setFormError("Выберите файл для импорта");
      return;
    }

    const fileName = jsonFile.name.toLowerCase();
    if (!fileName.endsWith(".json") && !fileName.endsWith(".jsonl")) {
      setFormError("Поддерживаются только файлы .json и .jsonl");
      return;
    }

    const maxSize = 2 * 1024 * 1024 * 1024; // 2GB
    if (jsonFile.size > maxSize) {
      setFormError("Размер файла превышает максимально допустимый (2GB)");
      return;
    }

    setFormError(null);

    try {
      const result = await uploadFile(jsonFile);
      setUploadedFileKey(result.fileKey);
      await analyzeStructure(result.fileKey);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Не удалось загрузить файл";
      setFormError(message);
    }
  };

  const analyzeStructure = async (fileKey: string) => {
    setIsAnalyzing(true);
    setPreviewError(null);
    setFormError(null);

    try {
      const response = await apiRequest(
        "POST",
        "/api/knowledge/json-import/preview",
        { fileKey, sampleSize: 100 },
        undefined,
        { workspaceId: resolvedWorkspaceId },
      );

      if (!response.ok) {
        const errorData = (await response.json()) as PreviewError;
        setPreviewError(errorData);
        setFormError(errorData.error);
        return;
      }

      const analysis = (await response.json()) as StructureAnalysis;
      setStructureAnalysis(analysis);
      setJsonImportStep("preview");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Не удалось проанализировать файл";
      setPreviewError({
        error: message,
        code: "PARSE_ERROR",
      });
      setFormError(message);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleJsonImportNext = () => {
    if (jsonImportStep === "upload" && uploadedFileKey && structureAnalysis) {
      setJsonImportStep("preview");
    } else if (jsonImportStep === "preview") {
      setJsonImportStep("mapping");
      setShowMappingValidationErrors(false);
    } else if (jsonImportStep === "mapping") {
      setShowMappingValidationErrors(true);
      if (isMappingValid) {
        setJsonImportStep("hierarchy");
      }
    }
  };

  const handleJsonImportBack = () => {
    if (jsonImportStep === "preview") {
      setJsonImportStep("upload");
    } else if (jsonImportStep === "mapping") {
      setJsonImportStep("preview");
    } else if (jsonImportStep === "hierarchy") {
      setJsonImportStep("mapping");
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);

    // Handle JSON import separately
    if (mode === "json_import") {
      if (!baseId) {
        setFormError("База знаний не указана");
        return;
      }

      if (!uploadedFileKey || !jsonFile) {
        setFormError("Сначала загрузите файл");
        return;
      }

      if (!mappingConfig || !isMappingValid) {
        setFormError("Настройте маппинг полей");
        return;
      }

      setIsSubmittingJsonImport(true);
      setFormError(null);

      try {
        const finalHierarchyConfig: HierarchyConfig = {
          ...(hierarchyConfig ?? { mode: "flat" }),
          baseParentId: parentValue === ROOT_PARENT_VALUE ? null : parentValue,
        };

        const importRequest: CreateJsonImportRequest = {
          fileKey: uploadedFileKey,
          fileName: jsonFile.name,
          fileSize: jsonFile.size,
          mappingConfig: mappingConfig,
          hierarchyConfig: finalHierarchyConfig,
        };

        const response = await apiRequest(
          "POST",
          `/api/knowledge/bases/${baseId}/json-import`,
          importRequest,
          undefined,
          { workspaceId: resolvedWorkspaceId },
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
        setFormError(message);
      } finally {
        setIsSubmittingJsonImport(false);
      }
      return;
    }

    const trimmedTitle = title.trim();
    const parentId = parentValue === ROOT_PARENT_VALUE ? null : parentValue;

    if (mode === "crawl") {
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
      ? "Импортировать страницу"
      : mode === "import"
        ? "Импортировать файл"
        : "Создать документ";
  const submitPendingLabel =
    mode === "crawl"
      ? "Импорт..."
      : mode === "import"
        ? "Импорт..."
        : "Создание...";
  const SubmitIcon = mode === "crawl" ? Globe : mode === "import" ? Upload : FileText;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent 
        className={cn(
          "max-w-2xl",
          mode === "json_import" && "w-[1200px] h-[900px] max-w-[1200px] max-h-[900px] overflow-x-hidden"
        )}
        style={mode === "json_import" ? { width: "1200px", height: "900px", maxWidth: "1200px", maxHeight: "900px", overflowX: "hidden" } : undefined}
      >
        <form onSubmit={handleSubmit} className="space-y-5">
          <DialogHeader>
            <DialogTitle>
              {mode === "json_import" ? "Импорт JSON/JSONL" : "Добавить знания"}
            </DialogTitle>
            <DialogDescription>
              {mode === "json_import"
                ? `Импортируйте структурированные данные из JSON или JSONL файлов в базу «${baseName}».`
                : `Добавьте один или несколько документов в базу «${baseName}». Выберите расположение и способ создания.`}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {mode !== "json_import" && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="knowledge-document-title">Название документа</Label>
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
                  {mode === "crawl" && (
                    <p className="text-xs text-muted-foreground">
                      После импорта название будет установлено по заголовку страницы.
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label>Размещение</Label>
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
                  <p className="text-xs text-muted-foreground">Текущий выбор: {parentDescription}</p>
                </div>
              </>
            )}

            {mode === "json_import" && (
              <div className="space-y-2">
                <Label>Размещение</Label>
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
                <p className="text-xs text-muted-foreground">
                  Документы будут импортированы в: {parentDescription}
                </p>
              </div>
            )}

            <div className="space-y-2">
              <Label>Способ создания</Label>
              <RadioGroup
                value={mode}
                onValueChange={(value) => handleModeChange(value as KnowledgeNodeSourceType)}
                className="grid gap-2 sm:grid-cols-2 md:grid-cols-4"
              >
                <label
                  htmlFor="knowledge-document-mode-manual"
                  className={cn(
                    "flex cursor-pointer flex-col gap-1 rounded-md border p-3 text-sm transition",
                    mode === "manual" ? "border-primary bg-primary/5" : "hover:border-primary/40",
                  )}
                >
                  <div className="flex items-center gap-2">
                    <RadioGroupItem
                      value="manual"
                      id="knowledge-document-mode-manual"
                      disabled={isSubmitting}
                    />
                    <span className="font-medium">Пустой документ</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Создайте чистый документ и заполните его позже или добавьте текст прямо сейчас.
                  </p>
                </label>

                <label
                  htmlFor="knowledge-document-mode-import"
                  className={cn(
                    "flex cursor-pointer flex-col gap-1 rounded-md border p-3 text-sm transition",
                    mode === "import" ? "border-primary bg-primary/5" : "hover:border-primary/40",
                  )}
                >
                  <div className="flex items-center gap-2">
                    <RadioGroupItem
                      value="import"
                      id="knowledge-document-mode-import"
                      disabled={isSubmitting}
                    />
                    <span className="font-medium">Импорт из файла</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                  Загрузите текстовый документ до 20 МБ. Поддерживаются {SUPPORTED_FORMAT_LABEL}.
                  </p>
                </label>

                <label
                  htmlFor="knowledge-document-mode-crawl"
                  className={cn(
                    "flex cursor-pointer flex-col gap-1 rounded-md border p-3 text-sm transition",
                    mode === "crawl" ? "border-primary bg-primary/5" : "hover:border-primary/40",
                  )}
                >
                  <div className="flex items-center gap-2">
                    <RadioGroupItem
                      value="crawl"
                      id="knowledge-document-mode-crawl"
                      disabled={isSubmitting}
                    />
                    <span className="font-medium">Импорт со страницы</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Укажите ссылку, и мы извлечём контент так же, как при краулинге базы знаний.
                  </p>
                </label>

                <label
                  htmlFor="knowledge-document-mode-json"
                  className={cn(
                    "flex cursor-pointer flex-col gap-1 rounded-md border p-3 text-sm transition",
                    mode === "json_import" ? "border-primary bg-primary/5" : "hover:border-primary/40",
                  )}
                >
                  <div className="flex items-center gap-2">
                    <RadioGroupItem
                      value="json_import"
                      id="knowledge-document-mode-json"
                      disabled={isSubmitting}
                    />
                    <span className="font-medium">Импорт JSON/JSONL</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Импортируйте структурированные данные из JSON или JSONL файлов.
                  </p>
                </label>
              </RadioGroup>
            </div>

            {mode === "manual" ? (
              <div className="space-y-2">
                <Label htmlFor="knowledge-document-content">Стартовое содержимое (необязательно)</Label>
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
            ) : mode === "import" ? (
              <div className="space-y-3">
                <div className="space-y-2">
                  <Label htmlFor="knowledge-document-file">Файл документа</Label>
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
                    <div className="prose prose-sm max-h-64 overflow-auto rounded-md border bg-muted/40 p-3">
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
              </div>
            ) : mode === "crawl" ? (
              <div className="space-y-2">
                <Label htmlFor="knowledge-document-crawl-url">Ссылка на страницу</Label>
                <Input
                  id="knowledge-document-crawl-url"
                  type="url"
                  value={crawlUrl}
                  onChange={(event) => setCrawlUrl(event.target.value)}
                  placeholder="https://example.com/article"
                  disabled={isSubmitting}
                  autoComplete="off"
                />
                <p className="text-xs text-muted-foreground">
                  Заголовок документа будет определён автоматически по содержимому страницы.
                </p>
              </div>
            ) : mode === "json_import" ? (
              <div className="space-y-4">
                {/* Step indicator */}
                <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                  <span className={cn("px-2 py-1 rounded", jsonImportStep === "upload" ? "bg-primary text-primary-foreground" : "bg-muted")}>
                    1. Загрузка
                  </span>
                  <ChevronRight className="h-4 w-4" />
                  <span className={cn("px-2 py-1 rounded", jsonImportStep === "preview" ? "bg-primary text-primary-foreground" : "bg-muted")}>
                    2. Предпросмотр
                  </span>
                  <ChevronRight className="h-4 w-4" />
                  <span className={cn("px-2 py-1 rounded", jsonImportStep === "mapping" ? "bg-primary text-primary-foreground" : "bg-muted")}>
                    3. Маппинг
                  </span>
                  <ChevronRight className="h-4 w-4" />
                  <span className={cn("px-2 py-1 rounded", jsonImportStep === "hierarchy" ? "bg-primary text-primary-foreground" : "bg-muted")}>
                    4. Иерархия
                  </span>
                </div>

                {/* Step 1: Upload */}
                {jsonImportStep === "upload" && (
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="json-import-file">Файл JSON/JSONL</Label>
                      <input
                        ref={jsonFileInputRef}
                        id="json-import-file"
                        type="file"
                        accept=".json,.jsonl"
                        onChange={handleJsonFileChange}
                        disabled={isSubmittingJsonImport || isUploading}
                        className="block w-full text-sm text-muted-foreground file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-medium file:bg-primary file:text-primary-foreground hover:file:bg-primary/90"
                      />
                      {jsonFile && (
                        <div className="space-y-2">
                          <p className="text-sm text-muted-foreground">
                            Выбран: {jsonFile.name} ({(jsonFile.size / 1024 / 1024).toFixed(2)} MB)
                          </p>
                          {!uploadedFileKey && !isUploading && (
                            <Button
                              type="button"
                              onClick={handleJsonFileUpload}
                              disabled={isSubmittingJsonImport}
                              className="w-full"
                            >
                              Загрузить файл
                            </Button>
                          )}
                          {isUploading && uploadProgress && (
                            <div className="space-y-2">
                              <div className="flex items-center justify-between text-sm">
                                <span className="text-muted-foreground">
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
                                className="w-full"
                              >
                                <X className="mr-2 h-4 w-4" />
                                Отменить загрузку
                              </Button>
                            </div>
                          )}
                          {isAnalyzing && (
                            <div className="flex items-center justify-center py-4">
                              <Loader2 className="h-5 w-5 animate-spin mr-2" />
                              <span className="text-sm">Анализ структуры файла...</span>
                            </div>
                          )}
                          {uploadedFileKey && structureAnalysis && (
                            <Alert>
                              <AlertDescription>
                                Файл загружен и проанализирован. Нажмите "Далее" для продолжения.
                              </AlertDescription>
                            </Alert>
                          )}
                          {previewError && (
                            <Alert variant="destructive">
                              <AlertDescription>
                                <p className="font-medium">{previewError.error}</p>
                                {previewError.details && (
                                  <p className="text-sm mt-1">{previewError.details}</p>
                                )}
                              </AlertDescription>
                            </Alert>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Step 2: Preview */}
                {jsonImportStep === "preview" && structureAnalysis && (
                  <div className="max-h-[400px] overflow-y-auto overflow-x-hidden">
                    <StructurePreview analysis={structureAnalysis} />
                  </div>
                )}

                {/* Step 3: Mapping */}
                {jsonImportStep === "mapping" && structureAnalysis && (
                  <div className="max-h-[400px] overflow-y-auto overflow-x-hidden">
                    <FieldMappingEditor
                      analysis={structureAnalysis}
                      initialMapping={mappingConfig ?? undefined}
                      onMappingChange={(mapping) => {
                        setMappingConfig(mapping);
                      }}
                      onValidationChange={(isValid) => {
                        setIsMappingValid(isValid);
                      }}
                      showValidationErrors={showMappingValidationErrors}
                    />
                  </div>
                )}

                {/* Step 4: Hierarchy */}
                {jsonImportStep === "hierarchy" && structureAnalysis && (
                  <div className="max-h-[400px] overflow-y-auto overflow-x-hidden">
                    <HierarchyConfigEditor
                      analysis={structureAnalysis}
                      initialConfig={hierarchyConfig ?? undefined}
                      onConfigChange={(config) => {
                        setHierarchyConfig(config);
                      }}
                    />
                  </div>
                )}
              </div>
            ) : null}
          </div>

          {(formError || uploadError) && (
            <div className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
              <AlertCircle className="h-4 w-4" /> {formError || uploadError}
            </div>
          )}

          {mode === "json_import" && jsonImportStep === "hierarchy" && (
            (() => {
              const getBlockReason = () => {
                if (isSubmittingJsonImport) return "Идёт запуск импорта...";
                if (isUploading) return "Идёт загрузка файла...";
                if (!uploadedFileKey) return "Файл не загружен. Вернитесь к шагу загрузки.";
                if (!mappingConfig) return "Маппинг полей не настроен. Вернитесь к шагу маппинга.";
                if (!isMappingValid) return "Маппинг полей настроен некорректно. Вернитесь к шагу маппинга.";
                return null;
              };
              const blockReason = getBlockReason();
              return blockReason ? (
                <Alert variant="destructive" className="mt-2">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription>
                    <strong>Кнопка "Импортировать" заблокирована:</strong> {blockReason}
                  </AlertDescription>
                </Alert>
              ) : null;
            })()
          )}

          <DialogFooter>
            {mode === "json_import" ? (
              <div className="flex flex-col gap-3 w-full">
                {jsonImportStep === "upload" && !uploadedFileKey && (
                  <Alert>
                    <AlertDescription className="text-sm">
                      Загрузите файл для продолжения
                    </AlertDescription>
                  </Alert>
                )}
                {jsonImportStep === "preview" && !structureAnalysis && (
                  <Alert variant="destructive">
                    <AlertTriangle className="h-4 w-4" />
                    <AlertDescription className="text-sm">
                      Не удалось проанализировать структуру файла. Вернитесь к шагу загрузки.
                    </AlertDescription>
                  </Alert>
                )}
                {jsonImportStep === "mapping" && !isMappingValid && !showMappingValidationErrors && (
                  <Alert>
                    <AlertDescription className="text-sm">
                      Настройте маппинг полей и нажмите "Далее" для проверки
                    </AlertDescription>
                  </Alert>
                )}
                <div className="flex items-center justify-between w-full">
                  <Button
                    variant="outline"
                    onClick={() => onOpenChange(false)}
                    disabled={isSubmittingJsonImport || isUploading}
                  >
                    Отмена
                  </Button>
                  <div className="flex gap-2">
                    {jsonImportStep !== "upload" && (
                      <Button
                        variant="outline"
                        type="button"
                        onClick={handleJsonImportBack}
                        disabled={isSubmittingJsonImport || isUploading}
                      >
                        <ChevronLeft className="mr-2 h-4 w-4" />
                        Назад
                      </Button>
                    )}
                    {jsonImportStep === "upload" && uploadedFileKey && structureAnalysis && (
                      <Button 
                        type="button"
                        onClick={handleJsonImportNext} 
                        disabled={isSubmittingJsonImport || isUploading || isAnalyzing}
                      >
                        Далее
                        <ChevronRight className="ml-2 h-4 w-4" />
                      </Button>
                    )}
                    {jsonImportStep === "preview" && (
                      <Button 
                        type="button"
                        onClick={handleJsonImportNext} 
                        disabled={isSubmittingJsonImport || isUploading || !structureAnalysis}
                      >
                        Далее
                        <ChevronRight className="ml-2 h-4 w-4" />
                      </Button>
                    )}
                    {jsonImportStep === "mapping" && (
                      <Button
                        type="button"
                        onClick={handleJsonImportNext}
                        disabled={isSubmittingJsonImport || isUploading || !isMappingValid}
                      >
                        Далее
                        <ChevronRight className="ml-2 h-4 w-4" />
                      </Button>
                    )}
                    {jsonImportStep === "hierarchy" && (
                      <Button
                        type="submit"
                        disabled={isSubmittingJsonImport || isUploading || !uploadedFileKey || !mappingConfig || !isMappingValid}
                      >
                        {isSubmittingJsonImport ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Импорт...
                          </>
                        ) : (
                          <>
                            <FileJson className="mr-2 h-4 w-4" />
                            Импортировать
                          </>
                        )}
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => onOpenChange(false)}
                  disabled={isSubmitting || isReadingFile}
                >
                  Отмена
                </Button>
                <Button
                  type="submit"
                  disabled={isSubmitting || isReadingFile}
                  className="min-w-[10rem]"
                >
                  {isSubmitting ? (
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
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default CreateKnowledgeDocumentDialog;
