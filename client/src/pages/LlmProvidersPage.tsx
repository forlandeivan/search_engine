import { MouseEvent, useEffect, useMemo, useState } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { z } from "zod";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Sparkles, Loader2, Trash2, Eye, EyeOff, Copy, SlidersHorizontal } from "lucide-react";

import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { useModels } from "@/hooks/useModels";
import { useModels } from "@/hooks/useModels";

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
  type UnicaChatConfig,
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
  isGlobal: boolean;
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
  isGlobal: false,
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

const aitunnelModelOptions: FormValues["availableModels"] = [
  { label: "OpenAI · GPT-5.1 Chat (флагман)", value: "gpt-5.1-chat" },
  { label: "OpenAI · GPT-5 Mini (быстрый)", value: "gpt-5-mini" },
  { label: "OpenAI · GPT-4.1", value: "gpt-4.1" },
  { label: "OpenAI · GPT-4.1 Mini", value: "gpt-4.1-mini" },
  { label: "OpenAI · GPT-4o Mini", value: "gpt-4o-mini" },
  { label: "DeepSeek · R1 (рассуждения)", value: "deepseek-r1" },
  { label: "Anthropic · Claude 3.7 Sonnet", value: "claude-3.7-sonnet" },
  { label: "Anthropic · Claude 3.7 Sonnet Thinking", value: "claude-3.7-sonnet-thinking" },
  { label: "Google · Gemini 2.5 Pro", value: "gemini-2.5-pro" },
  { label: "Google · Gemini 2.5 Flash", value: "gemini-2.5-flash" },
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
  aitunnel: () => ({
    providerType: "aitunnel",
    name: "AITunnel",
    description: "OpenAI, DeepSeek, Claude, Gemini через единый API",
    isActive: true,
    tokenUrl: "https://api.aitunnel.ru/v1", // не используется для OAuth, но поле требуется схемой
    completionUrl: "https://api.aitunnel.ru/v1/chat/completions",
    scope: "",
    model: "gpt-5.1-chat",
    availableModels: aitunnelModelOptions.map((model) => ({ ...model })),
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
  payload: Omit<LlmProviderInsert, "workspaceId">;
  formattedRequestHeaders: string;
};

type UnicaChatConfigResponse = { config: UnicaChatConfig };

type UnicaChatFormValues = {
  llmProviderConfigId: string;
  modelId: string;
  systemPrompt: string;
  temperature: string;
  maxTokens: string;
};

const DEFAULT_UNICA_TEMPERATURE = DEFAULT_LLM_REQUEST_CONFIG.temperature ?? 0.7;
const DEFAULT_UNICA_MAX_TOKENS = DEFAULT_LLM_REQUEST_CONFIG.maxTokens ?? 2048;

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

  const availableModels =
    Array.isArray(provider.availableModels) && provider.availableModels.length >= 0
      ? provider.availableModels
      : provider.recommendedModels ?? [];

  return {
    providerType: provider.providerType,
    name: provider.name,
    description: provider.description ?? "",
    isActive: provider.isActive,
    isGlobal: provider.isGlobal ?? false,
    tokenUrl: provider.tokenUrl,
    completionUrl: provider.completionUrl,
    authorizationKey: "",
    scope: provider.scope ?? "",
    model: provider.model ?? "",
    availableModels,
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

const getProviderModelOptions = (provider: PublicLlmProvider | null) => {
  if (!provider) {
    return [] as { label: string; value: string }[];
  }

  const rawOptions =
    provider.availableModels?.map((option) => ({
      label: option.label?.trim() || option.value?.trim() || "",
      value: option.value?.trim() || option.label?.trim() || "",
    })) ?? [];

  const filtered = rawOptions.filter((option) => option.value.length > 0);
  if (filtered.length > 0) {
    return filtered;
  }

  if (typeof provider.model === "string" && provider.model.trim().length > 0) {
    const trimmed = provider.model.trim();
    return [{ label: trimmed, value: trimmed }];
  }

  return [];
};

export default function LlmProvidersPage() {
  const { toast } = useToast();
  const [isAuthorizationVisible, setIsAuthorizationVisible] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null);

  const form = useForm<FormValues>({
    defaultValues: emptyFormValues,
  });

  const modelsArray = useFieldArray({ control: form.control, name: "availableModels" });
  const providerTypeValue = form.watch("providerType");
  const modelSelectOptions = useMemo(
    () =>
      modelsArray.fields
        .map((field) => ({
          label: field.label?.trim() ?? "",
          value: field.value?.trim() ?? "",
        }))
        .filter((option) => option.label.length > 0 && option.value.length > 0),
    [modelsArray.fields],
  );
  const isAitunnelProvider = providerTypeValue === "aitunnel";
  const providerCatalogOptions = useMemo(() => {
    if (!selectedProviderId) return [];
    return catalogModels
      .filter((model) => model.providerId === selectedProviderId)
      .map((model) => ({
        value: model.key,
        label: `${model.displayName} (${model.key})`,
      }))
      .sort((a, b) => a.label.localeCompare(b.label, "ru"));
  }, [catalogModels, selectedProviderId]);

  const unicaForm = useForm<UnicaChatFormValues>({
    defaultValues: {
      llmProviderConfigId: "",
      modelId: "",
      systemPrompt: "",
      temperature: String(DEFAULT_UNICA_TEMPERATURE),
      maxTokens: DEFAULT_UNICA_MAX_TOKENS ? String(DEFAULT_UNICA_MAX_TOKENS) : "",
    },
  });

  const providersQuery = useQuery<ProvidersResponse>({
    queryKey: ["/api/llm/providers"],
  });

  const providers = useMemo(() => providersQuery.data?.providers ?? [], [providersQuery.data]);
  const catalogModels = useModels("LLM").data ?? [];

  const selectedProvider = useMemo(
    () => providers.find((provider) => provider.id === selectedProviderId) ?? null,
    [providers, selectedProviderId],
  );

  const unicaChatQuery = useQuery<UnicaChatConfigResponse>({
    queryKey: ["/api/admin/unica-chat"],
  });

  const selectedUnicaProviderId = unicaForm.watch("llmProviderConfigId");

  const selectedUnicaProvider = useMemo(
    () => providers.find((provider) => provider.id === selectedUnicaProviderId) ?? null,
    [providers, selectedUnicaProviderId],
  );

  const unicaProviderModelOptions = useMemo(
    () => getProviderModelOptions(selectedUnicaProvider),
    [selectedUnicaProvider],
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

  function buildPayloadFromValues(mode: "create"): CreateLlmProviderVariables;
  function buildPayloadFromValues(mode: "update"): {
    payload: UpdateLlmProvider;
    formattedRequestHeaders: string;
  };
  function buildPayloadFromValues(
    mode: "create" | "update",
  ): CreateLlmProviderVariables | {
    payload: UpdateLlmProvider;
    formattedRequestHeaders: string;
  } {
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
      : sanitizedAvailableModels[0]?.value ??
        (values.providerType === "aitunnel" ? "gpt-5.1-chat" : "");
    if (!modelName) {
      throw new Error("Укажите модель по умолчанию или добавьте варианты в список моделей.");
    }

    const trimmedAuthorizationKey = values.authorizationKey.trim();
    const needsApiKey =
      values.providerType === "aitunnel" &&
      !selectedProvider?.hasAuthorizationKey &&
      trimmedAuthorizationKey.length === 0;

    const sharedFields = {
      providerType: values.providerType,
      name: values.name.trim(),
      description: values.description.trim() ? values.description.trim() : undefined,
      isActive: values.isActive,
      isGlobal: values.isGlobal,
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
    } satisfies Omit<LlmProviderInsert, "authorizationKey" | "workspaceId">;

    const formattedRequestHeaders = formatJson(requestHeaders);

    if (mode === "create") {
      if (trimmedAuthorizationKey.length === 0) {
        throw new Error(
          values.providerType === "aitunnel"
            ? "Укажите API ключ AITunnel."
            : "Укажите Authorization key для нового провайдера.",
        );
      }

      return {
        payload: {
          ...sharedFields,
          authorizationKey: trimmedAuthorizationKey,
        },
        formattedRequestHeaders,
      } satisfies CreateLlmProviderVariables;
    }

    if (needsApiKey) {
      throw new Error("Укажите API ключ AITunnel.");
    }

    const updatePayload: UpdateLlmProvider = {
      ...sharedFields,
      ...(trimmedAuthorizationKey.length > 0 ? { authorizationKey: trimmedAuthorizationKey } : {}),
    };

    return { payload: updatePayload, formattedRequestHeaders };
  }

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
  }, [selectedProvider, isCreating]);

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
  }, [isCreating, providerTypeValue]);

  useEffect(() => {
    const config = unicaChatQuery.data?.config;
    if (!config) {
      return;
    }

    const providerId = config.llmProviderConfigId ?? "";
    const provider = providers.find((entry) => entry.id === providerId) ?? null;
    const providerModels = getProviderModelOptions(provider);

    const fallbackModel =
      (config.modelId && config.modelId.trim().length > 0 ? config.modelId.trim() : "") ||
      providerModels[0]?.value ||
      provider?.model ||
      "";

    const fallbackPrompt =
      config.systemPrompt && config.systemPrompt.length > 0
        ? config.systemPrompt
        : typeof provider?.requestConfig?.systemPrompt === "string"
          ? provider.requestConfig.systemPrompt
          : "";

    const fallbackTemperature =
      (typeof config.temperature === "number" && !Number.isNaN(config.temperature)
        ? config.temperature
        : undefined) ??
      (typeof provider?.requestConfig?.temperature === "number"
        ? provider.requestConfig.temperature
        : undefined) ??
      DEFAULT_UNICA_TEMPERATURE;

    const fallbackMaxTokens =
      (typeof config.maxTokens === "number" && !Number.isNaN(config.maxTokens)
        ? config.maxTokens
        : undefined) ??
      (typeof provider?.requestConfig?.maxTokens === "number"
        ? provider.requestConfig.maxTokens
        : undefined) ??
      DEFAULT_UNICA_MAX_TOKENS;

    unicaForm.reset({
      llmProviderConfigId: providerId,
      modelId: fallbackModel,
      systemPrompt: fallbackPrompt ?? "",
      temperature:
        typeof fallbackTemperature === "number" && !Number.isNaN(fallbackTemperature)
          ? String(fallbackTemperature)
          : "",
      maxTokens:
        typeof fallbackMaxTokens === "number" && !Number.isNaN(fallbackMaxTokens)
          ? String(fallbackMaxTokens)
          : "",
    });
  }, [unicaChatQuery.data, providers, unicaForm]);

  useEffect(() => {
    if (!selectedUnicaProvider) {
      return;
    }

    const options = getProviderModelOptions(selectedUnicaProvider);
    const currentModel = unicaForm.getValues("modelId");

    if (currentModel && options.some((option) => option.value === currentModel)) {
      return;
    }

    if (options.length > 0) {
      unicaForm.setValue("modelId", options[0].value, { shouldDirty: true });
    } else if (!currentModel && selectedUnicaProvider.model) {
      unicaForm.setValue("modelId", selectedUnicaProvider.model, { shouldDirty: true });
    }
  }, [selectedUnicaProvider, unicaForm]);

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

  const updateUnicaChatMutation = useMutation<UnicaChatConfigResponse, Error, UnicaChatFormValues>({
    mutationFn: async (values) => {
      if (!values.llmProviderConfigId) {
        throw new Error("Выберите провайдера LLM");
      }

      const trimmedPrompt = values.systemPrompt.trim();
      const temperatureValue = values.temperature.trim();
      const maxTokensValue = values.maxTokens.trim();

      const parsedTemperature =
        temperatureValue.length > 0 ? Number.parseFloat(temperatureValue) : undefined;
      if (temperatureValue.length > 0 && Number.isNaN(parsedTemperature)) {
        throw new Error("Некорректное значение температуры");
      }

      const parsedMaxTokens =
        maxTokensValue.length > 0 ? Number.parseInt(maxTokensValue, 10) : undefined;
      if (maxTokensValue.length > 0 && Number.isNaN(parsedMaxTokens)) {
        throw new Error("Некорректное значение максимального числа токенов");
      }

      const payload = {
        llmProviderConfigId: values.llmProviderConfigId,
        modelId: values.modelId.trim() || undefined,
        systemPrompt: trimmedPrompt,
        temperature: parsedTemperature,
        maxTokens: parsedMaxTokens,
      };

      const response = await apiRequest("PUT", "/api/admin/unica-chat", payload);
      const body = (await response.json().catch(() => null)) as
        | (UnicaChatConfigResponse & { message?: string })
        | { message?: string }
        | null;

      if (!response.ok || !body || !("config" in body) || !body.config) {
        throw new Error(body?.message ?? "Не удалось обновить настройки Unica Chat");
      }

      return { config: body.config };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/unica-chat"] });
      toast({
        title: "Настройки Unica Chat сохранены",
        description: "Глобальные параметры системного навыка обновлены.",
      });
    },
    onError: (error) => {
      toast({
        title: "Не удалось сохранить настройки",
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

  const handleUnicaSubmit = unicaForm.handleSubmit(async (values) => {
    try {
      await updateUnicaChatMutation.mutateAsync(values);
    } catch {
      // уведомление показано в onError
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
                                      {type === "gigachat"
                                        ? "GigaChat"
                                        : type === "aitunnel"
                                          ? "AITunnel (GPT-5, DeepSeek, Claude, Gemini)"
                                          : "Другой сервис"}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </FormControl>
                            <FormDescription>
                              Выберите «GigaChat», чтобы мы автоматически заполнили рабочие URL, scope и список моделей. Для AITunnel будут предложены топовые модели OpenAI/DeepSeek/Claude/Gemini.
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
                        name="isGlobal"
                        render={({ field }) => (
                          <FormItem className="flex items-center justify-between rounded-lg border p-3">
                            <div className="space-y-1">
                              <FormLabel className="text-sm">Глобальный провайдер</FormLabel>
                              <FormDescription className="text-xs">
                                Глобальные провайдеры доступны всем пользователям системы.
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
                              <Input
                                {...field}
                                placeholder={isAitunnelProvider ? "Не обязателен для AITunnel" : "https://.../oauth"}
                                required={!isAitunnelProvider}
                              />
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
                            <FormLabel>
                              {isAitunnelProvider ? "API ключ AITunnel" : "Authorization key"}
                            </FormLabel>
                            <FormControl>
                              <div className="relative">
                                <Input
                                  {...field}
                                  type={isAuthorizationVisible ? "text" : "password"}
                                  placeholder={isAitunnelProvider ? "sk-aitunnel-..." : "Base64(client_id:client_secret)"}
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
                                : isAitunnelProvider
                                  ? "Ключ из личного кабинета AITunnel. Используется напрямую (Bearer)."
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
                              <Input
                                {...field}
                                placeholder={isAitunnelProvider ? "Не требуется" : "GIGACHAT_API_PERS"}
                                required={!isAitunnelProvider}
                              />
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
                            {providerCatalogOptions.length > 0 ? (
                              <>
                                <FormControl>
                                  <Select
                                    value={field.value || providerCatalogOptions[0]?.value || ""}
                                    onValueChange={(value) => field.onChange(value)}
                                  >
                                    <SelectTrigger>
                                      <SelectValue placeholder="Выберите модель из каталога" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {providerCatalogOptions.map((option) => (
                                        <SelectItem key={option.value} value={option.value}>
                                          {option.label}
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                </FormControl>
                                <FormDescription className="text-xs">
                                  Список моделей берётся из каталога для текущего провайдера. Измените каталог, чтобы
                                  добавить новые варианты.
                                </FormDescription>
                              </>
                            ) : providerTypeValue === "aitunnel" && modelSelectOptions.length > 0 ? (
                              <>
                                <FormControl>
                                  <Select
                                    value={field.value || modelSelectOptions[0]?.value || ""}
                                    onValueChange={(value) => field.onChange(value)}
                                  >
                                    <SelectTrigger>
                                      <SelectValue placeholder="Выберите модель" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {modelSelectOptions.map((option) => (
                                        <SelectItem key={option.value} value={option.value}>
                                          {option.label}
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                </FormControl>
                                <FormDescription className="text-xs">
                                  Рекомендуемые модели AITunnel; можно сохранить любую, даже если её нет в списке.
                                </FormDescription>
                              </>
                            ) : (
                              <>
                                <FormControl>
                                  <Input {...field} placeholder="Например, GigaChat" required />
                                </FormControl>
                                <FormDescription className="text-xs">
                                  Используется, если пользователь не выбрал конкретную модель.
                                </FormDescription>
                              </>
                            )}
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
                                        placeholder="Например, Lite"
                                        data-testid={`input-model-label-${index}`}
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
                                        placeholder="Например, GigaChat-Lite"
                                        data-testid={`input-model-value-${index}`}
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

      <Card>
        <CardHeader className="space-y-2">
          <div className="flex items-center gap-2">
            <SlidersHorizontal className="h-5 w-5 text-primary" />
            <CardTitle>Настройки Unica Chat</CardTitle>
          </div>
          <CardDescription>
            Глобальные параметры системного навыка Unica Chat. Эти настройки применяются для всех
            рабочих пространств и переопределяют модель, температуру и системный промпт навыка.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {unicaChatQuery.isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Загружаем текущие настройки...
            </div>
          ) : unicaChatQuery.isError ? (
            <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
              {(unicaChatQuery.error as Error).message ?? "Не удалось получить настройки Unica Chat"}
            </div>
          ) : providers.length === 0 ? (
            <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
              Сначала добавьте хотя бы один провайдер LLM, чтобы выбрать его для Unica Chat.
            </div>
          ) : (
            <Form {...unicaForm}>
              <form onSubmit={handleUnicaSubmit} className="space-y-5">
                <div className="grid gap-4 md:grid-cols-2">
                  <FormField
                    control={unicaForm.control}
                    name="llmProviderConfigId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Провайдер LLM</FormLabel>
                        <FormControl>
                          <Select
                            value={field.value}
                            onValueChange={field.onChange}
                            disabled={updateUnicaChatMutation.isPending}
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Выберите провайдера" />
                            </SelectTrigger>
                            <SelectContent>
                              {providers.map((provider) => (
                                <SelectItem key={provider.id} value={provider.id}>
                                  {provider.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </FormControl>
                        <FormDescription>
                          Используемый провайдер LLM для Unica Chat. Настройки доступны только
                          администраторам.
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={unicaForm.control}
                    name="modelId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Модель LLM</FormLabel>
                        {unicaProviderModelOptions.length > 0 ? (
                          <FormControl>
                            <Select
                              value={field.value}
                              onValueChange={field.onChange}
                              disabled={updateUnicaChatMutation.isPending}
                            >
                              <SelectTrigger>
                                <SelectValue placeholder="Выберите модель" />
                              </SelectTrigger>
                              <SelectContent>
                                {unicaProviderModelOptions.map((option) => (
                                  <SelectItem key={option.value} value={option.value}>
                                    {option.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </FormControl>
                        ) : (
                          <FormControl>
                            <Input
                              {...field}
                              placeholder="Введите модель вручную"
                              disabled={updateUnicaChatMutation.isPending}
                            />
                          </FormControl>
                        )}
                        <FormDescription>Модель, которая будет использоваться в Unica Chat.</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <FormField
                  control={unicaForm.control}
                  name="systemPrompt"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Системный промпт</FormLabel>
                      <FormControl>
                        <Textarea
                          {...field}
                          rows={5}
                          placeholder="Напишите инструкции для системного навыка"
                          disabled={updateUnicaChatMutation.isPending}
                        />
                      </FormControl>
                      <FormDescription>
                        Этот текст всегда отправляется в LLM перед пользовательским запросом.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="grid gap-4 md:grid-cols-2">
                  <FormField
                    control={unicaForm.control}
                    name="temperature"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Температура</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            type="number"
                            step="0.05"
                            min="0"
                            max="2"
                            placeholder={String(DEFAULT_UNICA_TEMPERATURE)}
                            disabled={updateUnicaChatMutation.isPending}
                          />
                        </FormControl>
                        <FormDescription>Определяет креативность и вариативность ответов.</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={unicaForm.control}
                    name="maxTokens"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Максимум токенов</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            type="number"
                            min="16"
                            placeholder={String(DEFAULT_UNICA_MAX_TOKENS)}
                            disabled={updateUnicaChatMutation.isPending}
                          />
                        </FormControl>
                        <FormDescription>Лимит на длину ответа LLM.</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <div className="flex justify-end">
                  <Button type="submit" disabled={updateUnicaChatMutation.isPending}>
                    {updateUnicaChatMutation.isPending ? "Сохраняем..." : "Сохранить настройки"}
                  </Button>
                </div>
              </form>
            </Form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
