import { useState, useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertTriangle, CheckCircle2, XCircle } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useEmbeddingProviderModels } from "@/hooks/useEmbeddingProviderModels";
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
  const [selectedProvider, setSelectedProvider] = useState(config.embeddingsProvider);
  const [selectedModel, setSelectedModel] = useState(config.embeddingsModel);
  const [chunkSize, setChunkSize] = useState(config.chunkSize);
  const [chunkOverlap, setChunkOverlap] = useState(config.chunkOverlap);
  const [chunkSizeError, setChunkSizeError] = useState<string | null>(null);
  const [chunkOverlapError, setChunkOverlapError] = useState<string | null>(null);

  // Загрузка провайдеров
  const { data: embeddingServices, isLoading: providersLoading } = useQuery<{ providers: PublicEmbeddingProvider[] }>({
    queryKey: ["embedding-providers", workspaceId],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/embedding-providers", undefined, undefined, { workspaceId });
      if (!res.ok) {
        throw new Error("Не удалось загрузить провайдеры");
      }
      return (await res.json()) as { providers: PublicEmbeddingProvider[] };
    },
  });

  const activeProviders = useMemo(
    () => (embeddingServices?.providers ?? []).filter((p) => p.isActive),
    [embeddingServices?.providers],
  );

  const selectedProviderData = useMemo(
    () => activeProviders.find((p) => p.id === selectedProvider),
    [activeProviders, selectedProvider],
  );

  // Загрузка моделей из каталога для выбранного провайдера
  const modelsQuery = useEmbeddingProviderModels(selectedProvider, {
    enabled: Boolean(selectedProvider),
    workspaceId,
  });

  const availableModels = useMemo(() => {
    if (!modelsQuery.data) {
      // Если модели ещё не загружены, возвращаем модель из провайдера (если есть)
      if (selectedProviderData?.model) {
        return [selectedProviderData.model];
      }
      return [];
    }
    return modelsQuery.data.models ?? [];
  }, [modelsQuery.data, selectedProviderData]);

  // Проверка изменений
  const hasProviderChanged = useMemo(
    () => initialConfig && selectedProvider !== initialConfig.embeddingsProvider,
    [initialConfig, selectedProvider],
  );
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
    if (chunkOverlap >= newChunkSize) {
      const newOverlap = Math.max(0, newChunkSize - 1);
      setChunkOverlap(newOverlap);
      onChange({
        embeddingsProvider: selectedProvider,
        embeddingsModel: selectedModel,
        chunkSize: newChunkSize,
        chunkOverlap: newOverlap,
      });
    } else {
      onChange({
        embeddingsProvider: selectedProvider,
        embeddingsModel: selectedModel,
        chunkSize: newChunkSize,
        chunkOverlap,
      });
    }
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

  // Обновление конфигурации при изменении провайдера/модели
  useEffect(() => {
    onChange({
      embeddingsProvider: selectedProvider,
      embeddingsModel: selectedModel,
      chunkSize,
      chunkOverlap,
    });
  }, [selectedProvider, selectedModel, chunkSize, chunkOverlap, onChange]);

  // Автоматический выбор модели при смене провайдера
  useEffect(() => {
    if (selectedProvider && availableModels.length > 0 && !availableModels.includes(selectedModel)) {
      const defaultModel = modelsQuery.data?.defaultModel ?? availableModels[0];
      if (defaultModel) {
        setSelectedModel(defaultModel);
      }
    }
  }, [selectedProvider, availableModels, selectedModel, modelsQuery.data]);

  // Синхронизация с внешним config
  useEffect(() => {
    setSelectedProvider(config.embeddingsProvider);
    setSelectedModel(config.embeddingsModel);
    setChunkSize(config.chunkSize);
    setChunkOverlap(config.chunkOverlap);
  }, [config.embeddingsProvider, config.embeddingsModel, config.chunkSize, config.chunkOverlap]);

  if (providersLoading) {
    return (
      <div className="space-y-4">
        <h3 className="text-lg font-semibold">Шаг 1: Эмбеддинги и чанкование</h3>
        <p className="text-sm text-muted-foreground">Загрузка провайдеров...</p>
      </div>
    );
  }

  if (activeProviders.length === 0) {
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

      {/* Провайдер */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Провайдер эмбеддингов</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="embeddings-provider-select">Провайдер</Label>
            <Select
              value={selectedProvider}
              onValueChange={(value) => {
                setSelectedProvider(value);
              }}
              disabled={disabled}
            >
              <SelectTrigger id="embeddings-provider-select">
                <SelectValue placeholder="Выберите провайдера" />
              </SelectTrigger>
              <SelectContent>
                {activeProviders.map((provider) => (
                  <SelectItem key={provider.id} value={provider.id}>
                    {provider.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {selectedProviderData && (
            <div className="flex items-center gap-2 text-sm">
              {selectedProviderData.isActive ? (
                <>
                  <CheckCircle2 className="h-4 w-4 text-green-600" />
                  <span>Активен</span>
                </>
              ) : (
                <>
                  <XCircle className="h-4 w-4 text-red-600" />
                  <span>Неактивен</span>
                </>
              )}
              {selectedProviderData.vectorSize && (
                <span className="text-muted-foreground">| Размерность: {selectedProviderData.vectorSize}</span>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Модель */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Модель</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="embeddings-model-select">Модель</Label>
            {modelsQuery.isLoading ? (
              <p className="text-sm text-muted-foreground">Загрузка моделей...</p>
            ) : availableModels.length > 0 ? (
              <Select
                value={selectedModel}
                onValueChange={(value) => {
                  setSelectedModel(value);
                }}
                disabled={disabled || !selectedProvider}
              >
                <SelectTrigger id="embeddings-model-select">
                  <SelectValue placeholder="Выберите модель" />
                </SelectTrigger>
                <SelectContent>
                  {availableModels.map((model) => (
                    <SelectItem key={model} value={model}>
                      {model}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Input
                id="embeddings-model-input"
                type="text"
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value)}
                disabled={disabled || !selectedProvider}
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
      {(hasProviderChanged || hasModelChanged) && (
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            Смена провайдера эмбеддингов требует полной переиндексации. Существующие векторы станут несовместимы с
            новой моделью.
          </AlertDescription>
        </Alert>
      )}

      {selectedProviderData && !selectedProviderData.isActive && (
        <Alert variant="destructive">
          <XCircle className="h-4 w-4" />
          <AlertDescription>
            Провайдер неактивен. Настройте его в разделе "Администрирование".
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
