import { useCallback, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

type ModelType = "LLM" | "EMBEDDINGS" | "ASR";
type ConsumptionUnit = "TOKENS_1K" | "MINUTES";
type CostLevel = "FREE" | "LOW" | "MEDIUM" | "HIGH" | "VERY_HIGH";
type AdminProviderType = "LLM" | "EMBEDDINGS";

type ProviderOption = {
  id: string;
  name: string;
  kind: AdminProviderType;
  providerType?: string | null;
};

type AdminModel = {
  id: string;
  modelKey: string;
  displayName: string;
  description: string | null;
  modelType: ModelType;
  consumptionUnit: ConsumptionUnit;
  costLevel: CostLevel;
  creditsPerUnit: number;
  isActive: boolean;
  sortOrder: number;
  createdAt?: string;
  updatedAt?: string;
  providerId?: string | null;
  providerType?: string | null;
  providerModelKey?: string | null;
};

const modelSchema = z.object({
  id: z.string().optional(),
  modelKey: z
    .string()
    .trim()
    .min(1, "Укажите ключ модели"),
  displayName: z
    .string()
    .trim()
    .min(1, "Введите название"),
  description: z
    .string()
    .trim()
    .max(500, "Слишком длинное описание")
    .optional(),
  modelType: z.enum(["LLM", "EMBEDDINGS", "ASR"]),
  consumptionUnit: z.enum(["TOKENS_1K", "MINUTES"]),
  costLevel: z.enum(["FREE", "LOW", "MEDIUM", "HIGH", "VERY_HIGH"]).default("MEDIUM"),
  creditsPerUnit: z.coerce
    .number()
    .min(0, "Не может быть отрицательным")
    .transform((value) => Math.floor(value)),
  isActive: z.boolean().default(true),
  sortOrder: z.coerce.number().default(0),
});

type ModelFormValues = z.infer<typeof modelSchema>;

const typeLabels: Record<ModelType, string> = {
  LLM: "LLM",
  EMBEDDINGS: "Embeddings",
  ASR: "ASR",
};

const unitLabels: Record<ConsumptionUnit, string> = {
  TOKENS_1K: "за 1000 токенов",
  MINUTES: "за минуту",
};

const costLevelLabels: Record<CostLevel, string> = {
  FREE: "Free",
  LOW: "Low",
  MEDIUM: "Medium",
  HIGH: "High",
  VERY_HIGH: "Very high",
};

function useAdminModels(filters: { providerId?: string; providerType?: string } = {}) {
  const queryParams = new URLSearchParams();
  if (filters.providerId) queryParams.set("providerId", filters.providerId);
  if (filters.providerType) queryParams.set("providerType", filters.providerType);

  return useQuery<AdminModel[]>({
    queryKey: ["/api/admin/models", filters.providerId ?? "all", filters.providerType ?? "all"],
    queryFn: async () => {
      const res = await apiRequest(
        "GET",
        `/api/admin/models${queryParams.toString() ? `?${queryParams.toString()}` : ""}`,
      );
      const data = (await res.json()) as { models: AdminModel[] };
      return data.models ?? [];
    },
  });
}

export default function AdminModelsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingModel, setEditingModel] = useState<AdminModel | null>(null);
  const [selectedProviderKind, setSelectedProviderKind] = useState<AdminProviderType | "ALL" | "NONE">("ALL");
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null);

  const modelsQuery = useAdminModels({
    providerId: selectedProviderId ?? undefined,
  });

  const llmProvidersQuery = useQuery<ProviderOption[]>({
    queryKey: ["/api/llm/providers"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/llm/providers");
      const data = (await res.json()) as { providers: { id: string; name: string; providerType?: string | null }[] };
      return (data.providers ?? []).map((p) => ({
        id: p.id,
        name: p.name,
        kind: "LLM" as const,
        providerType: p.providerType,
      }));
    },
  });

  const embeddingProvidersQuery = useQuery<ProviderOption[]>({
    queryKey: ["/api/embedding/services"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/embedding/services");
      const data = (await res.json()) as { providers: { id: string; name: string; providerType?: string | null }[] };
      return (data.providers ?? []).map((p) => ({
        id: p.id,
        name: p.name,
        kind: "EMBEDDINGS" as const,
        providerType: p.providerType,
      }));
    },
  });

  const form = useForm<ModelFormValues>({
    resolver: zodResolver(modelSchema),
    defaultValues: {
      modelType: "LLM",
      consumptionUnit: "TOKENS_1K",
      costLevel: "MEDIUM",
      creditsPerUnit: 0,
      isActive: true,
      sortOrder: 0,
    },
  });

  const resetForm = useCallback(
    (model?: AdminModel | null) => {
      if (!model) {
        form.reset({
          modelKey: "",
          displayName: "",
          description: "",
          modelType: "LLM",
          consumptionUnit: "TOKENS_1K",
          costLevel: "MEDIUM",
          creditsPerUnit: 0,
          isActive: true,
          sortOrder: 0,
        });
        return;
      }
      form.reset({
        id: model.id,
        modelKey: model.modelKey,
        displayName: model.displayName,
        description: model.description ?? "",
        modelType: model.modelType,
        consumptionUnit: model.consumptionUnit,
        costLevel: model.costLevel,
        creditsPerUnit: model.creditsPerUnit ?? 0,
        isActive: model.isActive,
        sortOrder: model.sortOrder ?? 0,
      });
    },
    [form],
  );

  const createMutation = useMutation({
    mutationFn: async (values: ModelFormValues) => {
      const payload = {
        modelKey: values.modelKey.trim(),
        displayName: values.displayName.trim(),
        description: values.description?.trim() || undefined,
        modelType: values.modelType,
        consumptionUnit: values.consumptionUnit,
        costLevel: values.costLevel,
        creditsPerUnit: values.creditsPerUnit,
        isActive: values.isActive,
        sortOrder: values.sortOrder,
      };
      const res = await apiRequest("POST", "/api/admin/models", payload);
      return await res.json();
    },
    onSuccess: () => {
      toast({ title: "Модель создана" });
      queryClient.invalidateQueries({
        predicate: (query) => Array.isArray(query.queryKey) && query.queryKey[0] === "/api/admin/models",
      });
      setDialogOpen(false);
      setEditingModel(null);
    },
    onError: (error: Error) => {
      toast({ title: "Не удалось сохранить", description: error.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (values: ModelFormValues) => {
      const payload = {
        displayName: values.displayName.trim(),
        description: values.description?.trim() || undefined,
        modelType: values.modelType,
        consumptionUnit: values.consumptionUnit,
        costLevel: values.costLevel,
        creditsPerUnit: values.creditsPerUnit,
        isActive: values.isActive,
        sortOrder: values.sortOrder,
      };
      const res = await apiRequest("PUT", `/api/admin/models/${values.id}`, payload);
      return await res.json();
    },
    onSuccess: () => {
      toast({ title: "Модель обновлена" });
      queryClient.invalidateQueries({
        predicate: (query) => Array.isArray(query.queryKey) && query.queryKey[0] === "/api/admin/models",
      });
      setDialogOpen(false);
      setEditingModel(null);
    },
    onError: (error: Error) => {
      toast({ title: "Не удалось сохранить", description: error.message, variant: "destructive" });
    },
  });

  const onSubmit = useCallback(
    (values: ModelFormValues) => {
      if (values.id) {
        updateMutation.mutate({ ...values, creditsPerUnit: values.creditsPerUnit <= 0 ? 0 : values.creditsPerUnit });
      } else {
        createMutation.mutate({ ...values, creditsPerUnit: values.creditsPerUnit <= 0 ? 0 : values.creditsPerUnit });
      }
    },
    [createMutation, updateMutation],
  );

  const openCreate = () => {
    setEditingModel(null);
    resetForm(null);
    setDialogOpen(true);
  };

  const openEdit = (model: AdminModel) => {
    setEditingModel(model);
    resetForm(model);
    setDialogOpen(true);
  };

  const models = modelsQuery.data ?? [];
  const providerOptions = useMemo(() => {
    const llm = llmProvidersQuery.data ?? [];
    const emb = embeddingProvidersQuery.data ?? [];
    return [...llm, ...emb].sort((a, b) => a.name.localeCompare(b.name));
  }, [llmProvidersQuery.data, embeddingProvidersQuery.data]);
  const providerKindById = useMemo(() => {
    const map = new Map<string, AdminProviderType>();
    for (const option of providerOptions) {
      map.set(option.id, option.kind);
    }
    return map;
  }, [providerOptions]);

  const filteredModels = useMemo(() => {
    let result = [...models];
    if (selectedProviderId) {
      result = result.filter((m) => m.providerId === selectedProviderId);
    } else if (selectedProviderKind === "NONE") {
      result = result.filter((m) => !m.providerId);
    } else if (selectedProviderKind === "LLM" || selectedProviderKind === "EMBEDDINGS") {
      result = result.filter((m) => {
        if (!m.providerId) return false;
        const kind = providerKindById.get(m.providerId);
        return kind === selectedProviderKind;
      });
    }
    return result;
  }, [models, selectedProviderId, selectedProviderKind, providerKindById]);

  const sortedModels = useMemo(
    () =>
      [...filteredModels].sort((a, b) => {
        if (a.sortOrder === b.sortOrder) return a.displayName.localeCompare(b.displayName);
        return a.sortOrder - b.sortOrder;
      }),
    [filteredModels],
  );

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Каталог моделей</h1>
          <p className="text-sm text-muted-foreground">
            Управляйте тарифами и доступностью моделей. Новые операции используют текущие значения.
          </p>
        </div>
        <Button onClick={openCreate} data-testid="button-model-create">Новая модель</Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Фильтры</CardTitle>
          <CardDescription>Можно показать только модели конкретного провайдера.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          <div className="space-y-1">
            <Label>Тип провайдера</Label>
            <Select
              value={selectedProviderKind}
              onValueChange={(value: AdminProviderType | "ALL" | "NONE") => {
                setSelectedProviderKind(value);
                setSelectedProviderId(null);
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Тип" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">Все</SelectItem>
                <SelectItem value="LLM">LLM</SelectItem>
                <SelectItem value="EMBEDDINGS">Embeddings</SelectItem>
                <SelectItem value="NONE">Без провайдера</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Провайдер</Label>
            <Select
              value={selectedProviderId ?? ""}
              onValueChange={(value) => setSelectedProviderId(value || null)}
              disabled={selectedProviderKind === "NONE"}
            >
              <SelectTrigger>
                <SelectValue placeholder="Все провайдеры" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">Все</SelectItem>
                {providerOptions
                  .filter((p) => selectedProviderKind === "ALL" || p.kind === selectedProviderKind)
                  .map((provider) => (
                    <SelectItem key={provider.id} value={provider.id}>
                      {provider.name} · {provider.providerType ?? provider.kind}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">Фильтрует запрос к API моделей по providerId.</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Модели</CardTitle>
          <CardDescription>creditsPerUnit показывается для админов, хранится на уровне модели.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Название</TableHead>
                  <TableHead>Ключ</TableHead>
                  <TableHead>Тип</TableHead>
                  <TableHead>Unit</TableHead>
                  <TableHead>Credits/Unit</TableHead>
                  <TableHead>Cost</TableHead>
                  <TableHead>Провайдер</TableHead>
                  <TableHead>Статус</TableHead>
                  <TableHead className="text-right">Действия</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedModels.map((model) => (
                  <TableRow key={model.id}>
                    <TableCell className="font-medium">{model.displayName}</TableCell>
                    <TableCell className="text-muted-foreground">{model.modelKey}</TableCell>
                    <TableCell>{typeLabels[model.modelType]}</TableCell>
                    <TableCell>{model.consumptionUnit}</TableCell>
                    <TableCell>
                      {model.creditsPerUnit}{" "}
                      <span className="text-muted-foreground text-xs">
                        {unitLabels[model.consumptionUnit]}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{costLevelLabels[model.costLevel]}</Badge>
                    </TableCell>
                    <TableCell>
                      {model.providerId ? (
                        <div className="flex flex-col gap-1">
                          <span className="text-xs text-muted-foreground">{model.providerId}</span>
                          <span className="text-xs text-muted-foreground">
                            {model.providerType ?? "—"} · {model.providerModelKey ?? "—"}
                          </span>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={model.isActive ? "secondary" : "destructive"}>
                        {model.isActive ? "Активна" : "Выключена"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="outline" size="sm" onClick={() => openEdit(model)}>
                        Редактировать
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {sortedModels.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center text-muted-foreground">
                      Модели не найдены
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingModel ? "Редактировать модель" : "Новая модель"}</DialogTitle>
          </DialogHeader>
          <form
            className="space-y-3"
            onSubmit={form.handleSubmit(onSubmit)}
            data-testid="form-model"
          >
            <div className="grid grid-cols-1 gap-3">
              <div className="space-y-1">
                <Label htmlFor="displayName">Название</Label>
                <Input id="displayName" placeholder="Напр. gpt-4o" {...form.register("displayName")} />
                {form.formState.errors.displayName && (
                  <p className="text-xs text-destructive">{form.formState.errors.displayName.message}</p>
                )}
              </div>
              <div className="space-y-1">
                <Label htmlFor="modelKey">Ключ модели</Label>
                <Input
                  id="modelKey"
                  placeholder="Уникальный ключ"
                  disabled={Boolean(editingModel)}
                  {...form.register("modelKey")}
                />
                {form.formState.errors.modelKey && (
                  <p className="text-xs text-destructive">{form.formState.errors.modelKey.message}</p>
                )}
              </div>
              <div className="space-y-1">
                <Label htmlFor="description">Описание</Label>
                <Input id="description" placeholder="Опционально" {...form.register("description")} />
                {form.formState.errors.description && (
                  <p className="text-xs text-destructive">{form.formState.errors.description.message}</p>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>Тип модели</Label>
                  <Select
                    value={form.watch("modelType")}
                    onValueChange={(value: ModelType) => form.setValue("modelType", value, { shouldDirty: true })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Тип" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="LLM">LLM</SelectItem>
                      <SelectItem value="EMBEDDINGS">Embeddings</SelectItem>
                      <SelectItem value="ASR">ASR</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label>Unit</Label>
                  <Select
                    value={form.watch("consumptionUnit")}
                    onValueChange={(value: ConsumptionUnit) =>
                      form.setValue("consumptionUnit", value, { shouldDirty: true })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Unit" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="TOKENS_1K">TOKENS_1K</SelectItem>
                      <SelectItem value="MINUTES">MINUTES</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>CreditsPerUnit</Label>
                  <Input
                    type="number"
                    min={0}
                    step={1}
                    disabled={form.watch("creditsPerUnit") === 0}
                    {...form.register("creditsPerUnit", { valueAsNumber: true })}
                  />
                  <p className="text-xs text-muted-foreground">
                    {unitLabels[form.watch("consumptionUnit")]}
                  </p>
                  {form.formState.errors.creditsPerUnit && (
                    <p className="text-xs text-destructive">
                      {form.formState.errors.creditsPerUnit.message}
                    </p>
                  )}
                </div>
                <div className="space-y-1">
                  <Label>Cost level</Label>
                  <Select
                    value={form.watch("costLevel")}
                    onValueChange={(value: CostLevel) => form.setValue("costLevel", value, { shouldDirty: true })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Cost level" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="FREE">Free</SelectItem>
                      <SelectItem value="LOW">Low</SelectItem>
                      <SelectItem value="MEDIUM">Medium</SelectItem>
                      <SelectItem value="HIGH">High</SelectItem>
                      <SelectItem value="VERY_HIGH">Very high</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Бесплатная модель</Label>
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="isFree"
                      checked={form.watch("creditsPerUnit") === 0}
                      onCheckedChange={(checked) =>
                        form.setValue("creditsPerUnit", checked ? 0 : 1, { shouldDirty: true })
                      }
                    />
                    <Label htmlFor="isFree">Не списывать кредиты (creditsPerUnit=0)</Label>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    При включении стоимость фиксируется в 0, операции попадут в журнал с credits=0.
                  </p>
                  {editingModel?.providerId && (
                    <p className="text-xs text-muted-foreground">
                      Модель синхронизируется с провайдером {editingModel.providerId}; ключ и связка с провайдером не
                      редактируются вручную.
                    </p>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 items-center">
                <div className="space-y-1">
                  <Label htmlFor="sortOrder">Порядок сортировки</Label>
                  <Input id="sortOrder" type="number" {...form.register("sortOrder", { valueAsNumber: true })} />
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="isActive"
                    checked={form.watch("isActive")}
                    onCheckedChange={(checked) =>
                      form.setValue("isActive", Boolean(checked), { shouldDirty: true })
                    }
                  />
                  <Label htmlFor="isActive">Активна</Label>
                </div>
              </div>
            </div>

            <DialogFooter className="pt-2">
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                Отмена
              </Button>
              <Button type="submit" disabled={createMutation.isPending || updateMutation.isPending}>
                {editingModel ? "Сохранить" : "Создать"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
