import { MouseEvent, useEffect, useMemo, useState } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { z } from "zod";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Sparkles, Loader2, Trash2, Eye, EyeOff, Copy } from "lucide-react";

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
import { Separator } from "@/components/ui/separator";

import {
  llmProviderTypes,
  DEFAULT_LLM_REQUEST_CONFIG,
  DEFAULT_LLM_RESPONSE_CONFIG,
  type PublicLlmProvider,
  type UpdateLlmProvider,
  type LlmProviderInsert,
} from "@shared/schema";

const requestHeadersSchema = z.record(z.string());

const formatJson = (value: unknown) => JSON.stringify(value, null, 2);

const formatFloat = (value: number | null | undefined) => {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "—";
  }

  return value.toLocaleString("ru-RU", { maximumFractionDigits: 3 });
};

const defaultRequestHeaders: Record<string, string> = {};

const buildCopyDescription = (label: string, value: string) => `${label} «${value}» скопирован в буфер обмена.`;

type FormValues = {
  providerType: (typeof llmProviderTypes)[number];
  name: string;
  description: string;
  isActive: boolean;
  tokenUrl: string;
  completionUrl: string;
  authorizationKey: string;
  scope: string;
  model: string;
  availableModels: { label: string; value: string }[];
  allowSelfSignedCertificate: boolean;
  requestHeaders: string;
  systemPrompt: string;
  temperature: string;
  maxTokens: string;
  topP: string;
  presencePenalty: string;
  frequencyPenalty: string;
};

const emptyFormValues: FormValues = {
  providerType: "gigachat",
  name: "",
  description: "",
  isActive: false,
  tokenUrl: "",
  completionUrl: "",
  authorizationKey: "",
  scope: "",
  model: "",
  availableModels: [],
  allowSelfSignedCertificate: false,
  requestHeaders: formatJson(defaultRequestHeaders),
  systemPrompt: "",
  temperature: "",
  maxTokens: "",
  topP: "",
  presencePenalty: "",
  frequencyPenalty: "",
};

const gigachatModelOptions: FormValues["availableModels"] = [
  { label: "GigaChat Pro", value: "GigaChat-Pro" },
  { label: "GigaChat", value: "GigaChat" },
  { label: "GigaChat Lite", value: "GigaChat-Lite" },
];

type LlmTemplateFactory = () => Partial<FormValues>;

const llmTemplates: Partial<Record<FormValues["providerType"], LlmTemplateFactory>> = {
  gigachat: () => ({
    providerType: "gigachat",
    name: "GigaChat",
    description: "Продовый доступ GigaChat от Сбера",
    isActive: true,
    tokenUrl: "https://ngw.devices.sberbank.ru:9443/api/v2/oauth",
    completionUrl: "https://gigachat.devices.sberbank.ru/api/v1/chat/completions",
    scope: "GIGACHAT_API_PERS",
    model: gigachatModelOptions[0]?.value ?? "GigaChat",
    availableModels: gigachatModelOptions.map((model) => ({ ...model })),
    requestHeaders: formatJson(defaultRequestHeaders),
    systemPrompt: DEFAULT_LLM_REQUEST_CONFIG.systemPrompt ?? "",
    temperature: String(DEFAULT_LLM_REQUEST_CONFIG.temperature ?? 0.2),
    maxTokens: DEFAULT_LLM_REQUEST_CONFIG.maxTokens
      ? String(DEFAULT_LLM_REQUEST_CONFIG.maxTokens)
      : "1024",
    allowSelfSignedCertificate: false,
  }),
};

type ProvidersResponse = { providers: PublicLlmProvider[] };

type UpdateLlmProviderVariables = {
  id: string;
  payload: UpdateLlmProvider;
  formattedRequestHeaders: string;
};

type CreateLlmProviderVariables = {
  payload: LlmProviderInsert;
  formattedRequestHeaders: string;
};

const parseJsonField = <T,>(
  value: string,
  schema: z.ZodType<T>,
  fieldName: string,
  errorMessage: string,
) => {
  const trimmed = value.trim();
  if (!trimmed) {
    return schema.parse({});
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return schema.parse(parsed);
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new Error(`${errorMessage}: ${error.issues.map((issue) => issue.message).join(", ")}`);
    }

    throw new Error(`${errorMessage}: ${(error as Error).message}`);
  }
};

const mapProviderToFormValues = (provider: PublicLlmProvider): FormValues => {
  const requestConfig = {
    ...DEFAULT_LLM_REQUEST_CONFIG,
    ...(provider.requestConfig ?? {}),
  };

  const toStringOrEmpty = (value: number | null | undefined) =>
    typeof value === "number" && !Number.isNaN(value) ? String(value) : "";

  return {
    providerType: provider.providerType,
    name: provider.name,
    description: provider.description ?? "",
    isActive: provider.isActive,
    tokenUrl: provider.tokenUrl,
    completionUrl: provider.completionUrl,
    authorizationKey: "",
    scope: provider.scope ?? "",
    model: provider.model ?? "",
    availableModels: provider.availableModels ?? [],
    allowSelfSignedCertificate: provider.allowSelfSignedCertificate ?? false,
    requestHeaders: formatJson(provider.requestHeaders ?? defaultRequestHeaders),
    systemPrompt:
      typeof requestConfig.systemPrompt === "string" ? requestConfig.systemPrompt : "",
    temperature: toStringOrEmpty(requestConfig.temperature),
    maxTokens: toStringOrEmpty(requestConfig.maxTokens),
    topP: toStringOrEmpty(requestConfig.topP),
    presencePenalty: toStringOrEmpty(requestConfig.presencePenalty),
    frequencyPenalty: toStringOrEmpty(requestConfig.frequencyPenalty),
  } satisfies FormValues;
};

export default function LlmProvidersPage() {
  const { toast } = useToast();
  const [isAuthorizationVisible, setIsAuthorizationVisible] = useState(false);
  const [isCreating, setIsCreating] = useState(false);

  const form = useForm<FormValues>({
    defaultValues: emptyFormValues,
  });

  const modelsArray = useFieldArray({ control: form.control, name: "availableModels" });
  const providerTypeValue = form.watch("providerType");

  const providersQuery = useQuery<ProvidersResponse>({
    queryKey: ["/api/llm/providers"],
  });

  const providers = useMemo(() => providersQuery.data?.providers ?? [], [providersQuery.data]);

  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null);

  const selectedProvider = useMemo(
    () => providers.find((provider) => provider.id === selectedProviderId) ?? null,
    [providers, selectedProviderId],
  );

  const handleSelectProvider = (providerId: string) => {
    setIsCreating(false);
    setSelectedProviderId(providerId);
  };

  const handleStartCreate = () => {
    const templateFactory = llmTemplates.gigachat;
    const templateValues = templateFactory ? templateFactory() : undefined;
    const availableModels = templateValues?.availableModels
      ? templateValues.availableModels.map((model) => ({ ...model }))
      : [];
    const initialValues: FormValues = {
      ...emptyFormValues,
      ...(templateValues ?? {}),
      availableModels,
    };

    form.reset(initialValues);
    modelsArray.replace(availableModels);
    form.setValue("availableModels", availableModels, { shouldDirty: false, shouldTouch: false });
    setSelectedProviderId(null);
    setIsCreating(true);
    setIsAuthorizationVisible(false);
  };

  const handleCancelCreate = () => {
    setIsCreating(false);
    setIsAuthorizationVisible(false);
    if (providers.length > 0) {
      setSelectedProviderId(providers[0].id);
      return;
    }

    form.reset(emptyFormValues);
    modelsArray.replace([]);
    form.setValue("availableModels", [], { shouldDirty: false, shouldTouch: false });
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

  const buildPayloadFromValues = (mode: "create" | "update") => {
    const values = form.getValues();
    const requestHeaders = parseJsonField(
      values.requestHeaders,
      requestHeadersSchema,
      "requestHeaders",
      "Укажите заголовки запроса в формате JSON",
    );

    const temperature = Number.parseFloat(values.temperature.trim());
    const maxTokens = Number.parseInt(values.maxTokens.trim(), 10);
    const topP = values.topP.trim() ? Number.parseFloat(values.topP.trim()) : undefined;
    const presencePenalty = values.presencePenalty.trim()
      ? Number.parseFloat(values.presencePenalty.trim())
      : undefined;
    const frequencyPenalty = values.frequencyPenalty.trim()
      ? Number.parseFloat(values.frequencyPenalty.trim())
      : undefined;

    const sanitizedAvailableModels = (values.availableModels ?? [])
      .map((model) => ({ label: model.label.trim(), value: model.value.trim() }))
      .filter((model) => model.label.length > 0 && model.value.length > 0);

    const modelName = values.model.trim().length > 0
      ? values.model.trim()
      : sanitizedAvailableModels[0]?.value ?? "";
    if (!modelName) {
      throw new Error("Укажите модель по умолчанию или добавьте варианты в список моделей.");
    }

    const trimmedAuthorizationKey = values.authorizationKey.trim();

    const sharedFields = {
      providerType: values.providerType,
      name: values.name.trim(),
      description: values.description.trim() ? values.description.trim() : undefined,
      isActive: values.isActive,
      tokenUrl: values.tokenUrl.trim(),
      completionUrl: values.completionUrl.trim(),
      scope: values.scope.trim(),
      model: modelName,
      allowSelfSignedCertificate: values.allowSelfSignedCertificate,
      requestHeaders,
      requestConfig: {
        modelField: "model",
        messagesField: "messages",
        systemPrompt: values.systemPrompt.trim(),
        temperature: Number.isNaN(temperature) ? DEFAULT_LLM_REQUEST_CONFIG.temperature : temperature,
        maxTokens: Number.isNaN(maxTokens) ? DEFAULT_LLM_REQUEST_CONFIG.maxTokens : maxTokens,
        topP: topP && !Number.isNaN(topP) ? topP : undefined,
        presencePenalty: presencePenalty && !Number.isNaN(presencePenalty) ? presencePenalty : undefined,
        frequencyPenalty: frequencyPenalty && !Number.isNaN(frequencyPenalty) ? frequencyPenalty : undefined,
        additionalBodyFields: {},
      },
      responseConfig: { ...DEFAULT_LLM_RESPONSE_CONFIG },
      availableModels: sanitizedAvailableModels,
    } satisfies Omit<LlmProviderInsert, "authorizationKey">;

    const formattedRequestHeaders = formatJson(requestHeaders);

    if (mode === "create") {
      if (trimmedAuthorizationKey.length === 0) {
        throw new Error("Укажите Authorization key для нового провайдера.");
      }

      return {
        payload: {
          ...sharedFields,
          authorizationKey: trimmedAuthorizationKey,
        },
        formattedRequestHeaders,
      } satisfies {
        payload: LlmProviderInsert;
        formattedRequestHeaders: string;
      };
    }

    const updatePayload: UpdateLlmProvider = {
      ...sharedFields,
      ...(trimmedAuthorizationKey.length > 0 ? { authorizationKey: trimmedAuthorizationKey } : {}),
    };

    return { payload: updatePayload, formattedRequestHeaders };
  };

  useEffect(() => {
    if (isCreating) {
      return;
    }

    if (providers.length === 0) {
      setSelectedProviderId(null);
      return;
    }

    if (selectedProviderId && providers.some((provider) => provider.id === selectedProviderId)) {
      return;
    }

    setSelectedProviderId(providers[0].id);
  }, [providers, selectedProviderId, isCreating]);

  useEffect(() => {
    if (isCreating) {
      return;
    }

    if (selectedProvider) {
      const values = mapProviderToFormValues(selectedProvider);
      form.reset(values);
      modelsArray.replace(values.availableModels ?? []);
      form.setValue("availableModels", values.availableModels ?? [], {
        shouldDirty: false,
        shouldTouch: false,
      });
      setIsAuthorizationVisible(false);
      return;
    }

    form.reset(emptyFormValues);
    modelsArray.replace([]);
    form.setValue("availableModels", [], { shouldDirty: false, shouldTouch: false });
    setIsAuthorizationVisible(false);
  }, [selectedProvider, form, isCreating, modelsArray]);

  useEffect(() => {
    if (!isCreating) {
      return;
    }

    const templateFactory = llmTemplates[providerTypeValue];
    if (!templateFactory) {
      return;
    }

    const templateValues = templateFactory();
    if (templateValues.availableModels) {
      modelsArray.replace(templateValues.availableModels);
      form.setValue("availableModels", templateValues.availableModels, {
        shouldDirty: false,
        shouldTouch: false,
      });
    }

    const templateFields: (keyof FormValues)[] = [
      "tokenUrl",
      "completionUrl",
      "scope",
      "model",
      "systemPrompt",
      "temperature",
      "maxTokens",
      "topP",
      "presencePenalty",
      "frequencyPenalty",
      "name",
      "description",
      "isActive",
      "allowSelfSignedCertificate",
    ];

    templateFields.forEach((field) => {
      if (templateValues[field] !== undefined) {
        form.setValue(field, templateValues[field] as never, { shouldDirty: false, shouldTouch: false });
      }
    });
  }, [form, isCreating, providerTypeValue, modelsArray]);

  const updateProviderMutation = useMutation<
    { provider: PublicLlmProvider },
    Error,
    UpdateLlmProviderVariables
  >({
    mutationFn: async ({ id, payload }) => {
      const response = await apiRequest("PUT", `/api/llm/providers/${id}`, payload);
      if (!response.ok) {
        const body = (await response.json()) as { message?: string };
        throw new Error(body.message ?? "Не удалось обновить провайдера LLM");
      }
      return (await response.json()) as { provider: PublicLlmProvider };
    },
    onSuccess: ({ provider }, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/llm/providers"] });
      toast({
        title: "Изменения сохранены",
        description: "Настройки провайдера обновлены.",
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
    { provider: PublicLlmProvider },
    Error,
    CreateLlmProviderVariables
  >({
    mutationFn: async ({ payload }) => {
      const response = await apiRequest("POST", "/api/llm/providers", payload);
      const body = (await response.json()) as { provider?: PublicLlmProvider; message?: string };
      if (!response.ok) {
        throw new Error(body.message ?? "Не удалось создать провайдера LLM");
      }

      if (!body.provider) {
        throw new Error("Некорректный ответ сервера");
      }

      return { provider: body.provider };
    },
    onSuccess: ({ provider }, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/llm/providers"] });
      queryClient.setQueryData<ProvidersResponse>(["/api/llm/providers"], (previous) => {
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
        title: "Провайдер создан",
        description: "GigaChat сразу готов к работе на dev-стенде.",
      });

      const updatedValues = {
        ...mapProviderToFormValues(provider),
        requestHeaders: variables.formattedRequestHeaders,
      } satisfies FormValues;

      setIsCreating(false);
      setSelectedProviderId(provider.id);
      form.reset(updatedValues);
      setIsAuthorizationVisible(false);
    },
    onError: (error) => {
      toast({
        title: "Не удалось создать провайдера",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleUpdate = form.handleSubmit((values) => {
    if (!selectedProvider) {
      toast({
        title: "Не выбран провайдер",
        description: "Выберите провайдера из списка слева, чтобы изменить его настройки.",
        variant: "destructive",
      });
      return;
    }

    form.clearErrors();

    try {
      const { payload, formattedRequestHeaders } = buildPayloadFromValues("update");
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
      const { payload, formattedRequestHeaders } = buildPayloadFromValues("create");
      createProviderMutation.mutate({ payload, formattedRequestHeaders });
    } catch (error) {
      toast({
        title: "Не удалось подготовить данные",
        description: error instanceof Error ? error.message : "Исправьте ошибки и попробуйте снова.",
        variant: "destructive",
      });
    }
  });

  const isSubmitPending = isCreating
    ? createProviderMutation.isPending
    : updateProviderMutation.isPending;

  return (
    <div className="space-y-6 p-6">
      <div className="space-y-1">
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          <Sparkles className="h-5 w-5 text-primary" /> Управление LLM
        </h1>
        <p className="text-muted-foreground max-w-3xl">
          Настройте токены, модели и системные промпты для подключённых LLM. Провайдеры создаются администратором и доступны здесь для редактирования.
        </p>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1.9fr)] 2xl:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <Card className="h-fit">
          <CardHeader className="space-y-3 pb-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle>Провайдеры LLM</CardTitle>
                <CardDescription>Выберите сервис или создайте новый шаблон.</CardDescription>
              </div>
              <Button size="sm" onClick={handleStartCreate} disabled={isCreating} className="gap-2">
                Добавить провайдера
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Рекомендуем выбрать тип GigaChat — мы автоматически подставим рабочие URL, scope и модели для dev-стенда.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            {providersQuery.isLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Загружаем список провайдеров...
              </div>
            ) : providersQuery.isError ? (
              <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
                {(providersQuery.error as Error).message ?? "Не удалось загрузить провайдеров"}
              </div>
            ) : providers.length === 0 ? (
              <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                <p className="mb-3">Провайдеры ещё не настроены. Создайте GigaChat, чтобы быстро повторить продовые настройки.</p>
                <Button size="sm" onClick={handleStartCreate} className="mb-2" disabled={isCreating}>
                  Добавить провайдера
                </Button>
                <p className="text-xs">Шаблон автозаполнит URL, scope и список моделей.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {providers.map((provider) => {
                  const isSelected = provider.id === selectedProviderId;
                  const requestConfig = {
                    ...DEFAULT_LLM_REQUEST_CONFIG,
                    ...(provider.requestConfig ?? {}),
                  };

                  return (
                    <button
                      key={provider.id}
                      type="button"
                      onClick={() => handleSelectProvider(provider.id)}
                      className={cn(
                        "w-full rounded-lg border px-4 py-3 text-left transition",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                        isSelected
                          ? "border-primary bg-primary/5 shadow-sm"
                          : "border-border bg-background hover:border-primary/60 hover:shadow-sm",
                        !provider.isActive && "opacity-90",
                      )}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold text-foreground">{provider.name}</span>
                          <Badge variant="outline" className="text-[11px] uppercase">
                            {provider.providerType}
                          </Badge>
                        </div>
                        <Badge variant={provider.isActive ? "default" : "secondary"}>
                          {provider.isActive ? "Активен" : "Отключён"}
                        </Badge>
                      </div>
                      {provider.description && (
                        <p className="mt-2 text-xs text-muted-foreground">{provider.description}</p>
                      )}
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        <Badge
                          variant="outline"
                          onClick={(event: MouseEvent<HTMLDivElement>) => {
                            event.stopPropagation();
                            void handleCopyValue(provider.id, "llmProviderId");
                          }}
                          className="cursor-pointer gap-1 text-[10px] uppercase tracking-wide"
                        >
                          <Copy className="h-3.5 w-3.5" /> llmProviderId: {provider.id}
                        </Badge>
                        {provider.model ? (
                          <Badge
                            variant="outline"
                            onClick={(event: MouseEvent<HTMLDivElement>) => {
                              event.stopPropagation();
                              void handleCopyValue(provider.model, "Модель LLM");
                            }}
                            className="cursor-pointer gap-1 text-[10px] uppercase tracking-wide"
                          >
                            <Copy className="h-3.5 w-3.5" /> model: {provider.model}
                          </Badge>
                        ) : null}
                      </div>
                      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <Badge variant="outline" className="text-[11px] font-normal">
                          SSL: {provider.allowSelfSignedCertificate ? "self-signed" : "строгая проверка"}
                        </Badge>
                        <Badge variant="outline" className="text-[11px] font-normal">
                          Token: {provider.hasAuthorizationKey ? "сохранён" : "не указан"}
                        </Badge>
                        <Badge variant="outline" className="text-[11px] font-normal">
                          Температура: {formatFloat(requestConfig.temperature)}
                        </Badge>
                      </div>
                      {provider.availableModels.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-2">
                          {provider.availableModels.slice(0, 4).map((model) => (
                            <Badge
                              key={`${provider.id}-${model.value}`}
                              variant="secondary"
                              className="text-[11px] font-normal"
                            >
                              {model.label}
                            </Badge>
                          ))}
                          {provider.availableModels.length > 4 && (
                            <Badge variant="secondary" className="text-[11px] font-normal">
                              +{provider.availableModels.length - 4}
                            </Badge>
                          )}
                        </div>
                      )}
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
                ? "Новый провайдер LLM"
                : selectedProvider
                  ? selectedProvider.name
                  : "Настройки провайдера"}
            </CardTitle>
            <CardDescription>
              {isCreating
                ? "Автозаполнили шаблон GigaChat: проверьте ключ и сохраните."
                : selectedProvider
                  ? "Отредактируйте авторизацию, список моделей и параметры генерации."
                  : "Выберите провайдера слева, чтобы изменить его настройки."}
            </CardDescription>
            {selectedProvider && !isCreating ? (
              <div className="mt-3 flex flex-wrap gap-1.5">
                <Badge
                  variant="outline"
                  onClick={() => void handleCopyValue(selectedProvider.id, "llmProviderId")}
                  className="cursor-pointer gap-1 text-[10px] uppercase tracking-wide"
                >
                  <Copy className="h-3.5 w-3.5" /> llmProviderId: {selectedProvider.id}
                </Badge>
                {selectedProvider.model ? (
                  <Badge
                    variant="outline"
                    onClick={() => void handleCopyValue(selectedProvider.model, "Модель LLM")}
                    className="cursor-pointer gap-1 text-[10px] uppercase tracking-wide"
                  >
                    <Copy className="h-3.5 w-3.5" /> model: {selectedProvider.model}
                  </Badge>
                ) : null}
              </div>
            ) : null}
          </CardHeader>
          <CardContent>
            <Form {...form}>
              <form onSubmit={isCreating ? handleCreate : handleUpdate} className="space-y-6">
                {!selectedProvider && !isCreating ? (
                  <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
                    Нет доступных провайдеров для настройки.
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
                                  {llmProviderTypes.map((type) => (
                                    <SelectItem key={type} value={type}>
                                      {type === "gigachat" ? "GigaChat" : "Другой сервис"}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </FormControl>
                            <FormDescription>
                              Выберите «GigaChat», чтобы мы автоматически заполнили рабочие URL, scope и список моделей.
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
                              <FormLabel className="text-sm">Статус провайдера</FormLabel>
                              <FormDescription className="text-xs">
                                Только активные провайдеры доступны в интерфейсе поиска.
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
                              <Input {...field} placeholder="Например, GigaChat Prod" required />
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
                              <Input {...field} placeholder="Необязательно" />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="tokenUrl"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Endpoint получения токена</FormLabel>
                            <FormControl>
                              <Input {...field} placeholder="https://.../oauth" required />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="completionUrl"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Endpoint генерации ответа</FormLabel>
                            <FormControl>
                              <Input {...field} placeholder="https://.../chat/completions" required />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="authorizationKey"
                        render={({ field }) => (
                          <FormItem className="md:col-span-2">
                            <FormLabel>Authorization key</FormLabel>
                            <FormControl>
                              <div className="relative">
                                <Input
                                  {...field}
                                  type={isAuthorizationVisible ? "text" : "password"}
                                  placeholder="Base64(client_id:client_secret)"
                                  autoComplete="new-password"
                                  className="pr-10"
                                  required={isCreating}
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
                                  {isAuthorizationVisible ? (
                                    <EyeOff className="h-4 w-4" />
                                  ) : (
                                    <Eye className="h-4 w-4" />
                                  )}
                                </Button>
                              </div>
                            </FormControl>
                            <FormDescription>
                              {selectedProvider?.hasAuthorizationKey && !isCreating
                                ? "Секрет сохранён. Оставьте поле пустым, если не требуется обновление."
                                : "Укажите ключ, который будет использоваться для запроса access_token."}
                            </FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

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
                            <FormLabel>Модель по умолчанию</FormLabel>
                            <FormControl>
                              <Input {...field} placeholder="Например, GigaChat" required />
                            </FormControl>
                            <FormDescription className="text-xs">
                              Используется, если пользователь не выбрал конкретную модель.
                            </FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <div className="md:col-span-2 space-y-3">
                        <FormLabel>Доступные модели для выбора</FormLabel>
                        <FormDescription>
                          Отображаются в интерфейсе генеративного поиска. Добавьте варианты, которые будут доступны пользователю.
                        </FormDescription>
                        <div className="space-y-3">
                          {modelsArray.fields.map((modelField, index) => (
                            <div
                              key={modelField.id}
                              className="grid gap-2 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]"
                            >
                              <FormField
                                control={form.control}
                                name={`availableModels.${index}.label`}
                                render={({ field }) => (
                                  <FormItem>
                                    <FormLabel className="text-xs uppercase text-muted-foreground">Название</FormLabel>
                                    <FormControl>
                                      <Input
                                        {...field}
                                        value={field.value ?? ""}
                                        placeholder="Например, Lite"
                                      />
                                    </FormControl>
                                    <FormMessage />
                                  </FormItem>
                                )}
                              />
                              <FormField
                                control={form.control}
                                name={`availableModels.${index}.value`}
                                render={({ field }) => (
                                  <FormItem>
                                    <FormLabel className="text-xs uppercase text-muted-foreground">Идентификатор</FormLabel>
                                    <FormControl>
                                      <Input
                                        {...field}
                                        value={field.value ?? ""}
                                        placeholder="Например, GigaChat-Lite"
                                      />
                                    </FormControl>
                                    <FormMessage />
                                  </FormItem>
                                )}
                              />
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="mt-6 h-9 w-9 text-muted-foreground hover:text-destructive"
                                onClick={() => modelsArray.remove(index)}
                                aria-label="Удалить модель"
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          ))}
                          {modelsArray.fields.length === 0 && (
                            <div className="rounded-md border border-dashed border-border/60 px-3 py-2 text-sm text-muted-foreground">
                              Добавьте хотя бы одну модель.
                            </div>
                          )}
                        </div>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="gap-2"
                          onClick={() => modelsArray.append({ label: "", value: "" })}
                        >
                          Добавить модель
                        </Button>
                      </div>
                    </div>

                    <FormField
                      control={form.control}
                      name="allowSelfSignedCertificate"
                      render={({ field }) => (
                        <FormItem className="flex items-center justify-between rounded-lg border p-3">
                          <div className="space-y-1">
                            <FormLabel className="text-sm">Доверять самоподписанным сертификатам</FormLabel>
                            <FormDescription className="text-xs">
                              Включите, если LLM размещён во внутреннем контуре с self-signed SSL.
                            </FormDescription>
                          </div>
                          <FormControl>
                            <Switch checked={field.value} onCheckedChange={field.onChange} />
                          </FormControl>
                        </FormItem>
                      )}
                    />

                    <Separator />

                    <div className="grid gap-4 md:grid-cols-2">
                      <FormField
                        control={form.control}
                        name="systemPrompt"
                        render={({ field }) => (
                          <FormItem className="md:col-span-2">
                            <FormLabel>Системный промпт</FormLabel>
                            <FormControl>
                              <Textarea {...field} rows={3} />
                            </FormControl>
                            <FormDescription>
                              LLM будет использовать этот текст как инструкцию перед обработкой пользовательского запроса.
                            </FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="temperature"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Температура</FormLabel>
                            <FormControl>
                              <Input {...field} type="number" step="0.1" min="0" max="2" />
                            </FormControl>
                            <FormDescription>Управляет вариативностью ответов.</FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="maxTokens"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Max tokens</FormLabel>
                            <FormControl>
                              <Input {...field} type="number" min="1" step="1" placeholder="1024" />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="topP"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Top P</FormLabel>
                            <FormControl>
                              <Input {...field} type="number" step="0.05" min="0" max="1" placeholder="1" />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="presencePenalty"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Presence penalty</FormLabel>
                            <FormControl>
                              <Input {...field} type="number" step="0.1" min="-2" max="2" placeholder="0" />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="frequencyPenalty"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Frequency penalty</FormLabel>
                            <FormControl>
                              <Input {...field} type="number" step="0.1" min="-2" max="2" placeholder="0" />
                            </FormControl>
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
                            <Textarea {...field} rows={4} />
                          </FormControl>
                          <FormDescription>
                            JSON-объект с заголовками, которые будут добавлены к запросам LLM.
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <div className="flex flex-wrap items-center gap-2">
                      <Button type="submit" className="min-w-[200px]" disabled={isSubmitPending}>
                        {isSubmitPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        {isCreating ? "Создать провайдера" : "Сохранить изменения"}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={
                          isCreating
                            ? handleCancelCreate
                            : () => selectedProvider && form.reset(mapProviderToFormValues(selectedProvider))
                        }
                        disabled={isSubmitPending || (!isCreating && !selectedProvider)}
                      >
                        {isCreating ? "Отменить" : "Сбросить изменения"}
                      </Button>
                    </div>
                  </>
                )}
              </form>
            </Form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
