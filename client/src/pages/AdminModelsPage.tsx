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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { formatCredits } from "@shared/credits";
import { cn } from "@/lib/utils";
import { ArrowUpDown, ChevronDown, ChevronUp, MoreHorizontal } from "lucide-react";

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
    .transform((value) => Math.round(value * 100) / 100),
  isActive: z.boolean().default(true),
  sortOrder: z.coerce.number().default(0),
  providerId: z.string().optional(),
  providerModelKey: z.string().optional(),
});

type ModelFormValues = z.infer<typeof modelSchema>;

type SortField =
  | "order"
  | "name"
  | "key"
  | "type"
  | "unit"
  | "credits"
  | "cost"
  | "provider"
  | "status";

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
  const [showArchived, setShowArchived] = useState(false);

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
      providerId: undefined,
      providerModelKey: "",
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
          providerId: undefined,
          providerModelKey: "",
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
        providerId: model.providerId ?? undefined,
        providerModelKey: model.providerModelKey ?? "",
      });
    },
    [form],
  );

  const createMutation = useMutation({
    mutationFn: async (values: ModelFormValues) => {
      const providerOption = providerOptions.find((p) => p.id === values.providerId);
      const providerTypeForPayload = providerOption?.providerType ?? providerOption?.kind;
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
        providerId: values.providerId || undefined,
        providerType: values.providerId ? providerTypeForPayload : undefined,
        providerModelKey: values.providerId ? values.providerModelKey?.trim() || undefined : undefined,
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
      const providerOption = providerOptions.find((p) => p.id === values.providerId);
      const providerTypeForPayload = providerOption?.providerType ?? providerOption?.kind;
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
        providerId: values.providerId || null,
        providerType: values.providerId ? providerTypeForPayload : null,
        providerModelKey: values.providerId ? values.providerModelKey?.trim() || null : null,
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

  const toggleArchiveMutation = useMutation({
    mutationFn: async (options: { modelId: string; isActive: boolean }) => {
      const res = await apiRequest("PUT", `/api/admin/models/${options.modelId}`, { isActive: options.isActive });
      return await res.json();
    },
    onSuccess: (_data, variables) => {
      toast({ title: variables.isActive ? "Модель восстановлена" : "Модель архивирована" });
      queryClient.invalidateQueries({
        predicate: (query) => Array.isArray(query.queryKey) && query.queryKey[0] === "/api/admin/models",
      });
    },
    onError: (error: Error) => {
      toast({ title: "Не удалось обновить модель", description: error.message, variant: "destructive" });
    },
  });

  const onSubmit = useCallback(
    (values: ModelFormValues) => {
      if (values.providerId && !values.providerModelKey?.trim()) {
        form.setError("providerModelKey", { message: "Укажите ключ модели у провайдера" });
        return;
      }
      if (values.id) {
        updateMutation.mutate({ ...values, creditsPerUnit: values.creditsPerUnit <= 0 ? 0 : values.creditsPerUnit });
      } else {
        createMutation.mutate({ ...values, creditsPerUnit: values.creditsPerUnit <= 0 ? 0 : values.creditsPerUnit });
      }
    },
    [createMutation, updateMutation, form],
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
    const archivedModelsCount = useMemo(() => models.filter((m) => !m.isActive).length, [models]);
    const [sortField, setSortField] = useState<SortField>("order");
    const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
    const providerOptions = useMemo(() => {
      const llm = Array.isArray(llmProvidersQuery.data) ? llmProvidersQuery.data : [];
      const emb = Array.isArray(embeddingProvidersQuery.data) ? embeddingProvidersQuery.data : [];
      return [...llm, ...emb].sort((a, b) => a.name.localeCompare(b.name));
    }, [llmProvidersQuery.data, embeddingProvidersQuery.data]);
    const providerKindById = useMemo(() => {
      const map = new Map<string, AdminProviderType>();
      for (const option of providerOptions) {
        map.set(option.id, option.kind);
      }
      return map;
    }, [providerOptions]);
    const providerNameById = useMemo(() => {
      const map = new Map<string, string>();
      for (const option of providerOptions) {
        map.set(option.id, option.name);
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
      result = result.filter((m) => m.modelType === selectedProviderKind);
    }
      if (!showArchived) {
        result = result.filter((m) => m.isActive);
      }
      return result;
    }, [models, selectedProviderId, selectedProviderKind, providerKindById, showArchived]);

    const sortedModels = useMemo(() => {
      const costPriority: Record<CostLevel, number> = {
        FREE: 0,
        LOW: 1,
        MEDIUM: 2,
        HIGH: 3,
        VERY_HIGH: 4,
      };
      const direction = sortDirection === "asc" ? 1 : -1;
      const base = [...filteredModels];
      if (sortField === "name") {
        return base.sort((a, b) => direction * a.displayName.localeCompare(b.displayName));
      }
      if (sortField === "key") {
        return base.sort((a, b) => direction * a.modelKey.localeCompare(b.modelKey));
      }
      if (sortField === "type") {
        return base.sort((a, b) => {
          const diff = typeLabels[a.modelType].localeCompare(typeLabels[b.modelType]);
          if (diff !== 0) return direction * diff;
          return direction * a.displayName.localeCompare(b.displayName);
        });
      }
      if (sortField === "unit") {
        return base.sort((a, b) => {
          const diff = unitLabels[a.consumptionUnit].localeCompare(unitLabels[b.consumptionUnit]);
          if (diff !== 0) return direction * diff;
          return direction * a.displayName.localeCompare(b.displayName);
        });
      }
      if (sortField === "cost") {
        return base.sort((a, b) => {
          const diff = costPriority[a.costLevel] - costPriority[b.costLevel];
          if (diff !== 0) return direction * diff;
          return direction * a.displayName.localeCompare(b.displayName);
        });
      }
      if (sortField === "credits") {
        return base.sort((a, b) => {
          const diff = (a.creditsPerUnit ?? 0) - (b.creditsPerUnit ?? 0);
          if (diff !== 0) return direction * diff;
          return direction * a.displayName.localeCompare(b.displayName);
        });
      }
      if (sortField === "provider") {
        return base.sort((a, b) => {
          const nameA = providerNameById.get(a.providerId ?? "") ?? a.providerId ?? "";
          const nameB = providerNameById.get(b.providerId ?? "") ?? b.providerId ?? "";
          const diff = nameA.localeCompare(nameB);
          if (diff !== 0) return direction * diff;
          return direction * a.displayName.localeCompare(b.displayName);
        });
      }
      if (sortField === "status") {
        return base.sort((a, b) => {
          const statusA = a.isActive ? 0 : 1;
          const statusB = b.isActive ? 0 : 1;
          const diff = statusA - statusB;
          if (diff !== 0) return direction * diff;
          return direction * a.displayName.localeCompare(b.displayName);
        });
      }
      return base.sort((a, b) => {
        const orderA = a.sortOrder ?? 0;
        const orderB = b.sortOrder ?? 0;
        if (orderA === orderB) return direction * a.displayName.localeCompare(b.displayName);
        return direction * (orderA - orderB);
      });
    }, [filteredModels, sortField, sortDirection, providerNameById]);

    const handleSort = (field: SortField) => {
      setSortDirection((prevDirection) =>
        sortField === field ? (prevDirection === "asc" ? "desc" : "asc") : "asc",
      );
      setSortField(field);
    };

    const renderSortableHeader = (field: SortField, label: string, className?: string) => {
      const isActive = sortField === field;
      const IconComponent = isActive
        ? sortDirection === "asc"
          ? ChevronUp
          : ChevronDown
        : ArrowUpDown;
      const description = isActive
        ? `${label}: ${sortDirection === "asc" ? "по возрастанию" : "по убыванию"}`
        : `Сортировать по ${label}`;
      return (
        <TableHead className={className}>
          <button
            type="button"
            className={cn(
              "flex w-full items-center justify-between gap-1 rounded px-1 text-left text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring hover:text-foreground",
              isActive ? "text-foreground" : "text-muted-foreground/80",
            )}
            aria-label={description}
            aria-pressed={isActive}
            onClick={() => handleSort(field)}
          >
            <span>{label}</span>
            <IconComponent
              className={cn(
                "h-4 w-4 transition-colors",
                isActive ? "text-primary" : "text-muted-foreground/70",
              )}
            />
          </button>
        </TableHead>
      );
    };

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
              value={selectedProviderId ?? "ALL"}
              onValueChange={(value) => setSelectedProviderId(value === "ALL" ? null : value)}
              disabled={selectedProviderKind === "NONE"}
            >
              <SelectTrigger>
                <SelectValue placeholder="Все провайдеры" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">Все</SelectItem>
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
          <div className="flex items-center gap-2 pt-6">
            <Checkbox
              id="showArchived"
              checked={showArchived}
              onCheckedChange={(checked) => setShowArchived(Boolean(checked))}
            />
            <Label htmlFor="showArchived">
              Показывать архивные{archivedModelsCount > 0 ? ` (${archivedModelsCount})` : ""}
            </Label>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Модели</CardTitle>
          <CardDescription className="space-y-1">
            <p>creditsPerUnit показывается для админов, хранится на уровне модели.</p>
            <p className="text-xs text-muted-foreground">
              Наведите на заголовок столбца и нажмите на стрелку, чтобы отсортировать список.
            </p>
            {!showArchived && archivedModelsCount > 0 && (
              <p className="text-xs text-muted-foreground">
                Скрыто архивных моделей: {archivedModelsCount}. Включите «Показывать архивные», чтобы увидеть их.
              </p>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  {renderSortableHeader("name", "Название")}
                  {renderSortableHeader("key", "Ключ")}
                  {renderSortableHeader("type", "Тип")}
                  {renderSortableHeader("unit", "Unit")}
                  {renderSortableHeader("credits", "Credits/Unit")}
                  {renderSortableHeader("cost", "Cost")}
                  {renderSortableHeader("provider", "Провайдер")}
                  {renderSortableHeader("status", "Статус")}
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
                      {formatCredits(model.creditsPerUnit)}{" "}
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
                      {model.isActive ? (
                        <Badge variant="secondary">Активна</Badge>
                      ) : (
                        <Badge variant="outline">Архив</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" aria-label="Меню действий модели">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onSelect={() => openEdit(model)}>
                            Редактировать
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onSelect={() =>
                              toggleArchiveMutation.mutate({ modelId: model.id, isActive: !model.isActive })
                            }
                            disabled={toggleArchiveMutation.isPending}
                          >
                            {model.isActive ? "Архивировать" : "Восстановить"}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
                {sortedModels.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center text-muted-foreground">
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
                  <Label>Провайдер (опционально)</Label>
                  <Select
                    value={form.watch("providerId") || "NONE"}
                    onValueChange={(value) => {
                      const next = value === "NONE" ? undefined : value;
                      form.setValue("providerId", next, { shouldDirty: true });
                      if (!next) {
                        form.setValue("providerModelKey", "", { shouldDirty: true });
                      }
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Без привязки" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="NONE">Без привязки</SelectItem>
                      {providerOptions.map((provider) => (
                        <SelectItem key={provider.id} value={provider.id}>
                          {provider.name} · {provider.providerType ?? provider.kind}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Привяжите модель к провайдеру LLM/Embeddings/ASR для синхронизации.
                  </p>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="providerModelKey">Ключ модели у провайдера</Label>
                  <Input
                    id="providerModelKey"
                    placeholder="Напр. gpt-4o-mini"
                    disabled={!form.watch("providerId")}
                    {...form.register("providerModelKey")}
                  />
                  <p className="text-xs text-muted-foreground">Обязателен при выборе провайдера.</p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>CreditsPerUnit</Label>
                  <Input
                    type="text"
                    inputMode="decimal"
                    placeholder="1.00"
                    disabled={form.watch("creditsPerUnit") === 0}
                    {...form.register("creditsPerUnit", {
                      setValueAs: (value) => {
                        if (value === "" || value === null || value === undefined) return 0;
                        const normalized = String(value).trim().replace(",", ".");
                        return Number(normalized);
                      },
                    })}
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
                      Модель привязана к провайдеру {editingModel.providerId}. Если у вас включена синхронизация моделей
                      провайдера, изменения ключей/привязки могут быть перезаписаны при следующей синхронизации.
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
