import { useState, useCallback, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { Database, ChevronRight, ChevronLeft, RotateCcw, AlertTriangle } from "lucide-react";
import { useStartKnowledgeBaseIndexing } from "@/hooks/useKnowledgeBaseIndexing";
import type { IndexingWizardConfig } from "@shared/knowledge-base-indexing";
import { IndexingModeSelector } from "./IndexingModeSelector";
import { ChunkingConfigStep } from "./ChunkingConfigStep";
import { EmbeddingsConfigStep } from "./EmbeddingsConfigStep";
import { SchemaFieldsStep } from "./SchemaFieldsStep";
import { IndexingConfirmStep } from "./IndexingConfirmStep";
import { cn } from "@/lib/utils";

type WizardMode = "select" | "express" | "advanced";
type WizardStep = "chunking" | "embeddings" | "schema" | "confirm";

interface IndexingWizardModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  baseId: string;
  workspaceId: string;
  /** Начальная конфигурация (из политики базы) */
  initialConfig?: IndexingWizardConfig;
  /** Глобальная конфигурация (для кнопки сброса) */
  defaultConfig: IndexingWizardConfig;
  /** Callback при успешном запуске индексации */
  onIndexingStarted?: (actionId: string) => void;
  /** Информация о базе знаний (опционально) */
  baseInfo?: {
    name: string;
    documentCount: number;
  };
}

export function IndexingWizardModal({
  open,
  onOpenChange,
  baseId,
  workspaceId,
  initialConfig,
  defaultConfig,
  onIndexingStarted,
  baseInfo,
}: IndexingWizardModalProps) {
  const { toast } = useToast();
  const startIndexingMutation = useStartKnowledgeBaseIndexing();

  const [mode, setMode] = useState<WizardMode>("select");
  const [step, setStep] = useState<WizardStep>("chunking");
  const [config, setConfig] = useState<IndexingWizardConfig>(initialConfig ?? defaultConfig);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [showResetDialog, setShowResetDialog] = useState(false);
  const [saveToPolicy, setSaveToPolicy] = useState(true);
  const [indexingMode, setIndexingMode] = useState<"full" | "changed">("changed");

  // Проверка изменений
  const checkChanges = useCallback(() => {
    const initial = initialConfig ?? defaultConfig;
    const changed =
      config.chunkSize !== initial.chunkSize ||
      config.chunkOverlap !== initial.chunkOverlap ||
      config.embeddingsProvider !== initial.embeddingsProvider ||
      config.embeddingsModel !== initial.embeddingsModel ||
      config.schemaFields.length !== initial.schemaFields.length;
    setHasChanges(changed);
    return changed;
  }, [config, initialConfig, defaultConfig]);

  // Обработка закрытия
  const handleClose = useCallback(() => {
    if (isSubmitting) {
      return;
    }

    if (hasChanges && mode === "advanced") {
      // Показываем предупреждение
      if (confirm("Вы уверены? Изменения будут потеряны.")) {
        setMode("select");
        setStep("chunking");
        setConfig(initialConfig ?? defaultConfig);
        setHasChanges(false);
        onOpenChange(false);
      }
    } else {
      setMode("select");
      setStep("chunking");
      setConfig(initialConfig ?? defaultConfig);
      setHasChanges(false);
      onOpenChange(false);
    }
  }, [isSubmitting, hasChanges, mode, initialConfig, defaultConfig, onOpenChange]);

  // Экспресс режим — запуск сразу
  const handleExpressMode = useCallback(async () => {
    setIsSubmitting(true);
    try {
      const result = await startIndexingMutation.mutateAsync({
        baseId,
        mode: "changed",
      });
      if (result.actionId) {
        onIndexingStarted?.(result.actionId);
      }
      toast({
        title: "Индексация запущена",
        description: "Прогресс отображается на странице базы знаний",
      });
      onOpenChange(false);
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Не удалось запустить индексацию",
        description: error instanceof Error ? error.message : "Попробуйте позже",
      });
    } finally {
      setIsSubmitting(false);
    }
  }, [baseId, startIndexingMutation, toast, onIndexingStarted, onOpenChange]);

  // Переход в расширенный режим
  const handleAdvancedMode = useCallback(() => {
    setMode("advanced");
    setStep("chunking");
  }, []);

  // Навигация по шагам
  const handleNext = useCallback(() => {
    if (step === "chunking") {
      setStep("embeddings");
    } else if (step === "embeddings") {
      setStep("schema");
    } else if (step === "schema") {
      setStep("confirm");
    }
    checkChanges();
  }, [step, checkChanges]);

  const handleBack = useCallback(() => {
    if (step === "confirm") {
      setStep("schema");
    } else if (step === "schema") {
      setStep("embeddings");
    } else if (step === "embeddings") {
      setStep("chunking");
    }
  }, [step]);

  // Сброс настроек
  const handleReset = useCallback(() => {
    if (confirm("Сбросить настройки к значениям из глобального профиля?")) {
      setConfig(defaultConfig);
      setHasChanges(false);
      setShowResetDialog(false);
      toast({
        title: "Настройки сброшены",
        description: "Применены значения из глобального профиля индексации",
      });
    }
  }, [defaultConfig, toast]);

  // Запуск индексации из расширенного режима
  const handleStartIndexing = useCallback(async () => {
    setIsSubmitting(true);
    try {
      // Импортируем компилятор
      const { compileExpressionToTemplate } = await import("@/lib/expression-compiler");

      const result = await startIndexingMutation.mutateAsync({
        baseId,
        mode: indexingMode,
        config: {
          chunkSize: config.chunkSize,
          chunkOverlap: config.chunkOverlap,
          embeddingsProvider: config.embeddingsProvider,
          embeddingsModel: config.embeddingsModel,
          schemaFields: config.schemaFields.map((field) => ({
            name: field.name,
            type: field.type,
            isArray: field.isArray,
            template: compileExpressionToTemplate(field.expression),
            isEmbeddingField: field.isEmbeddingField,
          })),
          saveToPolicy,
        },
      });
      if (result.actionId) {
        onIndexingStarted?.(result.actionId);
      }
      toast({
        title: "Индексация запущена",
        description: "Прогресс отображается на странице базы знаний",
      });
      onOpenChange(false);
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Не удалось запустить индексацию",
        description: error instanceof Error ? error.message : "Попробуйте позже",
      });
    } finally {
      setIsSubmitting(false);
    }
  }, [baseId, config, indexingMode, saveToPolicy, startIndexingMutation, toast, onIndexingStarted, onOpenChange]);

  // Индикатор шагов
  const steps = [
    { id: "chunking", label: "Чанкование" },
    { id: "embeddings", label: "Эмбеддинги" },
    { id: "schema", label: "Схема" },
    { id: "confirm", label: "Запуск" },
  ] as const;

  const currentStepIndex = steps.findIndex((s) => s.id === step);

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Database className="h-5 w-5" />
            Индексация базы знаний
          </DialogTitle>
          <DialogDescription>Настройте параметры индексации для RAG-поиска</DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Выбор режима */}
          {mode === "select" && (
            <IndexingModeSelector
              config={config}
              onExpressMode={handleExpressMode}
              onAdvancedMode={handleAdvancedMode}
              disabled={isSubmitting}
            />
          )}

          {/* Расширенный режим */}
          {mode === "advanced" && (
            <>
              {/* Индикатор шагов */}
              <div className="flex items-center justify-center gap-2 text-sm">
                {steps.map((s, index) => (
                  <div key={s.id} className="flex items-center gap-2">
                    <span
                      className={cn(
                        "px-3 py-1 rounded",
                        index === currentStepIndex
                          ? "bg-primary text-primary-foreground font-medium"
                          : index < currentStepIndex
                            ? "bg-muted text-muted-foreground"
                            : "bg-muted/50 text-muted-foreground",
                      )}
                    >
                      {index + 1}. {s.label}
                    </span>
                    {index < steps.length - 1 && <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                  </div>
                ))}
              </div>

              {/* Контент шага */}
              <div className="min-h-[400px]">
                {step === "chunking" && (
                  <ChunkingConfigStep
                    config={{ chunkSize: config.chunkSize, chunkOverlap: config.chunkOverlap }}
                    onChange={(newConfig) => {
                      setConfig({ ...config, ...newConfig });
                      checkChanges();
                    }}
                    disabled={isSubmitting}
                  />
                )}
                {step === "embeddings" && (
                  <EmbeddingsConfigStep
                    config={{
                      embeddingsProvider: config.embeddingsProvider,
                      embeddingsModel: config.embeddingsModel,
                    }}
                    onChange={(newConfig) => {
                      setConfig({ ...config, ...newConfig });
                      checkChanges();
                    }}
                    workspaceId={workspaceId}
                    initialConfig={
                      initialConfig
                        ? {
                            embeddingsProvider: initialConfig.embeddingsProvider,
                            embeddingsModel: initialConfig.embeddingsModel,
                          }
                        : undefined
                    }
                    disabled={isSubmitting}
                  />
                )}
                {step === "schema" && (
                  <SchemaFieldsStep
                    config={{ schemaFields: config.schemaFields }}
                    onChange={(newConfig) => {
                      setConfig({ ...config, ...newConfig });
                      checkChanges();
                    }}
                    workspaceId={workspaceId}
                    baseId={baseId}
                    disabled={isSubmitting}
                  />
                )}
                {step === "confirm" && (
                  <IndexingConfirmStep
                    config={config}
                    baseInfo={
                      baseInfo ?? {
                        id: baseId,
                        name: "База знаний",
                        documentCount: 0,
                      }
                    }
                    onSubmit={handleStartIndexing}
                    isSubmitting={isSubmitting}
                    saveToPolicy={saveToPolicy}
                    onSaveToPolicyChange={setSaveToPolicy}
                    indexingMode={indexingMode}
                  />
                )}
              </div>
            </>
          )}

          {/* Ошибки */}
          {startIndexingMutation.isError && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                {startIndexingMutation.error instanceof Error
                  ? startIndexingMutation.error.message
                  : "Не удалось запустить индексацию"}
              </AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter>
          <div className="flex items-center justify-between w-full">
            <div className="flex gap-2">
              {mode === "advanced" && step !== "chunking" && (
                <Button variant="outline" onClick={handleBack} disabled={isSubmitting}>
                  <ChevronLeft className="mr-2 h-4 w-4" />
                  Назад
                </Button>
              )}
              {mode === "advanced" && (
                <Button variant="outline" onClick={() => setShowResetDialog(true)} disabled={isSubmitting}>
                  <RotateCcw className="mr-2 h-4 w-4" />
                  Сбросить
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={handleClose} disabled={isSubmitting}>
                {mode === "select" ? "Отмена" : "Закрыть"}
              </Button>
              {mode === "advanced" && step !== "confirm" && (
                <Button onClick={handleNext} disabled={isSubmitting}>
                  Далее
                  <ChevronRight className="ml-2 h-4 w-4" />
                </Button>
              )}
              {mode === "advanced" && step === "confirm" && (
                <Button onClick={handleStartIndexing} disabled={isSubmitting}>
                  {isSubmitting ? (
                    <>
                      <span className="mr-2">Запуск...</span>
                    </>
                  ) : (
                    "Запустить индексацию"
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
