import { useEffect, useMemo, useState } from "react";
import { useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Sparkles,
  Plus,
  Pencil,
  Loader2,
  ChevronsUpDown,
  Check,
  Info,
} from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { Separator } from "@/components/ui/separator";
import { MoreVertical } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";

import { useSkills } from "@/hooks/useSkills";
import { useModels, type PublicModel } from "@/hooks/useModels";
import { apiRequest } from "@/lib/queryClient";
import { SKILL_ICON_OPTIONS, getSkillIcon } from "@/lib/skill-icons";
import { cn } from "@/lib/utils";
import { useLocation } from "wouter";

import type { KnowledgeBaseSummary } from "@shared/knowledge-base";
import type { ActionDto, SkillActionDto } from "@shared/skills";
import type { PublicEmbeddingProvider, PublicLlmProvider } from "@shared/schema";
import type { Skill } from "@/types/skill";
import type { SessionResponse } from "@/types/session";

const ICON_OPTIONS = SKILL_ICON_OPTIONS;

const NO_EMBEDDING_PROVIDER_VALUE = "__none";

export const skillFormSchema = z.object({
  name: z.string().trim().min(1, "Название обязательно").max(200, "Не более 200 символов"),
  description: z
    .string()
    .max(4000, "Не более 4000 символов")
    .optional()
    .or(z.literal("")),
  executionMode: z.enum(["standard", "no_code"]).default("standard"),
  mode: z.enum(["rag", "llm"]).default("rag"),
  knowledgeBaseIds: z.array(z.string()).default([]),
  llmKey: z.string().min(1, "Выберите конфиг LLM"),
  llmTemperature: z.string().optional().or(z.literal("")),
  llmMaxTokens: z.string().optional().or(z.literal("")),
  systemPrompt: z
    .string()
    .max(20000, "Не более 20000 символов")
    .optional()
    .or(z.literal("")),
  icon: z.string().optional().or(z.literal("")),
  ragMode: z.enum(["all_collections", "selected_collections"]),
  ragCollectionIds: z.array(z.string()).default([]),
  ragTopK: z.string().optional().or(z.literal("")),
  ragMinScore: z.string().optional().or(z.literal("")),
  ragMaxContextTokens: z.string().optional().or(z.literal("")),
  ragShowSources: z.boolean(),
  ragEmbeddingProviderId: z.string().optional().or(z.literal("")),
  onTranscriptionMode: z.enum(["raw_only", "auto_action"]),
  onTranscriptionAutoActionId: z.string().optional().or(z.literal("")),
  noCodeEndpointUrl: z
    .string()
    .url({ message: "Некорректный URL" })
    .optional()
    .or(z.literal(""))
    .refine(
      (value) =>
        value === undefined ||
        value === "" ||
        value.startsWith("http://") ||
        value.startsWith("https://"),
      { message: "Разрешены только http/https URL" },
    ),
  noCodeAuthType: z.enum(["none", "bearer"]).default("none"),
  noCodeBearerToken: z.string().optional().or(z.literal("")),
}).superRefine((val, ctx) => {
  const hasKnowledgeBases = Boolean(val.knowledgeBaseIds?.length);
  const hasCollections =
    val.ragMode === "selected_collections" && Boolean(val.ragCollectionIds?.length);
  const hasRagSources = hasKnowledgeBases || hasCollections;

  if (hasCollections && !hasKnowledgeBases) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["knowledgeBaseIds"],
      message: "Для коллекций выберите базу знаний",
    });
  }

  if (hasRagSources && val.ragMode === "selected_collections" && (!val.ragCollectionIds || val.ragCollectionIds.length === 0)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["ragCollectionIds"],
      message: "Укажите хотя бы одну коллекцию",
    });
  }

  if (hasRagSources && (!val.ragEmbeddingProviderId || val.ragEmbeddingProviderId === NO_EMBEDDING_PROVIDER_VALUE)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["ragEmbeddingProviderId"],
      message: "Выберите сервис эмбеддингов",
    });
  }
});




export const buildLlmKey = (providerId: string, modelId: string) => `${providerId}::${modelId}`;
export const catalogModelMap = (models: PublicModel[]) => new Map(models.map((m) => [m.key, m]));
const costLevelLabel: Record<PublicModel["costLevel"], string> = {
  FREE: "Free",
  LOW: "Low",
  MEDIUM: "Medium",
  HIGH: "High",
  VERY_HIGH: "Very high",
};

export const defaultFormValues = {
  name: "",
  description: "",
  executionMode: "standard" as "standard" | "no_code",
  mode: "llm" as "rag" | "llm",
  knowledgeBaseIds: [] as string[],
  llmKey: "",
  llmTemperature: "",
  llmMaxTokens: "",
  systemPrompt: "",
  icon: "",
  ragMode: "all_collections" as "all_collections" | "selected_collections",
  ragCollectionIds: [] as string[],
  ragTopK: "5",
  ragMinScore: "0.7",
  ragMaxContextTokens: "3000",
  ragShowSources: true,
  ragEmbeddingProviderId: NO_EMBEDDING_PROVIDER_VALUE,
  onTranscriptionMode: "raw_only" as "raw_only" | "auto_action",
  onTranscriptionAutoActionId: "",
  noCodeEndpointUrl: "",
  noCodeAuthType: "none" as "none" | "bearer",
  noCodeBearerToken: "",
};

export type SkillFormValues = z.infer<typeof skillFormSchema>;

export type LlmSelectionOption = {
  key: string;
  label: string;
  providerId: string;
  providerName: string;
  modelId: string; // provider's model key (must match catalog key)
  modelDisplayName: string;
  costLevel: PublicModel["costLevel"];
  providerIsActive: boolean;
  disabled: boolean;
  catalogModel?: PublicModel | null;
};

type KnowledgeBaseMultiSelectProps = {
  value: string[];
  onChange: (next: string[]) => void;
  knowledgeBases: KnowledgeBaseSummary[];
  disabled?: boolean;
};

type VectorCollectionSummary = {
  name: string;
};

type VectorCollectionMultiSelectProps = {
  value: string[];
  onChange: (next: string[]) => void;
  collections: VectorCollectionSummary[];
  disabled?: boolean;
};

type VectorCollectionsResponse = {
  collections: VectorCollectionSummary[];
};

type SkillActionConfigItem = {
  action: ActionDto;
  skillAction: SkillActionDto | null;
  ui: {
    effectiveLabel: string;
    editable: boolean;
  };
};

type SkillActionRowState = {
  action: ActionDto;
  skillAction: SkillActionDto | null;
  ui: {
    effectiveLabel: string;
    editable: boolean;
  };
  enabled: boolean;
  enabledPlacements: string[];
  labelOverride: string | null;
  saving: boolean;
  editing: boolean;
  draftLabel: string;
};

function SkillActionsInline({ skillId }: { skillId: string }) {
  const { data, isLoading, isError } = useQuery<SkillActionConfigItem[]>({
    queryKey: ["skill-actions-inline", skillId],
    queryFn: async () => {
      const response = await apiRequest("GET", `/api/skills/${skillId}/actions`);
      const json = await response.json();
      return (json.items ?? []) as SkillActionConfigItem[];
    },
  });

  if (isLoading) {
    return <span className="text-xs text-muted-foreground">Загрузка...</span>;
  }

  if (isError || !data) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }

  const enabledActions = data.filter((item) => item.skillAction?.enabled);
  if (enabledActions.length === 0) {
    return <span className="text-xs text-muted-foreground">Нет действий</span>;
  }

  const MAX_BADGES = 3;
  const visible = enabledActions.slice(0, MAX_BADGES);
  const extra = enabledActions.length - visible.length;

  return (
    <div className="flex flex-wrap gap-1">
      {visible.map((item) => (
        <Badge key={item.action.id} variant="secondary" className="text-[11px]">
          {item.skillAction?.labelOverride ?? item.ui.effectiveLabel ?? item.action.label}
        </Badge>
      ))}
      {extra > 0 && (
        <Badge variant="outline" className="text-[11px] text-muted-foreground">
          +{extra}
        </Badge>
      )}
    </div>
  );
}

function KnowledgeBaseMultiSelect({ value, onChange, knowledgeBases, disabled }: KnowledgeBaseMultiSelectProps) {
  const [open, setOpen] = useState(false);
  const selectedSet = useMemo(() => new Set(value), [value]);
  const selectedBases = useMemo(() => {
    return knowledgeBases.filter((kb) => selectedSet.has(kb.id));
  }, [knowledgeBases, selectedSet]);
  const MAX_BADGES = 2;
  const visibleBadges = selectedBases.slice(0, MAX_BADGES);
  const extraBadges = selectedBases.length - visibleBadges.length;

  const toggle = (id: string) => {
    if (selectedSet.has(id)) {
      onChange(value.filter((currentId) => currentId !== id));
      return;
    }
    onChange([...value, id]);
  };

  return (
    <div className="space-y-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            className="w-full justify-between gap-2"
            role="combobox"
            aria-expanded={open}
            disabled={disabled || knowledgeBases.length === 0}
            data-testid="libraries-multiselect"
          >
            {knowledgeBases.length === 0 ? (
              <span className="truncate">Нет доступных баз</span>
            ) : selectedBases.length === 0 ? (
              <span className="truncate text-muted-foreground">Выберите базы знаний</span>
            ) : (
              <span className="flex min-w-0 flex-wrap items-center gap-1">
                {visibleBadges.map((kb) => (
                  <Badge key={kb.id} variant="secondary" className="text-[11px]">
                    {kb.name}
                  </Badge>
                ))}
                {extraBadges > 0 && (
                  <Badge variant="outline" className="text-[11px] text-muted-foreground">
                    +{extraBadges}
                  </Badge>
                )}
              </span>
            )}
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[360px] p-0">
          <Command>
            <CommandInput placeholder="Поиск по названию..." />
            <CommandList>
              <CommandEmpty>Ничего не найдено</CommandEmpty>
              <CommandGroup heading="Базы знаний">
                {knowledgeBases.map((kb) => {
                  const isSelected = selectedSet.has(kb.id);
                  return (
                    <CommandItem
                      key={kb.id}
                      value={kb.name}
                      onSelect={() => toggle(kb.id)}
                      className="items-start"
                    >
                      <Check className={cn("mr-2 h-4 w-4", isSelected ? "opacity-100" : "opacity-0")} />
                      <div className="space-y-0.5">
                        <p className="text-sm font-medium leading-none">{kb.name}</p>
                        {kb.description && (
                          <p className="text-xs text-muted-foreground line-clamp-2">{kb.description}</p>
                        )}
                      </div>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}

function VectorCollectionMultiSelect({
  value,
  onChange,
  collections,
  disabled,
}: VectorCollectionMultiSelectProps) {
  const [open, setOpen] = useState(false);
  const sortedCollections = useMemo(
    () => [...collections].sort((a, b) => a.name.localeCompare(b.name, "ru", { sensitivity: "base" })),
    [collections],
  );
  const selectedSet = useMemo(() => new Set(value), [value]);
  const selected = sortedCollections.filter((collection) => selectedSet.has(collection.name));
  const MAX_BADGES = 2;
  const visibleBadges = selected.slice(0, MAX_BADGES);
  const extraBadges = selected.length - visibleBadges.length;

  const toggle = (name: string) => {
    if (selectedSet.has(name)) {
      onChange(value.filter((current) => current !== name));
      return;
    }
    onChange([...value, name]);
  };

  return (
    <div className="space-y-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            className="w-full justify-between gap-2"
            role="combobox"
            aria-expanded={open}
            disabled={disabled || sortedCollections.length === 0}
            data-testid="collections-multiselect"
          >
            {sortedCollections.length === 0 ? (
              <span className="truncate">Коллекции не найдены</span>
            ) : selected.length === 0 ? (
              <span className="truncate text-muted-foreground">Выберите коллекции</span>
            ) : (
              <span className="flex min-w-0 flex-wrap items-center gap-1">
                {visibleBadges.map((collection) => (
                  <Badge key={collection.name} variant="secondary" className="text-[11px]">
                    {collection.name}
                  </Badge>
                ))}
                {extraBadges > 0 && (
                  <Badge variant="outline" className="text-[11px] text-muted-foreground">
                    +{extraBadges}
                  </Badge>
                )}
              </span>
            )}
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[360px] p-0">
          <Command>
            <CommandInput placeholder="Поиск по коллекциям..." />
            <CommandList>
              <CommandEmpty>Коллекции не найдены</CommandEmpty>
              <CommandGroup heading="Коллекции">
                {sortedCollections.map((collection) => {
                  const isSelected = selectedSet.has(collection.name);
                  return (
                    <CommandItem
                      key={collection.name}
                      value={collection.name}
                      onSelect={() => toggle(collection.name)}
                      className="items-start"
                    >
                      <Check className={cn("mr-2 h-4 w-4", isSelected ? "opacity-100" : "opacity-0")} />
                      <span className="text-sm font-medium leading-none">{collection.name}</span>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}

type InfoTooltipIconProps = {
  text: string;
};

function InfoTooltipIcon({ text }: InfoTooltipIconProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="text-muted-foreground hover:text-foreground"
          aria-label="Пояснение"
        >
          <Info className="h-3.5 w-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs text-xs">{text}</TooltipContent>
    </Tooltip>
  );
}

type SkillActionsPreviewProps = {
  skillId: string;
  canEdit?: boolean;
};

function SkillActionsPreview({ skillId, canEdit = true }: SkillActionsPreviewProps) {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [archiveTarget, setArchiveTarget] = useState<Skill | null>(null);
  const [isArchiving, setIsArchiving] = useState(false);
  const { data, isLoading, isFetching, isError, error, refetch } = useQuery<SkillActionConfigItem[]>({
    queryKey: ["skill-actions", skillId],
    queryFn: async () => {
      const response = await apiRequest("GET", `/api/skills/${skillId}/actions`);
      const json = await response.json();
      return (json.items ?? []) as SkillActionConfigItem[];
    },
  });

  const [rows, setRows] = useState<SkillActionRowState[]>([]);

  useEffect(() => {
    if (!data) {
      return;
    }
    if (!Array.isArray(data)) {
      setRows([]);
      return;
    }
    setRows(
      data.map((item) => ({
        ...item,
        enabled: item.skillAction?.enabled ?? false,
        enabledPlacements: item.skillAction?.enabledPlacements ?? [],
        labelOverride: item.skillAction?.labelOverride ?? null,
        saving: false,
        editing: false,
        draftLabel: item.skillAction?.labelOverride ?? "",
        ui: { ...item.ui, editable: item.ui.editable && canEdit },
      })),
    );
  }, [data, canEdit]);

  const targetLabels: Record<string, string> = {
    transcript: "Стенограмма",
    message: "Сообщение",
    selection: "Выделение",
    conversation: "Диалог",
  };

  const outputModeLabels: Record<string, string> = {
    replace_text: "Заменить текст",
    new_version: "Новая версия",
    new_message: "Новое сообщение",
    document: "Документ",
  };
  const placementTooltips: Record<string, string> = {
    canvas: "Холст — панель действий справа от стенограммы",
    chat_message: "Действия в меню конкретного сообщения",
    chat_toolbar: "Быстрые действия над полем ввода/диалогом",
  };

  const [search, setSearch] = useState("");
  const [scopeFilter, setScopeFilter] = useState<"all" | "system" | "workspace">("all");
  const [enabledFilter, setEnabledFilter] = useState<"all" | "enabled" | "disabled">("all");
  const [targetFilter, setTargetFilter] = useState<string | "all">("all");

  const sendUpdate = async (row: SkillActionRowState, next: Partial<SkillActionRowState>) => {
    setRows((prev) =>
      prev.map((item) => (item.action.id === row.action.id ? { ...item, ...next, saving: true } : item)),
    );

    const nextEnabled = next.enabled ?? row.enabled;
    const basePlacements = next.enabledPlacements ?? row.enabledPlacements;
    const effectivePlacements =
      basePlacements.length > 0 ? basePlacements : [...(row.action.placements ?? [])];

    const payload = {
      enabled: nextEnabled,
      enabledPlacements: effectivePlacements,
      labelOverride:
        next.labelOverride === undefined
          ? row.labelOverride
          : next.labelOverride && next.labelOverride.trim().length > 0
            ? next.labelOverride
            : null,
    };

    try {
      const response = await apiRequest("PUT", `/api/skills/${skillId}/actions/${row.action.id}`, payload);
      if (!response.ok) {
        throw new Error("Не удалось сохранить изменения");
      }
      setRows((prev) =>
        prev.map((item) =>
          item.action.id === row.action.id
            ? {
                ...item,
                enabled: payload.enabled,
                enabledPlacements: payload.enabledPlacements,
                labelOverride: payload.labelOverride,
                ui: { ...item.ui, effectiveLabel: payload.labelOverride ?? item.action.label },
                saving: false,
                editing: false,
                draftLabel: payload.labelOverride ?? "",
              }
            : item,
        ),
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "Не удалось сохранить изменения";
      toast({
        title: "Ошибка",
        description: message,
        variant: "destructive",
      });
      // откат
      setRows((prev) =>
        prev.map((item) =>
          item.action.id === row.action.id
            ? {
                ...item,
                saving: false,
              }
            : item,
        ),
      );
    }
  };

  const renderPlacementCell = (row: SkillActionRowState, placement: string) => {
    const supported = row.action.placements.includes(placement as any);
    const active = supported && row.enabledPlacements.includes(placement as any);

    if (!supported) {
      return <span className="text-center text-xs text-muted-foreground">—</span>;
    }

    return (
      <TooltipProvider delayDuration={200}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Checkbox
              checked={active}
              disabled={!row.ui.editable || row.saving}
              aria-label={placement}
              onCheckedChange={(checked) => {
                if (!row.ui.editable || row.saving) return;
                const nextPlacements = checked
                  ? [...row.enabledPlacements, placement]
                  : row.enabledPlacements.filter((p) => p !== placement);
                sendUpdate(row, { enabledPlacements: nextPlacements });
              }}
            />
          </TooltipTrigger>
          <TooltipContent side="bottom" className="max-w-xs text-xs">
            {placementTooltips[placement] ?? placement}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  };

  if (isLoading && rows.length === 0) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Загрузка действий...
      </div>
    );
  }

  if (isError) {
    const message = error instanceof Error ? error.message : "Не удалось загрузить действия";
    return (
      <Alert variant="destructive">
        <AlertTitle>Ошибка загрузки</AlertTitle>
        <AlertDescription className="flex items-center justify-between gap-4">
          <span className="text-sm">{message}</span>
          <Button type="button" size="sm" variant="outline" onClick={() => refetch()}>
            Повторить
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  const filteredRows = rows.filter((row) => {
    const q = search.trim().toLowerCase();
    const labelText = (row.labelOverride ?? row.ui.effectiveLabel ?? row.action.label ?? "").toLowerCase();
    const descText = (row.action.description ?? "").toLowerCase();
    if (q && !labelText.includes(q) && !descText.includes(q)) {
      return false;
    }

    if (scopeFilter === "system" && row.action.scope !== "system") return false;
    if (scopeFilter === "workspace" && row.action.scope !== "workspace") return false;

    if (enabledFilter === "enabled" && !row.enabled) return false;
    if (enabledFilter === "disabled" && row.enabled) return false;

    if (targetFilter !== "all" && row.action.target !== targetFilter) return false;

    return true;
  });

  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-muted-foreground dark:border-slate-700 dark:bg-slate-900/40">
        Для этого навыка пока нет доступных действий.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-900/60">
        <div className="flex-1 min-w-[220px]">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Поиск по названию и описанию..."
          />
        </div>
        <Select value={scopeFilter} onValueChange={(v) => setScopeFilter(v as any)}>
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="Scope" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все</SelectItem>
            <SelectItem value="system">Системные</SelectItem>
            <SelectItem value="workspace">Рабочего пространства</SelectItem>
          </SelectContent>
        </Select>
        <Select value={enabledFilter} onValueChange={(v) => setEnabledFilter(v as any)}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Статус" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все</SelectItem>
            <SelectItem value="enabled">Только включённые</SelectItem>
            <SelectItem value="disabled">Только выключенные</SelectItem>
          </SelectContent>
        </Select>
        <Select value={targetFilter} onValueChange={(v) => setTargetFilter(v as any)}>
          <SelectTrigger className="w-[170px]">
            <SelectValue placeholder="Цель" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все цели</SelectItem>
            <SelectItem value="transcript">Стенограмма</SelectItem>
            <SelectItem value="message">Сообщение</SelectItem>
            <SelectItem value="selection">Выделение</SelectItem>
            <SelectItem value="conversation">Диалог</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <p className="text-sm text-muted-foreground">
        Отметьте, какие действия доступны в этом навыке и где они отображаются: в холсте, сообщениях чата или в панели ввода.
      </p>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Название</TableHead>
            <TableHead>Scope</TableHead>
            <TableHead>Target</TableHead>
            <TableHead>Enabled</TableHead>
            <TableHead className="text-center">Canvas</TableHead>
            <TableHead className="text-center">Message</TableHead>
            <TableHead className="text-center">Toolbar</TableHead>
            <TableHead>Output</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {filteredRows.map((row) => {
            const { action, ui } = row;
            const label = row.labelOverride ?? action.label;
            return (
              <TableRow key={action.id}>
                <TableCell>
                  <div className="space-y-1">
                    <div className="flex items-start gap-2">
                      {row.editing ? (
                        <div className="flex w-full items-center gap-2">
                          <Input
                            value={row.draftLabel}
                            placeholder={action.label}
                            onChange={(e) =>
                              setRows((prev) =>
                                prev.map((item) =>
                                  item.action.id === row.action.id ? { ...item, draftLabel: e.target.value } : item,
                                ),
                              )
                            }
                            disabled={row.saving}
                            className="h-8"
                            autoFocus
                          />
                          <Button
                            type="button"
                            size="sm"
                            onClick={() =>
                              sendUpdate(row, {
                                labelOverride: row.draftLabel.trim().length > 0 ? row.draftLabel.trim() : null,
                              })
                            }
                            disabled={row.saving}
                          >
                            Сохранить
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={() =>
                              setRows((prev) =>
                                prev.map((item) =>
                                  item.action.id === row.action.id
                                    ? { ...item, editing: false, draftLabel: item.labelOverride ?? "" }
                                    : item,
                                ),
                              )
                            }
                            disabled={row.saving}
                          >
                            Отмена
                          </Button>
                        </div>
                      ) : (
                        <>
                          <p className="text-sm font-medium leading-tight">{label}</p>
                          {ui.editable && (
                            <div className="flex flex-wrap gap-1">
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                className="h-7 px-2 text-xs"
                                onClick={() =>
                                  setRows((prev) =>
                                    prev.map((item) =>
                                      item.action.id === row.action.id
                                        ? { ...item, editing: true, draftLabel: item.labelOverride ?? label }
                                        : item,
                                    ),
                                  )
                                }
                                disabled={row.saving}
                              >
                                Переименовать
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                className="h-7 px-2 text-xs"
                                onClick={() => navigate(`/skills/${skillId}/actions/${row.action.id}/edit`)}
                              >
                                Открыть страницу
                              </Button>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                    {row.labelOverride && !row.editing && (
                      <p className="text-xs text-muted-foreground">Базовое: {action.label}</p>
                    )}
                    {action.description && (
                      <p className="text-xs text-muted-foreground line-clamp-2">{action.description}</p>
                    )}
                  </div>
                </TableCell>
                <TableCell>
                  <Badge variant="outline" className="text-[11px] uppercase">
                    {action.scope === "system" ? "Системное" : "Рабочее пространство"}
                  </Badge>
                </TableCell>
                <TableCell>
                  <span className="text-sm text-muted-foreground">{targetLabels[action.target] ?? action.target}</span>
                </TableCell>
                <TableCell>
                  <Checkbox
                    checked={row.enabled}
                    disabled={!ui.editable || row.saving}
                    aria-label="enabled"
                    onCheckedChange={(checked) => {
                      if (!ui.editable || row.saving) return;
                      sendUpdate(row, { enabled: Boolean(checked) });
                    }}
                  />
                </TableCell>
                <TableCell className="text-center">
                  {renderPlacementCell(row, "canvas")}
                </TableCell>
                <TableCell className="text-center">
                  {renderPlacementCell(row, "chat_message")}
                </TableCell>
                <TableCell className="text-center">
                  {renderPlacementCell(row, "chat_toolbar")}
                </TableCell>
                <TableCell>
                  <span className="text-sm text-muted-foreground">
                    {outputModeLabels[action.outputMode] ?? action.outputMode}
                  </span>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      {isFetching && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Обновляем список...
        </div>
      )}
    </div>
  );
}

function ActionsPreviewForNewSkill() {
  const { data, isLoading, isError } = useQuery<{ actions: ActionDto[] }>({
    queryKey: ["/api/actions/available"],
    queryFn: async () => {
      const response = await apiRequest("GET", "/api/actions/available");
      if (!response.ok) {
        return { actions: [] };
      }
      return (await response.json()) as { actions: ActionDto[] };
    },
  });

  const actions = data?.actions ?? [];

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Загрузка действий...
      </div>
    );
  }

  if (isError || actions.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-muted-foreground dark:border-slate-700 dark:bg-slate-900/40">
        Действия будут доступны после сохранения навыка.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">
        После сохранения навыка вы сможете настроить следующие действия:
      </p>
      <div className="flex flex-wrap gap-1">
        {actions.map((action) => (
          <Badge key={action.id} variant="secondary" className="text-xs">
            {action.label}
          </Badge>
        ))}
      </div>
    </div>
  );
}

type SkillFormProps = {
  knowledgeBases: KnowledgeBaseSummary[];
  vectorCollections: VectorCollectionSummary[];
  isVectorCollectionsLoading: boolean;
  embeddingProviders: PublicEmbeddingProvider[];
  isEmbeddingProvidersLoading: boolean;
  llmOptions: LlmSelectionOption[];
  onSubmit: (values: SkillFormValues) => Promise<boolean>;
  isSubmitting: boolean;
  skill?: Skill | null;
  allowNoCodeFlow?: boolean;
  getIconComponent: (iconName: string | null | undefined) => JSX.Element | null;
  hideHeader?: boolean;
  isOpen?: boolean;
  activeTab?: SkillSettingsTab;
  onTabChange?: (tab: SkillSettingsTab) => void;
};

export type SkillSettingsTab = "main" | "transcription" | "actions";

function IconPicker({
  value,
  onChange,
  renderIcon,
}: {
  value: string;
  onChange: (icon: string) => void;
  renderIcon: (name: string | null | undefined, className?: string) => JSX.Element | null;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLowerCase();
  const filteredIcons = useMemo(() => {
    if (!normalizedQuery) {
      return ICON_OPTIONS;
    }
    return ICON_OPTIONS.filter((icon) => icon.value.toLowerCase().includes(normalizedQuery));
  }, [normalizedQuery]);

  const handleSelect = (icon: string) => {
    onChange(icon);
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <div className="flex items-center gap-3">
        <div className="size-12 rounded-md border bg-muted flex items-center justify-center">
          {renderIcon(value, "h-5 w-5") ?? <span className="text-xs text-muted-foreground">—</span>}
        </div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="h-9"
          data-testid="skill-icon-trigger"
          onClick={() => setOpen(true)}
        >
          Выбрать
        </Button>
      </div>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Иконка навыка</DialogTitle>
          <DialogDescription>Выберите иконку, которая будет отображаться в списке навыков.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Поиск иконки"
            className="h-9"
          />
          <div className="grid gap-2 grid-cols-4 sm:grid-cols-6">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className={cn(
                "size-9 text-xs",
                "data-[selected=true]:ring-2 data-[selected=true]:ring-ring data-[selected=true]:bg-accent",
              )}
              data-selected={value === ""}
              onClick={() => handleSelect("")}
              aria-label="Без иконки"
              data-testid="skill-icon-option-none"
            >
              ✕
            </Button>
            {filteredIcons.map((icon) => {
              const selected = value === icon.value;
              return (
                <Button
                  key={icon.value}
                  type="button"
                  variant="ghost"
                  size="icon"
                  className={cn(
                    "size-9",
                    "data-[selected=true]:ring-2 data-[selected=true]:ring-ring data-[selected=true]:bg-accent",
                  )}
                  data-selected={selected}
                  onClick={() => handleSelect(icon.value)}
                  aria-label={icon.value}
                  data-testid={`skill-icon-option-${icon.value}`}
                >
                  {renderIcon(icon.value, "h-4 w-4")}
                </Button>
              );
            })}
          </div>
          {filteredIcons.length === 0 && (
            <p className="text-xs text-muted-foreground">Ничего не найдено</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function SkillFormContent({
  knowledgeBases,
  vectorCollections,
  isVectorCollectionsLoading,
  embeddingProviders,
  isEmbeddingProvidersLoading,
  llmOptions,
  onSubmit,
  isSubmitting,
  skill,
  allowNoCodeFlow = false,
  getIconComponent,
  hideHeader = false,
  isOpen = true,
  activeTab,
  onTabChange,
}: SkillFormProps) {
  const [internalTab, setInternalTab] = useState<SkillSettingsTab>("main");
  const form = useForm<SkillFormValues>({
    resolver: zodResolver(skillFormSchema),
    defaultValues: defaultFormValues,
  });
  const lastSavedRef = useRef<SkillFormValues>(defaultFormValues);
  const currentTab = activeTab ?? internalTab;

  const handleTabChange = (tab: string) => {
    const next: SkillSettingsTab = tab === "transcription" || tab === "actions" ? tab : "main";
    if (onTabChange) {
      onTabChange(next);
    } else {
      setInternalTab(next);
    }
  };
  const isSystemSkill = Boolean(skill?.isSystem);
  const ragMode = form.watch("ragMode");
  const isManualRagMode = ragMode === "selected_collections";
  const iconValue = form.watch("icon") ?? "";
  const transcriptionMode = form.watch("onTranscriptionMode");
  const isAutoActionMode = transcriptionMode === "auto_action";
  const vectorCollectionsEmpty = vectorCollections.length === 0;
  const vectorCollectionsUnavailable = isVectorCollectionsLoading || vectorCollectionsEmpty;
  const controlsDisabled = isSubmitting || isSystemSkill;
  const noCodeDisabled = controlsDisabled || !allowNoCodeFlow;
  const vectorCollectionsDisabled = vectorCollectionsUnavailable || controlsDisabled;
  const embeddingProvidersEmpty = embeddingProviders.length === 0;
  const embeddingProvidersUnavailable = isEmbeddingProvidersLoading || embeddingProvidersEmpty;
  const embeddingProviderSelectDisabled = embeddingProvidersUnavailable || controlsDisabled;
  const isNoCodeMode = form.watch("executionMode") === "no_code";
  const noCodeAuthType = form.watch("noCodeAuthType");
  const noCodeBearerTokenValue = form.watch("noCodeBearerToken");
  const hasBearerTokenDraft = Boolean(noCodeBearerTokenValue?.trim());
  const storedNoCodeTokenIsSet = skill?.noCodeConnection?.tokenIsSet ?? false;
  const embeddingProviderOptions = useMemo(() => {
    return embeddingProviders
      .map((provider) => ({
        id: provider.id,
        name: provider.name,
        isActive: provider.isActive,
      }))
      .sort((a, b) => a.name.localeCompare(b.name, "ru", { sensitivity: "base" }));
  }, [embeddingProviders]);
  const effectiveEmbeddingProviderOptions = useMemo(() => {
    const currentId = skill?.ragConfig?.embeddingProviderId;
    if (!currentId) {
      return embeddingProviderOptions;
    }
    if (embeddingProviderOptions.some((provider) => provider.id === currentId)) {
      return embeddingProviderOptions;
    }
    return [
      ...embeddingProviderOptions,
      {
        id: currentId,
        name: `${currentId} (не доступен)`,
        isActive: false,
      },
    ];
  }, [embeddingProviderOptions, skill]);
  const transcriptActionsQuery = useQuery<SkillActionConfigItem[]>({
    queryKey: ["skill-actions", skill?.id, "transcript"],
    enabled: Boolean(skill?.id),
    queryFn: async () => {
      const response = await apiRequest("GET", `/api/skills/${skill!.id}/actions`);
      const json = await response.json();
      const items = (json.items ?? []) as SkillActionConfigItem[];
      return items.filter((item) => item.action.target === "transcript");
    },
  });
  const transcriptActions = transcriptActionsQuery.data ?? [];
  const systemSkillDescription =
    skill?.systemKey === "UNICA_CHAT"
      ? "Настройки Unica Chat управляются администратором инстанса. Изменить их из рабочего пространства нельзя."
      : "Системные навыки управляются администратором и недоступны для редактирования.";

  const sortedKnowledgeBases = useMemo(() => {
    return [...knowledgeBases].sort((a, b) => a.name.localeCompare(b.name, "ru", { sensitivity: "base" }));
  }, [knowledgeBases]);

  const effectiveLlmOptions = useMemo(() => {
    if (!skill?.llmProviderConfigId || !skill?.modelId) {
      return llmOptions;
    }

    const key = buildLlmKey(skill.llmProviderConfigId, skill.modelId);
    if (llmOptions.some((option) => option.key === key)) {
      return llmOptions;
    }

    return [
      ...llmOptions,
      {
        key,
        label: `${skill.llmProviderConfigId} В· ${skill.modelId}`,
        providerId: skill.llmProviderConfigId,
        providerName: skill.llmProviderConfigId,
        modelId: skill.modelId,
        providerIsActive: false,
        disabled: true,
      },
    ];
  }, [llmOptions, skill]);

  useEffect(() => {
    if (!isOpen) {
      const nextValues = { ...defaultFormValues };
      form.reset(nextValues);
      lastSavedRef.current = nextValues;
      return;
    }

    if (skill) {
      const ragConfig = skill.ragConfig ?? {
        mode: "all_collections",
        collectionIds: [],
        topK: 5,
        minScore: 0.7,
        maxContextTokens: null,
        showSources: true,
        embeddingProviderId: null,
        bm25Weight: null,
        bm25Limit: null,
        vectorWeight: null,
        vectorLimit: null,
        llmTemperature: null,
        llmMaxTokens: null,
        llmResponseFormat: null,
      };

      const llmKey = buildLlmKey(skill.llmProviderConfigId ?? "", skill.modelId ?? "");
      const noCodeConnection = skill.noCodeConnection ?? {
        endpointUrl: null,
        authType: "none" as "none" | "bearer",
        tokenIsSet: false,
      };
      const nextValues: SkillFormValues = {
        name: skill.name ?? "",
        description: skill.description ?? "",
        executionMode: skill.executionMode ?? "standard",
        mode: skill.mode ?? "llm",
        knowledgeBaseIds: skill.knowledgeBaseIds ?? [],
        llmKey,
        llmTemperature:
          ragConfig.llmTemperature === null || ragConfig.llmTemperature === undefined
            ? ""
            : String(ragConfig.llmTemperature),
        llmMaxTokens:
          ragConfig.llmMaxTokens === null || ragConfig.llmMaxTokens === undefined
            ? ""
            : String(ragConfig.llmMaxTokens),
        systemPrompt: skill.systemPrompt ?? "",
        icon: skill.icon ?? "",
        ragMode: ragConfig.mode,
        ragCollectionIds: ragConfig.collectionIds,
        ragTopK: String(ragConfig.topK),
        ragMinScore: String(ragConfig.minScore),
        ragMaxContextTokens: ragConfig.maxContextTokens !== null ? String(ragConfig.maxContextTokens) : "",
        ragShowSources: ragConfig.showSources,
        ragEmbeddingProviderId: ragConfig.embeddingProviderId ?? NO_EMBEDDING_PROVIDER_VALUE,
        onTranscriptionMode: skill.onTranscriptionMode ?? "raw_only",
        onTranscriptionAutoActionId: skill.onTranscriptionAutoActionId ?? "",
        noCodeEndpointUrl: noCodeConnection.endpointUrl ?? "",
        noCodeAuthType: noCodeConnection.authType ?? "none",
        noCodeBearerToken: "",
      };
      form.reset(nextValues);
      lastSavedRef.current = nextValues;
      return;
    }

    const fallbackLlmKey = effectiveLlmOptions.find((option) => !option.disabled)?.key ?? "";
    const nextValues = { ...defaultFormValues, llmKey: fallbackLlmKey };
    form.reset(nextValues);
    lastSavedRef.current = nextValues;
  }, [isOpen, skill, form, effectiveLlmOptions]);

  const handleSubmit = form.handleSubmit(async (values) => {
    if (isSystemSkill) {
      return;
    }
    try {
      const didSave = await onSubmit(values);
      if (didSave) {
        const normalized: SkillFormValues = {
          ...values,
          name: values.name.trim(),
          description: values.description?.trim() ?? "",
          systemPrompt: values.systemPrompt?.trim() ?? "",
          icon: values.icon?.trim() ?? "",
        };
        lastSavedRef.current = normalized;
        form.reset(normalized);
      }
    } catch {
      // Ошибка обрабатывается в родителе через toast, оставляем форму dirty.
    }
  });

  const selectedKnowledgeBasesDisabled = sortedKnowledgeBases.length === 0;
  const llmDisabled = effectiveLlmOptions.length === 0;

  const renderIconPreview = (iconName: string | null | undefined, className = "h-5 w-5") => {
    const Icon = getSkillIcon(iconName);
    return Icon ? <Icon className={className} /> : null;
  };

  const isDirty = form.formState.isDirty;

  const handleReset = () => {
    form.reset(lastSavedRef.current);
  };

  return (
    <div className="space-y-6">
      {!hideHeader && isSystemSkill && (
        <Alert variant="default">
          <AlertTitle>Системный навык</AlertTitle>
          <AlertDescription>{systemSkillDescription}</AlertDescription>
        </Alert>
      )}
      <Form {...form}>
        <form onSubmit={handleSubmit} className="space-y-6">
          <Tabs value={currentTab} onValueChange={handleTabChange} className="space-y-4">
            <div className="mx-auto w-full max-w-6xl px-6">
              <TabsList className="inline-flex h-9 w-full items-center justify-start rounded-lg bg-muted p-[3px] overflow-x-auto">
                <TabsTrigger value="main" data-testid="skill-settings-tab-main" className="whitespace-nowrap">
                  Основное
                </TabsTrigger>
                <TabsTrigger value="transcription" data-testid="skill-settings-tab-transcription" className="whitespace-nowrap">
                  Транскрипция
                </TabsTrigger>
                <TabsTrigger value="actions" className="whitespace-nowrap">
                  Действия
                </TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value="main" className="space-y-6">
              <div className="mx-auto w-full max-w-6xl px-6">
              <fieldset disabled={controlsDisabled} className="space-y-6">
                <div className="grid gap-6 lg:grid-cols-[340px_1fr]">
                <Card>
                  <CardHeader className="px-6 grid gap-2">
                    <CardTitle className="text-base font-semibold">Метаданные</CardTitle>
                  </CardHeader>
                  <CardContent className="px-6 pb-6">
                    <div className="grid gap-4" data-testid="skill-icon-name-row">
                      <FormField
                        control={form.control}
                        name="icon"
                        render={({ field }) => (
                          <FormItem className="grid gap-1.5">
                            <FormLabel>Иконка</FormLabel>
                            <FormControl>
                              <div className="flex items-center gap-3">
                                <IconPicker
                                  value={field.value ?? ""}
                                  onChange={(icon) => field.onChange(icon)}
                                  renderIcon={(iconName, className = "h-5 w-5") =>
                                    renderIconPreview(iconName, className)
                                  }
                                />
                                <span className="text-sm text-muted-foreground" data-testid="skill-icon-label">
                                  {iconValue ? iconValue : "Не выбрана"}
                                </span>
                              </div>
                            </FormControl>
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="name"
                        render={({ field }) => (
                          <FormItem className="grid gap-1.5">
                            <FormLabel>Название</FormLabel>
                            <FormControl>
                              <Input
                                {...field}
                                placeholder="Например: Бизнес-процессы"
                                data-testid="skill-name-input"
                              />
                            </FormControl>
                            <FormMessage className="text-xs text-destructive leading-tight" />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="description"
                        render={({ field }) => (
                          <FormItem className="grid gap-1.5">
                            <FormLabel>Описание</FormLabel>
                            <FormControl>
                              <Textarea
                                {...field}
                                placeholder="Когда использовать навык и чем он помогает"
                                rows={3}
                                data-testid="skill-description-input"
                              />
                            </FormControl>
                            <FormMessage className="text-xs text-destructive leading-tight" />
                          </FormItem>
                        )}
                      />
                    </div>
                  </CardContent>
                </Card>

                <div className="grid gap-6">
                  <Card>
                    <CardHeader className="px-6 grid gap-2">
                      <CardTitle className="text-base font-semibold">Инструкция</CardTitle>
                    </CardHeader>
                    <CardContent className="px-6 pb-6">
                      <FormField
                        control={form.control}
                        name="systemPrompt"
                        render={({ field }) => (
                          <FormItem className="grid gap-1.5">
                            <FormLabel className="sr-only">Инструкция</FormLabel>
                            <FormControl>
                              <Textarea
                                {...field}
                                placeholder="Добавьте инструкции для модели"
                                className="min-h-[220px]"
                                data-testid="skill-instruction-textarea"
                              />
                            </FormControl>
                            <p className="text-xs text-muted-foreground leading-tight">
                              Всегда отправляется в LLM.
                            </p>
                            <FormMessage className="text-xs text-destructive leading-tight" />
                          </FormItem>
                        )}
                      />
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="px-6 grid gap-2">
                      <CardTitle className="text-base font-semibold">Режим выполнения</CardTitle>
                      <CardDescription className="text-sm text-muted-foreground">
                        Определяет, где выполняется логика обработки сообщений.
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="px-6 pb-6 space-y-4">
                      <FormField
                        control={form.control}
                        name="executionMode"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Режим</FormLabel>
                            <FormControl>
                              <RadioGroup
                                value={field.value}
                                onValueChange={controlsDisabled ? undefined : field.onChange}
                                className="grid gap-3 md:grid-cols-2"
                              >
                                <div className="rounded-lg border p-3">
                                  <label className="flex items-start gap-3 text-sm font-medium leading-tight">
                                    <RadioGroupItem
                                      value="standard"
                                      id="execution-mode-standard"
                                      className="mt-1"
                                      disabled={controlsDisabled}
                                      data-testid="execution-mode-standard"
                                    />
                                    <span>
                                      Стандартный
                                      <span className="block text-xs font-normal text-muted-foreground">
                                        Обработка внутри платформы.
                                      </span>
                                    </span>
                                  </label>
                                </div>
                                <div className="rounded-lg border p-3">
                                  <label className="flex items-start gap-3 text-sm font-medium leading-tight">
                                    <RadioGroupItem
                                      value="no_code"
                                      id="execution-mode-no-code"
                                      className="mt-1"
                                      disabled={noCodeDisabled}
                                      data-testid="execution-mode-no-code"
                                    />
                                    <span>
                                      No-code
                                      <span className="block text-xs font-normal text-muted-foreground">
                                        Обработка во внешнем сценарии (оркестрация настраивается отдельно).
                                      </span>
                                      {!allowNoCodeFlow && (
                                        <span className="block text-xs font-normal text-muted-foreground">
                                          Доступно на премиум-тарифе.
                                        </span>
                                      )}
                                    </span>
                                  </label>
                                </div>
                              </RadioGroup>
                            </FormControl>
                            <FormMessage className="text-xs text-destructive leading-tight" />
                          </FormItem>
                        )}
                      />
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="px-6 grid gap-2">
                      <CardTitle className="text-base font-semibold">No-code подключение</CardTitle>
                      <CardDescription className="text-sm text-muted-foreground">
                        {allowNoCodeFlow
                          ? isNoCodeMode
                            ? "Укажите URL и авторизацию, чтобы платформа перенаправляла события во внешний сценарий."
                            : "Можно заранее задать параметры, затем переключитесь в режим No-code."
                          : "Доступно только на премиум-тарифе."}
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="px-6 pb-6 space-y-4">
                      <FormField
                        control={form.control}
                        name="noCodeEndpointUrl"
                        render={({ field }) => (
                          <FormItem className="grid gap-1.5">
                            <FormLabel>URL сценария</FormLabel>
                            <FormControl>
                              <Input
                                {...field}
                                placeholder="https://example.com/no-code"
                                disabled={noCodeDisabled}
                                data-testid="skill-no-code-endpoint-input"
                              />
                            </FormControl>
                            <FormDescription className="text-xs text-muted-foreground leading-tight">
                              {noCodeDisabled
                                ? "Доступно только на премиум-тарифе."
                                : "Сюда будет приходить запрос, когда выбранно выполнение в no-code режиме."}
                            </FormDescription>
                            <FormMessage className="text-xs text-destructive leading-tight" />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="noCodeAuthType"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Авторизация</FormLabel>
                            <FormControl>
                              <RadioGroup
                                value={field.value}
                                onValueChange={noCodeDisabled ? undefined : field.onChange}
                                className="grid gap-3 md:grid-cols-2"
                              >
                                <div className="rounded-lg border p-3">
                                  <label className="flex items-start gap-3 text-sm font-medium leading-tight">
                                    <RadioGroupItem
                                      value="none"
                                      id="no-code-auth-none"
                                      className="mt-1"
                                      disabled={noCodeDisabled}
                                      data-testid="no-code-auth-none"
                                    />
                                    <span>
                                      Без авторизации
                                      <span className="block text-xs font-normal text-muted-foreground">
                                        Сценарий без токена.
                                      </span>
                                    </span>
                                  </label>
                                </div>
                                <div className="rounded-lg border p-3">
                                  <label className="flex items-start gap-3 text-sm font-medium leading-tight">
                                    <RadioGroupItem
                                      value="bearer"
                                      id="no-code-auth-bearer"
                                      className="mt-1"
                                      disabled={noCodeDisabled}
                                      data-testid="no-code-auth-bearer"
                                    />
                                    <span>
                                      Bearer token
                                      <span className="block text-xs font-normal text-muted-foreground">
                                        Отправляем токен в заголовке Authorization.
                                      </span>
                                    </span>
                                  </label>
                                </div>
                              </RadioGroup>
                            </FormControl>
                          </FormItem>
                        )}
                      />
                      {noCodeAuthType === "bearer" && (
                        <FormField
                          control={form.control}
                          name="noCodeBearerToken"
                          render={({ field }) => (
                            <FormItem className="grid gap-1.5">
                              <FormLabel>Bearer токен</FormLabel>
                              <FormControl>
                                <Input
                                  {...field}
                                  type="password"
                                  placeholder="Введите токен"
                                  disabled={noCodeDisabled}
                                  autoComplete="new-password"
                                  data-testid="skill-no-code-token-input"
                                />
                              </FormControl>
                              <FormDescription className="text-xs text-muted-foreground leading-tight">
                                {hasBearerTokenDraft
                                  ? "После сохранения токен будет заменён."
                                  : storedNoCodeTokenIsSet
                                  ? "Токен задан. Введите новый, чтобы заменить."
                                  : "Токен не сохраняется и не отображается после сохранения."}
                              </FormDescription>
                              <FormMessage className="text-xs text-destructive leading-tight" />
                            </FormItem>
                          )}
                        />
                      )}
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="px-6 grid gap-2">
                      <CardTitle className="text-base font-semibold">Модель LLM</CardTitle>
                    </CardHeader>
                    <CardContent className="px-6 pb-6 space-y-4">
                      <FormField
                        control={form.control}
                        name="llmKey"
                        render={({ field }) => (
                          <FormItem className="grid gap-1.5">
                            <FormLabel>LLM провайдер и модель</FormLabel>
                            <FormControl>
                              <Select value={field.value} onValueChange={field.onChange} disabled={llmDisabled || controlsDisabled}>
                                <SelectTrigger data-testid="llm-model-select">
                                  <SelectValue placeholder="Выберите модель" />
                                </SelectTrigger>
                                <SelectContent>
                                  {effectiveLlmOptions.map((option) => (
                                    <SelectItem key={option.key} value={option.key} disabled={option.disabled}>
                                      <div className="flex flex-col gap-0.5">
                                        <div className="flex items-center gap-2">
                                          <span className="font-medium">{option.label}</span>
                                          <Badge variant="outline" className="uppercase tracking-wide">
                                            {costLevelLabel[option.costLevel]}
                                          </Badge>
                                        </div>
                                        {!option.providerIsActive && (
                                          <span className="text-xs text-muted-foreground">Провайдер отключён</span>
                                        )}
                                      </div>
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </FormControl>
                            <p className="text-xs text-muted-foreground leading-tight">
                              Используется для генеративных ответов навыка.
                            </p>
                            <FormMessage className="text-xs text-destructive leading-tight" />
                          </FormItem>
                        )}
                      />

                      <Accordion type="single" collapsible>
                        <AccordionItem value="llm-advanced" className="border-none">
                          <AccordionTrigger className="py-2" data-testid="llm-advanced-accordion">
                            Параметры LLM
                          </AccordionTrigger>
                          <AccordionContent>
                            <div className="grid gap-4 md:grid-cols-2">
                              <FormField
                                control={form.control}
                                name="llmTemperature"
                                render={({ field }) => (
                                  <FormItem>
                                    <div className="flex items-center gap-2">
                                      <FormLabel>Температура</FormLabel>
                                      <InfoTooltipIcon text="Определяет вариативность ответа модели. Чем выше значение, тем более креативный ответ." />
                                    </div>
                                    <FormControl>
                                      <Input
                                        type="number"
                                        step="0.1"
                                        min={0}
                                        max={2}
                                        placeholder="0.7"
                                        value={field.value ?? ""}
                                        onChange={(event) => field.onChange(event.target.value)}
                                        data-testid="llm-temperature-input"
                                      />
                                    </FormControl>
                                    <FormDescription className="text-xs text-muted-foreground leading-tight">
                                      Оставьте пустым, чтобы использовать значения провайдера.
                                    </FormDescription>
                                    <FormMessage className="text-xs text-destructive leading-tight" />
                                  </FormItem>
                                )}
                              />
                              <FormField
                                control={form.control}
                                name="llmMaxTokens"
                                render={({ field }) => (
                                  <FormItem>
                                    <div className="flex items-center gap-2">
                                      <FormLabel>Макс. токенов ответа</FormLabel>
                                      <InfoTooltipIcon text="Ограничивает длину ответа модели. Если пусто — используем настройки провайдера." />
                                    </div>
                                    <FormControl>
                                      <Input
                                        type="number"
                                        min={16}
                                        max={4096}
                                        placeholder="1024"
                                        value={field.value ?? ""}
                                        onChange={(event) => field.onChange(event.target.value)}
                                        data-testid="llm-max-tokens-input"
                                      />
                                    </FormControl>
                                    <FormMessage className="text-xs text-destructive leading-tight" />
                                  </FormItem>
                                )}
                              />
                            </div>
                          </AccordionContent>
                        </AccordionItem>
                      </Accordion>
                    </CardContent>
                  </Card>
                </div>
              </div>

                <div className="grid gap-6">
                <Card>
                  <CardHeader className="px-6 grid gap-2">
                    <CardTitle className="text-base font-semibold">Базы знаний</CardTitle>
                    <CardDescription className="text-sm text-muted-foreground">
                      Навык будет искать ответы только в выбранных базах знаний.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="px-6 pb-6">
                    <FormField
                      control={form.control}
                      name="knowledgeBaseIds"
                      render={({ field }) => (
                        <FormItem>
                          <FormControl>
                            <KnowledgeBaseMultiSelect
                              value={field.value}
                              onChange={field.onChange}
                              knowledgeBases={sortedKnowledgeBases}
                              disabled={selectedKnowledgeBasesDisabled || controlsDisabled}
                            />
                          </FormControl>
                          <FormMessage className="text-xs text-destructive leading-tight" />
                        </FormItem>
                      )}
                    />
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="px-6 grid gap-2">
                    <CardTitle className="text-base font-semibold">Коллекции и режим</CardTitle>
                    <CardDescription className="text-sm text-muted-foreground">
                      Управляют тем, где искать и сколько текста отдавать в ответах.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="px-6 pb-6 space-y-4">
                    <FormField
                      control={form.control}
                      name="ragMode"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Режим использования коллекций</FormLabel>
                          <FormControl>
                            <RadioGroup
                              value={field.value}
                              onValueChange={controlsDisabled ? undefined : field.onChange}
                              className="grid gap-3 md:grid-cols-2"
                            >
                              <div className="rounded-lg border p-3">
                                <label className="flex items-start gap-3 text-sm font-medium leading-tight">
                                  <RadioGroupItem value="all_collections" id="rag-mode-all" className="mt-1" disabled={controlsDisabled} />
                                  <span>
                                    Все коллекции
                                    <span className="block text-xs font-normal text-muted-foreground">
                                      Навык автоматически ищет во всех коллекциях рабочей области.
                                    </span>
                                  </span>
                                </label>
                              </div>
                              <div className="rounded-lg border p-3">
                                <label className="flex items-start gap-3 text-sm font-medium leading-tight">
                                  <RadioGroupItem value="selected_collections" id="rag-mode-selected" className="mt-1" disabled={controlsDisabled} />
                                  <span>
                                    Выбрать вручную
                                    <span className="block text-xs font-normal text-muted-foreground">
                                      Укажите конкретные коллекции, в которых навык может искать ответы.
                                    </span>
                                  </span>
                                </label>
                              </div>
                            </RadioGroup>
                          </FormControl>
                          <FormMessage className="text-xs text-destructive leading-tight" />
                        </FormItem>
                      )}
                    />

                    {isManualRagMode ? (
                      <FormField
                        control={form.control}
                        name="ragCollectionIds"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Коллекции для навыка</FormLabel>
                            <FormControl>
                              <VectorCollectionMultiSelect
                                value={field.value}
                                onChange={field.onChange}
                                collections={vectorCollections}
                                disabled={vectorCollectionsDisabled}
                              />
                            </FormControl>
                            <FormDescription className="text-xs text-muted-foreground leading-tight">
                              {isVectorCollectionsLoading
                                ? "Загружаем список коллекций..."
                                : vectorCollectionsEmpty
                                  ? "Коллекций пока нет — создайте их в разделе “Vector Collections”."
                                  : "Можно выбрать одну или несколько коллекций рабочего пространства."}
                            </FormDescription>
                            <FormMessage className="text-xs text-destructive leading-tight" />
                          </FormItem>
                        )}
                      />
                    ) : null}
                  </CardContent>
                </Card>

                <Card>
                  <CardContent className="px-6 pb-6">
                    <Accordion type="single" collapsible>
                      <AccordionItem value="rag-advanced" className="border-none">
                        <AccordionTrigger className="py-2">RAG (дополнительно)</AccordionTrigger>
                        <AccordionContent>
                          <div className="space-y-4">
                            <div className="space-y-1">
                              <h3 className="text-base font-semibold">Провайдер эмбеддингов</h3>
                              <p className="text-sm text-muted-foreground">
                                Должен совпадать с тем, что использует выбранная коллекция.
                              </p>
                            </div>
                            <FormField
                              control={form.control}
                              name="ragEmbeddingProviderId"
                              render={({ field }) => (
                                <FormItem>
                                  <Select
                                    value={field.value ?? NO_EMBEDDING_PROVIDER_VALUE}
                                    onValueChange={field.onChange}
                                    disabled={embeddingProviderSelectDisabled}
                                  >
                                    <SelectTrigger>
                                      <SelectValue
                                        placeholder={
                                          embeddingProvidersUnavailable
                                            ? "Загрузка..."
                                            : embeddingProvidersEmpty
                                              ? "Нет доступных сервисов"
                                              : "Выберите сервис"
                                        }
                                      />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value={NO_EMBEDDING_PROVIDER_VALUE}>Не выбрано</SelectItem>
                                      {effectiveEmbeddingProviderOptions.map((provider) => (
                                        <SelectItem key={provider.id} value={provider.id} disabled={!provider.isActive}>
                                          <div className="flex flex-col gap-0.5">
                                            <span>{provider.name}</span>
                                            {!provider.isActive && (
                                              <span className="text-xs text-muted-foreground">Провайдер отключён</span>
                                            )}
                                          </div>
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                  <FormMessage className="text-xs text-destructive leading-tight" />
                                </FormItem>
                              )}
                            />

                            <div className="space-y-1">
                              <h3 className="text-base font-semibold">Параметры поиска</h3>
                              <p className="text-sm text-muted-foreground">Управляют объёмом и точностью выдачи.</p>
                            </div>
                            <div className="grid gap-4 md:grid-cols-2">
                              <FormField
                                control={form.control}
                                name="ragTopK"
                                render={({ field }) => (
                                  <FormItem>
                                    <div className="flex items-center gap-2">
                                      <FormLabel>topK</FormLabel>
                                      <InfoTooltipIcon text="Число чанков, которые ищем для каждого запроса. Больше — точнее, но дороже. По умолчанию 5." />
                                    </div>
                                    <FormControl>
                                      <Input
                                        type="number"
                                        min={1}
                                        max={50}
                                        placeholder="5"
                                        value={field.value ?? ""}
                                        onChange={(event) => field.onChange(event.target.value)}
                                      />
                                    </FormControl>
                                    <FormMessage className="text-xs text-destructive leading-tight" />
                                  </FormItem>
                                )}
                              />
                              <FormField
                                control={form.control}
                                name="ragMinScore"
                                render={({ field }) => (
                                  <FormItem>
                                    <div className="flex items-center gap-2">
                                      <FormLabel>minScore</FormLabel>
                                      <InfoTooltipIcon text="Минимальная релевантность чанка (0–1). Всё, что ниже порога, отбрасывается." />
                                    </div>
                                    <FormControl>
                                      <Input
                                        type="number"
                                        step="0.05"
                                        min={0}
                                        max={1}
                                        placeholder="0.7"
                                        value={field.value ?? ""}
                                        onChange={(event) => field.onChange(event.target.value)}
                                      />
                                    </FormControl>
                                    <FormMessage className="text-xs text-destructive leading-tight" />
                                  </FormItem>
                                )}
                              />
                            </div>

                            <FormField
                              control={form.control}
                              name="ragMaxContextTokens"
                              render={({ field }) => (
                                <FormItem>
                                  <div className="flex items-center gap-2">
                                    <FormLabel>Лимит контекста (токены)</FormLabel>
                                    <InfoTooltipIcon text="Мягкий лимит на суммарный текст из базы знаний для одного ответа LLM. Если пусто — используем настройку по умолчанию." />
                                  </div>
                                  <FormControl>
                                    <Input
                                      type="number"
                                      min={500}
                                      placeholder="3000"
                                      value={field.value ?? ""}
                                      onChange={(event) => field.onChange(event.target.value)}
                                    />
                                  </FormControl>
                                  <FormDescription className="text-xs text-muted-foreground leading-tight">
                                    Оставьте поле пустым, чтобы использовать стандартное значение.
                                  </FormDescription>
                                  <FormMessage className="text-xs text-destructive leading-tight" />
                                </FormItem>
                              )}
                            />

                            <FormField
                              control={form.control}
                              name="ragShowSources"
                              render={({ field }) => (
                                <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3">
                                  <div className="space-y-0.5">
                                    <FormLabel className="text-base">Показывать источники в ответе</FormLabel>
                                    <FormDescription className="text-xs text-muted-foreground leading-tight">
                                      Показывает пользователю документы и ссылки, из которых взяты чанки.
                                    </FormDescription>
                                  </div>
                                  <FormControl>
                                    <Switch checked={field.value} onCheckedChange={field.onChange} disabled={controlsDisabled} />
                                  </FormControl>
                                </FormItem>
                              )}
                            />
                          </div>
                        </AccordionContent>
                      </AccordionItem>
                    </Accordion>
                  </CardContent>
                </Card>
                </div>
              </fieldset>
              </div>
            </TabsContent>

            <TabsContent value="transcription" className="space-y-6">
              <div className="mx-auto w-full max-w-6xl px-6">
                <fieldset disabled={controlsDisabled} className="space-y-6">
                  <Card>
                    <CardHeader className="px-6 grid gap-2">
                      <CardTitle className="text-base font-semibold">Поведение при транскрибировании аудио</CardTitle>
                      <CardDescription className="text-sm text-muted-foreground">
                        Оставить сырую стенограмму или автоматически запустить действие после транскрипции.
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="px-6 pb-6 space-y-4">
                      <FormField
                        control={form.control}
                        name="onTranscriptionMode"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Режим</FormLabel>
                            <FormControl>
                              <RadioGroup
                                value={field.value}
                                onValueChange={controlsDisabled ? undefined : field.onChange}
                                className="grid gap-3 md:grid-cols-2"
                              >
                                <div className="rounded-lg border p-3">
                                  <label className="flex items-start gap-3 text-sm font-medium leading-tight">
                                    <RadioGroupItem
                                      value="raw_only"
                                      id="transcription-mode-raw"
                                      className="mt-1"
                                      disabled={controlsDisabled}
                                    />
                                    <span>
                                      Только транскрипция
                                      <span className="block text-xs font-normal text-muted-foreground">
                                        Создаётся сырая стенограмма без дополнительных шагов.
                                      </span>
                                    </span>
                                  </label>
                                </div>
                                <div className="rounded-lg border p-3">
                                  <label className="flex items-start gap-3 text-sm font-medium leading-tight">
                                    <RadioGroupItem
                                      value="auto_action"
                                      id="transcription-mode-auto"
                                      className="mt-1"
                                      disabled={controlsDisabled}
                                    />
                                    <span>
                                      Транскрипция + авто-действие
                                      <span className="block text-xs font-normal text-muted-foreground">
                                        После получения стенограммы запускается выбранное действие.
                                      </span>
                                    </span>
                                  </label>
                                </div>
                              </RadioGroup>
                            </FormControl>
                            <FormMessage className="text-xs text-destructive leading-tight" />
                          </FormItem>
                        )}
                      />

                      {isAutoActionMode ? (
                        <FormField
                          control={form.control}
                          name="onTranscriptionAutoActionId"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Действие для авто-запуска</FormLabel>
                              {skill ? (
                                <FormControl>
                                  <Select
                                    value={field.value ?? ""}
                                    onValueChange={field.onChange}
                                    disabled={controlsDisabled || transcriptActionsQuery.isLoading || transcriptActions.length === 0}
                                  >
                                    <SelectTrigger>
                                      <SelectValue
                                        placeholder={
                                          transcriptActionsQuery.isLoading
                                            ? "Загружаем действия..."
                                            : transcriptActions.length === 0
                                              ? "Нет действий с целью «Стенограмма»"
                                              : "Выберите действие"
                                        }
                                      />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {transcriptActions.map((item) => (
                                        <SelectItem key={item.action.id} value={item.action.id}>
                                          {item.action.label}
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                </FormControl>
                              ) : (
                                <div className="rounded-md border border-dashed bg-slate-50 p-3 text-sm text-muted-foreground dark:border-slate-700 dark:bg-slate-900/40">
                                  Доступно после сохранения навыка. Сначала создайте навык, затем выберите авто-действие.
                                </div>
                              )}
                              <FormDescription className="text-xs text-muted-foreground leading-tight">
                                Покажем превью обработанного результата и откроем вкладку действия при просмотре стенограммы.
                              </FormDescription>
                              <FormMessage className="text-xs text-destructive leading-tight" />
                            </FormItem>
                          )}
                        />
                      ) : null}
                    </CardContent>
                  </Card>
                </fieldset>
              </div>
            </TabsContent>

            <TabsContent value="actions" className="space-y-6">
              <div className="mx-auto w-full max-w-6xl px-6">
                <fieldset disabled={controlsDisabled} className="space-y-6">
                  <Card>
                    <CardHeader className="px-6 grid gap-2">
                      <CardTitle className="text-base font-semibold">Действия</CardTitle>
                      <CardDescription className="text-xs text-muted-foreground leading-tight">
                        Настройте, какие действия доступны в навыке и где они отображаются (холст, сообщения, панель ввода).
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="px-6 pb-6">
                      {isSystemSkill ? (
                        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-muted-foreground dark:border-slate-700 dark:bg-slate-900/40">
                          Настройка действий недоступна для системных навыков.
                        </div>
                      ) : skill?.id ? (
                        <SkillActionsPreview skillId={skill.id} />
                      ) : (
                        <ActionsPreviewForNewSkill />
                      )}
                    </CardContent>
                  </Card>
                </fieldset>
              </div>
            </TabsContent>
          </Tabs>

          {isDirty ? (
            <div className="mx-auto w-full max-w-6xl px-6">
              <div className="sticky bottom-0 z-10 -mx-6 mt-6 border-t border-border bg-background/80 px-6 py-3 backdrop-blur">
                <div className="flex justify-end gap-2">
                  <Button type="button" variant="secondary" className="h-9" onClick={handleReset} disabled={isSubmitting}>
                    Отмена
                  </Button>
                  <Button
                    type="submit"
                    className="h-9"
                    disabled={isSubmitting || isSystemSkill}
                    data-testid="save-button"
                  >
                    {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    {isSystemSkill ? "Недоступно" : "Сохранить"}
                  </Button>
                </div>
              </div>
            </div>
          ) : null}
        </form>
      </Form>
    </div>
  );
}


async function fetchKnowledgeBases(workspaceId: string): Promise<KnowledgeBaseSummary[]> {
  const response = await apiRequest("GET", "/api/knowledge/bases", undefined, undefined, { workspaceId });
  return (await response.json()) as KnowledgeBaseSummary[];
}

export default function SkillsPage() {
  const [, navigate] = useLocation();
  const openSkill = (url: string, e?: { metaKey?: boolean; ctrlKey?: boolean; button?: number }) => {
    const openInNewTab = Boolean(e?.metaKey || e?.ctrlKey || e?.button === 1);
    if (openInNewTab) {
      window.open(url, "_blank");
    } else {
      navigate(url);
    }
  };
  const { data: session } = useQuery<SessionResponse>({
    queryKey: ["/api/auth/session"],
  });
  const workspaceId = session?.workspace.active.id ?? session?.activeWorkspaceId ?? null;
  const {
    skills,
    isLoading: isSkillsLoading,
    isError,
    error,
    refetch: refetchSkills,
  } = useSkills({ workspaceId, enabled: Boolean(workspaceId) });
  const knowledgeBaseQuery = useQuery<KnowledgeBaseSummary[]>({
    queryKey: ["knowledge-bases", workspaceId],
    queryFn: () => fetchKnowledgeBases(workspaceId as string),
    enabled: Boolean(workspaceId),
  });
  const vectorCollectionsQuery = useQuery<VectorCollectionsResponse>({
    queryKey: ["/api/vector/collections", workspaceId],
    enabled: Boolean(workspaceId),
    queryFn: async () => {
      if (!workspaceId) {
        throw new Error("Рабочее пространство не выбрано");
      }
      const response = await apiRequest("GET", "/api/vector/collections", undefined, undefined, { workspaceId });
      return (await response.json()) as VectorCollectionsResponse;
    },
  });
  const {
    data: embeddingProvidersResponse,
    isLoading: isEmbeddingProvidersLoading,
    error: embeddingProvidersErrorRaw,
  } = useQuery<{ providers: PublicEmbeddingProvider[] }>({
    queryKey: ["/api/embedding/services"],
    queryFn: async () => {
      const response = await apiRequest("GET", "/api/embedding/services");
      return (await response.json()) as { providers: PublicEmbeddingProvider[] };
    },
  });
  const {
    data: llmProvidersResponse,
    isLoading: isLlmLoading,
    error: llmError,
  } = useQuery<{ providers: PublicLlmProvider[] }>({
    queryKey: ["/api/llm/providers"],
  });

  const { data: catalogLlmModels = [], isLoading: isModelsLoading, error: modelsError } = useModels("LLM");

  const llmProviders = llmProvidersResponse?.providers ?? [];

  const knowledgeBases = knowledgeBaseQuery.data ?? [];
  const vectorCollections = vectorCollectionsQuery.data?.collections ?? [];
  const vectorCollectionsError = vectorCollectionsQuery.error as Error | undefined;
  const embeddingProviders = embeddingProvidersResponse?.providers ?? [];
  const embeddingProvidersError = embeddingProvidersErrorRaw as Error | undefined;
  const { toast } = useToast();
  const [archiveTarget, setArchiveTarget] = useState<Skill | null>(null);
  const [isArchiving, setIsArchiving] = useState(false);

  const knowledgeBaseMap = useMemo(() => {
    return new Map(knowledgeBases.map((kb) => [kb.id, kb]));
  }, [knowledgeBases]);

  const sortedSkills = useMemo(() => {
    return [...skills].sort((a, b) => {
      const aName = a.name?.toLowerCase() ?? "";
      const bName = b.name?.toLowerCase() ?? "";
      return aName.localeCompare(bName, "ru");
    });
  }, [skills]);

  const llmOptions = useMemo<LlmSelectionOption[]>(() => {
    const options: LlmSelectionOption[] = [];
    const byProvider = catalogLlmModels.reduce<Record<string, typeof catalogLlmModels>>((acc, model) => {
      if (!model.providerId) return acc;
      acc[model.providerId] = acc[model.providerId] ?? [];
      acc[model.providerId].push(model);
      return acc;
    }, {});

    for (const provider of llmProviders) {
      const models = byProvider[provider.id] ?? [];
      for (const model of models) {
        const labelText = `${provider.name} · ${model.displayName}`;
        options.push({
          key: buildLlmKey(provider.id, model.key),
          label: labelText,
          providerId: provider.id,
          providerName: provider.name,
          modelId: model.key,
          modelDisplayName: model.displayName,
          costLevel: model.costLevel,
          providerIsActive: provider.isActive,
          disabled: !provider.isActive,
          catalogModel: model,
        });
      }
    }

    return options.sort((a, b) => a.label.localeCompare(b.label, "ru"));
  }, [llmProviders, catalogLlmModels]);

  const llmOptionByKey = useMemo(() => {
    return new Map(llmOptions.map((option) => [option.key, option]));
  }, [llmOptions]);

  const dateFormatter = useMemo(() => {
    return new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium", timeStyle: "short" });
  }, []);

  const creationDisabledReason = (() => {
    if (llmOptions.length === 0) {
      return "Подключите активного провайдера LLM с моделью из каталога.";
    }
    return null;
  })();

  const handleEditClick = (skill: Skill) => {
    if (skill.isSystem) {
      toast({
        title: "Системный навык",
        description:
          skill.systemKey === "UNICA_CHAT"
            ? "Настройки Unica Chat управляются администратором инстанса."
            : "Системные навыки нельзя изменять в рабочем пространстве.",
        variant: "destructive",
      });
      return;
    }
    navigate(`/skills/${skill.id}/edit`);
  };

  const handleArchiveSkill = async (skill: Skill) => {
    setArchiveTarget(skill);
  };

  const confirmArchiveSkill = async () => {
    if (!archiveTarget) return;
    setIsArchiving(true);
    try {
      const response = await apiRequest("DELETE", `/api/skills/${archiveTarget.id}`);
      const payload = await response.json().catch(() => ({}));
      await refetchSkills();
      toast({
        title: "Навык архивирован",
        description:
          typeof payload?.archivedChats === "number"
            ? `В архив переведено чатов: ${payload.archivedChats}`
            : undefined,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Не удалось архивировать навык";
      toast({ title: "Ошибка", description: message, variant: "destructive" });
    } finally {
      setIsArchiving(false);
      setArchiveTarget(null);
    }
  };

  const renderKnowledgeBases = (skill: Skill) => {
    const ids = skill.knowledgeBaseIds ?? [];
    if (ids.length === 0) {
      return <span className="text-sm text-muted-foreground">Не выбрано</span>;
    }

    return (
      <div className="flex flex-wrap gap-1">
        {ids.map((id) => {
          const kb = knowledgeBaseMap.get(id);
          return (
            <Badge key={id} variant="secondary" className="text-xs">
              {kb ? kb.name : `#${id}`}
            </Badge>
          );
        })}
      </div>
    );
  };

  const renderLlmInfo = (skill: Skill) => {
    if (!skill.llmProviderConfigId || !skill.modelId) {
      return <span className="text-sm text-muted-foreground">Не задано</span>;
    }

    const key = buildLlmKey(skill.llmProviderConfigId, skill.modelId);
    const option = llmOptionByKey.get(key);
    const isActive = option ? option.providerIsActive : true;
    const label = option ? option.label : `${skill.llmProviderConfigId} · ${skill.modelId}`;

    return (
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium leading-tight">{label}</p>
          {option && (
            <Badge variant="outline" className="uppercase tracking-wide">
              {costLevelLabel[option.costLevel]}
            </Badge>
          )}
        </div>
        {!isActive && <p className="text-xs text-muted-foreground">Провайдер отключён</p>}
      </div>
    );
  };

  const showLoadingState =
    isSkillsLoading ||
    knowledgeBaseQuery.isLoading ||
    isLlmLoading ||
    vectorCollectionsQuery.isLoading ||
    isEmbeddingProvidersLoading ||
    isModelsLoading;

  const getIconComponent = (iconName: string | null | undefined) => {
    const Icon = getSkillIcon(iconName);
    return Icon ? <Icon className="h-5 w-5" /> : null;
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="inline-flex items-center gap-2 text-sm font-medium text-primary">
            <Sparkles className="h-4 w-4" /> Навыки ассистента
          </div>
          <h1 className="text-2xl font-semibold">Навыки</h1>
          <p className="text-sm text-muted-foreground">
            Управляйте сценариями работы ИИ-ассистента: определяйте, какие базы знаний и модель LLM использовать в каждом кейсе.
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <Button onClick={() => navigate("/skills/new")} disabled={Boolean(creationDisabledReason)}>
            <Plus className="mr-2 h-4 w-4" /> Создать навык
          </Button>
          {creationDisabledReason && (
            <p className="text-xs text-muted-foreground text-right max-w-xs">{creationDisabledReason}</p>
          )}
        </div>
      </div>

      {(isError || knowledgeBaseQuery.error || llmError || modelsError || vectorCollectionsError || embeddingProvidersError) && (
        <Alert variant="destructive">
          <AlertTitle>Не удалось загрузить данные</AlertTitle>
          <AlertDescription>
            {error?.message ||
              (knowledgeBaseQuery.error as Error | undefined)?.message ||
              (llmError as Error | undefined)?.message ||
              (modelsError as Error | undefined)?.message ||
              vectorCollectionsError?.message}
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader className="py-4">
          <CardTitle className="text-base">Список навыков</CardTitle>
          <CardDescription>Название, описание, тип, связанные базы, действия и выбранная модель LLM.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {showLoadingState ? (
            <div className="flex items-center justify-center gap-2 py-12 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Загрузка данных...
            </div>
          ) : skills.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              Пока нет ни одного навыка — создайте первый, чтобы ускорить ответы ассистента.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[60px] text-center">Иконка</TableHead>
                  <TableHead className="w-[220px]">Название</TableHead>
                  <TableHead>Описание</TableHead>
                  <TableHead className="w-[120px]">Тип</TableHead>
                  <TableHead className="w-[200px]">Действия</TableHead>
                  <TableHead className="w-[220px]">Базы знаний</TableHead>
                  <TableHead className="w-[220px]">LLM модель</TableHead>
                  <TableHead className="w-[140px]">Обновлено</TableHead>
                  <TableHead className="w-[80px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedSkills.map((skill) => {
                  const isRagSkill =
                    (skill.knowledgeBaseIds ?? []).length > 0 ||
                    (skill.ragConfig?.collectionIds ?? []).length > 0;
                  return (
                    <TableRow
                      key={skill.id}
                      role="button"
                      tabIndex={0}
                      className="cursor-pointer hover:bg-muted/40 focus-visible:outline-none focus-visible:ring focus-visible:ring-primary/40"
                      onClick={(e) => openSkill(`/skills/${skill.id}/edit`, e)}
                      data-testid={`skill-row-${skill.id}`}
                      onMouseDown={(e) => {
                        if (e.button === 1 || e.ctrlKey || e.metaKey) {
                          e.preventDefault();
                          openSkill(`/skills/${skill.id}/edit`, e);
                        }
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          openSkill(`/skills/${skill.id}/edit`);
                        }
                      }}
                    >
                    <TableCell className="text-center">
                      <div className="flex items-center justify-center">
                        {getIconComponent(skill.icon) ? (
                          getIconComponent(skill.icon)
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <p className="font-semibold leading-tight">{skill.name ?? "Без названия"}</p>
                          {skill.isSystem && (
                            <Badge variant="outline" className="text-[10px] uppercase">
                              Системный
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground">ID: {skill.id}</p>
                      </div>
                    </TableCell>
                    <TableCell>
                      {skill.description ? (
                        <p className="text-sm text-muted-foreground line-clamp-3">{skill.description}</p>
                      ) : (
                        <span className="text-sm text-muted-foreground">Нет описания</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={cn(
                          "text-[11px] uppercase",
                          isRagSkill
                            ? "border-blue-200 bg-blue-100 text-blue-800"
                            : "border-green-200 bg-green-100 text-green-800",
                        )}
                      >
                        {isRagSkill ? "RAG" : "LLM"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <SkillActionsInline skillId={skill.id} />
                    </TableCell>
                    <TableCell>{renderKnowledgeBases(skill)}</TableCell>
                    <TableCell>{renderLlmInfo(skill)}</TableCell>
                    <TableCell>
                      <p className="text-sm text-muted-foreground">
                        {dateFormatter.format(new Date(skill.updatedAt))}
                      </p>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        {skill.status === "archived" && (
                          <Badge variant="secondary" className="text-[10px] uppercase">
                            Архив
                          </Badge>
                        )}
                        {!skill.isSystem && (
                          <DropdownMenu>
                            <DropdownMenuTrigger
                              asChild
                              onClick={(e) => e.stopPropagation()}
                            >
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                aria-label="Действия с навыком"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <MoreVertical className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => handleEditClick(skill)}>
                                <Pencil className="mr-2 h-4 w-4" />
                                Редактировать
                              </DropdownMenuItem>
                              {skill.status !== "archived" && (
                                <DropdownMenuItem
                                  className="text-red-600 focus:text-red-700"
                                  onClick={() => handleArchiveSkill(skill)}
                                >
                                  Архивировать
                                </DropdownMenuItem>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                      </div>
                    </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={Boolean(archiveTarget)} onOpenChange={(open) => !open && setArchiveTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Архивировать навык?</DialogTitle>
            <DialogDescription>
              Навык будет помечен как архивный. Новые чаты с ним создать нельзя. Все связанные чаты перейдут в режим
              только чтения.
            </DialogDescription>
          </DialogHeader>
          <Separator />
          <div className="space-y-2 text-sm">
            <p className="font-semibold">{archiveTarget?.name ?? "Без названия"}</p>
            <p className="text-muted-foreground">ID: {archiveTarget?.id}</p>
          </div>
          <DialogFooter className="gap-2">
            <Button type="button" variant="ghost" onClick={() => setArchiveTarget(null)} disabled={isArchiving}>
              Отмена
            </Button>
            <Button type="button" variant="destructive" onClick={confirmArchiveSkill} disabled={isArchiving}>
              {isArchiving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Архивировать
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

