import { useState, useEffect } from "react";
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
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { useJsonImportUpload } from "@/hooks/useJsonImportUpload";
import { Loader2, FileJson, X, ChevronRight, ChevronLeft } from "lucide-react";
import type { CreateJsonImportRequest } from "@shared/json-import";
import { StructurePreview } from "./json-import/StructurePreview";
import { DocumentFieldMappingEditor } from "./json-import/DocumentFieldMappingEditor";
import { HierarchyConfigEditor } from "./json-import/HierarchyConfig";
import type { StructureAnalysis, PreviewError } from "@/lib/json-import-types";
import type { MappingConfigV2, HierarchyConfig } from "@shared/json-import";

interface JsonImportWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  baseId: string;
  workspaceId: string;
  onImportStarted?: (jobId: string) => void;
}

export function JsonImportWizard({
  open,
  onOpenChange,
  baseId,
  workspaceId,
  onImportStarted,
}: JsonImportWizardProps) {
  const { toast } = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [uploadedFileKey, setUploadedFileKey] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentStep, setCurrentStep] = useState<"upload" | "preview" | "mapping" | "hierarchy">("upload");
  const [structureAnalysis, setStructureAnalysis] = useState<StructureAnalysis | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [previewError, setPreviewError] = useState<PreviewError | null>(null);
  const [mappingConfig, setMappingConfig] = useState<MappingConfigV2 | null>(null);
  const [isMappingValid, setIsMappingValid] = useState(false);
  const [hierarchyConfig, setHierarchyConfig] = useState<HierarchyConfig | null>(null);
  const { uploadFile, uploadProgress, isUploading, error: uploadError, abort } = useJsonImportUpload(workspaceId);

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0] ?? null;
    setFile(selectedFile);
    setError(null);
  };

  const handleFileUpload = async () => {
    if (!file) {
      setError("Выберите файл для импорта");
      return;
    }

    // Проверка расширения
    const fileName = file.name.toLowerCase();
    if (!fileName.endsWith(".json") && !fileName.endsWith(".jsonl")) {
      setError("Поддерживаются только файлы .json и .jsonl");
      return;
    }

    // Проверка размера (2GB)
    const maxSize = 2 * 1024 * 1024 * 1024;
    if (file.size > maxSize) {
      setError("Размер файла превышает максимально допустимый (2GB)");
      return;
    }

    setError(null);

    try {
      const result = await uploadFile(file);
      setUploadedFileKey(result.fileKey);
      // После загрузки автоматически анализируем структуру
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
        { workspaceId },
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
      setCurrentStep("preview");
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

  const handleNext = () => {
    if (currentStep === "upload" && uploadedFileKey && structureAnalysis) {
      setCurrentStep("preview");
    } else if (currentStep === "preview") {
      setCurrentStep("mapping");
    } else if (currentStep === "mapping" && isMappingValid) {
      setCurrentStep("hierarchy");
    }
  };

  const handleBack = () => {
    if (currentStep === "preview") {
      setCurrentStep("upload");
    } else if (currentStep === "mapping") {
      setCurrentStep("preview");
    } else if (currentStep === "hierarchy") {
      setCurrentStep("mapping");
    }
  };

  const handleStartImport = async () => {
    if (!uploadedFileKey || !file) {
      setError("Сначала загрузите файл");
      return;
    }

    if (!mappingConfig || !isMappingValid) {
      setError("Настройте маппинг полей перед запуском импорта");
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      // Используем настройки иерархии из UI или дефолтные
      const finalHierarchyConfig = hierarchyConfig ?? {
        mode: "flat" as const,
      };

      const request: CreateJsonImportRequest = {
        fileKey: uploadedFileKey,
        fileName: file.name,
        fileSize: file.size,
        mappingConfig: mappingConfig!,
        hierarchyConfig: finalHierarchyConfig,
      };

      const response = await apiRequest(
        "POST",
        `/api/knowledge/bases/${baseId}/json-import`,
        request,
        undefined,
        { workspaceId },
      );

      const data = (await response.json()) as { jobId: string; status: "pending" };

      toast({
        title: "Импорт запущен",
        description: "Импорт JSON/JSONL начат. Вы можете закрыть это окно и отслеживать прогресс.",
      });

      onImportStarted?.(data.jobId);
      handleClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Не удалось запустить импорт";
      setError(message);
      toast({
        variant: "destructive",
        title: "Ошибка импорта",
        description: message,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    if (!isSubmitting && !isUploading) {
      if (isUploading) {
        abort();
      }
      setFile(null);
      setUploadedFileKey(null);
      setError(null);
      setCurrentStep("upload");
      setStructureAnalysis(null);
      setPreviewError(null);
      setMappingConfig(null);
      setIsMappingValid(false);
      setHierarchyConfig(null);
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileJson className="h-5 w-5" />
            Импорт JSON/JSONL
          </DialogTitle>
          <DialogDescription>
            Загрузите файл JSON или JSONL для импорта в базу знаний. Файл будет обработан в фоновом режиме.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {currentStep === "upload" && (
            <>
              <div className="space-y-2">
            <Label htmlFor="json-import-file">Файл JSON/JSONL</Label>
            <Input
              id="json-import-file"
              type="file"
              accept=".json,.jsonl"
              onChange={handleFileChange}
              disabled={isSubmitting || isUploading}
            />
            {file && (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">
                  Выбран: {file.name} ({(file.size / 1024 / 1024).toFixed(2)} MB)
                </p>
                {!uploadedFileKey && !isUploading && (
                  <Button
                    type="button"
                    onClick={handleFileUpload}
                    disabled={isSubmitting}
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
                {uploadedFileKey && (
                  <Alert>
                    <AlertDescription>
                      Файл успешно загружен. Теперь можно запустить импорт.
                    </AlertDescription>
                  </Alert>
                )}
              </div>
            )}
          </div>

          {(error || uploadError) && (
            <Alert variant="destructive">
              <AlertDescription>{error || uploadError}</AlertDescription>
            </Alert>
          )}
            </>
          )}

          {currentStep === "preview" && (
            <div className="space-y-4">
              {isAnalyzing ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin mr-2" />
                  <span>Анализ структуры файла...</span>
                </div>
              ) : previewError ? (
                <Alert variant="destructive">
                  <AlertDescription>
                    <div>
                      <p className="font-medium">{previewError.error}</p>
                      {previewError.details && (
                        <p className="text-sm mt-1">{previewError.details}</p>
                      )}
                    </div>
                  </AlertDescription>
                </Alert>
              ) : structureAnalysis ? (
                <StructurePreview analysis={structureAnalysis} />
              ) : null}
            </div>
          )}

          {currentStep === "mapping" && structureAnalysis && (
            <DocumentFieldMappingEditor
              analysis={structureAnalysis}
              initialConfig={mappingConfig ?? undefined}
              onConfigChange={(config) => {
                setMappingConfig(config);
              }}
              onValidationChange={(isValid) => {
                setIsMappingValid(isValid);
              }}
              showValidationErrors={currentStep === "mapping"}
              workspaceId={workspaceId}
            />
          )}

          {currentStep === "hierarchy" && structureAnalysis && (
            <HierarchyConfigEditor
              analysis={structureAnalysis}
              initialConfig={hierarchyConfig ?? undefined}
              onConfigChange={(config) => {
                setHierarchyConfig(config);
              }}
            />
          )}
        </div>

        <DialogFooter>
          <div className="flex items-center justify-between w-full">
            <Button variant="outline" onClick={handleClose} disabled={isSubmitting || isUploading}>
              {isUploading ? "Отмена" : "Закрыть"}
            </Button>
            <div className="flex gap-2">
              {currentStep !== "upload" && (
                <Button variant="outline" onClick={handleBack} disabled={isSubmitting || isUploading}>
                  <ChevronLeft className="mr-2 h-4 w-4" />
                  Назад
                </Button>
              )}
              {currentStep === "upload" && uploadedFileKey && structureAnalysis && (
                <Button onClick={handleNext} disabled={isSubmitting || isUploading || isAnalyzing}>
                  Далее
                  <ChevronRight className="ml-2 h-4 w-4" />
                </Button>
              )}
              {currentStep === "preview" && (
                <Button onClick={handleNext} disabled={isSubmitting || isUploading || !structureAnalysis}>
                  Далее
                  <ChevronRight className="ml-2 h-4 w-4" />
                </Button>
              )}
              {currentStep === "mapping" && (
                <Button
                  onClick={handleNext}
                  disabled={isSubmitting || isUploading || !isMappingValid}
                >
                  Далее
                  <ChevronRight className="ml-2 h-4 w-4" />
                </Button>
              )}
              {currentStep === "hierarchy" && (
                <Button
                  onClick={handleStartImport}
                  disabled={isSubmitting || isUploading || !uploadedFileKey || !mappingConfig}
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Запускаем...
                    </>
                  ) : (
                    "Запустить импорт"
                  )}
                </Button>
              )}
            </div>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
