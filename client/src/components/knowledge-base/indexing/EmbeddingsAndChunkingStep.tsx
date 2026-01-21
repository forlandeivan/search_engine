import { useState, useEffect, useMemo } from "react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertTriangle } from "lucide-react";
import { useModels } from "@/hooks/useModels";
import { MIN_CHUNK_SIZE, MAX_CHUNK_SIZE } from "@shared/indexing-rules";

interface EmbeddingsAndChunkingStepProps {
  config: {
    embeddingsProvider: string;
    embeddingsModel: string;
    chunkSize: number;
    chunkOverlap: number;
  };
  onChange: (config: {
    embeddingsProvider: string;
    embeddingsModel: string;
    chunkSize: number;
    chunkOverlap: number;
  }) => void;
  workspaceId: string;
  /** Исходная конфигурация для проверки изменений */
  initialConfig?: {
    embeddingsProvider: string;
    embeddingsModel: string;
    chunkSize: number;
    chunkOverlap: number;
  };
  disabled?: boolean;
  /** Callback для передачи состояния валидности */
  onValidationChange?: (isValid: boolean) => void;
}

export function EmbeddingsAndChunkingStep({
  config,
  onChange,
  workspaceId,
  initialConfig,
  disabled,
  onValidationChange,
}: EmbeddingsAndChunkingStepProps) {
  const [selectedProvider, setSelectedProvider] = useState(config.embeddingsProvider || "");
  const [selectedModel, setSelectedModel] = useState(config.embeddingsModel || "");
  const [chunkSize, setChunkSize] = useState<number | "">(config.chunkSize || 800);
  const [chunkOverlap, setChunkOverlap] = useState<number | "">(config.chunkOverlap || 0);
  const [chunkSizeError, setChunkSizeError] = useState<string | null>(null);
  const [chunkOverlapError, setChunkOverlapError] = useState<string | null>(null);

  // Загрузка всех моделей эмбеддингов из каталога
  const { data: availableModels, isLoading: modelsLoading } = useModels("EMBEDDINGS");

  // Определяем провайдера для выбранной модели
  const selectedModelData = useMemo(() => {
    if (!selectedModel || !availableModels) return null;
    return availableModels.find((m) => m.providerModelKey === selectedModel || m.key === selectedModel);
  }, [selectedModel, availableModels]);

  // Автоматически определяем провайдера из выбранной модели
  useEffect(() => {
    if (selectedModelData?.providerId && selectedModelData.providerId !== selectedProvider) {
      setSelectedProvider(selectedModelData.providerId);
    }
  }, [selectedModelData, selectedProvider]);

  // Проверка изменений
  const hasModelChanged = useMemo(
    () => initialConfig && selectedModel !== initialConfig.embeddingsModel,
    [initialConfig, selectedModel],
  );

  // Валидация и обновление chunkSize
  const handleChunkSizeChange = (value: string) => {
    if (value === "") {
      setChunkSize("");
      setChunkSizeError(null);
      return;
    }
    const numValue = Number.parseInt(value, 10);
    if (Number.isNaN(numValue)) {
      return;
    }
    setChunkSize(numValue);
    if (numValue < MIN_CHUNK_SIZE) {
      setChunkSizeError(`Минимальный размер чанка: ${MIN_CHUNK_SIZE}`);
    } else if (numValue > MAX_CHUNK_SIZE) {
      setChunkSizeError(`Максимальный размер чанка: ${MAX_CHUNK_SIZE}`);
    } else {
      setChunkSizeError(null);
      // Автоматически ограничиваем chunkOverlap
      if (typeof chunkOverlap === "number" && chunkOverlap >= numValue) {
        setChunkOverlap(Math.max(0, numValue - 1));
      }
    }
  };

  // Валидация и обновление chunkOverlap
  const handleChunkOverlapChange = (value: string) => {
    if (value === "") {
      setChunkOverlap("");
      setChunkOverlapError(null);
      return;
    }
    const numValue = Number.parseInt(value, 10);
    if (Number.isNaN(numValue)) {
      return;
    }
    setChunkOverlap(numValue);
    if (numValue < 0) {
      setChunkOverlapError("Перекрытие не может быть отрицательным");
    } else if (typeof chunkSize === "number" && numValue >= chunkSize) {
      setChunkOverlapError(`Перекрытие должно быть меньше размера чанка (${chunkSize})`);
    } else {
      setChunkOverlapError(null);
    }
  };

  // Отправляем изменения при валидных значениях
  useEffect(() => {
    if (
      typeof chunkSize === "number" &&
      typeof chunkOverlap === "number" &&
      chunkSize >= MIN_CHUNK_SIZE &&
      chunkSize <= MAX_CHUNK_SIZE &&
      chunkOverlap >= 0 &&
      chunkOverlap < chunkSize
    ) {
      onChange({
        embeddingsProvider: selectedProvider,
        embeddingsModel: selectedModel,
        chunkSize,
        chunkOverlap,
      });
    }
  }, [chunkSize, chunkOverlap, selectedProvider, selectedModel, onChange]);

  // Синхронизация с внешним config
  useEffect(() => {
    if (
      config.embeddingsProvider !== selectedProvider ||
      config.embeddingsModel !== selectedModel ||
      config.chunkSize !== chunkSize ||
      config.chunkOverlap !== chunkOverlap
    ) {
      setSelectedProvider(config.embeddingsProvider || "");
      setSelectedModel(config.embeddingsModel || "");
      setChunkSize(config.chunkSize || 800);
      setChunkOverlap(config.chunkOverlap || 0);
    }
  }, [config.embeddingsProvider, config.embeddingsModel, config.chunkSize, config.chunkOverlap]);

  // Если модель не выбрана или выбранная модель недоступна, выбираем первую доступную
  useEffect(() => {
    if (availableModels && availableModels.length > 0 && !modelsLoading) {
      const currentModelExists = selectedModel
        ? availableModels.some(
            (m) => (m.providerModelKey || m.key) === selectedModel,
          )
        : false;

      if (!selectedModel || !currentModelExists) {
        const firstModel = availableModels[0];
        const modelKey = firstModel.providerModelKey || firstModel.key;
        if (modelKey && firstModel.providerId) {
          setSelectedModel(modelKey);
          setSelectedProvider(firstModel.providerId);
          const currentChunkSize = typeof chunkSize === "number" ? chunkSize : 800;
          const currentChunkOverlap = typeof chunkOverlap === "number" ? chunkOverlap : 0;
          onChange({
            embeddingsProvider: firstModel.providerId,
            embeddingsModel: modelKey,
            chunkSize: currentChunkSize,
            chunkOverlap: currentChunkOverlap,
          });
        }
      }
    }
  }, [selectedModel, availableModels, modelsLoading, chunkSize, chunkOverlap, onChange]);

  // Проверка валидности конфигурации (должна быть до условных возвратов)
  const isValid = useMemo(() => {
    return (
      typeof chunkSize === "number" &&
      chunkSize >= MIN_CHUNK_SIZE &&
      chunkSize <= MAX_CHUNK_SIZE &&
      typeof chunkOverlap === "number" &&
      chunkOverlap >= 0 &&
      chunkOverlap < chunkSize &&
      Boolean(selectedModel)
    );
  }, [chunkSize, chunkOverlap, selectedModel]);

  // Уведомляем родительский компонент об изменении валидности (должен быть до условных возвратов)
  useEffect(() => {
    onValidationChange?.(isValid);
  }, [isValid, onValidationChange]);

  if (modelsLoading) {
    return (
      <div className="space-y-4">
        <h3 className="text-lg font-semibold">Шаг 1: Эмбеддинги и чанкование</h3>
        <p className="text-sm text-muted-foreground">Загрузка провайдеров...</p>
      </div>
    );
  }

  if ((!availableModels || availableModels.length === 0) && !modelsLoading) {
    return (
      <div className="space-y-4">
        <h3 className="text-lg font-semibold">Шаг 1: Эмбеддинги и чанкование</h3>
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            <div className="space-y-2">
              <p>Нет настроенных провайдеров</p>
              <p className="text-sm">
                Для индексации необходимо настроить хотя бы один провайдер эмбеддингов в разделе "Администрирование".
              </p>
            </div>
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const maxOverlap = typeof chunkSize === "number" ? Math.max(0, chunkSize - 1) : 0;

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold">Шаг 1: Эмбеддинги и чанкование</h3>
        <p className="text-sm text-muted-foreground">
          Выберите модель эмбеддингов и настройте параметры чанкования документов.
        </p>
      </div>

      {/* Модель */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Модель</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            {modelsLoading ? (
              <p className="text-sm text-muted-foreground">Загрузка моделей...</p>
            ) : availableModels && availableModels.length > 0 ? (
              <Select
                value={selectedModel || undefined}
                onValueChange={(value) => {
                  const model = availableModels.find(
                    (m) => (m.providerModelKey || m.key) === value,
                  );
                  if (model && model.providerId) {
                    const modelKey = model.providerModelKey || model.key;
                    setSelectedModel(modelKey);
                    setSelectedProvider(model.providerId);
                    const currentChunkSize = typeof chunkSize === "number" ? chunkSize : 800;
                    const currentChunkOverlap = typeof chunkOverlap === "number" ? chunkOverlap : 0;
                    onChange({
                      embeddingsProvider: model.providerId,
                      embeddingsModel: modelKey,
                      chunkSize: currentChunkSize,
                      chunkOverlap: currentChunkOverlap,
                    });
                  }
                }}
                disabled={disabled}
              >
                <SelectTrigger id="embeddings-model-select">
                  <SelectValue placeholder="Выберите модель" />
                </SelectTrigger>
                <SelectContent>
                  {availableModels.map((model) => {
                    const modelKey = model.providerModelKey || model.key;
                    return (
                      <SelectItem key={modelKey} value={modelKey}>
                        {model.displayName || modelKey}
                        {model.providerType && ` (${model.providerType})`}
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            ) : (
              <Input
                id="embeddings-model-input"
                type="text"
                value={selectedModel}
                onChange={(e) => {
                  const value = e.target.value;
                  setSelectedModel(value);
                  const currentChunkSize = typeof chunkSize === "number" ? chunkSize : 800;
                  const currentChunkOverlap = typeof chunkOverlap === "number" ? chunkOverlap : 0;
                  onChange({
                    embeddingsProvider: selectedProvider,
                    embeddingsModel: value,
                    chunkSize: currentChunkSize,
                    chunkOverlap: currentChunkOverlap,
                  });
                }}
                disabled={disabled}
                placeholder="Введите модель вручную"
              />
            )}
          </div>
        </CardContent>
      </Card>

      {/* Размер чанка */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Размер чанка (символов)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Input
              id="chunk-size-input"
              type="number"
              min={MIN_CHUNK_SIZE}
              max={MAX_CHUNK_SIZE}
              value={chunkSize}
              onChange={(e) => handleChunkSizeChange(e.target.value)}
              disabled={disabled}
            />
            {chunkSizeError && <p className="text-sm text-destructive">{chunkSizeError}</p>}
            <p className="text-xs text-muted-foreground">
              Мин: {MIN_CHUNK_SIZE} | Макс: {MAX_CHUNK_SIZE}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Перекрытие чанков */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Перекрытие чанков (символов)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Input
              id="chunk-overlap-input"
              type="number"
              min={0}
              max={maxOverlap}
              value={chunkOverlap}
              onChange={(e) => handleChunkOverlapChange(e.target.value)}
              disabled={disabled}
            />
            {chunkOverlapError && <p className="text-sm text-destructive">{chunkOverlapError}</p>}
            <CardDescription>
              Перекрытие помогает сохранить контекст между чанками. Рекомендуется 10-25% от размера чанка.
            </CardDescription>
          </div>
        </CardContent>
      </Card>

      {/* Предупреждения */}
      {hasModelChanged && (
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            Смена модели эмбеддингов требует полной переиндексации. Существующие векторы станут несовместимы с
            новой моделью.
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
