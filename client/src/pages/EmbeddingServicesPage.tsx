import { useEffect, useMemo, useState } from "react";
import { useForm, type FieldPath } from "react-hook-form";
import { z } from "zod";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Sparkles,
  Loader2,
  Eye,
  EyeOff,
  AlertCircle,
  ShieldCheck,
  Copy,
} from "lucide-react";

import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";

import {
  embeddingProviderTypes,
  type PublicEmbeddingProvider,
  type UpdateEmbeddingProvider,
} from "@shared/schema";

const requestHeadersSchema = z.record(z.string());

const formatJson = (value: unknown) => JSON.stringify(value, null, 2);

const defaultRequestHeaders: Record<string, string> = {};

const formatBoolean = (value: boolean) => (value ? "да" : "нет");

const buildCopySuccessMessage = (id: string) => `Идентификатор ${id} скопирован`;

type DebugStage = "token-request" | "token-response" | "embedding-request" | "embedding-response";

type DebugStepStatus = "idle" | "pending" | "success" | "error";

type DebugStep = {
  stage: DebugStage;
  title: string;
  status: DebugStepStatus;
  detail?: string;
};

type TestCredentialsDebugStep = {
  stage: DebugStage;
  status: "success" | "error";
  detail: string;
};

type TestCredentialsResult = {
  message: string;
  steps: TestCredentialsDebugStep[];
};

type TestCredentialsError = Error & {
  steps?: TestCredentialsDebugStep[];
};

type ProvidersResponse = { providers: PublicEmbeddingProvider[] };

type UpdateEmbeddingProviderVariables = {
  id: string;
  payload: UpdateEmbeddingProvider;
  formattedRequestHeaders: string;
};

type FormValues = {
  providerType: (typeof embeddingProviderTypes)[number];
  name: string;
  description: string;
  isActive: boolean;
  tokenUrl: string;
  embeddingsUrl: string;
  authorizationKey: string;
  scope: string;
  model: string;
  allowSelfSignedCertificate: boolean;
  requestHeaders: string;
};

const emptyFormValues: FormValues = {
  providerType: "gigachat",
  name: "",
  description: "",
  isActive: false,
  tokenUrl: "",
  embeddingsUrl: "",
  authorizationKey: "",
  scope: "",
  model: "",
  allowSelfSignedCertificate: false,
  requestHeaders: formatJson(defaultRequestHeaders),
};

const debugStepDefinitions: Array<Pick<DebugStep, "stage" | "title">> = [
  { stage: "token-request", title: "Запрос access_token" },
  { stage: "token-response", title: "Обработка ответа OAuth" },
  { stage: "embedding-request", title: "Запрос эмбеддингов" },
  { stage: "embedding-response", title: "Проверка ответа сервиса" },
];

const stageOrder = debugStepDefinitions.map((step) => step.stage);

const buildDebugSteps = (
  statusByStage?: TestCredentialsDebugStep[],
  fallbackToError = false,
): DebugStep[] => {
  if (!statusByStage || statusByStage.length === 0) {
    return debugStepDefinitions.map((step) => ({
      ...step,
      status: fallbackToError ? "error" : "idle",
    }));
  }

  const highestIndex = Math.max(...statusByStage.map((step) => stageOrder.indexOf(step.stage)));
  const hasError = statusByStage.some((step) => step.status === "error");

  return debugStepDefinitions.map((step, index) => {
    const matched = statusByStage.find((item) => item.stage === step.stage);

    if (matched) {
      return {
        ...step,
        status: matched.status,
        detail: matched.detail,
      } satisfies DebugStep;
    }

    if (!hasError && index === highestIndex + 1) {
      return {
        ...step,
        status: "pending",
      } satisfies DebugStep;
    }

    return {
      ...step,
      status: fallbackToError ? "error" : "idle",
    } satisfies DebugStep;
  });
};

const mapProviderToFormValues = (provider: PublicEmbeddingProvider): FormValues => ({
  providerType: provider.providerType,
  name: provider.name,
  description: provider.description ?? "",
  isActive: provider.isActive,
  tokenUrl: provider.tokenUrl,
  embeddingsUrl: provider.embeddingsUrl,
  authorizationKey: "",
  scope: provider.scope,
  model: provider.model,
  allowSelfSignedCertificate: provider.allowSelfSignedCertificate ?? false,
  requestHeaders: formatJson(provider.requestHeaders ?? defaultRequestHeaders),
});

export default function EmbeddingServicesPage() {
  const { toast } = useToast();
  const form = useForm<FormValues>({ defaultValues: emptyFormValues });
  const [isAuthorizationVisible, setIsAuthorizationVisible] = useState(false);
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null);
  const [debugSteps, setDebugSteps] = useState<DebugStep[]>(() => buildDebugSteps());

  const providersQuery = useQuery<ProvidersResponse>({
    queryKey: ["/api/embedding/services"],
  });

  const providers = useMemo(() => providersQuery.data?.providers ?? [], [providersQuery.data]);

  const selectedProvider = useMemo(
    () => providers.find((provider) => provider.id === selectedProviderId) ?? null,
    [providers, selectedProviderId],
  );

  useEffect(() => {
    if (providers.length === 0) {
      setSelectedProviderId(null);
      return;
    }

    if (selectedProviderId && providers.some((provider) => provider.id === selectedProviderId)) {
      return;
    }

    setSelectedProviderId(providers[0].id);
  }, [providers, selectedProviderId]);

  useEffect(() => {
    if (selectedProvider) {
      form.reset(mapProviderToFormValues(selectedProvider));
      setIsAuthorizationVisible(false);
      setDebugSteps(buildDebugSteps());
      return;
    }

    form.reset(emptyFormValues);
    setIsAuthorizationVisible(false);
    setDebugSteps(buildDebugSteps());
  }, [selectedProvider, form]);

  const updateProviderMutation = useMutation<
    { provider: PublicEmbeddingProvider },
    Error,
    UpdateEmbeddingProviderVariables
  >({
    mutationFn: async ({ id, payload }) => {
      const response = await apiRequest("PUT", `/api/embedding/services/${id}`, payload);
      if (!response.ok) {
        const body = (await response.json()) as { message?: string };
        throw new Error(body.message ?? "Не удалось обновить сервис эмбеддингов");
      }
      return (await response.json()) as { provider: PublicEmbeddingProvider };
    },
    onSuccess: ({ provider }, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/embedding/services"] });
      toast({
        title: "Изменения сохранены",
        description: "Настройки сервиса эмбеддингов обновлены.",
      });

      const updatedValues = {
        ...mapProviderToFormValues(provider),
        requestHeaders: variables.formattedRequestHeaders,
      } satisfies FormValues;

      form.reset(updatedValues);
      setIsAuthorizationVisible(false);
    },
    onError: (error) => {
      toast({
        title: "Не удалось сохранить изменения",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const parseJsonField = <T,>(
    value: string,
    schema: z.ZodType<T>,
    field: FieldPath<FormValues>,
    errorMessage: string,
    allowEmptyObject = true,
  ): T => {
    const trimmed = value.trim();

    if (!trimmed) {
      if (allowEmptyObject) {
        return schema.parse({});
      }

      form.setError(field, { type: "manual", message: errorMessage });
      throw new Error(errorMessage);
    }

    try {
      const parsed = JSON.parse(trimmed) as unknown;
      return schema.parse(parsed);
    } catch (error) {
      form.setError(field, { type: "manual", message: errorMessage });
      throw error instanceof Error ? error : new Error(String(error));
    }
  };

  const handleUpdate = form.handleSubmit((values) => {
    if (!selectedProvider) {
      toast({
        title: "Не выбран сервис",
        description: "Выберите сервис эмбеддингов слева, чтобы изменить его настройки.",
        variant: "destructive",
      });
      return;
    }

    form.clearErrors();

    try {
      const requestHeaders = parseJsonField(
        values.requestHeaders,
        requestHeadersSchema,
        "requestHeaders",
        "Укажите заголовки запроса в формате JSON",
      );

      const trimmedAuthorizationKey = values.authorizationKey.trim();

      const payload: UpdateEmbeddingProvider = {
        providerType: values.providerType,
        name: values.name.trim(),
        description: values.description.trim() ? values.description.trim() : undefined,
        isActive: values.isActive,
        tokenUrl: values.tokenUrl.trim(),
        embeddingsUrl: values.embeddingsUrl.trim(),
        scope: values.scope.trim(),
        model: values.model.trim(),
        allowSelfSignedCertificate: values.allowSelfSignedCertificate,
        requestHeaders,
      } satisfies UpdateEmbeddingProvider;

      if (trimmedAuthorizationKey.length > 0) {
        payload.authorizationKey = trimmedAuthorizationKey;
      }

      const formattedRequestHeaders = formatJson(requestHeaders);

      updateProviderMutation.mutate({
        id: selectedProvider.id,
        payload,
        formattedRequestHeaders,
      });
    } catch (error) {
      toast({
        title: "Не удалось подготовить данные",
        description: error instanceof Error ? error.message : "Исправьте ошибки и попробуйте снова.",
        variant: "destructive",
      });
    }
  });

  const testCredentialsMutation = useMutation<TestCredentialsResult, TestCredentialsError>({
    mutationFn: async () => {
      form.clearErrors();

      const values = form.getValues();
      const tokenUrl = values.tokenUrl.trim();
      const embeddingsUrl = values.embeddingsUrl.trim();
      const authorizationKey = values.authorizationKey.trim();
      const scope = values.scope.trim();
      const model = values.model.trim();

      if (!tokenUrl) {
        const message = "Укажите endpoint для получения токена";
        form.setError("tokenUrl", { type: "manual", message });
        throw new Error(message);
      }

      if (!embeddingsUrl) {
        const message = "Укажите endpoint сервиса эмбеддингов";
        form.setError("embeddingsUrl", { type: "manual", message });
        throw new Error(message);
      }

      if (!authorizationKey) {
        const message = "Укажите Authorization key";
        form.setError("authorizationKey", { type: "manual", message });
        throw new Error(message);
      }

      if (!scope) {
        const message = "Укажите OAuth scope";
        form.setError("scope", { type: "manual", message });
        throw new Error(message);
      }

      if (!model) {
        const message = "Укажите модель";
        form.setError("model", { type: "manual", message });
        throw new Error(message);
      }

      const requestHeaders = parseJsonField(
        values.requestHeaders,
        requestHeadersSchema,
        "requestHeaders",
        "Укажите заголовки запроса в формате JSON",
      );

      setDebugSteps(
        debugStepDefinitions.map((step, index) => ({
          ...step,
          status: index === 0 ? "pending" : "idle",
        })),
      );

      let response: Response;
      try {
        response = await fetch("/api/embedding/services/test-credentials", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          credentials: "include",
          body: JSON.stringify({
            tokenUrl,
            embeddingsUrl,
            authorizationKey,
            scope,
            model,
            allowSelfSignedCertificate: values.allowSelfSignedCertificate,
            requestHeaders,
          }),
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const steps: TestCredentialsDebugStep[] = [
          {
            stage: "token-request",
            status: "error",
            detail: message,
          },
        ];
        setDebugSteps(buildDebugSteps(steps, true));
        const enrichedError = new Error(`Не удалось отправить запрос: ${message}`) as TestCredentialsError;
        enrichedError.steps = steps;
        throw enrichedError;
      }

      const rawBody = await response.text();
      let parsed: Partial<TestCredentialsResult> | null = null;

      if (rawBody) {
        try {
          parsed = JSON.parse(rawBody) as Partial<TestCredentialsResult>;
        } catch (error) {
          console.error("Не удалось разобрать ответ проверки эмбеддингов", error);
        }
      }

      if (!response.ok) {
        const message = parsed?.message ?? (rawBody || response.statusText);
        const errorSteps = Array.isArray(parsed?.steps)
          ? (parsed?.steps as TestCredentialsDebugStep[])
          : [];
        setDebugSteps(errorSteps.length > 0 ? buildDebugSteps(errorSteps, true) : buildDebugSteps());
        const enrichedError = new Error(message) as TestCredentialsError;
        enrichedError.steps = errorSteps.length > 0 ? errorSteps : undefined;
        throw enrichedError;
      }

      const steps = Array.isArray(parsed?.steps)
        ? (parsed?.steps as TestCredentialsDebugStep[])
        : [];
      const message = parsed?.message ?? "Авторизация подтверждена";
      setDebugSteps(buildDebugSteps(steps));
      return { message, steps } satisfies TestCredentialsResult;
    },
    onSuccess: (result) => {
      toast({
        title: "Авторизация подтверждена",
        description: result.message,
      });
    },
    onError: (error) => {
      if (error.steps && error.steps.length > 0) {
        setDebugSteps(buildDebugSteps(error.steps, true));
      } else {
        setDebugSteps(buildDebugSteps());
      }
      toast({
        title: "Проверка не удалась",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const hasActiveDebugSteps = debugSteps.some((step) => step.status !== "idle");

  const handleCopyId = async (id: string) => {
    try {
      await navigator.clipboard.writeText(id);
      toast({ title: "Скопировано", description: buildCopySuccessMessage(id) });
    } catch (error) {
      console.error("Не удалось скопировать embeddingProviderId", error);
      toast({
        title: "Не удалось скопировать",
        description: "Попробуйте вручную выделить и скопировать идентификатор.",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="space-y-6 p-6">
      <div className="space-y-1">
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          <Sparkles className="h-5 w-5 text-primary" /> Управление эмбеддингами
        </h1>
        <p className="text-muted-foreground max-w-3xl">
          Выберите подключённый сервис и настройте ключи, модель и дополнительные заголовки. Добавление новых сервисов
          выполняется программно, здесь доступны только правки существующих конфигураций.
        </p>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1.9fr)] 2xl:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <Card className="h-fit">
          <CardHeader className="pb-4">
            <CardTitle>Сервисы эмбеддингов</CardTitle>
            <CardDescription>Выберите сервис, чтобы изменить его параметры.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {providersQuery.isLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Загружаем список сервисов...
              </div>
            ) : providersQuery.isError ? (
              <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
                {(providersQuery.error as Error).message ?? "Не удалось загрузить сервисы"}
              </div>
            ) : providers.length === 0 ? (
              <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
                Сервисы ещё не настроены. Обратитесь к администратору.
              </div>
            ) : (
              <div className="space-y-3">
                {providers.map((provider) => {
                  const isSelected = provider.id === selectedProviderId;

                  return (
                    <button
                      key={provider.id}
                      type="button"
                      onClick={() => setSelectedProviderId(provider.id)}
                      className={cn(
                        "w-full rounded-lg border px-4 py-3 text-left transition",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                        isSelected
                          ? "border-primary bg-primary/5 shadow-sm"
                          : "border-border bg-background hover:border-primary/60 hover:shadow-sm",
                        !provider.isActive && "opacity-90",
                      )}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="flex flex-col gap-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-semibold text-foreground">{provider.name}</span>
                            <Badge variant="outline" className="text-[11px] uppercase">
                              {provider.providerType}
                            </Badge>
                            <Badge variant={provider.isActive ? "default" : "secondary"}>
                              {provider.isActive ? "Активен" : "Отключён"}
                            </Badge>
                          </div>
                          {provider.description ? (
                            <p className="text-xs text-muted-foreground">{provider.description}</p>
                          ) : null}
                        </div>
                        <div className="flex flex-col items-end gap-2 text-xs text-muted-foreground">
                          <span>Модель: {provider.model}</span>
                          <span>Token: {formatBoolean(provider.hasAuthorizationKey)}</span>
                          <span>SSL: {provider.allowSelfSignedCertificate ? "self-signed" : "строгая проверка"}</span>
                        </div>
                      </div>

                      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <Badge variant="outline" className="text-[11px] font-normal">
                          Scope: {provider.scope}
                        </Badge>
                        <Badge variant="outline" className="text-[11px] font-normal">
                          OAuth: {provider.tokenUrl}
                        </Badge>
                      </div>

                      <div className="mt-3">
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 text-[11px] font-medium uppercase text-primary"
                          onClick={(event) => {
                            event.stopPropagation();
                            void handleCopyId(provider.id);
                          }}
                        >
                          <Copy className="h-3.5 w-3.5" /> embeddingProviderId: {provider.id}
                        </button>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-4">
            <CardTitle>{selectedProvider ? selectedProvider.name : "Настройки сервиса"}</CardTitle>
            <CardDescription>
              {selectedProvider
                ? "Обновите ключи доступа, модель эмбеддингов и дополнительные параметры."
                : "Выберите сервис слева, чтобы изменить его настройки."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Form {...form}>
              <form onSubmit={handleUpdate} className="space-y-6">
                {!selectedProvider ? (
                  <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
                    Нет доступных сервисов для настройки.
                  </div>
                ) : (
                  <>
                    <div className="grid gap-4 md:grid-cols-2">
                      <FormField
                        control={form.control}
                        name="providerType"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Провайдер</FormLabel>
                            <FormControl>
                              <Select onValueChange={field.onChange} value={field.value}>
                                <SelectTrigger>
                                  <SelectValue placeholder="Выберите провайдера" />
                                </SelectTrigger>
                                <SelectContent>
                                  {embeddingProviderTypes.map((type) => (
                                    <SelectItem key={type} value={type}>
                                      {type === "gigachat" ? "GigaChat" : type}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </FormControl>
                            <FormDescription>Определяет преднастроенные параметры интеграции.</FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="isActive"
                        render={({ field }) => (
                          <FormItem className="flex items-center justify-between rounded-lg border p-3">
                            <div className="space-y-1">
                              <FormLabel className="text-sm">Статус сервиса</FormLabel>
                              <FormDescription className="text-xs">
                                Только активные сервисы доступны в настройках векторизации.
                              </FormDescription>
                            </div>
                            <FormControl>
                              <Switch checked={field.value} onCheckedChange={field.onChange} />
                            </FormControl>
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="name"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Название</FormLabel>
                            <FormControl>
                              <Input {...field} placeholder="Например, GigaChat Embeddings Prod" required />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="description"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Описание</FormLabel>
                            <FormControl>
                              <Input {...field} placeholder="Для чего используется этот сервис" />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>

                    <div className="grid gap-4 md:grid-cols-2">
                      <FormField
                        control={form.control}
                        name="tokenUrl"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Endpoint для Access Token</FormLabel>
                            <FormControl>
                              <Input
                                {...field}
                                placeholder="https://ngw.devices.sberbank.ru:9443/api/v2/oauth"
                                required
                              />
                            </FormControl>
                            <FormDescription>
                              Сервис GigaChat требует предварительный запрос для получения токена доступа.
                            </FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="embeddingsUrl"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Endpoint эмбеддингов</FormLabel>
                            <FormControl>
                              <Input
                                {...field}
                                placeholder="https://gigachat.devices.sberbank.ru/api/v1/embeddings"
                                required
                              />
                            </FormControl>
                            <FormDescription>Именно сюда будет отправляться текст для расчёта векторов.</FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>

                    <FormField
                      control={form.control}
                      name="authorizationKey"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Authorization key</FormLabel>
                          <FormControl>
                            <div className="relative">
                              <Input
                                {...field}
                                type={isAuthorizationVisible ? "text" : "password"}
                                placeholder="Значение заголовка Authorization"
                                autoComplete="new-password"
                                className="pr-10"
                              />
                              <Button
                                type="button"
                                size="icon"
                                variant="ghost"
                                className="absolute inset-y-0 right-0 h-full px-3 text-muted-foreground"
                                onClick={() => setIsAuthorizationVisible((previous) => !previous)}
                                aria-label={
                                  isAuthorizationVisible
                                    ? "Скрыть Authorization key"
                                    : "Показать Authorization key"
                                }
                              >
                                {isAuthorizationVisible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                              </Button>
                            </div>
                          </FormControl>
                          <FormDescription>
                            Скопируйте готовый ключ из личного кабинета GigaChat (формат <code>Basic &lt;token&gt;</code>).
                          </FormDescription>
                          <div className="flex flex-col gap-3 pt-2">
                            <div className="flex flex-wrap items-center gap-2">
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                onClick={() => testCredentialsMutation.mutate()}
                                disabled={testCredentialsMutation.isPending}
                              >
                                {testCredentialsMutation.isPending ? (
                                  <>
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Проверяем...
                                  </>
                                ) : (
                                  <>
                                    <ShieldCheck className="mr-2 h-4 w-4" /> Проверить авторизацию
                                  </>
                                )}
                              </Button>
                              {testCredentialsMutation.isSuccess && !testCredentialsMutation.isPending ? (
                                <span className="flex items-center gap-1 text-sm text-emerald-600">
                                  <ShieldCheck className="h-4 w-4" /> {testCredentialsMutation.data?.message}
                                </span>
                              ) : null}
                              {testCredentialsMutation.isError && !testCredentialsMutation.isPending ? (
                                <span className="flex items-center gap-1 text-sm text-destructive">
                                  <AlertCircle className="h-4 w-4" /> {testCredentialsMutation.error?.message}
                                </span>
                              ) : null}
                            </div>

                            {hasActiveDebugSteps ? (
                              <div className="rounded-lg border bg-muted/50 p-4">
                                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                                  Ход проверки
                                </p>
                                <div className="mt-3 space-y-2">
                                  {debugSteps.map((step) => {
                                    const statusColor =
                                      step.status === "error"
                                        ? "text-destructive"
                                        : step.status === "success"
                                          ? "text-emerald-600"
                                          : "text-muted-foreground";

                                    return (
                                      <div key={step.stage} className="flex items-start gap-2 text-sm">
                                        {step.status === "pending" ? (
                                          <Loader2 className="mt-0.5 h-4 w-4 animate-spin text-muted-foreground" />
                                        ) : step.status === "success" ? (
                                          <ShieldCheck className="mt-0.5 h-4 w-4 text-emerald-600" />
                                        ) : step.status === "error" ? (
                                          <AlertCircle className="mt-0.5 h-4 w-4 text-destructive" />
                                        ) : (
                                          <Sparkles className="mt-0.5 h-4 w-4 text-muted-foreground" />
                                        )}
                                        <div className="space-y-1">
                                          <div className={cn("font-medium", statusColor)}>{step.title}</div>
                                          {step.detail ? <div className={cn("text-sm", statusColor)}>{step.detail}</div> : null}
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            ) : null}
                          </div>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <div className="grid gap-4 md:grid-cols-2">
                      <FormField
                        control={form.control}
                        name="scope"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>OAuth scope</FormLabel>
                            <FormControl>
                              <Input {...field} placeholder="GIGACHAT_API_PERS" required />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="model"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Модель эмбеддингов</FormLabel>
                            <FormControl>
                              <Input {...field} placeholder="embeddings" required />
                            </FormControl>
                            <FormDescription>Посмотрите актуальные названия моделей в документации провайдера.</FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>

                    <FormField
                      control={form.control}
                      name="allowSelfSignedCertificate"
                      render={({ field }) => (
                        <FormItem className="flex items-center justify-between rounded-lg border p-3">
                          <div className="space-y-1">
                            <FormLabel className="text-sm">Доверять самоподписанным сертификатам</FormLabel>
                            <FormDescription className="text-xs">
                              Включите, если сервис размещён во внутреннем контуре с self-signed SSL.
                            </FormDescription>
                          </div>
                          <FormControl>
                            <Switch checked={field.value} onCheckedChange={field.onChange} />
                          </FormControl>
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="requestHeaders"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Дополнительные заголовки</FormLabel>
                          <FormControl>
                            <Textarea
                              {...field}
                              spellCheck={false}
                              rows={4}
                              placeholder='{"Accept": "application/json"}'
                            />
                          </FormControl>
                          <FormDescription>
                            JSON-объект со строковыми значениями. Добавьте заголовки только если они требуются вашим API.
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </>
                )}

                <div className="flex justify-end">
                  <Button type="submit" disabled={!selectedProvider || updateProviderMutation.isPending}>
                    {updateProviderMutation.isPending ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Сохраняем...
                      </>
                    ) : (
                      "Сохранить изменения"
                    )}
                  </Button>
                </div>
              </form>
            </Form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
