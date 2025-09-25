import { useMemo, useState } from "react";
import { useForm, type FieldPath } from "react-hook-form";
import { z } from "zod";
import { useMutation, useQuery } from "@tanstack/react-query";

import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormDescription,
  FormMessage,
} from "@/components/ui/form";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

import {
  embeddingProviderTypes,
  embeddingRequestConfigSchema,
  embeddingResponseConfigSchema,
  qdrantIntegrationConfigSchema,
  type PublicEmbeddingProvider,
  type InsertEmbeddingProvider,
} from "@shared/schema";

import { AlertCircle, Loader2, RefreshCw, ShieldCheck, Sparkles } from "lucide-react";

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

const debugStepDefinitions: Array<Pick<DebugStep, "stage" | "title">> = [
  {
    stage: "token-request",
    title: "Запрос access_token",
  },
  {
    stage: "token-response",
    title: "Обработка ответа OAuth",
  },
  {
    stage: "embedding-request",
    title: "Запрос эмбеддингов",
  },
  {
    stage: "embedding-response",
    title: "Проверка ответа сервиса",
  },
];

const stageOrder = debugStepDefinitions.map((step) => step.stage);

const buildDebugSteps = (statusByStage?: TestCredentialsDebugStep[], fallbackToError = false): DebugStep[] => {
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
      } as DebugStep;
    }

    if (!hasError && index === highestIndex + 1) {
      return {
        ...step,
        status: "pending",
      } as DebugStep;
    }

    return {
      ...step,
      status: "idle",
    } as DebugStep;
  });
};

type ProvidersResponse = {
  providers: PublicEmbeddingProvider[];
};

type CreateEmbeddingServiceVariables = {
  payload: InsertEmbeddingProvider;
  formattedStrings: {
    requestHeaders: string;
    requestConfig: string;
    responseConfig: string;
    qdrantConfig: string;
  };
};

type ToggleEmbeddingServiceVariables = {
  id: string;
  isActive: boolean;
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
  requestConfig: string;
  responseConfig: string;
  qdrantConfig: string;
};

const requestHeadersSchema = z.record(z.string());

const defaultRequestHeaders = {
  Accept: "application/json",
};

const defaultRequestConfig = {
  inputField: "input",
  modelField: "model",
  additionalBodyFields: {
    encoding_format: "float",
  },
};

const defaultResponseConfig = {
  vectorPath: "data[0].embedding",
  usageTokensPath: "usage.total_tokens",
  rawVectorType: "float32",
};

const defaultQdrantConfig = {
  collectionName: "{{ knowledge_base.slug }}",
  vectorFieldName: "{{ collection.vector_field | default: 'vector' }}",
  payloadFields: {
    source_id: "{{ document.id }}",
    text: "{{ chunk.text }}",
    metadata: "{{ chunk.metadata | json }}",
  },
  vectorSize: "{{ embedding.vector_size | default: 1024 }}",
  upsertMode: "{{ integration.upsert_mode | default: 'replace' }}",
};

const formatJson = (value: unknown) => JSON.stringify(value, null, 2);

const defaultFormValues: FormValues = {
  providerType: "gigachat",
  name: "GigaChat Embeddings",
  description: "",
  isActive: true,
  tokenUrl: "https://ngw.devices.sberbank.ru:9443/api/v2/oauth",
  embeddingsUrl: "https://gigachat.devices.sberbank.ru/api/v1/embeddings",
  authorizationKey: "",
  scope: "GIGACHAT_API_PERS",
  model: "embeddings",
  allowSelfSignedCertificate: true,
  requestHeaders: formatJson(defaultRequestHeaders),
  requestConfig: formatJson(defaultRequestConfig),
  responseConfig: formatJson(defaultResponseConfig),
  qdrantConfig: formatJson(defaultQdrantConfig),
};

export default function EmbeddingServicesPage() {
  const { toast } = useToast();

  const form = useForm<FormValues>({
    defaultValues: defaultFormValues,
  });

  const [debugSteps, setDebugSteps] = useState<DebugStep[]>(() => buildDebugSteps());

  const providersQuery = useQuery<ProvidersResponse>({
    queryKey: ["/api/embedding/services"],
  });

  const createServiceMutation = useMutation<
    { provider: PublicEmbeddingProvider },
    Error,
    CreateEmbeddingServiceVariables
  >({
    mutationFn: async ({ payload }: CreateEmbeddingServiceVariables) => {
      const response = await apiRequest("POST", "/api/embedding/services", payload);
      return (await response.json()) as { provider: PublicEmbeddingProvider };
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/embedding/services"] });
      toast({
        title: "Сервис сохранён",
        description: "Настройки подключения к эмбеддингам успешно добавлены.",
      });

      form.reset({
        ...form.getValues(),
        description: "",
        authorizationKey: "",
        requestHeaders: variables.formattedStrings.requestHeaders,
        requestConfig: variables.formattedStrings.requestConfig,
        responseConfig: variables.formattedStrings.responseConfig,
        qdrantConfig: variables.formattedStrings.qdrantConfig,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Не удалось сохранить сервис",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const toggleServiceMutation = useMutation<
    { provider: PublicEmbeddingProvider },
    Error,
    ToggleEmbeddingServiceVariables
  >({
    mutationFn: async ({ id, isActive }: ToggleEmbeddingServiceVariables) => {
      const response = await apiRequest("PUT", `/api/embedding/services/${id}`, { isActive });
      return (await response.json()) as { provider: PublicEmbeddingProvider };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/embedding/services"] });
      toast({ title: "Статус сервиса обновлён" });
    },
    onError: (error: Error) => {
      toast({
        title: "Не удалось изменить статус",
        description: error.message,
        variant: "destructive",
      });
    },
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
        true,
      );

      const requestConfig = parseJsonField(
        values.requestConfig,
        embeddingRequestConfigSchema,
        "requestConfig",
        "Опишите структуру тела запроса",
        true,
      );

      const responseConfig = parseJsonField(
        values.responseConfig,
        embeddingResponseConfigSchema,
        "responseConfig",
        "Укажите путь до вектора в ответе",
        true,
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
            requestConfig,
            responseConfig,
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
      return { message, steps };
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

  const providers = providersQuery.data?.providers ?? [];

  const totalActive = useMemo(
    () => providers.filter((provider) => provider.isActive).length,
    [providers],
  );

  const hasActiveDebugSteps = debugSteps.some((step) => step.status !== "idle");

  const parseJsonField = <T,>(
    value: string,
    schema: z.ZodType<T>,
    field: FieldPath<FormValues>,
    errorMessage: string,
    allowEmptyObject = false,
  ): T => {
    const trimmed = value.trim();

    let parsed: unknown = {};

    if (!trimmed) {
      if (!allowEmptyObject) {
        form.setError(field, {
          type: "manual",
          message: errorMessage,
        });
        throw new Error(errorMessage);
      }
    } else {
      try {
        parsed = JSON.parse(trimmed);
      } catch (error) {
        form.setError(field, {
          type: "manual",
          message: "Неверный формат JSON",
        });
        throw error instanceof Error ? error : new Error(String(error));
      }
    }

    try {
      return schema.parse(parsed);
    } catch (error) {
      if (error instanceof z.ZodError) {
        form.setError(field, {
          type: "manual",
          message: error.issues[0]?.message ?? errorMessage,
        });
      } else {
        form.setError(field, {
          type: "manual",
          message: errorMessage,
        });
      }
      throw error instanceof Error ? error : new Error(String(error));
    }
  };

  const handleCreate = form.handleSubmit((values) => {
    form.clearErrors();

    try {
      const requestHeaders = parseJsonField(
        values.requestHeaders,
        requestHeadersSchema,
        "requestHeaders",
        "Укажите заголовки запроса в формате JSON",
        true,
      ) as InsertEmbeddingProvider["requestHeaders"];

      const requestConfig = parseJsonField(
        values.requestConfig,
        embeddingRequestConfigSchema,
        "requestConfig",
        "Опишите структуру тела запроса",
        true,
      ) as InsertEmbeddingProvider["requestConfig"];

      const responseConfig = parseJsonField(
        values.responseConfig,
        embeddingResponseConfigSchema,
        "responseConfig",
        "Укажите путь до вектора в ответе",
        true,
      ) as InsertEmbeddingProvider["responseConfig"];

      const qdrantConfig = parseJsonField(
        values.qdrantConfig,
        qdrantIntegrationConfigSchema,
        "qdrantConfig",
        "Опишите схему записи в Qdrant",
      ) as InsertEmbeddingProvider["qdrantConfig"];

      const payload: InsertEmbeddingProvider = {
        providerType: values.providerType,
        name: values.name.trim(),
        description: values.description.trim() ? values.description.trim() : undefined,
        isActive: values.isActive,
        tokenUrl: values.tokenUrl.trim(),
        embeddingsUrl: values.embeddingsUrl.trim(),
        authorizationKey: values.authorizationKey.trim(),
        scope: values.scope.trim(),
        model: values.model.trim(),
        allowSelfSignedCertificate: values.allowSelfSignedCertificate,
        requestHeaders,
        requestConfig,
        responseConfig,
        qdrantConfig,
      };

      const formattedStrings = {
        requestHeaders: formatJson(requestHeaders),
        requestConfig: formatJson(requestConfig),
        responseConfig: formatJson(responseConfig),
        qdrantConfig: formatJson(qdrantConfig),
      };

      createServiceMutation.mutate({ payload, formattedStrings });
    } catch (_error) {
      toast({
        title: "Не удалось подготовить данные",
        description: "Исправьте ошибки в форме и попробуйте снова.",
        variant: "destructive",
      });
    }
  });

  return (
    <div className="space-y-6 p-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold">Эмбеддинги</h1>
        <p className="text-muted-foreground max-w-3xl">
          Настройте сервисы преобразования текста в вектора, чтобы использовать внешний API для наполнения коллекций
          Qdrant. Первый преднастроенный сценарий рассчитан на подключение GigaChat Embeddings от СберБанка.
        </p>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1.2fr)]">
        <Card>
          <CardHeader>
            <CardTitle>Новый сервис эмбеддингов</CardTitle>
            <CardDescription>
              Укажите параметры авторизации и форматы запросов/ответов, чтобы платформа могла автоматически получать
              эмбеддинги и складывать их в нужную коллекцию Qdrant.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Form {...form}>
              <form onSubmit={handleCreate} className="space-y-6">
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
                                  {type === "gigachat" ? "GigaChat" : "Другой сервис"}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </FormControl>
                        <FormDescription>От выбранного провайдера могут зависеть подсказки и дефолтные значения.</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="name"
                    rules={{ required: "Название обязательно" }}
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Название сервиса</FormLabel>
                        <FormControl>
                          <Input {...field} placeholder="Например, GigaChat Embeddings" required />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <FormField
                  control={form.control}
                  name="description"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Описание</FormLabel>
                      <FormControl>
                        <Textarea
                          {...field}
                          placeholder="Добавьте краткое описание или примечание для коллег"
                          rows={3}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="isActive"
                  render={({ field }) => (
                    <FormItem className="flex items-center justify-between rounded-lg border p-4">
                      <div className="space-y-1">
                        <FormLabel className="text-base">Активировать сразу</FormLabel>
                        <FormDescription>
                          Если выключить, сервис сохранится в черновиках и не будет использоваться пользователями.
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
                  name="allowSelfSignedCertificate"
                  render={({ field }) => (
                    <FormItem className="flex items-center justify-between rounded-lg border p-4">
                      <div className="space-y-1 pr-4">
                        <FormLabel className="text-base">Доверять самоподписанным сертификатам</FormLabel>
                        <FormDescription>
                          Отключает проверку TLS. Используйте только для доверенных провайдеров, например корпоративного API
                          GigaChat.
                        </FormDescription>
                      </div>
                      <FormControl>
                        <Switch checked={field.value} onCheckedChange={field.onChange} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="grid gap-4 md:grid-cols-2">
                  <FormField
                    control={form.control}
                    name="tokenUrl"
                    rules={{ required: "Укажите URL получения токена" }}
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Endpoint для Access Token</FormLabel>
                        <FormControl>
                          <Input {...field} placeholder="https://ngw.devices.sberbank.ru:9443/api/v2/oauth" required />
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
                    rules={{ required: "Укажите URL сервиса эмбеддингов" }}
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Endpoint эмбеддингов</FormLabel>
                        <FormControl>
                          <Input {...field} placeholder="https://gigachat.devices.sberbank.ru/api/v1/embeddings" required />
                        </FormControl>
                        <FormDescription>Именно сюда будет отправляться текст для расчёта векторов.</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <div className="grid gap-4">
                  <FormField
                    control={form.control}
                    name="authorizationKey"
                    rules={{ required: "Укажите Authorization key" }}
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Authorization key</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            type="password"
                            placeholder="Значение заголовка Authorization"
                            required
                            autoComplete="new-password"
                          />
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
                                        <div className={`font-medium ${statusColor}`}>{step.title}</div>
                                        {step.detail ? (
                                          <div className={`text-sm ${statusColor}`}>{step.detail}</div>
                                        ) : null}
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
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <FormField
                    control={form.control}
                    name="scope"
                    rules={{ required: "Укажите scope" }}
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
                    rules={{ required: "Укажите модель" }}
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
                        Например, провайдер GigaChat может запросить идентификатор
                        <code className="mx-1 rounded bg-muted px-1 py-0.5 text-xs">X-Client-Id</code>.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="requestConfig"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Структура тела запроса</FormLabel>
                      <FormControl>
                        <Textarea
                          {...field}
                          spellCheck={false}
                          rows={6}
                          placeholder='{"inputField":"input","modelField":"model"}'
                        />
                      </FormControl>
                      <FormDescription>
                        Укажите, в каком поле нужно передавать текст и как фиксируется выбранная модель. Можно добавить
                        дополнительные параметры (например, <code className="mx-1 rounded bg-muted px-1 py-0.5 text-xs">encoding_format</code>).
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="responseConfig"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Парсинг ответа</FormLabel>
                      <FormControl>
                        <Textarea
                          {...field}
                          spellCheck={false}
                          rows={5}
                          placeholder='{"vectorPath":"data[0].embedding"}'
                        />
                      </FormControl>
                      <FormDescription>
                        Опишите путь до массива с эмбеддингами и, при необходимости, пути до usage-метрик.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="qdrantConfig"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Запись в Qdrant</FormLabel>
                      <FormControl>
                        <Textarea
                          {...field}
                          spellCheck={false}
                          rows={6}
                          placeholder='{"collectionName":"{{ knowledge_base.slug }}","vectorFieldName":"{{ collection.vector_field }}"}'
                        />
                      </FormControl>
                      <FormDescription>
                        Опишите шаблон Liquid для коллекции, векторного поля и payload. Доступны объекты
                        <code className="mx-1 rounded bg-muted px-1 py-0.5 text-xs">knowledge_base</code>,
                        <code className="mx-1 rounded bg-muted px-1 py-0.5 text-xs">document</code>,
                        <code className="mx-1 rounded bg-muted px-1 py-0.5 text-xs">chunk</code>,
                        <code className="mx-1 rounded bg-muted px-1 py-0.5 text-xs">embedding</code> и
                        <code className="mx-1 rounded bg-muted px-1 py-0.5 text-xs">integration</code>.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="flex justify-end">
                  <Button type="submit" disabled={createServiceMutation.isPending}>
                    {createServiceMutation.isPending ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Сохраняем...
                      </>
                    ) : (
                      "Сохранить сервис"
                    )}
                  </Button>
                </div>
              </form>
            </Form>
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" />
                Схема интеграции с GigaChat
              </CardTitle>
              <CardDescription>
                Последовательность шагов, которые будет выполнять платформа при обращении к сервису эмбеддингов.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <ol className="list-decimal space-y-2 pl-5">
                <li>
                  Сформировать уникальный идентификатор <code className="mx-1 rounded bg-muted px-1 py-0.5 text-xs">RqUID</code>
                  и отправить запрос на получение токена доступа по адресу
                  <code className="mx-1 rounded bg-muted px-1 py-0.5 text-xs">{defaultFormValues.tokenUrl}</code>.
                </li>
                <li>
                  Передать заголовок <code className="mx-1 rounded bg-muted px-1 py-0.5 text-xs">Authorization</code> со значением, указанным в поле
                  Authorization key (например, <code className="mx-1 rounded bg-muted px-1 py-0.5 text-xs">Basic &lt;token&gt;</code>), и тело запроса
                  <code className="mx-1 rounded bg-muted px-1 py-0.5 text-xs">scope={defaultFormValues.scope}</code>.
                </li>
                <li>
                  Полученный <code className="mx-1 rounded bg-muted px-1 py-0.5 text-xs">access_token</code> использовать для обращения к
                  <code className="mx-1 rounded bg-muted px-1 py-0.5 text-xs">{defaultFormValues.embeddingsUrl}</code> с заголовками
                  <code className="mx-1 rounded bg-muted px-1 py-0.5 text-xs">Authorization: Bearer &lt;token&gt;</code> и
                  <code className="mx-1 rounded bg-muted px-1 py-0.5 text-xs">X-Client-Id</code>.
                </li>
                <li>
                  Передать текстовую нагрузку в поле, указанное в конфигурации (по умолчанию
                  <code className="mx-1 rounded bg-muted px-1 py-0.5 text-xs">input</code>) и зафиксировать модель через поле
                  <code className="mx-1 rounded bg-muted px-1 py-0.5 text-xs">model</code>.
                </li>
                <li>
                  Распарсить ответ и извлечь вектор по пути
                  <code className="mx-1 rounded bg-muted px-1 py-0.5 text-xs">data[0].embedding</code>. Полученный массив чисел будет
                  использован при записи в коллекцию Qdrant, указанную в настройках.
                </li>
              </ol>

              <div className="rounded-md bg-muted p-3 text-xs text-muted-foreground">
                Пример тела запроса:
                <pre className="mt-2 overflow-auto rounded bg-background p-3">
{`{
  "model": "embeddings",
  "input": "Здесь размещаем текст чанка"
}`}
                </pre>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-primary" />
                Требования к сохранению данных
              </CardTitle>
            </CardHeader>
              <CardContent className="space-y-3 text-sm text-muted-foreground">
                <p>
                  Authorization ключи хранятся в зашифрованном виде на стороне сервера и не отображаются повторно после
                  сохранения. Проверьте корректность данных до отправки формы.
                </p>
              <p>
                Формат JSON в полях конфигурации должен быть валидным. Используйте двойные кавычки и убедитесь, что в
                Qdrant существует указанная коллекция или она будет создана заранее.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <CardTitle>Подключённые сервисы</CardTitle>
            <CardDescription>
              {providers.length > 0
                ? `Всего ${providers.length} сервис(ов), активных — ${totalActive}.`
                : "После сохранения первого сервиса он появится в списке ниже."}
            </CardDescription>
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={() => providersQuery.refetch()}
            disabled={providersQuery.isFetching}
          >
            {providersQuery.isFetching ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Обновляем...
              </>
            ) : (
              <>
                <RefreshCw className="mr-2 h-4 w-4" /> Обновить список
              </>
            )}
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          {providersQuery.isError && (
            <Alert variant="destructive">
              <AlertTitle>Не удалось загрузить сервисы</AlertTitle>
              <AlertDescription>
                Попробуйте обновить страницу позже. Если ошибка повторяется, проверьте настройки подключения к базе.
              </AlertDescription>
            </Alert>
          )}

          {providersQuery.isLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Загружаем список сервисов...
            </div>
          ) : providers.length === 0 ? (
            <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
              Пока нет сохранённых сервисов. Добавьте GigaChat или другой провайдер с помощью формы выше.
            </div>
          ) : (
            providers.map((provider) => {
              const qdrantInfo = provider.qdrantConfig;
              const isToggling =
                toggleServiceMutation.isPending && toggleServiceMutation.variables?.id === provider.id;

              return (
                <div key={provider.id} className="space-y-3 rounded-lg border p-4">
                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-lg font-semibold">{provider.name}</h3>
                        <Badge variant={provider.isActive ? "default" : "secondary"}>
                          {provider.isActive ? "Активен" : "Выключен"}
                        </Badge>
                        <Badge variant="outline">{provider.providerType}</Badge>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        Модель: {provider.model} · Scope: {provider.scope}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-sm text-muted-foreground">Включить</span>
                      <Switch
                        checked={provider.isActive}
                        onCheckedChange={(checked) =>
                          toggleServiceMutation.mutate({ id: provider.id, isActive: checked })
                        }
                        disabled={isToggling}
                      />
                    </div>
                  </div>

                  <div className="grid gap-3 text-sm text-muted-foreground md:grid-cols-2">
                    <div>
                      <p className="font-medium text-foreground">OAuth endpoint</p>
                      <p className="break-all">{provider.tokenUrl}</p>
                    </div>
                    <div>
                      <p className="font-medium text-foreground">Endpoint эмбеддингов</p>
                      <p className="break-all">{provider.embeddingsUrl}</p>
                    </div>
                    <div>
                      <p className="font-medium text-foreground">Коллекция Qdrant</p>
                      <p className="break-all">
                        {qdrantInfo.collectionName} · поле: {qdrantInfo.vectorFieldName ?? "vector"}
                        {qdrantInfo.vectorSize ? ` · размер: ${qdrantInfo.vectorSize}` : ""}
                      </p>
                    </div>
                    <div>
                      <p className="font-medium text-foreground">Статус ключа</p>
                      <p>{provider.hasAuthorizationKey ? "Ключ сохранён" : "Ключ не задан"}</p>
                    </div>
                    <div>
                      <p className="font-medium text-foreground">Проверка TLS</p>
                      <p>
                        {provider.allowSelfSignedCertificate
                          ? "Самоподписанные сертификаты разрешены"
                          : "Требуется доверенный сертификат"}
                      </p>
                    </div>
                  </div>

                  {provider.description && (
                    <p className="text-sm text-muted-foreground">{provider.description}</p>
                  )}

                  <p className="text-xs text-muted-foreground">
                    Обновлён: {new Date(provider.updatedAt).toLocaleString("ru-RU")}
                  </p>
                </div>
              );
            })
          )}
        </CardContent>
      </Card>
    </div>
  );
}

