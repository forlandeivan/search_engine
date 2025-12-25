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
import { ApiError } from "@/lib/queryClient";
import { DEFAULT_INDEXING_RULES, indexingRulesSchema, type IndexingRulesDto } from "@shared/indexing-rules";

const formSchema = indexingRulesSchema.refine(
  (value) => value.chunkOverlap < value.chunkSize,
  {
    path: ["chunkOverlap"],
    message: "Перекрытие должно быть меньше размера чанка",
  },
);

export default function AdminIndexingRulesPage() {
  const { data, isLoading, isError, error, refetch } = useIndexingRules();
  const updateMutation = useUpdateIndexingRules();
  const providersQuery = useEmbeddingProviders();
  const { toast } = useToast();
  const [isEditing, setIsEditing] = useState(false);

  const form = useForm<IndexingRulesDto>({
    resolver: zodResolver(formSchema),
    mode: "onChange",
    defaultValues: data ?? { ...DEFAULT_INDEXING_RULES },
  });

  useEffect(() => {
    if (data) {
      form.reset(data);
    }
  }, [data, form]);

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      const updated = await updateMutation.mutateAsync(values);
      form.reset(updated);
      setIsEditing(false);
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

  const disableInputs = !isEditing || updateMutation.isPending;
  const providerFieldDisabled = disableInputs || providersQuery.isLoading || providersQuery.isError;

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
              {!isEditing ? (
                <>
                  <Button variant="outline" size="sm" type="button" onClick={() => refetch()}>
                    <RefreshCw className="h-4 w-4 mr-2" />
                    Обновить
                  </Button>
                  <Button
                    size="sm"
                    type="button"
                    onClick={() => setIsEditing(true)}
                    data-testid="indexing-rules-edit"
                  >
                    <Pencil className="h-4 w-4 mr-2" />
                    Изменить
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    type="button"
                    onClick={() => {
                      form.reset(data ?? { ...DEFAULT_INDEXING_RULES });
                      setIsEditing(false);
                    }}
                    data-testid="indexing-rules-cancel"
                    disabled={updateMutation.isPending}
                  >
                    <XCircle className="h-4 w-4 mr-2" />
                    Отмена
                  </Button>
                  <Button
                    size="sm"
                    type="button"
                    onClick={onSubmit}
                    disabled={updateMutation.isPending}
                    data-testid="indexing-rules-save"
                  >
                    {updateMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    Сохранить
                  </Button>
                </>
              )}
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
                          <Input
                            id="indexing-embeddings-model"
                            placeholder="text-embedding-3-small"
                            disabled={disableInputs}
                            value={field.value ?? ""}
                            onChange={(event) => field.onChange(event.target.value)}
                          />
                        </FormControl>
                        <FormDescription>Ключ модели как в настройках провайдера.</FormDescription>
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
                            min={1}
                            step={1}
                            disabled={disableInputs}
                            value={field.value ?? ""}
                            onChange={(event) => {
                              const raw = event.target.value;
                              field.onChange(raw === "" ? undefined : Number(raw));
                            }}
                          />
                        </FormControl>
                        <FormDescription>Количество символов в одном чанке.</FormDescription>
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
                            step={1}
                            disabled={disableInputs}
                            value={field.value ?? ""}
                            onChange={(event) => {
                              const raw = event.target.value;
                              field.onChange(raw === "" ? undefined : Number(raw));
                            }}
                          />
                        </FormControl>
                        <FormDescription>Сколько символов повторяется между чанками.</FormDescription>
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
                            min={1}
                            step={1}
                            disabled={disableInputs}
                            value={field.value ?? ""}
                            onChange={(event) => {
                              const raw = event.target.value;
                              field.onChange(raw === "" ? undefined : Number(raw));
                            }}
                          />
                        </FormControl>
                        <FormDescription>Сколько фрагментов возвращать из поиска.</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="relevanceThreshold"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel htmlFor="indexing-relevance-threshold">Порог релевантности (0..1)</FormLabel>
                        <FormControl>
                          <Input
                            id="indexing-relevance-threshold"
                            type="number"
                            min={0}
                            max={1}
                            step={0.01}
                            disabled={disableInputs}
                            value={field.value ?? ""}
                            onChange={(event) => {
                              const raw = event.target.value;
                              field.onChange(raw === "" ? undefined : Number(raw));
                            }}
                          />
                        </FormControl>
                        <FormDescription>Чанки ниже этого порога будут отфильтрованы.</FormDescription>
                        <FormMessage />
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
                        <FormDescription>Платформа будет возвращать ссылки на источники (если поддерживается).</FormDescription>
                      </div>
                      <FormControl>
                        <Switch
                          checked={field.value}
                          onCheckedChange={field.onChange}
                          disabled={disableInputs}
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
