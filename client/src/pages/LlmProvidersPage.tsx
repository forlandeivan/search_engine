import { useMemo, useState } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { z } from "zod";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Sparkles, Loader2, Trash2, Eye, EyeOff } from "lucide-react";

import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

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
  DEFAULT_LLM_RESPONSE_CONFIG,
  type InsertLlmProvider,
  type PublicLlmProvider,
} from "@shared/schema";

const requestHeadersSchema = z.record(z.string());

const formatJson = (value: unknown) => JSON.stringify(value, null, 2);

const defaultRequestHeaders: Record<string, string> = {};

const defaultFormValues = {
  providerType: "gigachat" as (typeof llmProviderTypes)[number],
  name: "GigaChat",
  description: "",
  isActive: true,
  tokenUrl: "https://ngw.devices.sberbank.ru:9443/api/v2/oauth",
  completionUrl: "https://gigachat.devices.sberbank.ru/api/v1/chat/completions",
  authorizationKey: "",
  scope: "GIGACHAT_API_PERS",
  model: "GigaChat",
  availableModels: [
    { label: "Lite", value: "GigaChat-Lite" },
    { label: "Pro", value: "GigaChat-Pro" },
    { label: "Max", value: "GigaChat-Max" },
  ],
  allowSelfSignedCertificate: true,
  requestHeaders: formatJson(defaultRequestHeaders),
  systemPrompt:
    "Ты — помощник для базы знаний. Отвечай на вопросы пользователя на основе предоставленных фрагментов контента. Если в фрагментах нет ответа, честно сообщи об этом.",
  temperature: "0.2",
  maxTokens: "1024",
  topP: "",
  presencePenalty: "",
  frequencyPenalty: "",
};

type FormValues = typeof defaultFormValues;

type ProvidersResponse = { providers: PublicLlmProvider[] };

type CreateLlmProviderVariables = {
  payload: InsertLlmProvider;
  formattedRequestHeaders: string;
};

type ToggleProviderVariables = { id: string; isActive: boolean };

type DeleteProviderVariables = { id: string };

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

export default function LlmProvidersPage() {
  const { toast } = useToast();
  const [isAuthorizationVisible, setIsAuthorizationVisible] = useState(false);

  const form = useForm<FormValues>({
    defaultValues: defaultFormValues,
  });

  const modelsArray = useFieldArray({ control: form.control, name: "availableModels" });

  const providersQuery = useQuery<ProvidersResponse>({
    queryKey: ["/api/llm/providers"],
  });

  const createProviderMutation = useMutation<
    { provider: PublicLlmProvider },
    Error,
    CreateLlmProviderVariables
  >({
    mutationFn: async ({ payload }) => {
      const response = await apiRequest("POST", "/api/llm/providers", payload);
      if (!response.ok) {
        const body = (await response.json()) as { message?: string };
        throw new Error(body.message ?? "Не удалось создать провайдера LLM");
      }
      return (await response.json()) as { provider: PublicLlmProvider };
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/llm/providers"] });
      toast({
        title: "Провайдер сохранён",
        description: "Настройки LLM успешно добавлены.",
      });

      const currentValues = form.getValues();
      form.reset({
        ...currentValues,
        description: "",
        authorizationKey: currentValues.authorizationKey,
        requestHeaders: variables.formattedRequestHeaders,
      });
      setIsAuthorizationVisible(false);
    },
    onError: (error) => {
      toast({
        title: "Не удалось сохранить провайдера",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const toggleProviderMutation = useMutation<
    { provider: PublicLlmProvider },
    Error,
    ToggleProviderVariables
  >({
    mutationFn: async ({ id, isActive }) => {
      const response = await apiRequest("PUT", `/api/llm/providers/${id}`, { isActive });
      if (!response.ok) {
        const body = (await response.json()) as { message?: string };
        throw new Error(body.message ?? "Не удалось обновить статус провайдера");
      }
      return (await response.json()) as { provider: PublicLlmProvider };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/llm/providers"] });
    },
    onError: (error) => {
      toast({
        title: "Ошибка",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const deleteProviderMutation = useMutation<
    void,
    Error,
    DeleteProviderVariables
  >({
    mutationFn: async ({ id }) => {
      const response = await apiRequest("DELETE", `/api/llm/providers/${id}`);
      if (!response.ok) {
        const body = (await response.json()) as { message?: string };
        throw new Error(body.message ?? "Не удалось удалить провайдера");
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/llm/providers"] });
      toast({ title: "Провайдер удалён" });
    },
    onError: (error) => {
      toast({
        title: "Ошибка",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleCreate = form.handleSubmit((values) => {
    form.clearErrors();

    try {
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

      const payload: InsertLlmProvider = {
        providerType: values.providerType,
        name: values.name.trim(),
        description: values.description.trim() ? values.description.trim() : undefined,
        isActive: values.isActive,
        tokenUrl: values.tokenUrl.trim(),
        completionUrl: values.completionUrl.trim(),
        authorizationKey: values.authorizationKey.trim(),
        scope: values.scope.trim(),
        model: modelName,
        allowSelfSignedCertificate: values.allowSelfSignedCertificate,
        requestHeaders,
        requestConfig: {
          modelField: "model",
          messagesField: "messages",
          systemPrompt: values.systemPrompt.trim(),
          temperature: Number.isNaN(temperature) ? 0.2 : temperature,
          maxTokens: Number.isNaN(maxTokens) ? 1024 : maxTokens,
          topP: topP && !Number.isNaN(topP) ? topP : undefined,
          presencePenalty:
            presencePenalty && !Number.isNaN(presencePenalty) ? presencePenalty : undefined,
          frequencyPenalty:
            frequencyPenalty && !Number.isNaN(frequencyPenalty) ? frequencyPenalty : undefined,
          additionalBodyFields: {},
        },
        responseConfig: { ...DEFAULT_LLM_RESPONSE_CONFIG },
        availableModels: sanitizedAvailableModels,
      } satisfies InsertLlmProvider;

      const formattedRequestHeaders = formatJson(requestHeaders);

      createProviderMutation.mutate({ payload, formattedRequestHeaders });
    } catch (error) {
      toast({
        title: "Не удалось подготовить данные",
        description: error instanceof Error ? error.message : "Исправьте ошибки и попробуйте снова.",
        variant: "destructive",
      });
    }
  });

  const providers = useMemo(() => providersQuery.data?.providers ?? [], [providersQuery.data]);

  return (
    <div className="space-y-6 p-6">
      <div className="space-y-2">
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          <Sparkles className="h-5 w-5 text-primary" /> Управление LLM
        </h1>
        <p className="text-muted-foreground max-w-3xl">
          Подключите внешние LLM по API, чтобы формировать ответы на основе результатов поиска в Qdrant. Первый шаблон
          настроен для GigaChat от СберБанка.
        </p>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1.2fr)]">
        <Card>
          <CardHeader>
            <CardTitle>Новый провайдер LLM</CardTitle>
            <CardDescription>
              Укажите параметры авторизации и подключения. Системный промпт и параметры генерации можно адаптировать под ваши задачи.
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
                              {llmProviderTypes.map((type) => (
                                <SelectItem key={type} value={type}>
                                  {type === "gigachat" ? "GigaChat" : "Другой сервис"}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </FormControl>
                        <FormDescription>Определяет преднастроенные значения формы.</FormDescription>
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
                              required
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
                              {isAuthorizationVisible ? (
                                <EyeOff className="h-4 w-4" />
                              ) : (
                                <Eye className="h-4 w-4" />
                              )}
                            </Button>
                          </div>
                        </FormControl>
                        <FormDescription>
                          Ключ используется для запроса access_token. Формат зависит от провайдера (Basic, Bearer и т.д.).
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
                          Эта модель будет использоваться, если пользователь не выберет другой вариант.
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <div className="md:col-span-2 space-y-3">
                    <FormLabel>Доступные модели для выбора</FormLabel>
                    <FormDescription>
                      Список отображается в интерфейсе генеративного поиска. Пользователь сможет выбрать нужный вариант модели.
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
                                  <Input {...field} placeholder="Например, Lite" />
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
                                  <Input {...field} placeholder="Например, GigaChat-Lite" />
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
                        <FormLabel>Максимум токенов</FormLabel>
                        <FormControl>
                          <Input {...field} type="number" min="128" max="4096" />
                        </FormControl>
                        <FormDescription>Сколько токенов можно потратить на ответ.</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="topP"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Top P (опционально)</FormLabel>
                        <FormControl>
                          <Input {...field} type="number" step="0.05" min="0" max="1" placeholder="Например, 0.9" />
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
                      <FormDescription>JSON-объект с заголовками, которые будут добавлены к запросам LLM.</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="flex items-center gap-2">
                  <Button type="submit" className="min-w-[140px]" disabled={createProviderMutation.isPending}>
                    {createProviderMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Сохранить провайдера
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => form.reset(defaultFormValues)}
                    disabled={createProviderMutation.isPending}
                  >
                    Сбросить значения
                  </Button>
                </div>
              </form>
            </Form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Подключённые провайдеры</CardTitle>
            <CardDescription>
              Управляйте активностью и удаляйте провайдеров. Секреты хранятся в базе данных.
            </CardDescription>
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
              <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
                Провайдеры ещё не настроены.
              </div>
            ) : (
              providers.map((provider) => {
                return (
                  <div key={provider.id} className="rounded-lg border p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-col">
                        <div className="flex items-center gap-2">
                          <span className="text-base font-semibold text-foreground">{provider.name}</span>
                          <Badge variant="outline">{provider.providerType}</Badge>
                          <Badge variant={provider.isActive ? "default" : "secondary"}>
                            {provider.isActive ? "Активен" : "Отключён"}
                          </Badge>
                          <Badge variant="outline">
                            По умолчанию: {provider.model}
                          </Badge>
                        </div>
                        {provider.availableModels.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1 text-xs text-muted-foreground">
                            {provider.availableModels.map((model) => (
                              <Badge key={model.value} variant="secondary" className="bg-muted text-foreground">
                                {model.label} · {model.value}
                              </Badge>
                            ))}
                          </div>
                        )}
                        {provider.description && (
                          <p className="text-sm text-muted-foreground">{provider.description}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={provider.isActive}
                          onCheckedChange={(checked) =>
                            toggleProviderMutation.mutate({ id: provider.id, isActive: Boolean(checked) })
                          }
                          disabled={toggleProviderMutation.isPending}
                        />
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          onClick={() => {
                            if (deleteProviderMutation.isPending) {
                              return;
                            }
                            if (window.confirm(`Удалить провайдера «${provider.name}»?`)) {
                              deleteProviderMutation.mutate({ id: provider.id });
                            }
                          }}
                          aria-label={`Удалить провайдера ${provider.name}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>

                    <div className="mt-3 grid gap-2 text-xs text-muted-foreground md:grid-cols-2">
                      <div className="space-y-1">
                        <span className="font-medium text-foreground">Endpoint токена</span>
                        <p className="break-all">{provider.tokenUrl}</p>
                      </div>
                      <div className="space-y-1">
                        <span className="font-medium text-foreground">Endpoint LLM</span>
                        <p className="break-all">{provider.completionUrl}</p>
                      </div>
                      <div className="space-y-1">
                        <span className="font-medium text-foreground">Scope</span>
                        <p>{provider.scope}</p>
                      </div>
                      <div className="space-y-1">
                        <span className="font-medium text-foreground">Секрет</span>
                        <p>{provider.hasAuthorizationKey ? "Сохранён" : "Не указан"}</p>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
