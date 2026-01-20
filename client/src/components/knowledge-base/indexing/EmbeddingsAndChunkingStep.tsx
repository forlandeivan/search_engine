import { useState, useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertTriangle } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useModels, type PublicModel } from "@/hooks/useModels";
import type { PublicEmbeddingProvider } from "@shared/schema";
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
}

export function EmbeddingsAndChunkingStep({
  config,
  onChange,
  workspaceId,
  initialConfig,
  disabled,
}: EmbeddingsAndChunkingStepProps) {
  const [selectedProvider, setSelectedProvider] = useState(config.embeddingsProvider || "");
  const [selectedModel, setSelectedModel] = useState(config.embeddingsModel || "");
  const [chunkSize, setChunkSize] = useState(config.chunkSize || 800);
  const [chunkOverlap, setChunkOverlap] = useState(config.chunkOverlap || 0);
  const [chunkSizeError, setChunkSizeError] = useState<string | null>(null);
  const [chunkOverlapError, setChunkOverlapError] = useState<string | null>(null);

  // Загрузка провайдеров для проверки активности
  const { data: embeddingServices } = useQuery<{ providers: PublicEmbeddingProvider[] }>({
    queryKey: ["/api/embedding/services", workspaceId],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/embedding/services");
      if (!res.ok) {
        throw new Error("Не удалось загрузить провайдеры");
      }
      return (await res.json()) as { providers: PublicEmbeddingProvider[] };
    },
  });

  const activeProvidersMap = useMemo(() => {
    const map = new Map<string, PublicEmbeddingProvider>();
    (embeddingServices?.providers ?? [])
      .filter((p) => p.isActive)
      .forEach((p) => map.set(p.id, p));
    return map;
  }, [embeddingServices?.providers]);

  // Загрузка всех моделей эмбеддингов из каталога
  const { data: allModels, isLoading: modelsLoading } = useModels("EMBEDDINGS");

  // Фильтруем только активные модели (с активными провайдерами)
  const availableModels = useMemo(() => {
    if (!allModels) return [];
    return allModels.filter((model) => {
      if (!model.providerId) return false;
      return activeProvidersMap.has(model.providerId);
    });
  }, [allModels, activeProvidersMap]);

  // Определяем провайдера для выбранной модели
  const selectedModelData = useMemo(() => {
    if (!selectedModel || !allModels) return null;
    return allModels.find((m) => m.providerModelKey === selectedModel || m.key === selectedModel);
  }, [selectedModel, allModels]);

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
  const updateChunkSize = (value: number) => {
    if (value < MIN_CHUNK_SIZE) {
      setChunkSizeError(`Минимальный размер чанка: ${MIN_CHUNK_SIZE}`);
      return;
    }
    if (value > MAX_CHUNK_SIZE) {
      setChunkSizeError(`Максимальный размер чанка: ${MAX_CHUNK_SIZE}`);
      return;
    }
    setChunkSizeError(null);
    const newChunkSize = Math.round(value);
    setChunkSize(newChunkSize);

    // Автоматически ограничиваем chunkOverlap
    let newOverlap = chunkOverlap;
    if (chunkOverlap >= newChunkSize) {
      newOverlap = Math.max(0, newChunkSize - 1);
      setChunkOverlap(newOverlap);
    }
    
    onChange({
      embeddingsProvider: selectedProvider,
      embeddingsModel: selectedModel,
      chunkSize: newChunkSize,
      chunkOverlap: newOverlap,
    });
  };

  // Валидация и обновление chunkOverlap
  const updateChunkOverlap = (value: number) => {
    if (value < 0) {
      setChunkOverlapError("Перекрытие не может быть отрицательным");
      return;
    }
    if (value >= chunkSize) {
      setChunkOverlapError(`Перекрытие должно быть меньше размера чанка (${chunkSize})`);
      return;
    }
    setChunkOverlapError(null);
    const newOverlap = Math.round(value);
    setChunkOverlap(newOverlap);
    onChange({
      embeddingsProvider: selectedProvider,
      embeddingsModel: selectedModel,
      chunkSize,
      chunkOverlap: newOverlap,
    });
  };

  // Автоматический выбор модели при смене провайдера
  useEffect(() => {
    if (selectedProvider && availableModels.length > 0 && !availableModels.includes(selectedModel)) {
      const defaultModel = modelsQuery.data?.defaultModel ?? availableModels[0];
      if (defaultModel) {
        setSelectedModel(defaultModel);
      }
    }
  }, [selectedProvider, availableModels, selectedModel, modelsQuery.data]);

  // Синхронизация с внешним config (только при изменении внешнего config)
  useEffect(() => {
    if (
      config.embeddingsProvider !== selectedProvider ||
      config.embeddingsModel !== selectedModel ||
      config.chunkSize !== chunkSize ||
      config.chunkOverlap !== chunkOverlap
    ) {
      setSelectedProvider(config.embeddingsProvider || "");
      setSelectedModel(config.embeddingsModel || "");
      setChunkSize(config.chunkSize);
      setChunkOverlap(config.chunkOverlap);
    }
  }, [config.embeddingsProvider, config.embeddingsModel, config.chunkSize, config.chunkOverlap]);

  // Если модель не выбрана, но есть доступные модели, выбираем первую
  useEffect(() => {
    if (!selectedModel && availableModels.length > 0 && !modelsLoading) {
      const firstModel = availableModels[0];
      const modelKey = firstModel.providerModelKey || firstModel.key;
      if (modelKey && firstModel.providerId) {
        setSelectedModel(modelKey);
        setSelectedProvider(firstModel.providerId);
        onChange({
          embeddingsProvider: firstModel.providerId,
          embeddingsModel: modelKey,
          chunkSize,
          chunkOverlap,
        });
      }
    }
  }, [selectedModel, availableModels.length, modelsLoading]);

  if (modelsLoading) {
    return (
      <div className="space-y-4">
        <h3 className="text-lg font-semibold">Шаг 1: Эмбеддинги и чанкование</h3>
        <p className="text-sm text-muted-foreground">Загрузка провайдеров...</p>
      </div>
    );
  }

  if (availableModels.length === 0 && !modelsLoading) {
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

  const maxOverlap = Math.max(0, chunkSize - 1);

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
            <Label htmlFor="embeddings-model-select">Модель</Label>
            {modelsLoading ? (
              <p className="text-sm text-muted-foreground">Загрузка моделей...</p>
            ) : availableModels.length > 0 ? (
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
                    onChange({
                      embeddingsProvider: model.providerId,
                      embeddingsModel: modelKey,
                      chunkSize,
                      chunkOverlap,
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
                    const provider = activeProvidersMap.get(model.providerId || "");
                    return (
                      <SelectItem key={modelKey} value={modelKey}>
                        {model.displayName || modelKey}
                        {provider && ` (${provider.name})`}
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
                  onChange({
                    embeddingsProvider: selectedProvider,
                    embeddingsModel: value,
                    chunkSize,
                    chunkOverlap,
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
            <Label htmlFor="chunk-size-input">Размер чанка</Label>
            <Input
              id="chunk-size-input"
              type="number"
              min={MIN_CHUNK_SIZE}
              max={MAX_CHUNK_SIZE}
              value={chunkSize}
              onChange={(e) => {
                const value = Number.parseInt(e.target.value, 10);
                if (!Number.isNaN(value)) {
                  updateChunkSize(value);
                }
              }}
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
            <Label htmlFor="chunk-overlap-input">Перекрытие чанков</Label>
            <Input
              id="chunk-overlap-input"
              type="number"
              min={0}
              max={maxOverlap}
              value={chunkOverlap}
              onChange={(e) => {
                const value = Number.parseInt(e.target.value, 10);
                if (!Number.isNaN(value)) {
                  updateChunkOverlap(value);
                }
              }}
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
