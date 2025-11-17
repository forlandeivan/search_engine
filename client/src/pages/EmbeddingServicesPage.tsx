import { MouseEvent, useEffect, useMemo, useState } from "react";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import {
  embeddingProviderTypes,
  type EmbeddingProviderType,
  type InsertEmbeddingProvider,
  type PublicEmbeddingProvider,
  type UpdateEmbeddingProvider,
} from "@shared/schema";

const requestHeadersSchema = z.record(z.string());

const formatJson = (value: unknown) => JSON.stringify(value, null, 2);

const defaultRequestHeaders: Record<string, string> = {};

const formatBoolean = (value: boolean) => (value ? "да" : "нет");
const numberFormatter = new Intl.NumberFormat("ru-RU");
const formatNullableNumber = (value?: number | null) =>
  typeof value === "number" && Number.isFinite(value) ? numberFormatter.format(value) : "—";

const buildCopyDescription = (label: string, value: string) => `${label} «${value}» скопирован в буфер обмена.`;

const GIGACHAT_BATCH_LIMIT = 16;
const GIGACHAT_RATE_LIMIT_PER_SECOND = 5;
const GIGACHAT_RATE_LIMIT_PER_MINUTE = 300;
const GIGACHAT_TOKEN_TTL_MINUTES = 30;

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

type CreateEmbeddingProviderVariables = {
  payload: InsertEmbeddingProvider;
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
  maxTokensPerVectorization: string;
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
  maxTokensPerVectorization: "",
  allowSelfSignedCertificate: false,
  requestHeaders: formatJson(defaultRequestHeaders),
};

const embeddingTemplates: Record<EmbeddingProviderType, Partial<FormValues>> = {
  gigachat: {
    providerType: "gigachat",
    name: "GigaChat Embeddings",
    description: "Шаблон dev-стенда с готовыми URL и scope",
    isActive: true,
    tokenUrl: "https://ngw.devices.sberbank.ru:9443/api/v2/oauth",
    embeddingsUrl: "https://gigachat.devices.sberbank.ru/api/v1/embeddings",
    scope: "GIGACHAT_API_PERS",
    model: "embeddings",
  },
  custom: {
    providerType: "custom",
    isActive: true,
  },
};

const buildTemplateValues = (type: EmbeddingProviderType = "gigachat"): FormValues => {
  const template = embeddingTemplates[type] ?? {};

  return {
    ...emptyFormValues,
    ...template,
    providerType: template.providerType ?? type,
    requestHeaders: template.requestHeaders ?? formatJson(defaultRequestHeaders),
  } satisfies FormValues;
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
  maxTokensPerVectorization: provider.maxTokensPerVectorization
    ? String(provider.maxTokensPerVectorization)
    : "",
  allowSelfSignedCertificate: provider.allowSelfSignedCertificate ?? false,
  requestHeaders: formatJson(provider.requestHeaders ?? defaultRequestHeaders),
});

export default function EmbeddingServicesPage() {
  const { toast } = useToast();
  const form = useForm<FormValues>({ defaultValues: emptyFormValues });
  const [isAuthorizationVisible, setIsAuthorizationVisible] = useState(false);
  const [selectedProviderId, setSelectedProviderId] = useState<string | "new" | null>(null);
  const [debugSteps, setDebugSteps] = useState<DebugStep[]>(() => buildDebugSteps());
  const [activeTab, setActiveTab] = useState<"settings" | "docs">("settings");
  const watchedProviderType = form.watch("providerType");
  const isGigachatProvider = watchedProviderType === "gigachat";
  const isCreating = selectedProviderId === "new";

  const providersQuery = useQuery<ProvidersResponse>({
    queryKey: ["/api/embedding/services"],
  });

  const providers = useMemo(() => providersQuery.data?.providers ?? [], [providersQuery.data]);
  const providersLoaded = providersQuery.isSuccess;

  const selectedProvider = useMemo(
    () =>
      selectedProviderId && selectedProviderId !== "new"
        ? providers.find((provider) => provider.id === selectedProviderId) ?? null
        : null,
    [providers, selectedProviderId],
  );
  const isSelectedGigachatProvider = selectedProvider?.providerType === "gigachat";

  useEffect(() => {
    if (!providersLoaded) {
      return;
    }

    if (providers.length === 0) {
      if (selectedProviderId !== "new") {
        setSelectedProviderId("new");
        form.reset(buildTemplateValues());
      }
      return;
    }

    if (selectedProviderId === "new") {
      return;
    }

    if (selectedProviderId && providers.some((provider) => provider.id === selectedProviderId)) {
      return;
    }

    setSelectedProviderId(providers[0].id);
  }, [providersLoaded, providers, selectedProviderId, form]);

  useEffect(() => {
    if (selectedProvider) {
      form.reset(mapProviderToFormValues(selectedProvider));
      setIsAuthorizationVisible(false);
      setDebugSteps(buildDebugSteps());
      setActiveTab("settings");
      return;
    }

    if (isCreating) {
      setIsAuthorizationVisible(false);
      setDebugSteps(buildDebugSteps());
      setActiveTab("settings");
      return;
    }

    form.reset(emptyFormValues);
    setIsAuthorizationVisible(false);
    setDebugSteps(buildDebugSteps());
    setActiveTab("settings");
  }, [selectedProvider, form, isCreating]);

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

  const createProviderMutation = useMutation<
    { provider: PublicEmbeddingProvider },
    Error,
    CreateEmbeddingProviderVariables
  >({
    mutationFn: async ({ payload }) => {
      const response = await apiRequest("POST", "/api/embedding/services", payload);
      const body = (await response.json()) as { provider?: PublicEmbeddingProvider; message?: string };

      if (!response.ok) {
        throw new Error(body.message ?? "Не удалось создать сервис эмбеддингов");
      }

      if (!body.provider) {
        throw new Error("Некорректный ответ сервера");
      }

      return { provider: body.provider };
    },
    onSuccess: ({ provider }, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/embedding/services"] });
      queryClient.setQueryData<ProvidersResponse>(["/api/embedding/services"], (previous) => {
        if (!previous) {
          return { providers: [provider] } satisfies ProvidersResponse;
        }

        const exists = previous.providers.some((item) => item.id === provider.id);
        if (exists) {
          return previous;
        }

        return { providers: [...previous.providers, provider] } satisfies ProvidersResponse;
      });

      toast({
        title: "Сервис создан",
        description: "Шаблон GigaChat заполнен автоматически, проверьте ключ.",
      });

      const updatedValues = {
        ...mapProviderToFormValues(provider),
        requestHeaders: variables.formattedRequestHeaders,
      } satisfies FormValues;

      setSelectedProviderId(provider.id);
      form.reset(updatedValues);
      setIsAuthorizationVisible(false);
    },
    onError: (error) => {
      toast({
        title: "Не удалось создать сервис",
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

  function buildPayloadFromValues(
    values: FormValues,
    mode: "create",
  ): { payload: InsertEmbeddingProvider; formattedRequestHeaders: string };
  function buildPayloadFromValues(
    values: FormValues,
    mode: "update",
  ): { payload: UpdateEmbeddingProvider; formattedRequestHeaders: string };
  function buildPayloadFromValues(
    values: FormValues,
    mode: "create" | "update",
  ): { payload: InsertEmbeddingProvider | UpdateEmbeddingProvider; formattedRequestHeaders: string } {
    const requestHeaders = parseJsonField(
      values.requestHeaders,
      requestHeadersSchema,
      "requestHeaders",
      "Укажите заголовки запроса в формате JSON",
    );

    const trimmedAuthorizationKey = values.authorizationKey.trim();
    const trimmedMaxTokens = values.maxTokensPerVectorization.trim();

    if (!trimmedMaxTokens) {
      const message = "Укажите максимальное количество токенов";
      form.setError("maxTokensPerVectorization", { type: "manual", message });
      throw new Error(message);
    }

    const parsedMaxTokens = Number.parseInt(trimmedMaxTokens, 10);

    if (!Number.isFinite(parsedMaxTokens) || parsedMaxTokens <= 0) {
      const message = "Введите положительное целое число";
      form.setError("maxTokensPerVectorization", { type: "manual", message });
      throw new Error(message);
    }

    const payloadBase = {
      providerType: values.providerType,
      name: values.name.trim(),
      description: values.description.trim() ? values.description.trim() : undefined,
      isActive: values.isActive,
      tokenUrl: values.tokenUrl.trim(),
      embeddingsUrl: values.embeddingsUrl.trim(),
      scope: values.scope.trim(),
      model: values.model.trim(),
      maxTokensPerVectorization: parsedMaxTokens,
      allowSelfSignedCertificate: values.allowSelfSignedCertificate,
      requestHeaders,
    } satisfies InsertEmbeddingProvider & UpdateEmbeddingProvider;

    const formattedRequestHeaders = formatJson(requestHeaders);

    if (mode === "create") {
      if (!trimmedAuthorizationKey) {
        const message = "Укажите Authorization key";
        form.setError("authorizationKey", { type: "manual", message });
        throw new Error(message);
      }

      const payload: InsertEmbeddingProvider = {
        ...payloadBase,
        authorizationKey: trimmedAuthorizationKey,
      } satisfies InsertEmbeddingProvider;

      return { payload, formattedRequestHeaders };
    }

    const payload: UpdateEmbeddingProvider = {
      ...payloadBase,
    } satisfies UpdateEmbeddingProvider;

    if (trimmedAuthorizationKey.length > 0) {
      payload.authorizationKey = trimmedAuthorizationKey;
    }

    return { payload, formattedRequestHeaders };
  }

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
      const { payload, formattedRequestHeaders } = buildPayloadFromValues(values, "update");
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

  const handleCreate = form.handleSubmit((values) => {
    form.clearErrors();

    try {
      const { payload, formattedRequestHeaders } = buildPayloadFromValues(values, "create");
      createProviderMutation.mutate({ payload, formattedRequestHeaders });
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

  const handleStartCreate = () => {
    const currentType = form.getValues("providerType");
    const fallbackType = embeddingProviderTypes.includes(currentType as EmbeddingProviderType)
      ? (currentType as EmbeddingProviderType)
      : "gigachat";
    const templateValues = buildTemplateValues(fallbackType);

    setSelectedProviderId("new");
    form.reset(templateValues);
    setIsAuthorizationVisible(false);
    setDebugSteps(buildDebugSteps());
    setActiveTab("settings");
  };

  const handleCopyValue = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast({ title: "Скопировано", description: buildCopyDescription(label, value) });
    } catch (error) {
      console.error("Не удалось скопировать значение", error);
      toast({
        title: "Не удалось скопировать",
        description: "Попробуйте вручную выделить и скопировать значение.",
        variant: "destructive",
      });
    }
  };

  const isSubmitPending = isCreating
    ? createProviderMutation.isPending
    : updateProviderMutation.isPending;

  const settingsFormContent = (
    <form onSubmit={isCreating ? handleCreate : handleUpdate} className="space-y-6">
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
              <FormDescription>
                Определяет преднастроенные параметры интеграции. Для GigaChat мы подставим рабочие URL, scope и модель.
              </FormDescription>
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
                <Input {...field} placeholder="https://ngw.devices.sberbank.ru:9443/api/v2/oauth" required />
              </FormControl>
              <FormDescription>
                {isGigachatProvider
                  ? "Сервис GigaChat требует предварительный запрос для получения токена доступа."
                  : "Введите endpoint OAuth-сервера, который возвращает access token."}
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
                <Input {...field} placeholder="https://gigachat.devices.sberbank.ru/api/v1/embeddings" required />
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
                  aria-label={isAuthorizationVisible ? "Скрыть Authorization key" : "Показать Authorization key"}
                >
                  {isAuthorizationVisible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
            </FormControl>
            <FormDescription>
              {isGigachatProvider ? (
                <>
                  Скопируйте готовый ключ из личного кабинета GigaChat (формат <code>Basic &lt;token&gt;</code>).
                </>
              ) : (
                "Вставьте значение заголовка Authorization, которое требуется для получения токена."
              )}
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
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Ход проверки</p>
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

        <FormField
          control={form.control}
          name="maxTokensPerVectorization"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Максимальное количество токенов</FormLabel>
              <FormControl>
                <Input
                  {...field}
                  inputMode="numeric"
                  pattern="[0-9]*"
                  placeholder="Например, 4096"
                  required
                />
              </FormControl>
              <FormDescription>
                Используется для проверки чанков до отправки в сервис. Значение указывается в токенах на один элемент массива
                <code>input</code>.
              </FormDescription>
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
              <Textarea {...field} spellCheck={false} rows={4} placeholder='{"Accept": "application/json"}' />
            </FormControl>
            <FormDescription>
              JSON-объект со строковыми значениями. Добавьте заголовки только если они требуются вашим API.
            </FormDescription>
            <FormMessage />
          </FormItem>
        )}
      />

      <div className="flex justify-end">
        <Button type="submit" disabled={isSubmitPending}>
          {isSubmitPending ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> {isCreating ? "Создаём..." : "Сохраняем..."}
            </>
          ) : isCreating ? (
            "Создать сервис"
          ) : (
            "Сохранить изменения"
          )}
        </Button>
      </div>
    </form>
  );

  return (
    <div className="space-y-6 p-6">
      <div className="space-y-1">
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          <Sparkles className="h-5 w-5 text-primary" /> Управление эмбеддингами
        </h1>
        <p className="text-muted-foreground max-w-3xl">
          Выберите подключённый сервис и настройте ключи, модель и дополнительные заголовки. Можно добавить новый шаблон —
          для GigaChat мы автоматически подставим рабочие URL, scope и модель dev-стенда.
        </p>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1.9fr)] 2xl:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <Card className="h-fit">
          <CardHeader className="space-y-3 pb-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle>Сервисы эмбеддингов</CardTitle>
                <CardDescription>Выберите сервис или создайте новый шаблон GigaChat.</CardDescription>
              </div>
              <Button size="sm" onClick={handleStartCreate} disabled={isSubmitPending} className="gap-2">
                <Sparkles className="h-4 w-4" /> Добавить сервис
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Шаблон GigaChat заполнит OAuth endpoint, embeddings URL, scope и модель dev-стенда.
            </p>
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
              <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                <p className="mb-3">Сервисы ещё не настроены. Создайте GigaChat по готовому шаблону.</p>
                <Button size="sm" onClick={handleStartCreate} disabled={isSubmitPending} className="mb-2">
                  Добавить сервис
                </Button>
                <p className="text-xs">Мы автоматически подставим URL, scope и модель dev-стенда.</p>
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
                          <span>Макс. токенов: {formatNullableNumber(provider.maxTokensPerVectorization)}</span>
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
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        <Badge
                          variant="outline"
                          onClick={(event: MouseEvent<HTMLDivElement>) => {
                            event.stopPropagation();
                            void handleCopyValue(provider.id, "embeddingProviderId");
                          }}
                          className="cursor-pointer gap-1 text-[10px] uppercase tracking-wide"
                        >
                          <Copy className="h-3.5 w-3.5" /> embeddingProviderId: {provider.id}
                        </Badge>
                        {provider.model ? (
                          <Badge
                            variant="outline"
                            onClick={(event: MouseEvent<HTMLDivElement>) => {
                              event.stopPropagation();
                              void handleCopyValue(provider.model, "Модель эмбеддингов");
                            }}
                            className="cursor-pointer gap-1 text-[10px] uppercase tracking-wide"
                          >
                            <Copy className="h-3.5 w-3.5" /> model: {provider.model}
                          </Badge>
                        ) : null}
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
            <CardTitle>
              {isCreating
                ? "Новый сервис эмбеддингов"
                : selectedProvider
                  ? selectedProvider.name
                  : "Настройки сервиса"}
            </CardTitle>
            <CardDescription>
              {isCreating
                ? "Автозаполнили шаблон GigaChat: проверьте ключ и сохраните."
                : selectedProvider
                  ? "Обновите ключи доступа, модель эмбеддингов и дополнительные параметры."
                  : "Выберите сервис слева или нажмите «Добавить сервис»."}
            </CardDescription>
            {selectedProvider ? (
              <div className="mt-3 flex flex-wrap gap-1.5">
                <Badge
                  variant="outline"
                  onClick={() => void handleCopyValue(selectedProvider.id, "embeddingProviderId")}
                  className="cursor-pointer gap-1 text-[10px] uppercase tracking-wide"
                >
                  <Copy className="h-3.5 w-3.5" /> embeddingProviderId: {selectedProvider.id}
                </Badge>
                {selectedProvider.model ? (
                  <Badge
                    variant="outline"
                    onClick={() => void handleCopyValue(selectedProvider.model, "Модель эмбеддингов")}
                    className="cursor-pointer gap-1 text-[10px] uppercase tracking-wide"
                  >
                    <Copy className="h-3.5 w-3.5" /> model: {selectedProvider.model}
                  </Badge>
                ) : null}
                {typeof selectedProvider.maxTokensPerVectorization === "number" ? (
                  <Badge variant="outline" className="gap-1 text-[10px] uppercase tracking-wide">
                    max tokens: {formatNullableNumber(selectedProvider.maxTokensPerVectorization)}
                  </Badge>
                ) : null}
              </div>
            ) : null}
          </CardHeader>
          <CardContent>
            <Form {...form}>
              {isCreating ? (
                settingsFormContent
              ) : !selectedProvider ? (
                <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
                  Выберите сервис слева или создайте новый шаблон GigaChat.
                </div>
              ) : isSelectedGigachatProvider ? (
                <Tabs
                  value={activeTab}
                  onValueChange={(value) => setActiveTab(value as "settings" | "docs")}
                  className="space-y-6"
                >
                  <TabsList className="grid w-full grid-cols-2">
                    <TabsTrigger value="settings">Настройки</TabsTrigger>
                    <TabsTrigger value="docs">Документация</TabsTrigger>
                  </TabsList>
                  <TabsContent value="settings">{settingsFormContent}</TabsContent>
                  <TabsContent value="docs">
                    <GigachatEmbeddingDocumentation provider={selectedProvider} />
                  </TabsContent>
                </Tabs>
              ) : (
                settingsFormContent
              )}
            </Form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

type GigachatEmbeddingDocumentationProps = {
  provider: PublicEmbeddingProvider;
};

function GigachatEmbeddingDocumentation({ provider }: GigachatEmbeddingDocumentationProps) {
  const maxTokens = provider.maxTokensPerVectorization;
  const formattedMaxTokens = formatNullableNumber(maxTokens);
  const batchLimitLabel = numberFormatter.format(GIGACHAT_BATCH_LIMIT);
  const rateLimitPerSecond = numberFormatter.format(GIGACHAT_RATE_LIMIT_PER_SECOND);
  const rateLimitPerMinute = numberFormatter.format(GIGACHAT_RATE_LIMIT_PER_MINUTE);
  const tokenTtlLabel = numberFormatter.format(GIGACHAT_TOKEN_TTL_MINUTES);

  return (
    <div className="space-y-6">
      <section className="space-y-3 rounded-lg border bg-muted/30 p-6">
        <h3 className="text-lg font-semibold">Пайплайн интеграции</h3>
        <p className="text-sm text-muted-foreground">
          Сервис GigaChat Embeddings требует предварительной выдачи access token. После получения токена выполняется отдельный
          запрос на расчёт векторов. Ниже перечислены шаги, которые выполняет платформа при каждом обращении.
        </p>
        <ol className="list-decimal space-y-2 pl-4 text-sm text-muted-foreground">
          <li>
            <span className="font-medium text-foreground">POST {" "}</span>
            <code className="rounded bg-muted px-1 py-0.5 text-xs">{provider.tokenUrl}</code>
            <span className="block">
              Отправляем OAuth-запрос с заголовком <code>Authorization: Basic &lt;key&gt;</code> и телом
              <code>grant_type=client_credentials&amp;scope={provider.scope}</code>. Ответ содержит <code>access_token</code> и время
              жизни токена.
            </span>
          </li>
          <li>
            <span className="font-medium text-foreground">Проверка токена</span>
            <span className="block">
              Сохраняем TTL (≈ {tokenTtlLabel} минут) и повторно используем токен, пока он валиден. При ошибке авторизации
              инициируем повторный запрос токена.
            </span>
          </li>
          <li>
            <span className="font-medium text-foreground">POST {" "}</span>
            <code className="rounded bg-muted px-1 py-0.5 text-xs">{provider.embeddingsUrl}</code>
            <span className="block">
              Формируем JSON:
              <code className="mt-1 block break-all">
                {`{ "model": "${provider.model}", "input": ["chunk"], "encoding_format": "float" }`}
              </code>
              В заголовках передаём <code>Authorization: Bearer &lt;access_token&gt;</code>{" "}
              и <code>Content-Type: application/json</code>.
            </span>
          </li>
          <li>
            <span className="font-medium text-foreground">Анализ ответа</span>
            <span className="block">
              Если сервис вернул массив <code>data</code>, извлекаем <code>embedding</code>, <code>usage.total_tokens</code> и, при
              наличии, <code>id</code> вектора. Ошибки сервиса пробрасываются в админку вместе с телом ответа.
            </span>
          </li>
        </ol>
      </section>

      <section className="space-y-4 rounded-lg border bg-background p-6">
        <h3 className="text-lg font-semibold">HTTP параметры и примеры</h3>
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-2 rounded-lg border bg-muted/20 p-4 text-sm text-muted-foreground">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground/80">Запрос за токеном</p>
            <pre className="overflow-x-auto rounded bg-background p-3 text-xs text-foreground">
              {`POST ${provider.tokenUrl}
Authorization: Basic <key>
Content-Type: application/x-www-form-urlencoded

grant_type=client_credentials&scope=${provider.scope}`}
            </pre>
            <p>Ответ хранится {tokenTtlLabel} минут. При истечении срока необходимо запросить новый токен.</p>
          </div>

          <div className="space-y-2 rounded-lg border bg-muted/20 p-4 text-sm text-muted-foreground">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground/80">Запрос эмбеддингов</p>
            <pre className="overflow-x-auto rounded bg-background p-3 text-xs text-foreground">
              {`POST ${provider.embeddingsUrl}
Authorization: Bearer <access_token>
Content-Type: application/json

{
  "model": "${provider.model}",
  "input": ["текст чанка"],
  "encoding_format": "float"
}`}
            </pre>
            <p>
              Поле <code>input</code> принимает массив строк: один запрос может содержать сразу несколько чанков (батч).
            </p>
          </div>
        </div>
      </section>

      <section className="space-y-3 rounded-lg border bg-muted/30 p-6">
        <h3 className="text-lg font-semibold">Ограничения сервиса</h3>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <div className="space-y-1 rounded-lg border bg-background/80 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground/80">Частота запросов</p>
            <p className="text-sm font-medium text-foreground">до {rateLimitPerSecond} RPS ({rateLimitPerMinute} в минуту)</p>
            <p className="text-xs text-muted-foreground">
              Настройте throttling при масcовой векторизации, чтобы не получить 429 от провайдера.
            </p>
          </div>

          <div className="space-y-1 rounded-lg border bg-background/80 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground/80">Размер батча</p>
            <p className="text-sm font-medium text-foreground">до {batchLimitLabel} элементов</p>
            <p className="text-xs text-muted-foreground">
              Ограничение действует на длину массива <code>input</code>. При большем количестве чанков разбивайте запросы.
            </p>
          </div>

          <div className="space-y-1 rounded-lg border bg-background/80 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground/80">Максимум токенов</p>
            <p className="text-sm font-medium text-foreground">
              {typeof maxTokens === "number" ? `${formattedMaxTokens} токенов` : "Укажите значение во вкладке «Настройки»"}
            </p>
            <p className="text-xs text-muted-foreground">
              Лимит применяется к одному элементу массива <code>input</code>. Общий размер батча равен сумме лимитов по каждому
              элементу.
            </p>
          </div>

          <div className="space-y-1 rounded-lg border bg-background/80 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground/80">Время жизни токена</p>
            <p className="text-sm font-medium text-foreground">≈ {tokenTtlLabel} минут</p>
            <p className="text-xs text-muted-foreground">
              Кэшируйте токен и обновляйте его заранее, чтобы не прерывать пакетную обработку документов.
            </p>
          </div>
        </div>
      </section>

      <section className="space-y-2 rounded-lg border bg-background p-6 text-sm text-muted-foreground">
        <h3 className="text-lg font-semibold text-foreground">Практические советы</h3>
        <ul className="list-disc space-y-1 pl-4">
          <li>
            Сверяйте размер чанков с полем «Максимальное количество токенов» перед векторизацией. При превышении лучше сразу
            пересобрать чанки, чем ждать ошибку 400 от сервиса.
          </li>
          <li>
            Держите очередь запросов в соответствии с лимитами ({rateLimitPerSecond} RPS / {rateLimitPerMinute} RPM), особенно при
            массовой индексации.
          </li>
          <li>
            Используйте батчи (до {batchLimitLabel} элементов), чтобы экономить на сетевых вызовах, но следите за суммарным
            размером данных и лимитами токенов.
          </li>
        </ul>
      </section>
    </div>
  );
}
