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
} from "lucide-react";
import { JsonImportPanel } from "./import/JsonImportPanel";
import { FileImportPanel, type FileImportMode } from "./import/FileImportPanel";
import { CrawlImportPanel, type CrawlMode, type CrawlConfig } from "./import/CrawlImportPanel";
import { useBulkDocumentImport } from "@/hooks/useBulkDocumentImport";

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

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  
  // Bulk import hook
  const resolvedWorkspaceId = workspaceId ?? "";
  const bulkImportMutation = useBulkDocumentImport(resolvedWorkspaceId, baseId ?? "");

  const folderOptions = useMemo(() => buildFolderOptions(structure), [structure]);

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

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);

    // JSON import обрабатывается через JsonImportPanel, не через handleSubmit
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
            { workspaceId: resolvedWorkspaceId }
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
            {mode !== "json_import" && !(mode === "crawl" && crawlMode === "multiple") && (
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
                  {mode === "crawl" && crawlMode === "single" && (
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
                {/* Toggle режима импорта */}
                <div className="flex items-center gap-4">
                  <Label>Режим импорта:</Label>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant={fileImportMode === "single" ? "default" : "outline"}
                      size="sm"
                      onClick={() => {
                        setFileImportMode("single");
                        setImportFiles([]);
                        setBulkImportResult(null);
                      }}
                      disabled={isSubmitting || isBulkImporting}
                    >
                      Один файл
                    </Button>
                    <Button
                      type="button"
                      variant={fileImportMode === "multiple" ? "default" : "outline"}
                      size="sm"
                      onClick={() => {
                        setFileImportMode("multiple");
                        setImportFile(null);
                        setImportHtml("");
                        setImportDetectedTitle(null);
                        setBulkImportResult(null);
                      }}
                      disabled={isSubmitting || isBulkImporting}
                    >
                      Несколько файлов
                    </Button>
                    <Button
                      type="button"
                      variant={fileImportMode === "archive" ? "default" : "outline"}
                      size="sm"
                      onClick={() => {
                        setFileImportMode("archive");
                        setImportFile(null);
                        setImportHtml("");
                        setImportDetectedTitle(null);
                        setBulkImportResult(null);
                      }}
                      disabled={isSubmitting || isBulkImporting}
                    >
                      ZIP-архив
                    </Button>
                  </div>
                </div>
                
                {fileImportMode === "single" ? (
                  // Одиночный импорт (старая логика)
                  <>
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
            ) : mode === "json_import" ? (
              workspaceId && baseId ? (
                <JsonImportPanel
                  workspaceId={workspaceId}
                  targetBaseId={baseId}
                  targetParentId={parentValue === ROOT_PARENT_VALUE ? null : parentValue}
                  onComplete={(result) => {
                    onJsonImportStarted?.(result.jobId);
                    onOpenChange(false);
                  }}
                  onCancel={() => setMode("manual")}
                  disabled={isSubmitting}
                />
              ) : (
                <div className="text-sm text-destructive">
                  Не указаны workspaceId или baseId для JSON импорта
                </div>
              )
            ) : null}
          </div>

          {formError && mode !== "json_import" && (
            <div className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
              <AlertCircle className="h-4 w-4" /> {formError}
            </div>
          )}

          <DialogFooter>
            {mode === "json_import" ? (
              // JSON импорт обрабатывается внутри JsonImportPanel
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={isSubmitting}
              >
                Отмена
              </Button>
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
                  disabled={
                    isSubmitting || 
                    isReadingFile || 
                    isBulkImporting ||
                    (mode === "import" && (fileImportMode === "multiple" || fileImportMode === "archive") && importFiles.length === 0)
                  }
                  className="min-w-[10rem]"
                >
                  {(isSubmitting || isBulkImporting) ? (
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
