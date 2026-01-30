import { MouseEvent, useEffect, useMemo, useRef, useState } from "react";
import { useForm, useFieldArray, type FieldPath } from "react-hook-form";
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
  Trash2,
  Info,
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
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

import {
  embeddingProviderTypes,
  DEFAULT_EMBEDDING_REQUEST_CONFIG,
  DEFAULT_EMBEDDING_RESPONSE_CONFIG,
  DEFAULT_QDRANT_CONFIG,
  type EmbeddingProviderType,
  type InsertEmbeddingProvider,
  type PublicEmbeddingProvider,
  type UpdateEmbeddingProvider,
} from "@shared/schema";
import { useModels, type PublicModel } from "@/hooks/useModels";

const requestHeadersSchema = z.record(z.string(), z.string());

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
  testText?: string;
  vectorSize?: number;
  vectorPreview?: number[];
  usageTokens?: number;
};

type TestCredentialsError = Error & {
  steps?: TestCredentialsDebugStep[];
};

type ProvidersResponse = { providers: PublicEmbeddingProvider[] };
type CatalogModel = PublicModel;

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
  isGlobal: boolean;
  tokenUrl: string;
  embeddingsUrl: string;
  authorizationKey: string;
  scope: string;
  model: string;
  availableModels: { label: string; value: string }[];
  maxTokensPerVectorization: string;
  allowSelfSignedCertificate: boolean;
  requestHeaders: string;
};

const emptyFormValues: FormValues = {
  providerType: "gigachat",
  name: "",
  description: "",
  isActive: false,
  isGlobal: true,
  tokenUrl: "",
  embeddingsUrl: "",
  authorizationKey: "",
  scope: "",
  model: "",
  availableModels: [],
  maxTokensPerVectorization: "",
  allowSelfSignedCertificate: false,
  requestHeaders: formatJson(defaultRequestHeaders),
};

const gigachatModelOptions = [
  { label: "GigaChat Embeddings", value: "embeddings" }
];

const embeddingTemplates: Record<EmbeddingProviderType, Partial<FormValues>> = {
  gigachat: {
    providerType: "gigachat",
    name: "GigaChat Embeddings",
    description: "Шаблон dev-стенда с готовыми URL и scope",
    isActive: true,
    isGlobal: true,
    tokenUrl: "https://ngw.devices.sberbank.ru:9443/api/v2/oauth",
    embeddingsUrl: "https://gigachat.devices.sberbank.ru/api/v1/embeddings",
    scope: "GIGACHAT_API_PERS",
    model: "embeddings",
    availableModels: [...gigachatModelOptions],
  },
  custom: {
    providerType: "custom",
    isActive: true,
    isGlobal: true,
    availableModels: [],
  },
  unica: {
    providerType: "unica",
    name: "",
    description: "",
    isActive: true,
    isGlobal: true,
    tokenUrl: "",
    embeddingsUrl: "",
    scope: "",
    model: "",
    maxTokensPerVectorization: "",
    availableModels: [],
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

const mapProviderToFormValues = (provider: PublicEmbeddingProvider): FormValues => {
  const availableModels =
    Array.isArray(provider.availableModels) && provider.availableModels.length >= 0
      ? provider.availableModels
      : [];

  return {
    providerType: provider.providerType,
    name: provider.name,
    description: provider.description ?? "",
    isActive: provider.isActive,
    isGlobal: provider.isGlobal ?? false,
    tokenUrl: provider.tokenUrl,
    embeddingsUrl: provider.embeddingsUrl,
    authorizationKey: "",
    scope: provider.scope,
    model: provider.model,
    availableModels,
    maxTokensPerVectorization: provider.maxTokensPerVectorization ? String(provider.maxTokensPerVectorization) : "",
    allowSelfSignedCertificate: provider.allowSelfSignedCertificate ?? false,
    requestHeaders: formatJson(provider.requestHeaders ?? defaultRequestHeaders),
  };
};

export default function EmbeddingServicesPage() {
  const { toast } = useToast();
  const form = useForm<FormValues>({ defaultValues: emptyFormValues });
  const modelsArray = useFieldArray({ control: form.control, name: "availableModels" });
  const [isAuthorizationVisible, setIsAuthorizationVisible] = useState(false);
  const [selectedProviderId, setSelectedProviderId] = useState<string | "new" | null>(null);
  const [debugSteps, setDebugSteps] = useState<DebugStep[]>(() => buildDebugSteps());
  const [activeTab, setActiveTab] = useState<"settings" | "docs">("settings");
  const [testEmbeddingText, setTestEmbeddingText] = useState("Hello world!");
  const [isLoadingKey, setIsLoadingKey] = useState(false);
  const [loadedAuthKey, setLoadedAuthKey] = useState<string>("");
  const [isEditMode, setIsEditMode] = useState(false);
  const [originalFormValues, setOriginalFormValues] = useState<FormValues | null>(null);
  const watchedProviderType = form.watch("providerType");
  const isGigachatProvider = watchedProviderType === "gigachat";
  const isUnicaProvider = watchedProviderType === "unica";
  const isCreating = selectedProviderId === "new";
  const isViewMode = !isCreating && !isEditMode;
  const lastInitializedProviderIdRef = useRef<string | "new" | null>(null);

  const providersQuery = useQuery<ProvidersResponse>({
    queryKey: ["/api/embedding/services"],
  });
  const catalogQuery = useModels("EMBEDDINGS");

  const providers = useMemo(() => providersQuery.data?.providers ?? [], [providersQuery.data]);
  const providersLoaded = providersQuery.isSuccess;
  const catalogEmbModels = catalogQuery.data ?? [];
  const catalogByKey = useMemo(() => new Map(catalogEmbModels.map((m) => [m.key, m])), [catalogEmbModels]);

  const providerCatalogOptions = useMemo(() => {
    if (!selectedProviderId || selectedProviderId === "new") return [];
    return catalogEmbModels
      .filter((m) => m.providerId === selectedProviderId)
      .map((m) => ({
        label: m.displayName,
        value: m.key,
      }));
  }, [catalogEmbModels, selectedProviderId]);

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
        const templateValues = buildTemplateValues();
        form.reset(templateValues);
        modelsArray.replace(templateValues.availableModels ?? []);
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
    // ВАЖНО: инициализируем форму только при смене выбранного провайдера/режима,
    // иначе useFieldArray-объект будет триггерить эффект на каждом ререндере.
    if (lastInitializedProviderIdRef.current === selectedProviderId) {
      return;
    }

    lastInitializedProviderIdRef.current = selectedProviderId;

    if (selectedProviderId && selectedProviderId !== "new") {
      const provider = providers.find((p) => p.id === selectedProviderId) ?? null;

      if (provider) {
        const values = mapProviderToFormValues(provider);
        form.reset(values);
        modelsArray.replace(values.availableModels ?? []);
        setIsAuthorizationVisible(false);
        setLoadedAuthKey("");
        setDebugSteps(buildDebugSteps());
        setActiveTab("settings");
        setIsEditMode(false);
        setOriginalFormValues(values);
        return;
      }
    }

    if (isCreating) {
      setIsAuthorizationVisible(false);
      setLoadedAuthKey("");
      setDebugSteps(buildDebugSteps());
      setActiveTab("settings");
      setIsEditMode(false);
      setOriginalFormValues(null);
      return;
    }

    form.reset(emptyFormValues);
    modelsArray.replace([]);
    setIsAuthorizationVisible(false);
    setLoadedAuthKey("");
    setDebugSteps(buildDebugSteps());
    setActiveTab("settings");
    setIsEditMode(false);
    setOriginalFormValues(null);
  }, [selectedProviderId, providers, isCreating, form, modelsArray]);

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
      queryClient.invalidateQueries({ queryKey: ["/api/models"] });
      toast({
        title: "Изменения сохранены",
        description: "Настройки сервиса эмбеддингов обновлены.",
      });

      const updatedValues = {
        ...mapProviderToFormValues(provider),
        requestHeaders: variables.formattedRequestHeaders,
      } satisfies FormValues;

      form.reset(updatedValues);
      modelsArray.replace(updatedValues.availableModels ?? []);
      setIsAuthorizationVisible(false);
      setIsEditMode(false);
      setLoadedAuthKey("");
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
      queryClient.invalidateQueries({ queryKey: ["/api/models"] });
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
        description: `Шаблон ${provider.providerType === "gigachat" ? "GigaChat" : provider.providerType === "unica" ? "Unica AI" : provider.providerType} заполнен автоматически, проверьте данные.`,
      });

      const updatedValues = {
        ...mapProviderToFormValues(provider),
        requestHeaders: variables.formattedRequestHeaders,
      } satisfies FormValues;

      setSelectedProviderId(provider.id);
      form.reset(updatedValues);
      modelsArray.replace(updatedValues.availableModels ?? []);
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

  const deleteProviderMutation = useMutation<void, Error, string>({
    mutationFn: async (providerId) => {
      const response = await apiRequest("DELETE", `/api/embedding/services/${providerId}`);
      
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { message?: string; details?: any } | null;
        throw new Error(body?.message ?? "Не удалось удалить провайдера");
      }
    },
    onSuccess: (_, providerId) => {
      queryClient.invalidateQueries({ queryKey: ["/api/embedding/services"] });
      queryClient.setQueryData<ProvidersResponse>(["/api/embedding/services"], (previous) => {
        if (!previous) return previous;
        return {
          providers: (previous.providers ?? []).filter(p => p.id !== providerId),
        };
      });
      
      // Сбрасываем выбор, если удалили текущий провайдер
      if (selectedProviderId === providerId) {
        setSelectedProviderId(null);
      }
      
      toast({
        title: "Провайдер удалён",
        description: "Сервис эмбеддингов успешно удалён из системы.",
      });
    },
    onError: (error) => {
      toast({
        title: "Не удалось удалить провайдера",
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
    const trimmedModel = values.model.trim();

    if (!trimmedModel && values.providerType !== "unica") {
      const message = "Укажите модель";
      form.setError("model", { type: "manual", message });
      throw new Error(message);
    }

    const isInCatalog = trimmedModel ? catalogByKey.has(trimmedModel) : false;
    const isInAvailable = trimmedModel ? values.availableModels?.some((m) => m.value === trimmedModel) : false;

    if (trimmedModel && !isInCatalog && !isInAvailable) {
      const message = "Модель не найдена в каталоге и списке доступных моделей";
      form.setError("model", { type: "manual", message });
      throw new Error(message);
    }

    let parsedMaxTokens: number | undefined = undefined;

    if (trimmedMaxTokens) {
      const val = Number.parseInt(trimmedMaxTokens, 10);
      if (!Number.isFinite(val) || val <= 0) {
        const message = "Введите положительное целое число";
        form.setError("maxTokensPerVectorization", { type: "manual", message });
        throw new Error(message);
      }
      parsedMaxTokens = val;
    }

    const payloadBase = {
      providerType: values.providerType,
      name: values.name.trim(),
      description: values.description.trim() ? values.description.trim() : undefined,
      isActive: values.isActive,
      isGlobal: values.isGlobal,
      tokenUrl: values.tokenUrl.trim(),
      embeddingsUrl: values.embeddingsUrl.trim(),
      scope: values.scope.trim(),
      model: trimmedModel,
      availableModels: (values.availableModels ?? []).map((m) => ({
        label: m.label.trim(),
        value: m.value.trim(),
      })),
      maxTokensPerVectorization: parsedMaxTokens,
      allowSelfSignedCertificate: values.allowSelfSignedCertificate,
      requestHeaders,
    } satisfies Omit<
      InsertEmbeddingProvider,
      "authorizationKey" | "workspaceId" | "requestConfig" | "responseConfig" | "qdrantConfig"
    > &
      UpdateEmbeddingProvider;

    // Для unica провайдера tokenUrl и scope могут быть пустыми
    if (values.providerType === "unica") {
      if (!payloadBase.tokenUrl) payloadBase.tokenUrl = "";
      if (!payloadBase.scope) payloadBase.scope = "";
    }

    const formattedRequestHeaders = formatJson(requestHeaders);

    if (mode === "create") {
      if (!trimmedAuthorizationKey && values.providerType !== "unica") {
        const message = "Укажите Authorization key";
        form.setError("authorizationKey", { type: "manual", message });
        throw new Error(message);
      }

      const payload: InsertEmbeddingProvider = {
        ...payloadBase,
        authorizationKey: trimmedAuthorizationKey || "",
        requestConfig: { ...DEFAULT_EMBEDDING_REQUEST_CONFIG },
        responseConfig: { ...DEFAULT_EMBEDDING_RESPONSE_CONFIG },
        qdrantConfig: { ...DEFAULT_QDRANT_CONFIG },
      } satisfies Omit<InsertEmbeddingProvider, "workspaceId">;

      return { payload, formattedRequestHeaders };
    }

    const payload: UpdateEmbeddingProvider = {
      ...payloadBase,
    } satisfies UpdateEmbeddingProvider;

    // Если ключ не пустой, обновляем его
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

  const handleStartEdit = () => {
    setIsEditMode(true);
    const currentValues = form.getValues();
    setOriginalFormValues(currentValues);
  };

  const handleCancelEdit = () => {
    if (originalFormValues) {
      form.reset(originalFormValues);
      modelsArray.replace(originalFormValues.availableModels ?? []);
    }
    setIsEditMode(false);
    setLoadedAuthKey("");
    setIsAuthorizationVisible(false);
  };

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

  const handleDelete = () => {
    if (!selectedProvider) return;
    
    if (!confirm(`Вы уверены, что хотите удалить провайдера эмбеддингов "${selectedProvider.name}"?\n\nЭто действие нельзя отменить. Провайдер можно удалить только если к нему не привязаны активные модели в каталоге.`)) {
      return;
    }
    
    deleteProviderMutation.mutate(selectedProvider.id);
  };

  const testCredentialsMutation = useMutation<TestCredentialsResult, TestCredentialsError>({
    mutationFn: async () => {
      form.clearErrors();

      const values = form.getValues();
      const providerType = values.providerType;
      const tokenUrl = values.tokenUrl.trim();
      const embeddingsUrl = values.embeddingsUrl.trim();
      let authorizationKey = values.authorizationKey.trim();
      const scope = values.scope.trim();
      const model = values.model.trim();

      // Если поле пустое и есть сохранённый ключ, загружаем его
      if (!authorizationKey && selectedProvider?.hasAuthorizationKey) {
        if (!loadedAuthKey) {
          // Загружаем ключ
          try {
            const response = await apiRequest("GET", `/api/embedding/services/${selectedProvider.id}/key`);
            if (!response.ok) {
              throw new Error("Не удалось загрузить ключ");
            }
            const data = (await response.json()) as { authorizationKey: string };
            authorizationKey = data.authorizationKey;
            setLoadedAuthKey(authorizationKey);
          } catch (error) {
            const message = error instanceof Error ? error.message : "Не удалось загрузить ключ авторизации";
            form.setError("authorizationKey", { type: "manual", message });
            throw new Error(message);
          }
        } else {
          authorizationKey = loadedAuthKey;
        }
      }

      if (providerType !== "unica" && !tokenUrl) {
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
        const message = isUnicaProvider ? "Укажите API ключ" : "Укажите Authorization key";
        form.setError("authorizationKey", { type: "manual", message });
        throw new Error(message);
      }

      if (providerType !== "unica" && !scope) {
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
            providerType,
            tokenUrl,
            embeddingsUrl,
            authorizationKey,
            scope,
            model,
            allowSelfSignedCertificate: values.allowSelfSignedCertificate,
            requestHeaders,
            testText: testEmbeddingText.trim() || undefined,
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
    modelsArray.replace(templateValues.availableModels ?? []);
    setIsAuthorizationVisible(false);
    setDebugSteps(buildDebugSteps());
    setActiveTab("settings");
  };

  const handleProviderTypeChange = (value: string) => {
    const type = value as EmbeddingProviderType;
    form.setValue("providerType", type);

    if (isCreating) {
      const templateValues = buildTemplateValues(type);
      form.reset(templateValues);
      modelsArray.replace(templateValues.availableModels ?? []);
    }
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

  const handleToggleAuthorizationVisibility = async () => {
    // Если показываем ключ и ещё не загружен
    if (!isAuthorizationVisible && selectedProvider && !loadedAuthKey) {
      setIsLoadingKey(true);
      try {
        const response = await apiRequest("GET", `/api/embedding/services/${selectedProvider.id}/key`);
        if (!response.ok) {
          throw new Error("Не удалось загрузить ключ");
        }
        const data = (await response.json()) as { authorizationKey: string };
        setLoadedAuthKey(data.authorizationKey);
        form.setValue("authorizationKey", data.authorizationKey);
      } catch (error) {
        toast({
          title: "Ошибка загрузки ключа",
          description: error instanceof Error ? error.message : "Не удалось загрузить ключ авторизации",
          variant: "destructive",
        });
        setIsLoadingKey(false);
        return;
      }
      setIsLoadingKey(false);
    }
    
    setIsAuthorizationVisible((previous) => !previous);
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
                <Select onValueChange={handleProviderTypeChange} value={field.value} disabled={isViewMode}>
                  <SelectTrigger>
                    <SelectValue placeholder="Выберите провайдера" />
                  </SelectTrigger>
                  <SelectContent>
                    {embeddingProviderTypes.map((type) => (
                      <SelectItem key={type} value={type}>
                        {type === "gigachat" ? "GigaChat" : type === "unica" ? "Unica AI" : type}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormControl>
              <FormDescription>
                Определяет преднастроенные параметры интеграции.
                {isGigachatProvider && " Для GigaChat мы подставим рабочие URL, scope и модель."}
                {isUnicaProvider && " Для Unica AI мы подставим модель по умолчанию."}
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
                <Switch checked={field.value} onCheckedChange={field.onChange} disabled={isViewMode} />
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
                <FormLabel className="text-sm">Глобальный сервис</FormLabel>
                <FormDescription className="text-xs">
                  Глобальные сервисы доступны всем пользователям системы.
                </FormDescription>
              </div>
              <FormControl>
                <Switch checked={field.value} onCheckedChange={field.onChange} disabled={isViewMode} />
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
                <Input
                  {...field}
                  placeholder={
                    isGigachatProvider
                      ? "Например, GigaChat Embeddings Prod"
                      : isUnicaProvider
                        ? "Например, Unica AI bge-m3"
                        : "Введите название сервиса"
                  }
                  required
                  disabled={isViewMode}
                />
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
                <Input {...field} placeholder="Для чего используется этот сервис" disabled={isViewMode} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {!isUnicaProvider && (
          <FormField
            control={form.control}
            name="tokenUrl"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Endpoint для Access Token</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    placeholder={
                      isGigachatProvider
                        ? "https://ngw.devices.sberbank.ru:9443/api/v2/oauth"
                        : "https://auth.example.com/oauth2/token"
                    }
                    required
                    disabled={isViewMode}
                  />
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
        )}

        <FormField
          control={form.control}
          name="embeddingsUrl"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Endpoint эмбеддингов</FormLabel>
              <FormControl>
                <Input
                  {...field}
                  placeholder={
                    isGigachatProvider
                      ? "https://gigachat.devices.sberbank.ru/api/v1/embeddings"
                      : "https://api.example.com/v1/embeddings"
                  }
                  required
                  disabled={isViewMode}
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
            <FormLabel>{isUnicaProvider ? "API ключ" : "Authorization key"}</FormLabel>
            <FormControl>
              <div className="relative">
                <Input
                  {...field}
                  type={isAuthorizationVisible ? "text" : "password"}
                  placeholder={
                    !isCreating && selectedProvider?.hasAuthorizationKey 
                      ? (isUnicaProvider ? "Ключ сохранен. Оставьте пустым, чтобы не менять" : "Ключ сохранен. Оставьте пустым, чтобы не менять")
                      : (isUnicaProvider ? "Введите API ключ Unica AI" : "Значение заголовка Authorization")
                  }
                  autoComplete="new-password"
                  className="pr-10"
                  disabled={isViewMode}
                />
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="absolute inset-y-0 right-0 h-full px-3 text-muted-foreground"
                  onClick={handleToggleAuthorizationVisibility}
                  disabled={isLoadingKey}
                  aria-label={isAuthorizationVisible ? (isUnicaProvider ? "Скрыть API ключ" : "Скрыть Authorization key") : (isUnicaProvider ? "Показать API ключ" : "Показать Authorization key")}
                >
                  {isLoadingKey ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : isAuthorizationVisible ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </FormControl>
            <FormDescription>
              {isUnicaProvider ? (
                "API ключ для авторизации запросов к Unica AI."
              ) : isGigachatProvider ? (
                <>
                  Скопируйте готовый ключ из личного кабинета GigaChat (формат <code>Basic &lt;token&gt;</code>).
                </>
              ) : (
                "Вставьте значение заголовка Authorization, которое требуется для получения токена."
              )}
              {!isCreating && selectedProvider?.hasAuthorizationKey && (
                <span className="block mt-1 text-emerald-600 text-xs">
                  ✓ Ключ сохранен. Оставьте поле пустым, чтобы сохранить текущий ключ, или введите новый для обновления.
                </span>
              )}
            </FormDescription>
            <div className="flex flex-col gap-3 pt-2">
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Input
                    value={testEmbeddingText}
                    onChange={(e) => setTestEmbeddingText(e.target.value)}
                    placeholder="Текст для тестовой векторизации"
                    className="max-w-xs"
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => testCredentialsMutation.mutate()}
                    disabled={testCredentialsMutation.isPending || !testEmbeddingText.trim()}
                  >
                    {testCredentialsMutation.isPending ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Проверяем...
                      </>
                    ) : (
                      <>
                        <ShieldCheck className="mr-2 h-4 w-4" /> Проверить
                      </>
                    )}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Введите текст для тестовой векторизации. Результат покажет размерность вектора и первые 10 значений.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
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

              {testCredentialsMutation.isSuccess && testCredentialsMutation.data?.vectorPreview && (
                <div className="rounded-lg border bg-muted/30 p-4">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-3">
                    Результат векторизации
                  </p>
                  <div className="space-y-2 text-sm">
                    <p>
                      <span className="text-muted-foreground">Текст:</span>{" "}
                      <span className="font-medium">"{testCredentialsMutation.data.testText}"</span>
                    </p>
                    <p>
                      <span className="text-muted-foreground">Размерность:</span>{" "}
                      <span className="font-medium">{testCredentialsMutation.data.vectorSize}</span>
                    </p>
                    <p>
                      <span className="text-muted-foreground">Токенов:</span>{" "}
                      <span className="font-medium">
                        {testCredentialsMutation.data.usageTokens ?? "—"}
                      </span>
                    </p>
                    <div>
                      <span className="text-muted-foreground">Вектор (первые 10 значений):</span>
                      <code className="block mt-1 text-xs bg-background p-2 rounded overflow-x-auto border">
                        [{testCredentialsMutation.data.vectorPreview.map((n) => n.toFixed(6)).join(", ")}
                        {(testCredentialsMutation.data.vectorSize ?? 0) > 10 ? ", ..." : ""}]
                      </code>
                    </div>
                  </div>
                </div>
              )}
            </div>
            <FormMessage />
          </FormItem>
        )}
      />

      <div className="grid gap-4 md:grid-cols-2">
        {!isUnicaProvider && (
          <FormField
            control={form.control}
            name="scope"
            render={({ field }) => (
              <FormItem>
                <FormLabel>OAuth scope</FormLabel>
                <FormControl>
                  <Input {...field} placeholder="GIGACHAT_API_PERS" required disabled={isViewMode} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        )}

        <FormField
          control={form.control}
          name="model"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Модель по умолчанию</FormLabel>
              <FormControl>
                <Select onValueChange={field.onChange} value={field.value} disabled={isViewMode}>
                  <SelectTrigger>
                    <SelectValue placeholder="Выберите модель" />
                  </SelectTrigger>
                  <SelectContent>
                    {providerCatalogOptions.length > 0 || modelsArray.fields.length > 0 ? (
                      <>
                        {providerCatalogOptions.map((opt) => (
                          <SelectItem key={opt.value} value={opt.value}>
                            {opt.label}
                          </SelectItem>
                        ))}
                        {/* Также показываем модели из локального списка, которых нет в каталоге */}
                        {modelsArray.fields
                          .filter((m) => !providerCatalogOptions.some((opt) => opt.value === m.value))
                          .map((m, index) => (
                            <SelectItem key={m.value || index} value={m.value}>
                              {m.label || m.value}
                            </SelectItem>
                          ))}
                      </>
                    ) : (
                      <div className="p-2 text-sm text-muted-foreground text-center">
                        Моделей нет. Добавьте их в списке ниже.
                      </div>
                    )}
                  </SelectContent>
                </Select>
              </FormControl>
              <FormDescription>
                {providerCatalogOptions.length > 0
                  ? "Выберите модель из каталога для этого провайдера."
                  : "Введите идентификатор модели. Рекомендуется сперва добавить модели в список ниже."}
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="md:col-span-2 space-y-3 mt-4">
          <div className="flex items-center justify-between">
            <FormLabel>Список доступных моделей</FormLabel>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 gap-2"
              onClick={() => modelsArray.append({ label: "", value: "" })}
              disabled={isViewMode}
            >
              <Sparkles className="h-3.5 w-3.5" /> Добавить модель
            </Button>
          </div>
          <FormDescription>
            Эти модели будут автоматически добавлены в общий каталог и привязаны к этому провайдеру.
          </FormDescription>
          <div className="space-y-3">
            {modelsArray.fields.map((modelField, index) => (
              <div key={modelField.id} className="grid gap-2 md:grid-cols-[minmax(0,1.fr)_minmax(0,1fr)_auto] items-start">
                <FormField
                  control={form.control}
                  name={`availableModels.${index}.label`}
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-[10px] uppercase text-muted-foreground">Название (для UI)</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="Например, BGE-M3" disabled={isViewMode} />
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
                      <FormLabel className="text-[10px] uppercase text-muted-foreground">Ключ (ID модели)</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="Например, bge-m3" disabled={isViewMode} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="mt-7 h-9 w-9 text-muted-foreground hover:text-destructive"
                  onClick={() => modelsArray.remove(index)}
                  disabled={isViewMode}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
            {modelsArray.fields.length === 0 && (
              <div className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
                Список моделей пуст. Добавьте хотя бы одну модель для корректной работы.
              </div>
            )}
          </div>
        </div>

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
                  disabled={isViewMode}
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
              <Switch checked={field.value} onCheckedChange={field.onChange} disabled={isViewMode} />
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
              <Textarea {...field} spellCheck={false} rows={4} placeholder='{"Accept": "application/json"}' disabled={isViewMode} />
            </FormControl>
            <FormDescription>
              JSON-объект со строковыми значениями. Добавьте заголовки только если они требуются вашим API.
            </FormDescription>
            <FormMessage />
          </FormItem>
        )}
      />

      <div className="flex flex-wrap items-center gap-2 justify-end">
        {isViewMode ? (
          <Button type="button" onClick={handleStartEdit}>
            Редактировать
          </Button>
        ) : (
          <>
            <Button type="button" onClick={isCreating ? handleCreate : handleUpdate} disabled={isSubmitPending}>
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
            
            {!isCreating && (
              <Button 
                type="button" 
                variant="outline"
                onClick={handleCancelEdit}
                disabled={isSubmitPending}
              >
                Отмена
              </Button>
            )}
          </>
        )}
        
        {!isCreating && selectedProvider && (
          <Button 
            type="button" 
            variant="destructive" 
            onClick={handleDelete}
            disabled={deleteProviderMutation.isPending}
          >
            {deleteProviderMutation.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Удаление...
              </>
            ) : (
              <>
                <Trash2 className="mr-2 h-4 w-4" />
                Удалить провайдера
              </>
            )}
          </Button>
        )}
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
          мы автоматически подставим рабочие URL, scope и модель, если это предусмотрено шаблоном.
        </p>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1.9fr)] 2xl:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <Card className="h-fit">
          <CardHeader className="space-y-3 pb-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle>Сервисы эмбеддингов</CardTitle>
                <CardDescription>Выберите сервис или создайте новый по шаблону.</CardDescription>
              </div>
              <Button size="sm" onClick={handleStartCreate} disabled={isSubmitPending} className="gap-2">
                <Sparkles className="h-4 w-4" /> Добавить сервис
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Шаблоны помогут быстро заполнить URL, scope и модель для известных провайдеров.
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
                <p className="mb-3">Сервисы ещё не настроены. Создайте новый сервис по готовому шаблону.</p>
                <Button size="sm" onClick={handleStartCreate} disabled={isSubmitPending} className="mb-2">
                  Добавить сервис
                </Button>
                <p className="text-xs">Мы автоматически подставим URL, scope и модель, если это предусмотрено шаблоном.</p>
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
                          {provider.model && (
                            <span className={cn("text-[11px]", catalogByKey.get(provider.model) ? "text-muted-foreground" : "text-destructive")}>
                              {catalogByKey.get(provider.model)
                                ? `${catalogByKey.get(provider.model)?.displayName} · ${catalogByKey.get(provider.model)?.costLevel}`
                                : "Нет в каталоге"}
                            </span>
                          )}
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
                      {provider.availableModels && provider.availableModels.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-2">
                          {provider.availableModels.slice(0, 4).map((model: { label: string; value: string }) => (
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
                ? `Автозаполнили шаблон ${watchedProviderType === "gigachat" ? "GigaChat" : watchedProviderType === "unica" ? "Unica AI" : watchedProviderType}: проверьте данные и сохраните.`
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
              {isUnicaProvider && (
                <Alert className="mb-6">
                  <Info className="h-4 w-4" />
                  <AlertTitle>Unica AI Embeddings</AlertTitle>
                  <AlertDescription>
                    Unica AI использует API-ключ для авторизации (без OAuth). 
                    Укажите URL эндпоинта эмбеддингов и API-ключ.
                    Модель по умолчанию: <code className="text-sm">bge-m3</code>.
                  </AlertDescription>
                </Alert>
              )}
              {isCreating ? (
                settingsFormContent
              ) : !selectedProvider ? (
                <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
                  Выберите сервис слева или нажмите «Добавить сервис», чтобы создать новый по шаблону.
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
