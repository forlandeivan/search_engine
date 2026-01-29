import { useEffect, useRef, useState, type ChangeEvent, type ComponentType } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { useCreateKnowledgeBase } from "@/hooks/useCreateKnowledgeBase";
import { useJsonImportUpload } from "@/hooks/useJsonImportUpload";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import type { CreateKnowledgeBaseInput } from "@/hooks/useCreateKnowledgeBase";
import type { KnowledgeBase, KnowledgeBaseSourceType } from "@/lib/knowledge-base";
import type { StructureAnalysis, PreviewError } from "@/lib/json-import-types";
import type { MappingConfigV2, HierarchyConfig, CreateJsonImportRequest } from "@shared/json-import";
import {
  NotebookPen,
  FolderArchive,
  Globe,
  FileJson,
  ChevronLeft,
  ChevronRight,
  Loader2,
  X,
  AlertTriangle,
} from "lucide-react";
import { ImportModeSelector, FileImportPanel, CrawlImportPanel, BaseNameForm } from "./import";
import { StructurePreview } from "./json-import/StructurePreview";
import { DocumentFieldMappingEditor } from "./json-import/DocumentFieldMappingEditor";
import { HierarchyConfigEditor } from "./json-import/HierarchyConfig";
import type { CrawlConfig, CrawlMode } from "./import/types";

type CreationOption = {
  value: KnowledgeBaseSourceType;
  title: string;
  description: string;
  icon: ComponentType<{ className?: string }>;
};

type JsonImportStep = "upload" | "preview" | "mapping" | "hierarchy";

export const KNOWLEDGE_BASE_CREATION_OPTIONS: CreationOption[] = [
  {
    value: "blank",
    title: "Пустая база",
    description: "Новая база с нуля",
    icon: NotebookPen,
  },
  {
    value: "archive",
    title: "Импорт архива",
    description: "ZIP-архив документов с сохранённой иерархией",
    icon: FolderArchive,
  },
  {
    value: "crawler",
    title: "Краулинг сайта",
    description: "Импорт с сайта с автообновлением",
    icon: Globe,
  },
  {
    value: "json_import",
    title: "Импорт JSON/JSONL",
    description: "Структурированные JSON/JSONL",
    icon: FileJson,
  },
];

type CreateKnowledgeBaseDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialMode?: KnowledgeBaseSourceType;
  onCreated?: (base: KnowledgeBase) => void;
  workspaceId?: string | null;
  onJsonImportStarted?: (jobId: string) => void;
};


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
  const [isSubmittingImport, setIsSubmittingImport] = useState(false);
  const [archiveFile, setArchiveFile] = useState<File | null>(null);
  const [archiveFiles, setArchiveFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
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
  const [crawlMode, setCrawlMode] = useState<CrawlMode>("multiple");
  const [crawlSingleUrl, setCrawlSingleUrl] = useState("");
  const [crawlConfig, setCrawlConfig] = useState<CrawlConfig>({
    startUrls: [],
    robotsTxt: true,
  });
  const createBaseMutation = useCreateKnowledgeBase(workspaceId);
  const { uploadFile, uploadProgress, isUploading, error: uploadError, abort } = useJsonImportUpload(
    workspaceId ?? "",
  );

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

  const resetForm = () => {
    setName("");
    setDescription("");
    setCrawlConfig({
      startUrls: [],
      robotsTxt: true,
    });
    setCrawlMode("multiple");
    setCrawlSingleUrl("");
    setArchiveFile(null);
    setArchiveFiles([]);
    setError(null);
    if (archiveInputRef.current) {
      archiveInputRef.current.value = "";
    }
    setIsSubmittingImport(false);
    resetJsonImportState();
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
    setJsonError(null);
    if (value !== "archive") {
      setArchiveFile(null);
      setArchiveFiles([]);
      if (archiveInputRef.current) {
        archiveInputRef.current.value = "";
      }
    }
    resetJsonImportState();
    if (value !== "crawler") {
      setCrawlConfig({
        startUrls: [],
        robotsTxt: true,
      });
      setCrawlMode("multiple");
      setCrawlSingleUrl("");
    }
  };

  const handleArchiveChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    setArchiveFile(file);
    if (file) {
      setArchiveFiles([file]);
    } else {
      setArchiveFiles([]);
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
      if (!workspaceId) {
        setJsonError("Не указан workspaceId для импорта JSON");
        return;
      }
      if (!name.trim()) {
        setJsonError("Укажите название базы знаний");
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
    if (!workspaceId) {
      setJsonError("Не указан workspaceId для импорта JSON");
      return;
    }
    if (createBaseMutation.isPending || jsonIsSubmitting) {
      return;
    }
    if (!name.trim()) {
      setJsonError("Укажите название базы знаний");
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
      const created = await createBaseMutation.mutateAsync({
        name,
        description,
        mode: "json_import",
        archiveFile: null,
        crawlerConfig: undefined,
      });

      const finalHierarchyConfig: HierarchyConfig = {
        ...(jsonHierarchyConfig ?? { mode: "flat" }),
        baseParentId: null,
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
        `/api/knowledge/bases/${created.id}/json-import`,
        importRequest,
        undefined,
        { workspaceId },
      );

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Не удалось запустить импорт");
      }

      const data = (await response.json()) as { jobId: string; status: "pending" };

      toast({
        title: "База знаний создана",
        description: "Импорт JSON/JSONL запущен. Вы можете отслеживать прогресс на странице базы знаний.",
      });

      onJsonImportStarted?.(data.jobId);
      handleOpenChange(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Не удалось запустить импорт";
      setJsonError(message);
    } finally {
      setJsonIsSubmitting(false);
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

    // JSON import обрабатывается отдельным пошаговым сценарием
    if (mode === "json_import") {
      return;
    }

    setError(null);

    try {
      let crawlerConfig: CreateKnowledgeBaseInput["crawlerConfig"] | undefined;
      if (mode === "crawler") {
        const trimmedUrl = crawlSingleUrl.trim();
        const startUrls =
          crawlMode === "single" ? (trimmedUrl ? [trimmedUrl] : []) : crawlConfig.startUrls;

        if (crawlMode === "single") {
          if (!trimmedUrl) {
            setError("Укажите ссылку на страницу для краулинга");
            return;
          }
          try {
            const parsed = new URL(trimmedUrl);
            if (!parsed.protocol.startsWith("http")) {
              throw new Error("Invalid protocol");
            }
          } catch {
            setError("Укажите корректный URL страницы");
            return;
          }
        }

        if (!startUrls || startUrls.length === 0) {
          setError("Укажите хотя бы один стартовый URL для краулинга");
          return;
        }

        crawlerConfig = {
          startUrls,
          sitemapUrl: crawlConfig.sitemapUrl || undefined,
          allowedDomains: crawlConfig.allowedDomains || undefined,
          include: crawlConfig.include || undefined,
          exclude: crawlConfig.exclude || undefined,
          // Для режима "single" ограничиваем краулинг одной страницей
          maxPages: crawlMode === "single" ? 1 : (crawlConfig.maxPages || undefined),
          maxDepth: crawlMode === "single" ? 0 : (crawlConfig.maxDepth || undefined),
          rateLimitRps: crawlConfig.rateLimitRps || undefined,
          robotsTxt: crawlConfig.robotsTxt ?? true,
          selectors: crawlConfig.selectors
            ? {
                title: crawlConfig.selectors.title || undefined,
                content: crawlConfig.selectors.content || undefined,
              }
            : undefined,
          language: crawlConfig.language || undefined,
          version: crawlConfig.version || undefined,
          authHeaders: crawlConfig.authHeaders || undefined,
        };
      }
      
      // For other modes, just create the base
      const created = await createBaseMutation.mutateAsync({
        name,
        description,
        mode,
        archiveFile: archiveFiles[0] || null,
        crawlerConfig,
      });

      onCreated?.(created);
      handleOpenChange(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Не удалось создать базу знаний. Попробуйте снова.";
      setError(message);
      setIsSubmittingImport(false);
    }
  };

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
    : "Создание базы знаний";

  const isJsonBusy = createBaseMutation.isPending || jsonIsSubmitting || isUploading || jsonIsAnalyzing;
  const jsonPrimaryLabel =
    jsonStep === "hierarchy"
      ? jsonIsSubmitting
        ? "Импортируем..."
        : "Импортировать"
      : "Далее";
  const jsonAlertMessage = jsonPreviewError ? uploadError : jsonError || uploadError;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className={cn(
          "flex max-w-3xl flex-col gap-0 overflow-hidden p-0",
          isJsonWizard && "h-[95vh] w-[95vw] max-h-[95vh] max-w-[95vw]",
        )}
      >
        <DialogHeader className="shrink-0 px-6 pt-6 pb-4">
          <DialogTitle>{dialogTitle}</DialogTitle>
        </DialogHeader>

        <div className="flex-1 space-y-4 overflow-x-hidden overflow-y-auto px-6 pb-6 pt-4 min-h-0">
          {(!isJsonImport || jsonStep === "upload") && (
            <>
              <BaseNameForm
                name={name}
                onNameChange={setName}
                description={description}
                onDescriptionChange={setDescription}
                disabled={isSubmittingImport || isJsonBusy}
              />

              <ImportModeSelector
                mode={mode}
                onModeChange={handleModeChange}
                options={KNOWLEDGE_BASE_CREATION_OPTIONS.map((opt) => ({
                  value: opt.value,
                  title: opt.title,
                  description: opt.description,
                  icon: opt.icon,
                }))}
                disabled={isSubmittingImport || isJsonBusy}
              />
            </>
          )}

          {mode === "archive" && (
            <FileImportPanel
              mode="archive"
              files={archiveFiles}
              onFilesChange={(files) => {
                setArchiveFiles(files);
                setArchiveFile(files[0] || null);
              }}
              disabled={isSubmittingImport || isJsonBusy}
              allowArchives={true}
            />
          )}

          {mode === "crawler" && (
            <CrawlImportPanel
              mode={crawlMode}
              onModeChange={setCrawlMode}
              singleUrl={crawlSingleUrl}
              onSingleUrlChange={setCrawlSingleUrl}
              config={crawlConfig}
              onConfigChange={setCrawlConfig}
              isSubmitting={isSubmittingImport}
              error={error}
              disabled={isSubmittingImport || isJsonBusy}
            />
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

          {!workspaceId && isJsonImport && jsonStep === "upload" && (
            <Alert variant="destructive">
              <AlertDescription>Не указан workspaceId для импорта JSON.</AlertDescription>
            </Alert>
          )}

          {isJsonImport && jsonAlertMessage && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>{jsonAlertMessage}</AlertDescription>
            </Alert>
          )}

          {/* Ошибка для краулинга выводится в CrawlImportPanel, чтобы избежать дублирования */}
          {error && !isJsonImport && mode !== "crawler" && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter className="sticky bottom-0 z-10 shrink-0 border-t bg-muted/50 px-6 py-4">
          {isJsonImport ? (
            <div className="flex w-full items-center justify-between">
              <div>
                {jsonStep !== "upload" && (
                  <Button variant="outline" onClick={handleJsonBack} disabled={isJsonBusy}>
                    <ChevronLeft className="mr-2 h-4 w-4" />
                    Назад
                  </Button>
                )}
              </div>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={isJsonBusy}>
                  Отмена
                </Button>
                <Button onClick={handleJsonNext} disabled={isJsonBusy}>
                  {jsonPrimaryLabel}
                  {jsonStep !== "hierarchy" && <ChevronRight className="ml-2 h-4 w-4" />}
                </Button>
              </div>
            </div>
          ) : (
            <>
              <Button
                variant="outline"
                onClick={() => handleOpenChange(false)}
                disabled={createBaseMutation.isPending || isSubmittingImport}
              >
                Отмена
              </Button>
              <Button onClick={handleSubmit} disabled={createBaseMutation.isPending || isSubmittingImport}>
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
