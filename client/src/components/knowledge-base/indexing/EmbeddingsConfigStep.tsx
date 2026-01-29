import { useState, useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { AlertTriangle, CheckCircle2, XCircle, ExternalLink } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import type { PublicEmbeddingProvider } from "@shared/schema";

interface EmbeddingsConfigStepProps {
  config: {
    embeddingsProvider: string;
    embeddingsModel: string;
  };
  onChange: (config: { embeddingsProvider: string; embeddingsModel: string }) => void;
  workspaceId: string;
  /** Исходная конфигурация для проверки изменений */
  initialConfig?: {
    embeddingsProvider: string;
    embeddingsModel: string;
  };
  disabled?: boolean;
}

// Модели для известных провайдеров
const PROVIDER_MODELS: Record<string, string[]> = {
  openai: ["text-embedding-3-small", "text-embedding-3-large", "text-embedding-ada-002"],
  "openai-embeddings": ["text-embedding-3-small", "text-embedding-3-large", "text-embedding-ada-002"],
  gigachat: ["Embeddings"],
  "gigachat-embeddings": ["Embeddings"],
};

export function EmbeddingsConfigStep({
  config,
  onChange,
  workspaceId,
  initialConfig,
  disabled,
}: EmbeddingsConfigStepProps) {
  const [selectedProvider, setSelectedProvider] = useState(config.embeddingsProvider);
  const [selectedModel, setSelectedModel] = useState(config.embeddingsModel);

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

  // Доступные модели для выбранного провайдера
  const availableModels = useMemo(() => {
    if (!selectedProvider) return [];
    // Пытаемся получить модели из провайдера
    if (selectedProviderData?.model) {
      return [selectedProviderData.model];
    }
    // Иначе используем захардкоженные модели
    const providerKey = selectedProvider.toLowerCase();
    return PROVIDER_MODELS[providerKey] ?? [];
  }, [selectedProvider, selectedProviderData]);

  // Проверка изменений
  const hasProviderChanged = useMemo(
    () => initialConfig && selectedProvider !== initialConfig.embeddingsProvider,
    [initialConfig, selectedProvider],
  );
  const hasModelChanged = useMemo(
    () => initialConfig && selectedModel !== initialConfig.embeddingsModel,
    [initialConfig, selectedModel],
  );

  // Обновление конфигурации
  useEffect(() => {
    onChange({ embeddingsProvider: selectedProvider, embeddingsModel: selectedModel });
  }, [selectedProvider, selectedModel, onChange]);

  // Автоматический выбор модели при смене провайдера
  useEffect(() => {
    if (selectedProvider && availableModels.length > 0 && !availableModels.includes(selectedModel)) {
      setSelectedModel(availableModels[0]);
    }
  }, [selectedProvider, availableModels, selectedModel]);

  if (providersLoading) {
    return (
      <div className="space-y-4">
        <h3 className="text-lg font-semibold">Шаг 2: Провайдер эмбеддингов</h3>
        <p className="text-sm text-muted-foreground">Загрузка провайдеров...</p>
      </div>
    );
  }

  if (activeProviders.length === 0) {
    return (
      <div className="space-y-4">
        <h3 className="text-lg font-semibold">Шаг 2: Провайдер эмбеддингов</h3>
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            <div className="space-y-2">
              <p>Нет настроенных провайдеров</p>
              <p className="text-sm">
                Для индексации необходимо настроить хотя бы один провайдер эмбеддингов в разделе "Администрирование".
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => window.open("/admin", "_blank")}
                className="mt-2"
              >
                Перейти в настройки
                <ExternalLink className="ml-2 h-4 w-4" />
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold">Шаг 2: Провайдер эмбеддингов</h3>
        <p className="text-sm text-muted-foreground">
          Выберите сервис для создания векторных представлений документов.
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
              {"vectorSize" in (selectedProviderData as any) && (selectedProviderData as any).vectorSize && (
                <span className="text-muted-foreground">| Размерность: {(selectedProviderData as any).vectorSize}</span>
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
            {availableModels.length > 0 ? (
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
              <input
                type="text"
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value)}
                disabled={disabled || !selectedProvider}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                placeholder="Введите модель вручную"
              />
            )}
          </div>
          {availableModels.length > 0 && (
            <CardDescription>
              <p className="font-medium mb-1">Доступные модели:</p>
              <ul className="list-disc list-inside space-y-0.5 text-xs">
                {availableModels.map((model) => (
                  <li key={model}>
                    {model === "text-embedding-3-small" && "быстрая, экономичная"}
                    {model === "text-embedding-3-large" && "высокая точность"}
                    {model === "text-embedding-ada-002" && "legacy"}
                  </li>
                ))}
              </ul>
            </CardDescription>
          )}
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
