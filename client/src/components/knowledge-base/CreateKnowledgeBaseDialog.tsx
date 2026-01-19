import { useEffect, useRef, useState, type ChangeEvent, type ComponentType } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useCreateKnowledgeBase } from "@/hooks/useCreateKnowledgeBase";
import { useJsonImportUpload } from "@/hooks/useJsonImportUpload";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import type { CreateKnowledgeBaseInput } from "@/hooks/useCreateKnowledgeBase";
import type { KnowledgeBase, KnowledgeBaseSourceType } from "@/lib/knowledge-base";
import type { StructureAnalysis, PreviewError } from "@/lib/json-import-types";
import type { MappingConfig, HierarchyConfig, CreateJsonImportRequest } from "@shared/json-import";
import { StructurePreview } from "./json-import/StructurePreview";
import { FieldMappingEditor } from "./json-import/FieldMappingEditor";
import { HierarchyConfigEditor } from "./json-import/HierarchyConfig";
import { ChevronDown, ChevronUp, FolderArchive, Globe, HelpCircle, NotebookPen, FileJson, Loader2, X, ChevronRight, ChevronLeft } from "lucide-react";

type CreationOption = {
  value: KnowledgeBaseSourceType;
  title: string;
  description: string;
  icon: ComponentType<{ className?: string }>;
};

export const KNOWLEDGE_BASE_CREATION_OPTIONS: CreationOption[] = [
  {
    value: "blank",
    title: "Пустая база",
    description: "Создайте структуру с нуля и наполняйте контент вручную или с помощью AI.",
    icon: NotebookPen,
  },
  {
    value: "archive",
    title: "Импорт архива",
    description: "Загрузите ZIP-архив документов, чтобы автоматически разложить их в иерархию.",
    icon: FolderArchive,
  },
  {
    value: "crawler",
    title: "Краулинг сайта",
    description: "Подключите корпоративный портал или знания из публичного сайта для автообновления.",
    icon: Globe,
  },
  {
    value: "json_import",
    title: "Импорт JSON/JSONL",
    description: "Импортируйте структурированные данные из JSON или JSONL файлов в базу знаний.",
    icon: FileJson,
  },
];

type JsonImportStep = "upload" | "preview" | "mapping" | "hierarchy";

type CreateKnowledgeBaseDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialMode?: KnowledgeBaseSourceType;
  onCreated?: (base: KnowledgeBase) => void;
  workspaceId?: string | null;
  onJsonImportStarted?: (jobId: string) => void;
};

type FieldLabelWithTooltipProps = {
  label: string;
  tooltip: string;
  htmlFor?: string;
};

function FieldLabelWithTooltip({ label, tooltip, htmlFor }: FieldLabelWithTooltipProps) {
  return (
    <div className="flex items-center gap-2">
      {htmlFor ? (
        <label className="text-sm font-medium" htmlFor={htmlFor}>
          {label}
        </label>
      ) : (
        <p className="text-sm font-medium">{label}</p>
      )}
      <Tooltip>
        <TooltipTrigger asChild>
          <HelpCircle className="h-4 w-4 cursor-help text-muted-foreground" aria-hidden="true" />
        </TooltipTrigger>
        <TooltipContent className="max-w-xs text-xs leading-relaxed">{tooltip}</TooltipContent>
      </Tooltip>
    </div>
  );
}

export function CreateKnowledgeBaseDialog({
  open,
  onOpenChange,
  initialMode = "blank",
  onCreated,
  workspaceId,
  onJsonImportStarted,
}: CreateKnowledgeBaseDialogProps) {
  const { toast } = useToast();
  const archiveInputRef = useRef<HTMLInputElement | null>(null);
  const jsonFileInputRef = useRef<HTMLInputElement | null>(null);
  const [mode, setMode] = useState<KnowledgeBaseSourceType>(initialMode);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  
  // JSON Import wizard states
  const [jsonImportStep, setJsonImportStep] = useState<JsonImportStep>("upload");
  const [jsonFile, setJsonFile] = useState<File | null>(null);
  const [uploadedFileKey, setUploadedFileKey] = useState<string | null>(null);
  const [structureAnalysis, setStructureAnalysis] = useState<StructureAnalysis | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [previewError, setPreviewError] = useState<PreviewError | null>(null);
  const [mappingConfig, setMappingConfig] = useState<MappingConfig | null>(null);
  const [isMappingValid, setIsMappingValid] = useState(false);
  const [hierarchyConfig, setHierarchyConfig] = useState<HierarchyConfig | null>(null);
  const [isSubmittingImport, setIsSubmittingImport] = useState(false);
  const [startUrlsInput, setStartUrlsInput] = useState("");
  const [sitemapUrl, setSitemapUrl] = useState("");
  const [allowedDomainsInput, setAllowedDomainsInput] = useState("");
  const [includePatternsInput, setIncludePatternsInput] = useState("");
  const [excludePatternsInput, setExcludePatternsInput] = useState("");
  const [maxPagesInput, setMaxPagesInput] = useState("");
  const [maxDepthInput, setMaxDepthInput] = useState("");
  const [rateLimitInput, setRateLimitInput] = useState("");
  const [robotsTxtEnabled, setRobotsTxtEnabled] = useState(true);
  const [selectorTitle, setSelectorTitle] = useState("");
  const [selectorContent, setSelectorContent] = useState("");
  const [language, setLanguage] = useState("");
  const [version, setVersion] = useState("");
  const [authHeadersInput, setAuthHeadersInput] = useState("");
  const [archiveFile, setArchiveFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showCrawlerAdvanced, setShowCrawlerAdvanced] = useState(false);
  const createBaseMutation = useCreateKnowledgeBase(workspaceId);
  
  // JSON Import upload hook - needs workspaceId for S3 upload
  const resolvedWorkspaceId = workspaceId ?? "";
  const { uploadFile, uploadProgress, isUploading, error: uploadError, abort } = useJsonImportUpload(resolvedWorkspaceId);

  const parseListInput = (value: string): string[] =>
    value
      .split(/[,\n]/)
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);

  const parseNumberInput = (value: string): number | undefined => {
    const trimmed = value.trim();
    if (!trimmed) {
      return undefined;
    }
    const parsed = Number.parseInt(trimmed, 10);
    return Number.isNaN(parsed) ? undefined : parsed;
  };

  const parseHeadersInputToRecord = (value: string): Record<string, string> | undefined => {
    const headers: Record<string, string> = {};
    value
      .split(/\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .forEach((line) => {
        const separatorIndex = line.indexOf(":");
        if (separatorIndex === -1) {
          return;
        }
        const key = line.slice(0, separatorIndex).trim();
        const headerValue = line.slice(separatorIndex + 1).trim();
        if (key && headerValue) {
          headers[key] = headerValue;
        }
      });

    return Object.keys(headers).length > 0 ? headers : undefined;
  };

  const resetForm = () => {
    setName("");
    setDescription("");
    setStartUrlsInput("");
    setSitemapUrl("");
    setAllowedDomainsInput("");
    setIncludePatternsInput("");
    setExcludePatternsInput("");
    setMaxPagesInput("");
    setMaxDepthInput("");
    setRateLimitInput("");
    setRobotsTxtEnabled(true);
    setSelectorTitle("");
    setSelectorContent("");
    setLanguage("");
    setVersion("");
    setAuthHeadersInput("");
    setArchiveFile(null);
    setError(null);
    setShowCrawlerAdvanced(false);
    if (archiveInputRef.current) {
      archiveInputRef.current.value = "";
    }
    // Reset JSON import states
    setJsonImportStep("upload");
    setJsonFile(null);
    setUploadedFileKey(null);
    setStructureAnalysis(null);
    setIsAnalyzing(false);
    setPreviewError(null);
    setMappingConfig(null);
    setIsMappingValid(false);
    setHierarchyConfig(null);
    setIsSubmittingImport(false);
    if (jsonFileInputRef.current) {
      jsonFileInputRef.current.value = "";
    }
  };

  useEffect(() => {
    if (open) {
      setMode(initialMode);
    }
  }, [initialMode, open]);

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      resetForm();
    }
    onOpenChange(nextOpen);
  };

  const handleModeChange = (value: KnowledgeBaseSourceType) => {
    setMode(value);
    setError(null);
    setShowCrawlerAdvanced(false);
    if (value !== "archive") {
      setArchiveFile(null);
      if (archiveInputRef.current) {
        archiveInputRef.current.value = "";
      }
    }
    if (value !== "json_import") {
      // Reset JSON import states when switching away from json_import
      setJsonImportStep("upload");
      setJsonFile(null);
      setUploadedFileKey(null);
      setStructureAnalysis(null);
      setPreviewError(null);
      setMappingConfig(null);
      setIsMappingValid(false);
      setHierarchyConfig(null);
      if (jsonFileInputRef.current) {
        jsonFileInputRef.current.value = "";
      }
    }
    if (value !== "crawler") {
      setStartUrlsInput("");
      setSitemapUrl("");
      setAllowedDomainsInput("");
      setIncludePatternsInput("");
      setExcludePatternsInput("");
      setMaxPagesInput("");
      setMaxDepthInput("");
      setRateLimitInput("");
      setRobotsTxtEnabled(true);
      setSelectorTitle("");
      setSelectorContent("");
      setLanguage("");
      setVersion("");
      setAuthHeadersInput("");
    }
  };

  const handleArchiveChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    setArchiveFile(file);
  };

  // JSON Import handlers
  const handleJsonFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0] ?? null;
    setJsonFile(selectedFile);
    setError(null);
    // Reset upload state when file changes
    setUploadedFileKey(null);
    setStructureAnalysis(null);
    setPreviewError(null);
  };

  const handleJsonFileUpload = async () => {
    if (!jsonFile) {
      setError("Выберите файл для импорта");
      return;
    }

    // Validate extension
    const fileName = jsonFile.name.toLowerCase();
    if (!fileName.endsWith(".json") && !fileName.endsWith(".jsonl")) {
      setError("Поддерживаются только файлы .json и .jsonl");
      return;
    }

    // Validate size (2GB)
    const maxSize = 2 * 1024 * 1024 * 1024;
    if (jsonFile.size > maxSize) {
      setError("Размер файла превышает максимально допустимый (2GB)");
      return;
    }

    setError(null);

    try {
      const result = await uploadFile(jsonFile);
      setUploadedFileKey(result.fileKey);
      // After upload, automatically analyze structure
      await analyzeStructure(result.fileKey);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Не удалось загрузить файл";
      setError(message);
      toast({
        variant: "destructive",
        title: "Ошибка загрузки",
        description: message,
      });
    }
  };

  const analyzeStructure = async (fileKey: string) => {
    setIsAnalyzing(true);
    setPreviewError(null);
    setError(null);

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
        toast({
          variant: "destructive",
          title: "Ошибка анализа",
          description: errorData.error,
        });
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
      toast({
        variant: "destructive",
        title: "Ошибка анализа",
        description: message,
      });
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleJsonImportNext = () => {
    if (jsonImportStep === "upload" && uploadedFileKey && structureAnalysis) {
      setJsonImportStep("preview");
    } else if (jsonImportStep === "preview") {
      setJsonImportStep("mapping");
    } else if (jsonImportStep === "mapping" && isMappingValid) {
      setJsonImportStep("hierarchy");
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

  const handleSubmit = async () => {
    if (createBaseMutation.isPending || isSubmittingImport) {
      return;
    }

    if (!name.trim()) {
      setError("Укажите название базы знаний");
      return;
    }

    if (mode === "archive" && !archiveFile) {
      setError("Выберите архив документов для импорта");
      return;
    }

    if (mode === "json_import") {
      // Validate JSON import requirements
      if (!uploadedFileKey || !jsonFile) {
        setError("Сначала загрузите файл");
        return;
      }
      if (!mappingConfig || !isMappingValid) {
        setError("Настройте маппинг полей");
        return;
      }
    }

    setError(null);

    try {
      let crawlerConfig: CreateKnowledgeBaseInput["crawlerConfig"] | undefined;
      if (mode === "crawler") {
        const startUrls = parseListInput(startUrlsInput);
        if (startUrls.length === 0) {
          setError("Укажите хотя бы один стартовый URL для краулинга");
          return;
        }

        const headersRecord = parseHeadersInputToRecord(authHeadersInput);

        crawlerConfig = {
          startUrls,
          sitemapUrl: sitemapUrl.trim() || undefined,
          allowedDomains: parseListInput(allowedDomainsInput),
          include: parseListInput(includePatternsInput),
          exclude: parseListInput(excludePatternsInput),
          maxPages: parseNumberInput(maxPagesInput),
          maxDepth: parseNumberInput(maxDepthInput),
          rateLimitRps: parseNumberInput(rateLimitInput),
          robotsTxt: robotsTxtEnabled,
          selectors: {
            title: selectorTitle.trim() || undefined,
            content: selectorContent.trim() || undefined,
          },
          language: language.trim() || undefined,
          version: version.trim() || undefined,
          authHeaders: headersRecord,
        };
      }

      // For json_import, we need to create the base first, then start the import
      if (mode === "json_import") {
        setIsSubmittingImport(true);
        
        // Step 1: Create the knowledge base
        const created = await createBaseMutation.mutateAsync({
          name,
          description,
          mode,
          archiveFile: null,
          crawlerConfig: undefined,
        });

        // Step 2: Start the JSON import job
        try {
          const finalHierarchyConfig = hierarchyConfig ?? {
            mode: "flat" as const,
          };

          const importRequest: CreateJsonImportRequest = {
            fileKey: uploadedFileKey!,
            fileName: jsonFile!.name,
            fileSize: jsonFile!.size,
            mappingConfig: mappingConfig!,
            hierarchyConfig: finalHierarchyConfig,
          };

          const response = await apiRequest(
            "POST",
            `/api/knowledge/bases/${created.id}/json-import`,
            importRequest,
            undefined,
            { workspaceId: resolvedWorkspaceId },
          );

          const data = (await response.json()) as { jobId: string; status: "pending" };

          toast({
            title: "База знаний создана",
            description: "Импорт JSON/JSONL запущен. Вы можете отслеживать прогресс на странице базы знаний.",
          });

          onCreated?.(created);
          onJsonImportStarted?.(data.jobId);
          handleOpenChange(false);
        } catch (importErr) {
          // Base was created but import failed
          const message = importErr instanceof Error ? importErr.message : "Не удалось запустить импорт";
          setError(`База создана, но импорт не запустился: ${message}`);
          toast({
            variant: "destructive",
            title: "Ошибка импорта",
            description: message,
          });
        } finally {
          setIsSubmittingImport(false);
        }
      } else {
        // For other modes, just create the base
        const created = await createBaseMutation.mutateAsync({
          name,
          description,
          mode,
          archiveFile,
          crawlerConfig,
        });

        onCreated?.(created);
        handleOpenChange(false);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Не удалось создать базу знаний. Попробуйте снова.";
      setError(message);
      setIsSubmittingImport(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className={cn("max-w-xl", mode === "json_import" && "max-w-3xl")}>
        <DialogHeader>
          <DialogTitle>
            {mode === "json_import" ? "Импорт JSON/JSONL" : "Создание базы знаний"}
          </DialogTitle>
          <DialogDescription>
            {mode === "json_import" 
              ? "Загрузите файл, настройте маппинг полей и иерархию документов."
              : "Выберите подходящий сценарий, задайте название и при необходимости укажите источники данных."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Hide mode selection and name/description when in JSON import wizard steps beyond upload */}
          {!(mode === "json_import" && jsonImportStep !== "upload") && (
            <>
              <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-4">
                {KNOWLEDGE_BASE_CREATION_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => handleModeChange(option.value)}
                    disabled={isUploading || isSubmittingImport}
                    className={cn(
                      "flex flex-col gap-2 rounded-lg border p-3 text-left transition",
                      mode === option.value ? "border-primary bg-primary/5" : "hover:border-primary/40",
                      (isUploading || isSubmittingImport) && "opacity-50 cursor-not-allowed",
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <option.icon className="h-4 w-4" />
                      <span className="text-sm font-semibold">{option.title}</span>
                    </div>
                    <p className="text-xs text-muted-foreground">{option.description}</p>
                  </button>
                ))}
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor="create-base-name">
                  Название базы знаний
                </label>
                <Input
                  id="create-base-name"
                  placeholder="Например, База знаний по клиентской поддержке"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  disabled={isUploading || isSubmittingImport}
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor="create-base-description">
                  Краткое описание
                </label>
                <Textarea
                  id="create-base-description"
                  rows={3}
                  disabled={isUploading || isSubmittingImport}
                  placeholder="Расскажите, для чего нужна база знаний и какие процессы она покрывает"
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                />
              </div>
            </>
          )}

          {mode === "archive" && (
            <div className="space-y-2">
              <label className="text-sm font-medium">ZIP-архив документов</label>
              <input
                ref={archiveInputRef}
                type="file"
                accept=".zip,.rar,.7z"
                className="hidden"
                onChange={handleArchiveChange}
              />
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" variant="outline" onClick={() => archiveInputRef.current?.click()}>
                  Выбрать архив
                </Button>
                {archiveFile ? (
                  <span className="text-xs text-muted-foreground">Выбрано: {archiveFile.name}</span>
                ) : (
                  <span className="text-xs text-muted-foreground">Поддерживаются ZIP, RAR и 7z архивы</span>
                )}
              </div>
            </div>
          )}

          {mode === "crawler" && (
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor="create-base-crawler-start-urls">
                  Стартовые URL
                </label>
                <Textarea
                  id="create-base-crawler-start-urls"
                  placeholder="https://example.com/docs\nhttps://docs.example.com/guide"
                  value={startUrlsInput}
                  onChange={(event) => setStartUrlsInput(event.target.value)}
                  rows={3}
                />
                <p className="text-xs text-muted-foreground">
                  Перечислите адреса, с которых начнём обход. Каждый URL — с новой строки или через запятую.
                </p>
              </div>

              <Collapsible open={showCrawlerAdvanced} onOpenChange={setShowCrawlerAdvanced}>
                <CollapsibleTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    className="flex w-full items-center justify-between px-0 text-sm font-medium"
                  >
                    {showCrawlerAdvanced ? "Скрыть дополнительные настройки" : "Дополнительные настройки"}
                    {showCrawlerAdvanced ? (
                      <ChevronUp className="h-4 w-4" aria-hidden="true" />
                    ) : (
                      <ChevronDown className="h-4 w-4" aria-hidden="true" />
                    )}
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent className="pt-2">
                  <TooltipProvider>
                    <div className="space-y-4">
                      <div className="grid gap-4 md:grid-cols-2">
                        <div className="space-y-2">
                          <FieldLabelWithTooltip
                            htmlFor="create-base-crawler-sitemap"
                            label="Sitemap (опционально)"
                            tooltip="Укажите ссылку на sitemap.xml или другой индекс, чтобы ускорить поиск страниц. Если поле пустое, краулер обойдётся без карты сайта."
                          />
                          <Input
                            id="create-base-crawler-sitemap"
                            placeholder="https://example.com/sitemap.xml"
                            value={sitemapUrl}
                            onChange={(event) => setSitemapUrl(event.target.value)}
                          />
                        </div>
                        <div className="space-y-2">
                          <FieldLabelWithTooltip
                            htmlFor="create-base-crawler-domains"
                            label="Разрешённые домены"
                            tooltip="Список доменов, на которых можно продолжать обход. Все ссылки на сторонние ресурсы будут игнорироваться."
                          />
                          <Textarea
                            id="create-base-crawler-domains"
                            placeholder="example.com\nsub.example.com"
                            value={allowedDomainsInput}
                            onChange={(event) => setAllowedDomainsInput(event.target.value)}
                            rows={3}
                          />
                        </div>
                      </div>

                      <div className="grid gap-4 md:grid-cols-2">
                        <div className="space-y-2">
                          <FieldLabelWithTooltip
                            htmlFor="create-base-crawler-include"
                            label="Включать пути / RegExp"
                            tooltip="Регулярные выражения или маски путей, которые должны попадать в базу. Сохраняем страницы только если URL соответствует хотя бы одному правилу."
                          />
                          <Textarea
                            id="create-base-crawler-include"
                            placeholder="/docs/.*"
                            value={includePatternsInput}
                            onChange={(event) => setIncludePatternsInput(event.target.value)}
                            rows={3}
                          />
                        </div>
                        <div className="space-y-2">
                          <FieldLabelWithTooltip
                            htmlFor="create-base-crawler-exclude"
                            label="Исключать пути / RegExp"
                            tooltip="URL, которые нужно пропустить. Если адрес подходит под правило, он не будет загружен и не попадёт в базу."
                          />
                          <Textarea
                            id="create-base-crawler-exclude"
                            placeholder="/blog/.*"
                            value={excludePatternsInput}
                            onChange={(event) => setExcludePatternsInput(event.target.value)}
                            rows={3}
                          />
                        </div>
                      </div>

                      <div className="grid gap-4 md:grid-cols-3">
                        <div className="space-y-2">
                          <FieldLabelWithTooltip
                            htmlFor="create-base-crawler-max-pages"
                            label="Максимум страниц"
                            tooltip="Ограничение на общее число страниц, которые загрузит краулер. Помогает контролировать бюджет обхода."
                          />
                          <Input
                            id="create-base-crawler-max-pages"
                            type="number"
                            min={1}
                            placeholder="500"
                            value={maxPagesInput}
                            onChange={(event) => setMaxPagesInput(event.target.value)}
                          />
                        </div>
                        <div className="space-y-2">
                          <FieldLabelWithTooltip
                            htmlFor="create-base-crawler-max-depth"
                            label="Максимальная глубина"
                            tooltip="Сколько уровней ссылок от стартовых страниц мы проходим. 0 — только стартовые URL, 1 — ссылки с них, и так далее."
                          />
                          <Input
                            id="create-base-crawler-max-depth"
                            type="number"
                            min={0}
                            placeholder="6"
                            value={maxDepthInput}
                            onChange={(event) => setMaxDepthInput(event.target.value)}
                          />
                        </div>
                        <div className="space-y-2">
                          <FieldLabelWithTooltip
                            htmlFor="create-base-crawler-rate-limit"
                            label="Лимит RPS"
                            tooltip="Максимальное количество запросов в секунду к сайту. Уменьшите значение, чтобы не перегружать источник."
                          />
                          <Input
                            id="create-base-crawler-rate-limit"
                            type="number"
                            min={1}
                            placeholder="2"
                            value={rateLimitInput}
                            onChange={(event) => setRateLimitInput(event.target.value)}
                          />
                        </div>
                      </div>

                      <div className="flex items-center justify-between rounded-md border px-3 py-2">
                        <div className="space-y-1">
                          <FieldLabelWithTooltip
                            label="Учитывать robots.txt"
                            tooltip="При включении краулер проверяет правила Disallow/Allow и избегает запрещённых разделов сайта. Отключите, если у вас есть право обходить закрытые разделы."
                          />
                          <p className="text-xs text-muted-foreground">Краулер будет уважать правила доступа сайта.</p>
                        </div>
                        <Switch checked={robotsTxtEnabled} onCheckedChange={setRobotsTxtEnabled} />
                      </div>

                      <div className="grid gap-4 md:grid-cols-2">
                        <div className="space-y-2">
                          <FieldLabelWithTooltip
                            htmlFor="create-base-crawler-selector-title"
                            label="CSS-селектор заголовка"
                            tooltip="Селектор для поиска основного заголовка на странице. Используйте его, если заголовок отличается от стандартных h1/title."
                          />
                          <Input
                            id="create-base-crawler-selector-title"
                            placeholder="h1"
                            value={selectorTitle}
                            onChange={(event) => setSelectorTitle(event.target.value)}
                          />
                        </div>
                        <div className="space-y-2">
                          <FieldLabelWithTooltip
                            htmlFor="create-base-crawler-selector-content"
                            label="CSS-селектор контента"
                            tooltip="Селектор контейнера с основным текстом. Помогает отфильтровать меню, футер и другие служебные блоки."
                          />
                          <Input
                            id="create-base-crawler-selector-content"
                            placeholder="article"
                            value={selectorContent}
                            onChange={(event) => setSelectorContent(event.target.value)}
                          />
                        </div>
                      </div>

                      <div className="grid gap-4 md:grid-cols-2">
                        <div className="space-y-2">
                          <FieldLabelWithTooltip
                            htmlFor="create-base-crawler-language"
                            label="Язык контента"
                            tooltip="ISO-код языка (например, ru или en). Используется для улучшения качеcтва поиска и выбора модели обработки."
                          />
                          <Input
                            id="create-base-crawler-language"
                            placeholder="ru"
                            value={language}
                            onChange={(event) => setLanguage(event.target.value)}
                          />
                        </div>
                        <div className="space-y-2">
                          <FieldLabelWithTooltip
                            htmlFor="create-base-crawler-version"
                            label="Версия документации"
                            tooltip="Дополнительный признак версии для документации. Можно указывать v2.0, release-2024 и т.п."
                          />
                          <Input
                            id="create-base-crawler-version"
                            placeholder="v2.0"
                            value={version}
                            onChange={(event) => setVersion(event.target.value)}
                          />
                        </div>
                      </div>

                      <div className="space-y-2">
                        <FieldLabelWithTooltip
                          htmlFor="create-base-crawler-headers"
                          label="Дополнительные HTTP-заголовки"
                          tooltip="Заголовки, которые будут отправляться в каждом запросе. Используйте для авторизации или передачи токенов доступа."
                        />
                        <Textarea
                          id="create-base-crawler-headers"
                          placeholder={"Authorization: Bearer <token>\nX-Token: secret"}
                          value={authHeadersInput}
                          onChange={(event) => setAuthHeadersInput(event.target.value)}
                          rows={3}
                        />
                        <p className="text-xs text-muted-foreground">Ключ: значение, каждый заголовок на отдельной строке.</p>
                      </div>
                    </div>
                  </TooltipProvider>
                </CollapsibleContent>
              </Collapsible>
            </div>
          )}

          {mode === "json_import" && (
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
                      disabled={isSubmittingImport || isUploading}
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
                            disabled={isSubmittingImport}
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
                <div className="max-h-[400px] overflow-y-auto">
                  <StructurePreview analysis={structureAnalysis} />
                </div>
              )}

              {/* Step 3: Mapping */}
              {jsonImportStep === "mapping" && structureAnalysis && (
                <div className="max-h-[400px] overflow-y-auto">
                  <FieldMappingEditor
                    analysis={structureAnalysis}
                    initialMapping={mappingConfig ?? undefined}
                    onMappingChange={(mapping) => {
                      setMappingConfig(mapping);
                    }}
                    onValidationChange={(isValid) => {
                      setIsMappingValid(isValid);
                    }}
                  />
                </div>
              )}

              {/* Step 4: Hierarchy */}
              {jsonImportStep === "hierarchy" && structureAnalysis && (
                <div className="max-h-[400px] overflow-y-auto">
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
          )}

          {(error || uploadError) && <p className="text-sm text-destructive">{error || uploadError}</p>}
        </div>

        <DialogFooter>
          {mode === "json_import" ? (
            <div className="flex items-center justify-between w-full">
              <Button
                variant="outline"
                onClick={() => handleOpenChange(false)}
                disabled={isSubmittingImport || isUploading}
              >
                Отмена
              </Button>
              <div className="flex gap-2">
                {jsonImportStep !== "upload" && (
                  <Button
                    variant="outline"
                    onClick={handleJsonImportBack}
                    disabled={isSubmittingImport || isUploading}
                  >
                    <ChevronLeft className="mr-2 h-4 w-4" />
                    Назад
                  </Button>
                )}
                {jsonImportStep === "upload" && uploadedFileKey && structureAnalysis && (
                  <Button onClick={handleJsonImportNext} disabled={isSubmittingImport || isUploading || isAnalyzing}>
                    Далее
                    <ChevronRight className="ml-2 h-4 w-4" />
                  </Button>
                )}
                {jsonImportStep === "preview" && (
                  <Button onClick={handleJsonImportNext} disabled={isSubmittingImport || isUploading || !structureAnalysis}>
                    Далее
                    <ChevronRight className="ml-2 h-4 w-4" />
                  </Button>
                )}
                {jsonImportStep === "mapping" && (
                  <Button
                    onClick={handleJsonImportNext}
                    disabled={isSubmittingImport || isUploading || !isMappingValid}
                  >
                    Далее
                    <ChevronRight className="ml-2 h-4 w-4" />
                  </Button>
                )}
                {jsonImportStep === "hierarchy" && (
                  <Button
                    onClick={handleSubmit}
                    disabled={isSubmittingImport || isUploading || !uploadedFileKey || !mappingConfig || !name.trim()}
                  >
                    {isSubmittingImport ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Создаём...
                      </>
                    ) : (
                      "Создать и импортировать"
                    )}
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <>
              <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={createBaseMutation.isPending}>
                Отмена
              </Button>
              <Button onClick={handleSubmit} disabled={createBaseMutation.isPending}>
                {createBaseMutation.isPending ? "Создаём..." : "Создать базу знаний"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default CreateKnowledgeBaseDialog;
