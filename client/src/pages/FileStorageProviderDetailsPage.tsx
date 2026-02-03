import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { Loader2, ArrowLeft, Info, Copy, CheckCircle2, XCircle, Zap } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import {
  createFileStorageProvider,
  updateFileStorageProvider,
  useFileStorageProviderDetails,
} from "@/hooks/useFileStorageProviders";

const ALLOWED_PLACEHOLDERS = [
  "bucket",
  "workspaceName",
  "workspaceId",
  "skillName",
  "skillId",
  "chatId",
  "userId",
  "messageId",
  "fileName",
  "objectKey",
] as const;

const PLACEHOLDER_HINTS: Array<{ key: (typeof ALLOWED_PLACEHOLDERS)[number]; description: string }> = [
  { key: "bucket", description: "Bucket из конфигурации провайдера" },
  { key: "workspaceName", description: "Название рабочего пространства" },
  { key: "workspaceId", description: "ID рабочего пространства" },
  { key: "skillName", description: "Название навыка чата" },
  { key: "skillId", description: "ID навыка" },
  { key: "chatId", description: "ID чата" },
  { key: "userId", description: "ID пользователя, загрузившего файл" },
  { key: "messageId", description: "ID сообщения, к которому прикреплён файл" },
  { key: "fileName", description: "Оригинальное имя файла" },
  { key: "objectKey", description: "Уникальный slug имени (fallback)" },
];

type ProviderFormState = {
  name: string;
  baseUrl: string;
  description: string;
  authType: "none" | "bearer";
  isActive: boolean;
  uploadMethod: "POST" | "PUT";
  pathTemplate: string;
  multipartFieldName: string;
  metadataFieldName: string;
  responseFileIdPath: string;
  defaultTimeoutMs: string;
  bucket: string;
  skipSslVerify: boolean;
};

const defaultState: ProviderFormState = {
  name: "",
  baseUrl: "",
  description: "",
  authType: "none",
  isActive: true,
  uploadMethod: "POST",
  pathTemplate: "/{workspaceId}/{objectKey}",
  multipartFieldName: "file",
  metadataFieldName: "metadata",
  responseFileIdPath: "fileUri",
  defaultTimeoutMs: "15000",
  bucket: "",
  skipSslVerify: true, // По умолчанию включено для новых провайдеров
};

interface Props {
  providerId: string;
}

export default function FileStorageProviderDetailsPage({ providerId }: Props) {
  const isCreate = providerId === "new";
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { provider, isLoading, isError, error, refetch } = useFileStorageProviderDetails(providerId, {
    enabled: !isCreate,
  });

  const [form, setForm] = useState<ProviderFormState>(defaultState);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testBearerToken, setTestBearerToken] = useState("");
  const [testResult, setTestResult] = useState<{
    success: boolean;
    message: string;
    details?: unknown;
    elapsed?: number;
    providerFileId?: string;
  } | null>(null);

  useEffect(() => {
    if (provider) {
      setForm({
        name: provider.name ?? "",
        baseUrl: provider.baseUrl ?? "",
        description: provider.description ?? "",
        authType: (provider.authType as ProviderFormState["authType"]) ?? "none",
        isActive: provider.isActive ?? true,
        uploadMethod: (provider.config?.uploadMethod as ProviderFormState["uploadMethod"]) ?? defaultState.uploadMethod,
        pathTemplate: provider.config?.pathTemplate ?? defaultState.pathTemplate,
        multipartFieldName: provider.config?.multipartFieldName ?? defaultState.multipartFieldName,
        metadataFieldName: provider.config?.metadataFieldName ?? defaultState.metadataFieldName,
        responseFileIdPath: provider.config?.responseFileIdPath ?? defaultState.responseFileIdPath,
        defaultTimeoutMs:
          provider.config?.defaultTimeoutMs !== undefined && provider.config?.defaultTimeoutMs !== null
            ? String(provider.config.defaultTimeoutMs)
            : defaultState.defaultTimeoutMs,
        bucket: provider.config?.bucket ?? defaultState.bucket,
        skipSslVerify: provider.config?.skipSslVerify ?? false, // Для существующих провайдеров по умолчанию false
      });
    }
  }, [provider]);

  const title = useMemo(() => (isCreate ? "Создать файловый провайдер" : `Провайдер: ${provider?.name ?? ""}`), [isCreate, provider]);

  const validateTemplate = (template: string): string | null => {
    const tokens = Array.from(template.matchAll(/\{([^}]+)\}/g)).map(([, key]) => key.trim()).filter(Boolean);
    const invalid = tokens.filter((token) => !ALLOWED_PLACEHOLDERS.includes(token as (typeof ALLOWED_PLACEHOLDERS)[number]));
    if (invalid.length > 0) {
      return `Неподдерживаемые плейсхолдеры: ${invalid.join(", ")}`;
    }
    if (template.trim().length === 0) {
      return "Path template не может быть пустым";
    }
    return null;
  };

  const handleChange = (key: keyof ProviderFormState, value: any) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const templateError = validateTemplate(form.pathTemplate);
      if (templateError) {
        toast({ variant: "destructive", title: "Некорректный шаблон пути", description: templateError });
        setSaving(false);
        return;
      }
      const parsedTimeout = Number(form.defaultTimeoutMs);
      const timeoutValue = Number.isFinite(parsedTimeout) ? parsedTimeout : undefined;
      const payload = {
        ...form,
        config: {
          uploadMethod: form.uploadMethod,
          pathTemplate: form.pathTemplate.trim(),
          multipartFieldName: form.multipartFieldName.trim(),
          metadataFieldName: form.metadataFieldName.trim() === "" ? null : form.metadataFieldName.trim(),
          responseFileIdPath: form.responseFileIdPath.trim(),
          defaultTimeoutMs: timeoutValue,
          bucket: form.bucket.trim() === "" ? null : form.bucket.trim(),
          skipSslVerify: form.skipSslVerify,
        },
      };
      if (isCreate) {
        await createFileStorageProvider(payload);
        toast({ title: "Провайдер создан" });
      } else {
        await updateFileStorageProvider(providerId, payload);
        toast({ title: "Изменения сохранены" });
      }
      await queryClient.invalidateQueries({ queryKey: ["admin", "file-storage", "providers"] });
      navigate("/admin/file-storage");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Не удалось сохранить провайдера";
      toast({ variant: "destructive", title: "Ошибка", description: message });
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    if (isCreate) {
      toast({ variant: "destructive", title: "Сначала сохраните провайдера" });
      return;
    }
    setTesting(true);
    setTestResult(null);
    try {
      const body: { bearerToken?: string } = {};
      if (form.authType === "bearer" && testBearerToken.trim()) {
        body.bearerToken = testBearerToken.trim();
      }
      const res = await apiRequest("POST", `/api/admin/file-storage/providers/${providerId}/test`, body);
      const data = await res.json();
      if (data.success) {
        setTestResult({
          success: true,
          message: data.message ?? "Подключение успешно!",
          elapsed: data.elapsed,
          providerFileId: data.providerFileId,
        });
        toast({ title: "Проверка прошла успешно", description: `Файл загружен за ${data.elapsed}мс` });
      } else {
        setTestResult({
          success: false,
          message: data.message ?? "Ошибка подключения",
          details: data.details,
          elapsed: data.elapsed,
        });
        toast({ variant: "destructive", title: "Проверка не прошла", description: data.message });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Не удалось проверить подключение";
      setTestResult({
        success: false,
        message,
      });
      toast({ variant: "destructive", title: "Ошибка", description: message });
    } finally {
      setTesting(false);
    }
  };

  if (!isCreate && isLoading) {
    return (
      <div className="flex h-full items-center justify-center p-10 text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        Загрузка провайдера...
      </div>
    );
  }

  if (!isCreate && isError) {
    const message = error instanceof Error ? error.message : "Не удалось загрузить провайдера";
    return (
      <div className="p-6 space-y-3">
        <h1 className="text-2xl font-semibold">Провайдер</h1>
        <p className="text-destructive">{message}</p>
        <Button variant="secondary" onClick={() => refetch()}>
          Повторить
        </Button>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-3xl">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate("/admin/file-storage")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="space-y-1">
          <h1 className="text-3xl font-semibold">{title}</h1>
          <p className="text-muted-foreground">Укажите параметры внешнего хранилища файлов.</p>
        </div>
      </div>

      <div className="space-y-5">
        <div className="grid gap-2">
          <Label htmlFor="name">Название</Label>
          <Input
            id="name"
            value={form.name}
            onChange={(e) => handleChange("name", e.target.value)}
            placeholder="Например, Unica AI Storage"
          />
        </div>

        <div className="grid gap-2">
          <Label htmlFor="baseUrl">Base URL</Label>
          <Input
            id="baseUrl"
            value={form.baseUrl}
            onChange={(e) => handleChange("baseUrl", e.target.value)}
            placeholder="https://files.example.com/api"
          />
        </div>

        <div className="grid gap-2">
          <Label htmlFor="description">Описание</Label>
          <Textarea
            id="description"
            value={form.description}
            onChange={(e) => handleChange("description", e.target.value)}
            placeholder="Кратко опишите провайдера (опционально)"
          />
        </div>

        <div className="grid gap-2">
          <Label>Аутентификация</Label>
          <Select value={form.authType} onValueChange={(value: ProviderFormState["authType"]) => handleChange("authType", value)}>
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder="Выберите тип" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">None</SelectItem>
              <SelectItem value="bearer">Bearer</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <div className="grid gap-2">
            <Label>HTTP метод</Label>
            <Select
              value={form.uploadMethod}
              onValueChange={(value: ProviderFormState["uploadMethod"]) => handleChange("uploadMethod", value)}
            >
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder="Метод" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="POST">POST</SelectItem>
                <SelectItem value="PUT">PUT</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <div className="flex items-center gap-1">
              <Label htmlFor="pathTemplate">Path template</Label>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-6 w-6 p-0 text-muted-foreground">
                    <Info className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top" align="start" className="max-w-sm space-y-2">
                  <p className="font-semibold text-xs">Доступные плейсхолдеры</p>
                  <div className="space-y-1">
                    {PLACEHOLDER_HINTS.map((item) => (
                      <div key={item.key} className="flex items-center gap-2 text-xs leading-snug">
                        <span className="font-mono text-slate-700 dark:text-slate-200">{`{${item.key}}`}</span>
                        <span className="text-muted-foreground flex-1">{item.description}</span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 p-0 text-muted-foreground"
                          onClick={() => {
                            const value = `{${item.key}}`;
                            if (navigator?.clipboard?.writeText) {
                              navigator.clipboard.writeText(value).then(
                                () => toast({ title: "Скопировано", description: value }),
                                () => toast({ title: "Не удалось скопировать", variant: "destructive" }),
                              );
                            } else {
                              toast({ title: "Копирование недоступно", variant: "destructive" });
                            }
                          }}
                        >
                          <Copy className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    ))}
                  </div>
                  <div className="pt-1 space-y-1">
                    <p className="font-semibold text-xs">Пример</p>
                    <p className="text-xs leading-snug">/{`{bucket}`}/{`{workspaceName}`}/{`{skillName}`}/{`{fileName}`}</p>
                    <p className="text-[11px] text-muted-foreground">→ /unica-cloud/acme/qa-bot/report.pdf</p>
                  </div>
                </TooltipContent>
              </Tooltip>
            </div>
            <Input
              id="pathTemplate"
              value={form.pathTemplate}
              onChange={(e) => handleChange("pathTemplate", e.target.value)}
              placeholder="/{workspaceId}/{objectKey}"
            />
            <p className="text-xs text-muted-foreground">
              Плейсхолдеры: bucket, workspaceName, workspaceId, skillName, skillId, chatId, userId, messageId, fileName, objectKey.
            </p>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="bucket">Bucket (опционально)</Label>
            <Input
              id="bucket"
              value={form.bucket}
              onChange={(e) => handleChange("bucket", e.target.value)}
              placeholder="unica-cloud"
            />
            <p className="text-xs text-muted-foreground">Используйте {`{bucket}`} в шаблоне, если хотите подставлять это значение.</p>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <div className="grid gap-2">
            <Label htmlFor="multipartFieldName">Поле файла</Label>
            <Input
              id="multipartFieldName"
              value={form.multipartFieldName}
              onChange={(e) => handleChange("multipartFieldName", e.target.value)}
              placeholder="file"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="metadataFieldName">Поле metadata (опционально)</Label>
            <Input
              id="metadataFieldName"
              value={form.metadataFieldName}
              onChange={(e) => handleChange("metadataFieldName", e.target.value)}
              placeholder="metadata"
            />
            <p className="text-xs text-muted-foreground">Оставьте пустым, чтобы не отправлять metadata.</p>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="responseFileIdPath">Ключ ответа</Label>
            <Input
              id="responseFileIdPath"
              value={form.responseFileIdPath}
              onChange={(e) => handleChange("responseFileIdPath", e.target.value)}
              placeholder="fileUri"
            />
            <p className="text-xs text-muted-foreground">Поле/путь в JSON с providerFileId.</p>
          </div>
        </div>

        <div className="grid gap-2 md:w-1/3">
          <Label htmlFor="defaultTimeoutMs">Таймаут, мс</Label>
          <Input
            id="defaultTimeoutMs"
            type="number"
            min={0}
            max={600000}
            step={1000}
            value={form.defaultTimeoutMs}
            onChange={(e) => handleChange("defaultTimeoutMs", e.target.value)}
            placeholder="15000"
          />
          <p className="text-xs text-muted-foreground">0 — без таймаута, максимум 600000 мс (10 минут).</p>
        </div>

        <div className="flex items-center gap-3">
          <Switch checked={form.isActive} onCheckedChange={(value) => handleChange("isActive", value)} id="isActive" />
          <Label htmlFor="isActive">Активен</Label>
        </div>

        <div className="flex items-center gap-3">
          <Switch
            checked={form.skipSslVerify}
            onCheckedChange={(value) => handleChange("skipSslVerify", value)}
            id="skipSslVerify"
          />
          <div className="grid gap-0.5">
            <Label htmlFor="skipSslVerify">Игнорировать ошибки SSL</Label>
            <p className="text-xs text-muted-foreground">
              Отключает проверку SSL сертификата. Используйте для серверов с самоподписанными сертификатами.
            </p>
          </div>
        </div>
      </div>

      {/* Test Connection Section */}
      {!isCreate && (
        <div className="rounded-lg border p-4 space-y-4 bg-muted/30">
          <div className="flex items-center gap-2">
            <Zap className="h-5 w-5 text-amber-500" />
            <h3 className="font-medium">Проверка подключения</h3>
          </div>
          <p className="text-sm text-muted-foreground">
            Загрузит тестовый файл в провайдер для проверки настроек и сетевой доступности.
          </p>

          {form.authType === "bearer" && (
            <div className="grid gap-2">
              <Label htmlFor="testBearerToken">Bearer токен для теста</Label>
              <Input
                id="testBearerToken"
                type="password"
                value={testBearerToken}
                onChange={(e) => setTestBearerToken(e.target.value)}
                placeholder="Введите токен для авторизации"
              />
              <p className="text-xs text-muted-foreground">
                Токен будет использован только для тестового запроса и не сохраняется.
              </p>
            </div>
          )}

          <Button
            variant="secondary"
            onClick={handleTest}
            disabled={testing || (form.authType === "bearer" && !testBearerToken.trim())}
          >
            {testing ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Проверяем...
              </>
            ) : (
              <>
                <Zap className="mr-2 h-4 w-4" />
                Проверить подключение
              </>
            )}
          </Button>

          {testResult && (
            <Alert variant={testResult.success ? "default" : "destructive"}>
              {testResult.success ? (
                <CheckCircle2 className="h-4 w-4" />
              ) : (
                <XCircle className="h-4 w-4" />
              )}
              <AlertTitle>{testResult.success ? "Успешно" : "Ошибка"}</AlertTitle>
              <AlertDescription className="space-y-2">
                <p>{testResult.message}</p>
                {testResult.elapsed !== undefined && (
                  <p className="text-xs">Время выполнения: {testResult.elapsed}мс</p>
                )}
                {testResult.providerFileId && (
                  <p className="text-xs font-mono break-all">File ID: {testResult.providerFileId}</p>
                )}
                {testResult.details && (
                  <details className="text-xs">
                    <summary className="cursor-pointer">Подробности</summary>
                    <pre className="mt-2 whitespace-pre-wrap break-all bg-muted p-2 rounded text-[11px]">
                      {JSON.stringify(testResult.details, null, 2)}
                    </pre>
                  </details>
                )}
              </AlertDescription>
            </Alert>
          )}
        </div>
      )}

      <div className="flex gap-3">
        <Button onClick={handleSave} disabled={saving}>
          {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Сохранить
        </Button>
        <Button variant="outline" onClick={() => navigate("/admin/file-storage")}>
          Отмена
        </Button>
      </div>
    </div>
  );
}
