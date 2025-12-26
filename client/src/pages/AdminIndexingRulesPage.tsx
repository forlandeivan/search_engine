import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, RefreshCw, Pencil, XCircle } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useIndexingRules, useUpdateIndexingRules } from "@/hooks/useIndexingRules";
import { useEmbeddingProviders } from "@/hooks/useEmbeddingProviders";
import { useEmbeddingProviderModels } from "@/hooks/useEmbeddingProviderModels";
import { ApiError } from "@/lib/queryClient";
import {
  DEFAULT_INDEXING_RULES,
  MAX_CHUNK_SIZE,
  MIN_CHUNK_SIZE,
  MAX_RELEVANCE_THRESHOLD,
  MAX_TOP_K,
  MIN_RELEVANCE_THRESHOLD,
  MIN_TOP_K,
  indexingRulesSchema,
  type IndexingRulesDto,
} from "@shared/indexing-rules";

const formSchema = indexingRulesSchema.refine(
  (value) => value.chunkOverlap < value.chunkSize,
  {
    path: ["chunkOverlap"],
    message: "Перекрытие должно быть меньше размера чанка",
  },
);

const STRICT_THRESHOLD_WARNING = 0.8;

export default function AdminIndexingRulesPage() {
  const { data, isLoading, isError, error, refetch } = useIndexingRules();
  const updateMutation = useUpdateIndexingRules();
  const providersQuery = useEmbeddingProviders();
  const { toast } = useToast();
  const [baseline, setBaseline] = useState<IndexingRulesDto | null>(data ?? null);

  const form = useForm<IndexingRulesDto>({
    resolver: zodResolver(formSchema),
    mode: "onChange",
    defaultValues: data ?? { ...DEFAULT_INDEXING_RULES },
  });

  useEffect(() => {
    if (data && !form.formState.isDirty) {
      setBaseline(data);
      form.reset(data);
    }
  }, [data, form]);

  const selectedProviderId = form.watch("embeddingsProvider");
  const modelsQuery = useEmbeddingProviderModels(selectedProviderId, { enabled: Boolean(selectedProviderId) });
  const modelsInfo = modelsQuery.data;
  const supportsModelSelection = modelsInfo?.supportsModelSelection ?? true;
  const modelOptions = modelsInfo?.models ?? [];
  const modelsLoading = modelsQuery.isLoading || modelsQuery.isFetching;
  const modelsError = modelsQuery.isError;
  const chunkSizeValue = form.watch("chunkSize") ?? 0;
  const overlapMax = Math.max(0, chunkSizeValue - 1);
  const relevanceThresholdValue = form.watch("relevanceThreshold");
  const showStrictThresholdWarning =
    typeof relevanceThresholdValue === "number" && relevanceThresholdValue > STRICT_THRESHOLD_WARNING;

  useEffect(() => {
    if (!selectedProviderId) {
      return;
    }
    if (modelsLoading || !modelsInfo) {
      return;
    }

    if (!modelsInfo.supportsModelSelection) {
      const fallbackModel = modelsInfo.defaultModel ?? form.getValues("embeddingsModel") ?? "";
      if (fallbackModel && fallbackModel !== form.getValues("embeddingsModel")) {
        form.setValue("embeddingsModel", fallbackModel, { shouldValidate: true, shouldDirty: true });
      }
      return;
    }

    if (modelOptions.length > 0) {
      const currentModel = (form.getValues("embeddingsModel") ?? "").trim();
      const nextModel = currentModel && modelOptions.includes(currentModel) ? currentModel : modelOptions[0];
      if (nextModel !== currentModel) {
        form.setValue("embeddingsModel", nextModel, { shouldValidate: true, shouldDirty: true });
      }
    } else if (!form.getValues("embeddingsModel") && modelsInfo.defaultModel) {
      form.setValue("embeddingsModel", modelsInfo.defaultModel, { shouldValidate: true, shouldDirty: true });
    }
  }, [form, modelOptions, modelsInfo, modelsLoading, selectedProviderId]);

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      const updated = await updateMutation.mutateAsync(values);
      setBaseline(updated);
      form.reset(updated);
      toast({ title: "Сохранено", description: "Правила индексации обновлены" });
    } catch (err: unknown) {
      const apiErr = err as ApiError;
      const details = (apiErr?.details ?? {}) as Record<string, unknown>;
      const message =
        apiErr instanceof ApiError
          ? apiErr.message
          : err instanceof Error
            ? err.message
            : "Не удалось сохранить правила индексации";
      if (details?.field === "embeddings_provider") {
        form.setError("embeddingsProvider", { message });
      }
      if (details?.field === "embeddings_model") {
        form.setError("embeddingsModel", { message });
      }
      if (details?.field === "chunk_size") {
        form.setError("chunkSize", { message });
      }
      if (details?.field === "chunk_overlap") {
        form.setError("chunkOverlap", { message });
      }
      if (details?.field === "top_k") {
        form.setError("topK", { message });
      }
      if (details?.field === "relevance_threshold") {
        form.setError("relevanceThreshold", { message });
      }
      toast({ title: "Ошибка сохранения", description: message, variant: "destructive" });
    }
  });

  if (isLoading) {
    return (
      <div className="p-6 text-muted-foreground flex items-center gap-2">
        <Loader2 className="h-4 w-4 animate-spin" />
        Загружаем правила индексации...
      </div>
    );
  }

  if (isError) {
    const message = (error as Error)?.message ?? "Не удалось загрузить правила индексации";
    return (
      <div className="p-6">
        <Alert variant="destructive">
          <AlertTitle>Ошибка загрузки</AlertTitle>
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      </div>
    );
  }

  const disableInputs = updateMutation.isPending;
  const providerFieldDisabled = disableInputs || providersQuery.isLoading || providersQuery.isError;
  const modelRequiredMissing =
    supportsModelSelection && modelOptions.length > 0 && !(form.watch("embeddingsModel") ?? "").trim();
  const saveDisabled =
    updateMutation.isPending || modelRequiredMissing || !form.formState.isValid || !form.formState.isDirty;
  const canCancel = form.formState.isDirty && !updateMutation.isPending;

  const normalizeNumber = (value: string): number | "" => {
    const trimmed = value.replace(",", ".").trim();
    if (!trimmed) return "";
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : "";
  };

  const handleRefresh = async () => {
    if (form.formState.isDirty) {
      const confirmReload = window.confirm("Есть несохранённые изменения. Обновить и потерять правки?");
      if (!confirmReload) return;
    }
    await refetch();
  };

  const handleCancel = () => {
    const fallback = baseline ?? data ?? { ...DEFAULT_INDEXING_RULES };
    form.reset(fallback);
    form.clearErrors();
  };

  return (
    <div className="p-6 space-y-4">
      <header className="space-y-1">
        <CardTitle>Правила индексации</CardTitle>
        <CardDescription>
          Единый профиль для чанкования, эмбеддингов и поиска. Эти значения применяются ко всем документам навыков.
        </CardDescription>
      </header>

      <Card>
        <CardHeader className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <CardTitle>Профиль индексации</CardTitle>
              <CardDescription>Редактирование применится ко всем новым и переиндексируемым документам</CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" type="button" onClick={handleRefresh}>
                <RefreshCw className="h-4 w-4 mr-2" />
                Обновить
              </Button>
              <Button
                variant="outline"
                size="sm"
                type="button"
                onClick={handleCancel}
                data-testid="indexing-rules-cancel"
                disabled={!canCancel}
              >
                <XCircle className="h-4 w-4 mr-2" />
                Отменить
              </Button>
              <Button
                size="sm"
                type="button"
                onClick={onSubmit}
                disabled={saveDisabled}
                data-testid="indexing-rules-save"
              >
                {updateMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Сохранить
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form className="space-y-6" onSubmit={onSubmit}>
              <section className="space-y-4">
                <div>
                  <h3 className="text-lg font-semibold">Embeddings</h3>
                  <p className="text-sm text-muted-foreground">
                    Провайдер и модель, используемые для векторизации документов.
                  </p>
                </div>
                <div className="grid md:grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="embeddingsProvider"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel htmlFor="indexing-embeddings-provider">Провайдер эмбеддингов</FormLabel>
                        <FormControl>
                          <Select
                            disabled={providerFieldDisabled}
                            value={field.value}
                            onValueChange={(value) => {
                              form.clearErrors("embeddingsProvider");
                              form.clearErrors("embeddingsModel");
                              form.setValue("embeddingsModel", "", { shouldValidate: false, shouldDirty: true });
                              field.onChange(value);
                            }}
                          >
                            <SelectTrigger id="indexing-embeddings-provider">
                              <SelectValue
                                placeholder={
                                  providersQuery.isLoading
                                    ? "Загружаем провайдеры..."
                                    : providersQuery.isError
                                      ? "Не удалось загрузить провайдеры"
                                      : "Выберите провайдера"
                                }
                              />
                            </SelectTrigger>
                            <SelectContent>
                              {(providersQuery.data ?? []).map((provider) => (
                                <SelectItem
                                  key={provider.id}
                                  value={provider.id}
                                  disabled={!provider.isConfigured}
                                  aria-disabled={!provider.isConfigured}
                                >
                                  <div className="flex flex-col">
                                    <span>{provider.displayName}</span>
                                    <span className="text-xs text-muted-foreground">
                                      {provider.model}
                                      {!provider.isConfigured && provider.statusReason
                                        ? ` — ${provider.statusReason}`
                                        : !provider.isConfigured
                                          ? " — Не настроен"
                                          : ""}
                                    </span>
                                  </div>
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </FormControl>
                        {providersQuery.isError ? (
                          <FormDescription className="text-destructive">
                            Не удалось загрузить список провайдеров
                          </FormDescription>
                        ) : (
                          <FormDescription>
                            Выберите доступный провайдер. Не настроенные варианты недоступны.
                          </FormDescription>
                        )}
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="embeddingsModel"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel htmlFor="indexing-embeddings-model">Модель эмбеддингов</FormLabel>
                        <FormControl>
                          {supportsModelSelection && modelOptions.length > 0 ? (
                            <Select
                              value={field.value ?? ""}
                              disabled={disableInputs || modelsLoading || modelsError}
                              onValueChange={(value) => {
                                form.clearErrors("embeddingsModel");
                                field.onChange(value);
                              }}
                            >
                              <SelectTrigger id="indexing-embeddings-model">
                                <SelectValue
                                  placeholder={
                                    modelsLoading
                                      ? "Загружаем модели..."
                                      : modelsError
                                        ? "Не удалось загрузить модели"
                                        : "Выберите модель"
                                  }
                                />
                              </SelectTrigger>
                              <SelectContent>
                                {modelOptions.map((model) => (
                                  <SelectItem key={model} value={model}>
                                    {model}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          ) : (
                            <Input
                              id="indexing-embeddings-model"
                              placeholder="text-embedding-3-small"
                              disabled={disableInputs || modelsLoading || !supportsModelSelection}
                              value={field.value ?? ""}
                              onChange={(event) => {
                                form.clearErrors("embeddingsModel");
                                field.onChange(event.target.value);
                              }}
                            />
                          )}
                        </FormControl>
                        {modelsLoading ? (
                          <FormDescription>Загружаем модели выбранного провайдера…</FormDescription>
                        ) : modelsError ? (
                          <FormDescription className="text-destructive">
                            Не удалось загрузить список моделей. Введите модель вручную или попробуйте позже.
                          </FormDescription>
                        ) : !supportsModelSelection ? (
                          <FormDescription>
                            Провайдер использует модель по умолчанию: {modelsInfo?.defaultModel ?? "—"}.
                          </FormDescription>
                        ) : modelOptions.length > 0 ? (
                          <FormDescription>Выберите модель, доступную для выбранного провайдера.</FormDescription>
                        ) : (
                          <FormDescription>Список моделей недоступен, введите идентификатор модели вручную.</FormDescription>
                        )}
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </section>

              <Separator />

              <section className="space-y-4">
                <div>
                  <h3 className="text-lg font-semibold">Chunking</h3>
                  <p className="text-sm text-muted-foreground">Параметры разбиения текста на фрагменты.</p>
                </div>
                <div className="grid md:grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="chunkSize"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel htmlFor="indexing-chunk-size">Размер чанка</FormLabel>
                        <FormControl>
                          <Input
                            id="indexing-chunk-size"
                            type="number"
                            min={MIN_CHUNK_SIZE}
                            max={MAX_CHUNK_SIZE}
                            step={1}
                            disabled={disableInputs}
                            value={field.value ?? ""}
                            onChange={(event) => {
                              const raw = event.target.value;
                              const normalized = normalizeNumber(raw);
                              field.onChange(normalized === "" ? undefined : normalized);
                            }}
                          />
                        </FormControl>
                        <FormDescription>
                          Размер чанка в символах. Больше — меньше фрагментов и быстрее обработка, но ниже точность; меньше —
                          точнее, но дольше и дороже.
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="chunkOverlap"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel htmlFor="indexing-chunk-overlap">Перекрытие чанков</FormLabel>
                        <FormControl>
                          <Input
                            id="indexing-chunk-overlap"
                            type="number"
                            min={0}
                            max={overlapMax}
                            step={1}
                            disabled={disableInputs}
                            value={field.value ?? ""}
                            onChange={(event) => {
                              const raw = event.target.value;
                              const normalized = normalizeNumber(raw);
                              field.onChange(normalized === "" ? undefined : normalized);
                            }}
                          />
                        </FormControl>
                        <FormDescription>
                          Увеличивайте перекрытие, если важная мысль рвётся на границе чанков; уменьшайте, если обработка стала
                          дольше и дороже.
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </section>

              <Separator />

              <section className="space-y-4">
                <div>
                  <h3 className="text-lg font-semibold">Retrieval</h3>
                  <p className="text-sm text-muted-foreground">Параметры поиска релевантных чанков.</p>
                </div>
                <div className="grid md:grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="topK"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel htmlFor="indexing-top-k">Top K</FormLabel>
                        <FormControl>
                          <Input
                            id="indexing-top-k"
                            type="number"
                            min={MIN_TOP_K}
                            max={MAX_TOP_K}
                            step={1}
                            disabled={disableInputs}
                            value={field.value ?? ""}
                            onChange={(event) => {
                              const raw = event.target.value;
                              const normalized = normalizeNumber(raw);
                              field.onChange(normalized === "" ? undefined : normalized);
                            }}
                          />
                        </FormControl>
                        <FormDescription>
                          Сколько фрагментов возвращать из поиска. Больше — контекст полнее, но больше шума; меньше — чище, но можно
                          потерять важное.
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="relevanceThreshold"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel htmlFor="indexing-relevance-threshold">Порог релевантности</FormLabel>
                        <FormControl>
                          <Input
                            id="indexing-relevance-threshold"
                            type="number"
                            min={MIN_RELEVANCE_THRESHOLD}
                            max={MAX_RELEVANCE_THRESHOLD}
                            step={0.01}
                            disabled={disableInputs}
                            value={field.value ?? ""}
                            onChange={(event) => {
                              const raw = event.target.value;
                              const normalized = normalizeNumber(raw);
                              field.onChange(normalized === "" ? undefined : normalized);
                            }}
                          />
                        </FormControl>
                        <FormDescription>
                          Увеличивайте порог, если подтягивается нерелевантный текст; снижайте, если система часто “не находит”
                          ответы. Чанки ниже порога отфильтруем.
                        </FormDescription>
                        <FormMessage />
                        {showStrictThresholdWarning ? (
                          <Alert variant="warning" className="mt-2">
                            <AlertTitle>Слишком строгий порог</AlertTitle>
                            <AlertDescription>
                              Система может не находить подходящих фрагментов и отвечать без опоры на документы.
                            </AlertDescription>
                          </Alert>
                        ) : null}
                      </FormItem>
                    )}
                  />
                </div>
              </section>

              <Separator />

              <section className="space-y-4">
                <div>
                  <h3 className="text-lg font-semibold">Citations</h3>
                  <p className="text-sm text-muted-foreground">Глобальный флаг для включения цитирования.</p>
                </div>
                <FormField
                  control={form.control}
                  name="citationsEnabled"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                      <div className="space-y-0.5">
                        <FormLabel>Включить цитирование</FormLabel>
                        <FormDescription>
                          В MVP источники могут не отображаться, но настройка включает подготовку данных для цитирования в ответах.
                        </FormDescription>
                      </div>
                      <FormControl>
                        <Switch
                          checked={field.value}
                          onCheckedChange={field.onChange}
                          disabled={disableInputs}
                          data-testid="indexing-citations-toggle"
                        />
                      </FormControl>
                    </FormItem>
                  )}
                />
              </section>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
