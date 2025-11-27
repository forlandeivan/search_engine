import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { Loader2, CheckCircle2 } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useSpeechProviderDetails, updateSpeechProvider, testIamToken, UpdateSpeechProviderPayload } from "@/hooks/useSpeechProviders";
import type { SpeechProviderDetail, SpeechProviderStatus } from "@/types/speech-providers";
import { useMutation, useQueryClient } from "@tanstack/react-query";

const STATUS_META: Record<SpeechProviderStatus, { label: string; variant: "default" | "secondary" | "destructive" }> = {
  Disabled: { label: "Выключен", variant: "secondary" },
  Enabled: { label: "Включен", variant: "default" },
  Error: { label: "Ошибка", variant: "destructive" },
};

const STATUS_HINT: Record<SpeechProviderStatus, string> = {
  Disabled: "Провайдер отключен и недоступен для транскрибации.",
  Enabled: "Провайдер доступен для транскрибации аудио.",
  Error: "При последней проверке настроек возникла ошибка.",
};

const SECRET_LABELS: Record<string, string> = {
  apiKey: "API-ключ",
  folderId: "ID каталога",
  serviceAccountKey: "Service Account Key",
};

const SECRET_DESCRIPTIONS: Record<string, string> = {
  apiKey: "Сервисный ключ доступа SpeechKit (синхронный API).",
  folderId: "Идентификатор каталога (folderId), внутри которого доступен SpeechKit.",
  serviceAccountKey: "JSON-ключ сервис-аккаунта Yandex Cloud. IAM-токен будет автоматически получен и кэширован с перевыпуском при истечении.",
};

const DEFAULT_CONFIG = {
  languageCode: "",
  model: "",
  enablePunctuation: true,
  iamMode: "auto" as "auto" | "manual",
  iamToken: "",
};

const DEFAULT_SECRETS = {
  apiKey: "",
  folderId: "",
  serviceAccountKey: "",
};

interface SpeechProviderDetailsPageProps {
  providerId: string;
}

export default function SpeechProviderDetailsPage({ providerId }: SpeechProviderDetailsPageProps) {
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { provider, isLoading, isError, error } = useSpeechProviderDetails(providerId);
  const [isEnabled, setIsEnabled] = useState(false);
  const [configState, setConfigState] = useState(DEFAULT_CONFIG);
  const [secretInputs, setSecretInputs] = useState(DEFAULT_SECRETS);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [generalError, setGeneralError] = useState<string | null>(null);

  useEffect(() => {
    if (!provider) {
      return;
    }
    setIsEnabled(provider.isEnabled);
    setConfigState({
      languageCode: (provider.config.languageCode as string) ?? "",
      model: (provider.config.model as string) ?? "",
      enablePunctuation:
        typeof provider.config.enablePunctuation === "boolean" ? provider.config.enablePunctuation : true,
      iamMode: (provider.config.iamMode as "auto" | "manual") ?? "auto",
      iamToken: (provider.config.iamToken as string) ?? "",
    });
    setSecretInputs(DEFAULT_SECRETS);
    setFieldErrors({});
    setGeneralError(null);
  }, [provider]);

  const mutation = useMutation({
    mutationFn: (payload: UpdateSpeechProviderPayload) => updateSpeechProvider(providerId, payload),
    onSuccess: (response) => {
      queryClient.invalidateQueries({ queryKey: ["admin", "tts-stt", "providers"] });
      queryClient.invalidateQueries({ queryKey: ["admin", "tts-stt", "providers", "detail", providerId] });
      toast({ title: "Настройки провайдера сохранены" });
      if (response?.provider) {
        setSecretInputs(DEFAULT_SECRETS);
        setFieldErrors({});
        setGeneralError(null);
        setIsEnabled(response.provider.isEnabled);
        setConfigState({
          languageCode: (response.provider.config.languageCode as string) ?? "",
          model: (response.provider.config.model as string) ?? "",
          enablePunctuation:
            typeof response.provider.config.enablePunctuation === "boolean"
              ? (response.provider.config.enablePunctuation as boolean)
              : true,
        });
      }
    },
    onError: (error: Error & { details?: unknown }) => {
      const newErrors: Record<string, string> = {};
      if (error.details && Array.isArray(error.details)) {
        for (const issue of error.details as Array<{ path?: (string | number)[]; message?: string }>) {
          const path = issue.path?.join(".") ?? "";
          if (path) {
            newErrors[path] = issue.message ?? "Некорректное значение";
          }
        }
      }
      setFieldErrors(newErrors);
      setGeneralError(error.message);
    },
  });

  const statusMeta = provider ? STATUS_META[provider.status] : null;
  const statusHint = provider ? STATUS_HINT[provider.status] : null;

  const updatedByText = useMemo(() => {
    if (!provider?.updatedByAdmin) {
      return "—";
    }
    return provider.updatedByAdmin.email ?? provider.updatedByAdmin.id ?? "—";
  }, [provider]);

  const handleSecretChange = (key: keyof typeof secretInputs, value: string) => {
    setSecretInputs((prev) => ({ ...prev, [key]: value }));
  };

  const handleConfigChange = (key: keyof typeof configState, value: string | boolean) => {
    setConfigState((prev) => ({ ...prev, [key]: value }));
  };

  const handleCancel = () => {
    navigate("/admin/tts-stt");
  };

  const handleToggleEnabled = (newValue: boolean) => {
    setIsEnabled(newValue);
    if (!provider) return;
    
    const payload: UpdateSpeechProviderPayload = {
      isEnabled: newValue,
      config: {
        languageCode: configState.languageCode.trim(),
        model: configState.model.trim() || undefined,
        enablePunctuation: configState.enablePunctuation,
      },
    };

    const secretsPayload: Record<string, string | null> = {};
    if (secretInputs.apiKey.trim().length > 0) {
      secretsPayload.apiKey = secretInputs.apiKey.trim();
    }
    if (secretInputs.folderId.trim().length > 0) {
      secretsPayload.folderId = secretInputs.folderId.trim();
    }
    if (secretInputs.serviceAccountKey.trim().length > 0) {
      secretsPayload.serviceAccountKey = secretInputs.serviceAccountKey.trim();
    }
    if (Object.keys(secretsPayload).length > 0) {
      payload.secrets = secretsPayload;
    }

    setGeneralError(null);
    mutation.mutate(payload);
  };

  const testTokenMutation = useMutation({
    mutationFn: () => testIamToken(providerId),
    onSuccess: (result) => {
      toast({ 
        title: "Успех", 
        description: result.message + (result.tokenPreview ? ` (${result.tokenPreview})` : "")
      });
    },
    onError: (error: Error & { details?: string }) => {
      const details = error.details ? `\n\n${error.details}` : "";
      toast({ 
        title: "Ошибка подключения", 
        description: error.message + details,
        variant: "destructive"
      });
    },
  });

  const validateForm = () => {
    if (!provider) {
      return false;
    }
    const validationErrors: Record<string, string> = {};
    const trimmedLanguage = configState.languageCode.trim();
    if (isEnabled && trimmedLanguage.length === 0) {
      validationErrors["config.languageCode"] = "Укажите язык распознавания (например, ru-RU).";
    }
    if (isEnabled && !provider.secrets.apiKey?.isSet && secretInputs.apiKey.trim().length === 0) {
      validationErrors["secrets.apiKey"] = "Укажите API-ключ перед включением провайдера.";
    }
    if (isEnabled && !provider.secrets.folderId?.isSet && secretInputs.folderId.trim().length === 0) {
      validationErrors["secrets.folderId"] = "Укажите ID каталога перед включением провайдера.";
    }
    if (isEnabled && !provider.secrets.serviceAccountKey?.isSet && secretInputs.serviceAccountKey.trim().length === 0) {
      validationErrors["secrets.serviceAccountKey"] = "Укажите Service Account Key перед включением провайдера (требуется для асинхронного API с автоперевыпуском IAM-токена).";
    }

    setFieldErrors(validationErrors);
    return Object.keys(validationErrors).length === 0;
  };

  const isProviderReady = useMemo(() => {
    if (!provider || !isEnabled) {
      return false;
    }
    return Boolean(
      (provider.secrets.apiKey?.isSet || secretInputs.apiKey.trim().length > 0) &&
      (provider.secrets.folderId?.isSet || secretInputs.folderId.trim().length > 0) &&
      (provider.secrets.serviceAccountKey?.isSet || secretInputs.serviceAccountKey.trim().length > 0) &&
      configState.languageCode.trim().length > 0 &&
      provider.status === "Enabled"
    );
  }, [provider, isEnabled, secretInputs, configState]);

  const handleSave = () => {
    if (!provider) {
      return;
    }
    if (!validateForm()) {
      return;
    }

    const config: Record<string, unknown> = {
      languageCode: configState.languageCode.trim(),
      model: configState.model.trim() || undefined,
      enablePunctuation: configState.enablePunctuation,
      iamMode: configState.iamMode,
    };
    
    if (configState.iamMode === "manual" && configState.iamToken.trim()) {
      config.iamToken = configState.iamToken.trim();
    }

    const payload: UpdateSpeechProviderPayload = {
      isEnabled,
      config,
    };

    const secretsPayload: Record<string, string | null> = {};
    if (secretInputs.apiKey.trim().length > 0) {
      secretsPayload.apiKey = secretInputs.apiKey.trim();
    }
    if (secretInputs.folderId.trim().length > 0) {
      secretsPayload.folderId = secretInputs.folderId.trim();
    }
    if (secretInputs.serviceAccountKey.trim().length > 0) {
      secretsPayload.serviceAccountKey = secretInputs.serviceAccountKey.trim();
    }
    if (Object.keys(secretsPayload).length > 0) {
      payload.secrets = secretsPayload;
    }

    setGeneralError(null);
    mutation.mutate(payload);
  };

  if (isLoading || !provider) {
    if (isLoading) {
      return (
        <div className="flex h-full items-center justify-center p-10 text-muted-foreground">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
          Загрузка данных провайдера...
        </div>
      );
    }
  }

  if (isError || !provider) {
    const message = error instanceof Error ? error.message : "Не удалось загрузить провайдера.";
    return (
      <div className="p-6 space-y-2">
        <h1 className="text-2xl font-semibold">Провайдер не найден</h1>
        <p className="text-muted-foreground">{message}</p>
        <Button variant="outline" onClick={() => navigate("/admin/tts-stt")}>
          Вернуться к списку
        </Button>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-col gap-3">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-semibold">Yandex SpeechKit</h1>
            {statusMeta && <Badge variant={statusMeta.variant}>{statusMeta.label}</Badge>}
          </div>
          <p className="text-muted-foreground">
            Тип: {provider.type} · Направление: {provider.direction === "audio_to_text" ? "audio → text" : provider.direction}
          </p>
        </div>
        <div className="text-sm text-muted-foreground flex flex-wrap gap-4">
          <span>
            Последний изменил: <span className="font-medium text-foreground">{updatedByText}</span>
          </span>
          <span>
            Дата изменения: <span className="font-medium text-foreground">{formatDateTime(provider.lastUpdatedAt)}</span>
          </span>
        </div>
      </div>

      {statusHint && (
        <div className="rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">
          <div className="flex items-start justify-between gap-4">
            <div>
              {statusHint}
              {provider.status === "Error" && provider.lastErrorMessage && (
                <p className="mt-1 text-destructive">{provider.lastErrorMessage}</p>
              )}
            </div>
            {isProviderReady && (
              <div className="flex items-center gap-2 whitespace-nowrap text-green-600 dark:text-green-400">
                <CheckCircle2 className="h-5 w-5 shrink-0" />
                <span className="text-xs font-medium">Готов к использованию</span>
              </div>
            )}
          </div>
        </div>
      )}

      {generalError && (
        <div className="rounded-lg border border-destructive bg-destructive/10 p-3 text-sm text-destructive">
          {generalError}
        </div>
      )}

      <div className="grid gap-6">
        <section className="space-y-4 rounded-lg border p-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-medium">Статус провайдера</h2>
              <p className="text-sm text-muted-foreground">
                Управляйте доступностью Yandex SpeechKit для всех рабочих пространств.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Label htmlFor="provider-enabled">Включить провайдера</Label>
              <Switch id="provider-enabled" checked={isEnabled} onCheckedChange={handleToggleEnabled} disabled={mutation.isPending} />
            </div>
          </div>
          <div className="space-y-4 border-t pt-4">
            <div className="space-y-3">
              <Label>Режим получения IAM токена</Label>
              <div className="space-y-3">
                <div className="flex items-center gap-3 p-3 border rounded-lg cursor-pointer" onClick={() => handleConfigChange("iamMode", "auto")}>
                  <input 
                    type="radio" 
                    id="iam-auto" 
                    name="iamMode" 
                    checked={configState.iamMode === "auto"}
                    onChange={() => handleConfigChange("iamMode", "auto")}
                  />
                  <label htmlFor="iam-auto" className="flex-1 cursor-pointer">
                    <div className="font-medium">Автоматический (MODE 2)</div>
                    <p className="text-xs text-muted-foreground">Система автоматически генерирует IAM токен через Yandex API. Требует сетевого доступа.</p>
                  </label>
                </div>
                <div className="flex items-center gap-3 p-3 border rounded-lg cursor-pointer" onClick={() => handleConfigChange("iamMode", "manual")}>
                  <input 
                    type="radio" 
                    id="iam-manual" 
                    name="iamMode"
                    checked={configState.iamMode === "manual"}
                    onChange={() => handleConfigChange("iamMode", "manual")}
                  />
                  <label htmlFor="iam-manual" className="flex-1 cursor-pointer">
                    <div className="font-medium">Готовый токен (MODE 1)</div>
                    <p className="text-xs text-muted-foreground">Подставьте готовый IAM токен. Обновляйте каждые 12 часов.</p>
                  </label>
                </div>
              </div>
            </div>
            {configState.iamMode === "manual" && (
              <div className="grid gap-2 p-3 bg-muted/30 rounded-lg">
                <Label htmlFor="iam-token">IAM Токен</Label>
                <Textarea
                  id="iam-token"
                  value={configState.iamToken}
                  onChange={(e) => handleConfigChange("iamToken", e.target.value)}
                  placeholder="Вставьте готовый IAM токен (t1.с...)  - действителен 12 часов"
                  rows={3}
                />
                <p className="text-xs text-muted-foreground">Получите токен командой: yc iam create-token</p>
              </div>
            )}
          </div>
          <div className="space-y-3">
            <div className="grid gap-2">
              <Label htmlFor="language-code">Язык распознавания (например, ru-RU)</Label>
              <Input
                id="language-code"
                value={configState.languageCode}
                onChange={(event) => handleConfigChange("languageCode", event.target.value)}
                placeholder="ru-RU"
              />
              {fieldErrors["config.languageCode"] && (
                <p className="text-sm text-destructive">{fieldErrors["config.languageCode"]}</p>
              )}
            </div>
            <div className="grid gap-2">
              <Label htmlFor="model-name">Модель (опционально)</Label>
              <Input
                id="model-name"
                value={configState.model}
                onChange={(event) => handleConfigChange("model", event.target.value)}
                placeholder="general"
              />
            </div>
            <div className="flex items-center gap-2 border rounded-md px-3 py-2">
              <Switch
                id="enable-punctuation"
                checked={configState.enablePunctuation}
                onCheckedChange={(value) => handleConfigChange("enablePunctuation", value)}
              />
              <div className="space-y-1">
                <Label htmlFor="enable-punctuation" className="cursor-pointer">
                  Автоматическая пунктуация
                </Label>
                <p className="text-xs text-muted-foreground">Расставлять точки и запятые в тексте транскрипции.</p>
              </div>
            </div>
          </div>
        </section>

      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="space-y-4 rounded-lg border p-4">
          <div>
            <h2 className="text-lg font-medium">Секреты</h2>
            <p className="text-sm text-muted-foreground">
              Значения не отображаются по соображениям безопасности. Введите новое значение, чтобы обновить секрет.
            </p>
          </div>
          <div className="space-y-4">
            {Object.entries(SECRET_LABELS).map(([key, label]) => {
              const secretKey = key as keyof typeof secretInputs;
              const isSet = provider.secrets[secretKey]?.isSet ?? false;
              const fieldKey = `secrets.${secretKey}`;
              return (
                <div key={secretKey} className="space-y-2">
                  <div className="flex items-center gap-2">
                    <div>
                      <Label>{label}</Label>
                      <p className="text-xs text-muted-foreground">{SECRET_DESCRIPTIONS[secretKey]}</p>
                    </div>
                    <Badge variant={isSet ? "default" : "secondary"}>{isSet ? "Задан" : "Не задан"}</Badge>
                  </div>
                  <Textarea
                    value={secretInputs[secretKey]}
                    onChange={(event) => handleSecretChange(secretKey, event.target.value)}
                    placeholder={isSet ? "Оставьте пустым, чтобы не менять значение" : "Введите значение"}
                    rows={2}
                  />
                  {fieldErrors[fieldKey] && <p className="text-sm text-destructive">{fieldErrors[fieldKey]}</p>}
                </div>
              );
            })}
            <Button 
              variant="outline" 
              onClick={() => testTokenMutation.mutate()} 
              disabled={testTokenMutation.isPending || !provider.secrets.serviceAccountKey?.isSet}
              data-testid="button-test-iam-token"
            >
              {testTokenMutation.isPending ? "Проверка..." : "Протестировать IAM токен"}
            </Button>
          </div>
        </section>
      </div>

      <div className="flex justify-end gap-3">
        <Button variant="outline" onClick={handleCancel} disabled={mutation.isPending}>
          Отмена
        </Button>
        <Button onClick={handleSave} disabled={mutation.isPending}>
          {mutation.isPending ? "Сохранение..." : "Сохранить"}
        </Button>
      </div>
    </div>
  );
}

function formatDateTime(value?: string | null) {
  if (!value) {
    return "—";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "—";
  }
  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}
