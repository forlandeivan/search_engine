import { useRef, useState, type ChangeEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { useJsonImportUpload } from "@/hooks/useJsonImportUpload";
import { apiRequest } from "@/lib/queryClient";
import type { StructureAnalysis, PreviewError } from "@/lib/json-import-types";
import type { MappingConfig, HierarchyConfig, CreateJsonImportRequest } from "@shared/json-import";
import { StructurePreview } from "../json-import/StructurePreview";
import { FieldMappingEditor } from "../json-import/FieldMappingEditor";
import { HierarchyConfigEditor } from "../json-import/HierarchyConfig";
import { ChevronRight, ChevronLeft, Loader2, X, AlertTriangle } from "lucide-react";

type JsonImportStep = "upload" | "preview" | "mapping" | "hierarchy";

type JsonImportPanelProps = {
  workspaceId: string;
  targetBaseId?: string; // Если импорт в существующую БЗ
  targetParentId?: string | null; // Родительская папка для импорта
  onComplete: (result: { jobId: string }) => void;
  onCancel?: () => void;
  disabled?: boolean;
};

export function JsonImportPanel({
  workspaceId,
  targetBaseId,
  targetParentId,
  onComplete,
  onCancel,
  disabled,
}: JsonImportPanelProps) {
  const [step, setStep] = useState<JsonImportStep>("upload");
  const [jsonFile, setJsonFile] = useState<File | null>(null);
  const [uploadedFileKey, setUploadedFileKey] = useState<string | null>(null);
  const [structureAnalysis, setStructureAnalysis] = useState<StructureAnalysis | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [previewError, setPreviewError] = useState<PreviewError | null>(null);
  const [mappingConfig, setMappingConfig] = useState<MappingConfig | null>(null);
  const [isMappingValid, setIsMappingValid] = useState(false);
  const [showMappingValidationErrors, setShowMappingValidationErrors] = useState(false);
  const [hierarchyConfig, setHierarchyConfig] = useState<HierarchyConfig | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const jsonFileInputRef = useRef<HTMLInputElement | null>(null);
  const { uploadFile, uploadProgress, isUploading, error: uploadError, abort } = useJsonImportUpload(workspaceId);

  const handleJsonFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0] ?? null;
    setJsonFile(selectedFile);
    setError(null);
    setUploadedFileKey(null);
    setStructureAnalysis(null);
    setPreviewError(null);
  };

  const handleJsonFileUpload = async () => {
    if (!jsonFile) {
      setError("Выберите файл для импорта");
      return;
    }

    const fileName = jsonFile.name.toLowerCase();
    if (!fileName.endsWith(".json") && !fileName.endsWith(".jsonl")) {
      setError("Поддерживаются только файлы .json и .jsonl");
      return;
    }

    const maxSize = 2 * 1024 * 1024 * 1024; // 2GB
    if (jsonFile.size > maxSize) {
      setError("Размер файла превышает максимально допустимый (2GB)");
      return;
    }

    setError(null);

    try {
      const result = await uploadFile(jsonFile);
      setUploadedFileKey(result.fileKey);
      await analyzeStructure(result.fileKey);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Не удалось загрузить файл";
      setError(message);
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
        { workspaceId },
      );

      if (!response.ok) {
        const errorData = (await response.json()) as PreviewError;
        setPreviewError(errorData);
        setError(errorData.error);
        return;
      }

      const analysis = (await response.json()) as StructureAnalysis;
      setStructureAnalysis(analysis);
      setStep("preview");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Не удалось проанализировать файл";
      setPreviewError({
        error: message,
        code: "PARSE_ERROR",
      });
      setError(message);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleNext = () => {
    if (step === "upload" && uploadedFileKey && structureAnalysis) {
      setStep("preview");
    } else if (step === "preview") {
      setStep("mapping");
      setShowMappingValidationErrors(false);
    } else if (step === "mapping") {
      setShowMappingValidationErrors(true);
      if (isMappingValid) {
        setStep("hierarchy");
      }
    }
  };

  const handleBack = () => {
    if (step === "preview") {
      setStep("upload");
    } else if (step === "mapping") {
      setStep("preview");
    } else if (step === "hierarchy") {
      setStep("mapping");
    }
  };

  const handleSubmit = async () => {
    if (!targetBaseId) {
      setError("База знаний не указана");
      return;
    }

    if (!uploadedFileKey || !jsonFile) {
      setError("Сначала загрузите файл");
      return;
    }

    if (!mappingConfig || !isMappingValid) {
      setError("Настройте маппинг полей");
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const finalHierarchyConfig: HierarchyConfig = {
        ...(hierarchyConfig ?? { mode: "flat" }),
        baseParentId: targetParentId ?? null,
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
        `/api/knowledge/bases/${targetBaseId}/json-import`,
        importRequest,
        undefined,
        { workspaceId },
      );

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Не удалось запустить импорт");
      }

      const data = (await response.json()) as { jobId: string; status: "pending" };

      onComplete({ jobId: data.jobId });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Не удалось запустить импорт";
      setError(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Step indicator */}
      <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
        <span className={cn("px-2 py-1 rounded", step === "upload" ? "bg-primary text-primary-foreground" : "bg-muted")}>
          1. Загрузка
        </span>
        <ChevronRight className="h-4 w-4" />
        <span className={cn("px-2 py-1 rounded", step === "preview" ? "bg-primary text-primary-foreground" : "bg-muted")}>
          2. Предпросмотр
        </span>
        <ChevronRight className="h-4 w-4" />
        <span className={cn("px-2 py-1 rounded", step === "mapping" ? "bg-primary text-primary-foreground" : "bg-muted")}>
          3. Маппинг
        </span>
        <ChevronRight className="h-4 w-4" />
        <span className={cn("px-2 py-1 rounded", step === "hierarchy" ? "bg-primary text-primary-foreground" : "bg-muted")}>
          4. Иерархия
        </span>
      </div>

      {/* Step 1: Upload */}
      {step === "upload" && (
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="json-import-file">Файл JSON/JSONL</Label>
            <input
              ref={jsonFileInputRef}
              id="json-import-file"
              type="file"
              accept=".json,.jsonl"
              onChange={handleJsonFileChange}
              disabled={disabled || isSubmitting || isUploading}
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
                    disabled={disabled || isSubmitting}
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
                      disabled={disabled}
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
                      {previewError.details && <p className="text-sm mt-1">{previewError.details}</p>}
                    </AlertDescription>
                  </Alert>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Step 2: Preview */}
      {step === "preview" && structureAnalysis && (
        <div className="max-h-[600px] overflow-y-auto overflow-x-hidden">
          <StructurePreview analysis={structureAnalysis} />
        </div>
      )}

      {/* Step 3: Mapping */}
      {step === "mapping" && structureAnalysis && (
        <div className="max-h-[600px] overflow-y-auto overflow-x-hidden">
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
      {step === "hierarchy" && structureAnalysis && (
        <div className="max-h-[600px] overflow-y-auto overflow-x-hidden">
          <HierarchyConfigEditor
            analysis={structureAnalysis}
            initialConfig={hierarchyConfig ?? undefined}
            onConfigChange={(config) => {
              setHierarchyConfig(config);
            }}
          />
        </div>
      )}

      {/* Ошибки */}
      {(error || uploadError) && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>{error || uploadError}</AlertDescription>
        </Alert>
      )}

      {/* Навигация */}
      <div className="flex items-center justify-between">
        <div className="flex gap-2">
          {step !== "upload" && (
            <Button variant="outline" onClick={handleBack} disabled={disabled || isSubmitting || isUploading}>
              <ChevronLeft className="mr-2 h-4 w-4" />
              Назад
            </Button>
          )}
          {onCancel && (
            <Button variant="outline" onClick={onCancel} disabled={disabled || isSubmitting || isUploading}>
              Отмена
            </Button>
          )}
        </div>
        <div className="flex gap-2">
          {step === "upload" && uploadedFileKey && structureAnalysis && (
            <Button onClick={handleNext} disabled={disabled || isSubmitting || isUploading || isAnalyzing}>
              Далее
              <ChevronRight className="ml-2 h-4 w-4" />
            </Button>
          )}
          {step === "preview" && (
            <Button onClick={handleNext} disabled={disabled || isSubmitting || isUploading || !structureAnalysis}>
              Далее
              <ChevronRight className="ml-2 h-4 w-4" />
            </Button>
          )}
          {step === "mapping" && (
            <Button onClick={handleNext} disabled={disabled || isSubmitting || isUploading || !isMappingValid}>
              Далее
              <ChevronRight className="ml-2 h-4 w-4" />
            </Button>
          )}
          {step === "hierarchy" && (
            <Button
              onClick={handleSubmit}
              disabled={disabled || isSubmitting || isUploading || !uploadedFileKey || !mappingConfig || !isMappingValid}
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Импорт...
                </>
              ) : (
                "Импортировать"
              )}
            </Button>
          )}
        </div>
      </div>

      {/* Сообщение о блокировке */}
      {step === "hierarchy" && (
        (() => {
          const getBlockReason = () => {
            if (isSubmitting) return "Идёт запуск импорта...";
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
    </div>
  );
}
