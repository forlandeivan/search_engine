import { useEffect, useMemo, useState } from "react";
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
  Zap,
  Brain,
  Search,
  FileText,
  MessageSquare,
  Settings,
  BookOpen,
  Airplay,
  AlertCircle,
  Archive,
  ArrowRight,
  Award,
  Backpack,
  BarChart2,
  Battery,
  Bell,
  BellOff,
  Binoculars,
  Bluetooth,
  Bold,
  BookMarked,
  Bookmark,
  Box,
  Briefcase,
  BriefcaseBusiness,
  Bug,
  Building,
  Building2,
  Calendar,
  Camera,
  CameraOff,
  Captions,
  Car,
  CarFront,
  Carrot,
  Cast,
  Castle,
  ChartArea,
  ChartLine,
  ChartPie,
  CheckCircle,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Chrome,
  Circle,
  CircleDollarSign,
  CircleOff,
  Clock,
  Cloud,
  CloudDrizzle,
  CloudFog,
  CloudLightning,
  CloudOff,
  CloudRain,
  CloudRainWind,
  CloudSnow,
  Code,
  Code2,
  Codepen,
  Codesandbox,
  Coffee,
  Cog,
  Coins,
  Columns,
  Compass,
  ConciergeBell,
  Container,
  Contrast,
  Cookie,
  Copy,
  CreditCard,
  Crop,
  Crown,
  Cuboid,
  CupSoda,
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

import { useSkills } from "@/hooks/useSkills";
import { useModels, type PublicModel } from "@/hooks/useModels";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { useLocation } from "wouter";

import type { KnowledgeBaseSummary } from "@shared/knowledge-base";
import type { ActionDto, SkillActionDto } from "@shared/skills";
import type { PublicEmbeddingProvider, PublicLlmProvider } from "@shared/schema";
import type { Skill } from "@/types/skill";
import type { SessionResponse } from "@/types/session";

const ICON_OPTIONS = [
  { value: "Zap" },
  { value: "Brain" },
  { value: "Search" },
  { value: "FileText" },
  { value: "MessageSquare" },
  { value: "Settings" },
  { value: "BookOpen" },
  { value: "Sparkles" },
  { value: "Airplay" },
  { value: "AlertCircle" },
  { value: "Archive" },
  { value: "ArrowRight" },
  { value: "Award" },
  { value: "Backpack" },
  { value: "BarChart2" },
  { value: "Battery" },
  { value: "Bell" },
  { value: "BellOff" },
  { value: "Binoculars" },
  { value: "Bluetooth" },
  { value: "Bold" },
  { value: "BookMarked" },
  { value: "Bookmark" },
  { value: "Box" },
  { value: "Briefcase" },
  { value: "BriefcaseBusiness" },
  { value: "Bug" },
  { value: "Building" },
  { value: "Building2" },
  { value: "Calendar" },
  { value: "Camera" },
  { value: "CameraOff" },
  { value: "Captions" },
  { value: "Car" },
  { value: "CarFront" },
  { value: "Carrot" },
  { value: "Cast" },
  { value: "Castle" },
  { value: "ChartArea" },
  { value: "ChartLine" },
  { value: "ChartPie" },
  { value: "CheckCircle" },
  { value: "CheckCircle2" },
  { value: "ChevronDown" },
  { value: "ChevronLeft" },
  { value: "ChevronRight" },
  { value: "ChevronUp" },
  { value: "Chrome" },
  { value: "Circle" },
  { value: "CircleDollarSign" },
  { value: "CircleOff" },
  { value: "Clock" },
  { value: "Cloud" },
  { value: "CloudDrizzle" },
  { value: "CloudFog" },
  { value: "CloudLightning" },
  { value: "CloudOff" },
  { value: "CloudRain" },
  { value: "CloudRainWind" },
  { value: "CloudSnow" },
  { value: "Code" },
  { value: "Code2" },
  { value: "Codepen" },
  { value: "Codesandbox" },
  { value: "Coffee" },
  { value: "Cog" },
  { value: "Coins" },
  { value: "Columns" },
  { value: "Compass" },
  { value: "ConciergeBell" },
  { value: "Container" },
  { value: "Contrast" },
  { value: "Cookie" },
  { value: "Copy" },
  { value: "CreditCard" },
  { value: "Crop" },
  { value: "Crown" },
  { value: "Cuboid" },
  { value: "CupSoda" },
];

const NO_EMBEDDING_PROVIDER_VALUE = "__none";

export const skillFormSchema = z.object({
  name: z.string().trim().min(1, "Название обязательно").max(200, "Не более 200 символов"),
  description: z
    .string()
    .max(4000, "Не более 4000 символов")
    .optional()
    .or(z.literal("")),
  mode: z.enum(["rag", "llm"]).default("rag"),
  knowledgeBaseIds: z.array(z.string()).default([]),
  llmKey: z.string().min(1, "Выберите конфиг LLM"),
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
}).superRefine((val, ctx) => {
  if (val.mode === "rag") {
    if (!val.knowledgeBaseIds || val.knowledgeBaseIds.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["knowledgeBaseIds"],
        message: "Выберите хотя бы одну базу знаний",
      });
    }
    if (val.ragMode === "selected_collections" && (!val.ragCollectionIds || val.ragCollectionIds.length === 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["ragCollectionIds"],
        message: "Укажите хотя бы одну коллекцию",
      });
    }
    if (!val.ragEmbeddingProviderId || val.ragEmbeddingProviderId === NO_EMBEDDING_PROVIDER_VALUE) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["ragEmbeddingProviderId"],
        message: "Выберите сервис эмбеддингов",
      });
    }
    if (!val.ragTopK || val.ragTopK.trim().length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["ragTopK"],
        message: "Укажите количество документов",
      });
    }
    if (!val.ragMinScore || val.ragMinScore.trim().length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["ragMinScore"],
        message: "Укажите минимальный порог релевантности",
      });
    }
    if (!val.ragMaxContextTokens || val.ragMaxContextTokens.trim().length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["ragMaxContextTokens"],
        message: "Укажите лимит токенов контекста",
      });
    }
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
  mode: "rag" as "rag" | "llm",
  knowledgeBaseIds: [] as string[],
  llmKey: "",
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

  const buttonLabel = selectedBases.length
    ? `${selectedBases[0].name}${selectedBases.length > 1 ? ` +${selectedBases.length - 1}` : ""}`
    : "Выберите базы знаний";

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
            className="w-full justify-between"
            role="combobox"
            aria-expanded={open}
            disabled={disabled || knowledgeBases.length === 0}
          >
            <span className="truncate">{knowledgeBases.length === 0 ? "Нет доступных баз" : buttonLabel}</span>
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
      {selectedBases.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {selectedBases.map((kb) => (
            <Badge key={kb.id} variant="secondary" className="text-xs">
              {kb.name}
            </Badge>
          ))}
        </div>
      )}
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
  const buttonLabel = selected.length
    ? `${selected[0].name}${selected.length > 1 ? ` +${selected.length - 1}` : ""}`
    : "Выберите коллекции";

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
            className="w-full justify-between"
            role="combobox"
            aria-expanded={open}
            disabled={disabled || sortedCollections.length === 0}
          >
            <span className="truncate">{sortedCollections.length === 0 ? "Коллекции не найдены" : buttonLabel}</span>
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
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {selected.map((collection) => (
            <Badge key={collection.name} variant="secondary" className="text-xs">
              {collection.name}
            </Badge>
          ))}
        </div>
      )}
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
  onSubmit: (values: SkillFormValues) => Promise<void>;
  isSubmitting: boolean;
  skill?: Skill | null;
  getIconComponent: (iconName: string | null | undefined) => JSX.Element | null;
  onCancel?: () => void;
  hideHeader?: boolean;
  isOpen?: boolean;
};

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
  getIconComponent,
  onCancel,
  hideHeader = false,
  isOpen = true,
}: SkillFormProps) {
  const form = useForm<SkillFormValues>({
    resolver: zodResolver(skillFormSchema),
    defaultValues: defaultFormValues,
  });
  const isSystemSkill = Boolean(skill?.isSystem);
  const ragMode = form.watch("ragMode");
  const skillMode = form.watch("mode") ?? "rag";
  const isRagModeSelected = skillMode === "rag";
  const isManualRagMode = ragMode === "selected_collections";
  const transcriptionMode = form.watch("onTranscriptionMode");
  const isAutoActionMode = transcriptionMode === "auto_action";
  const vectorCollectionsEmpty = vectorCollections.length === 0;
  const vectorCollectionsUnavailable = isVectorCollectionsLoading || vectorCollectionsEmpty;
  const controlsDisabled = isSubmitting || isSystemSkill;
  const vectorCollectionsDisabled = vectorCollectionsUnavailable || controlsDisabled;
  const embeddingProvidersEmpty = embeddingProviders.length === 0;
  const embeddingProvidersUnavailable = isEmbeddingProvidersLoading || embeddingProvidersEmpty;
  const embeddingProviderSelectDisabled = embeddingProvidersUnavailable || controlsDisabled;
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
      form.reset(defaultFormValues);
      return;
    }

    if (skill) {
      const ragConfig = {
        mode: skill.ragConfig?.mode ?? "all_collections",
        collectionIds: skill.ragConfig?.collectionIds ?? [],
        topK: skill.ragConfig?.topK ?? 5,
        minScore: skill.ragConfig?.minScore ?? 0.7,
        maxContextTokens:
          skill.ragConfig?.maxContextTokens === null || skill.ragConfig?.maxContextTokens === undefined
            ? null
            : skill.ragConfig.maxContextTokens,
        showSources: skill.ragConfig?.showSources ?? true,
        embeddingProviderId: skill.ragConfig?.embeddingProviderId ?? null,
      };
      form.reset({
        name: skill.name ?? "",
        description: skill.description ?? "",
        mode: skill.mode ?? "rag",
        knowledgeBaseIds: skill.knowledgeBaseIds ?? [],
        llmKey:
          skill.llmProviderConfigId && skill.modelId
            ? buildLlmKey(skill.llmProviderConfigId, skill.modelId)
            : "",
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
      });
      return;
    }

    const fallbackLlmKey = effectiveLlmOptions.find((option) => !option.disabled)?.key ?? "";
    form.reset({ ...defaultFormValues, llmKey: fallbackLlmKey });
  }, [isOpen, skill, form, effectiveLlmOptions]);

  const handleSubmit = form.handleSubmit(async (values) => {
    if (isSystemSkill) {
      return;
    }
    await onSubmit(values);
  });

  const selectedKnowledgeBasesDisabled = sortedKnowledgeBases.length === 0;
  const llmDisabled = effectiveLlmOptions.length === 0;

  return (
    <div className="space-y-5">
      {!hideHeader && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            {skill?.icon && getIconComponent(skill.icon)}
            <h2 className="text-xl font-semibold">{skill ? "Редактирование навыка" : "Создание навыка"}</h2>
          </div>
          <p className="text-sm text-muted-foreground">
            Настройте параметры навыка: выберите связанные базы знаний, модель LLM и при необходимости систем промпт.
          </p>
          {isSystemSkill && (
            <Alert variant="default">
              <AlertTitle>Системный навык</AlertTitle>
              <AlertDescription>{systemSkillDescription}</AlertDescription>
            </Alert>
          )}
        </div>
      )}
      <Form {...form}>
        <form onSubmit={handleSubmit} className="space-y-5">

            <fieldset disabled={controlsDisabled} className="space-y-5">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Название</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="Например, Поддержка клиентов" />
                  </FormControl>
                  <FormDescription>Это имя будет отображаться в списке навыков.</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="icon"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Иконка навыка</FormLabel>
                  <FormControl>
                    <div className="border rounded-lg p-2 max-h-[360px] overflow-y-auto">
                      <div className="grid grid-cols-6 gap-1">
                        <button
                          type="button"
                          onClick={() => field.onChange("")}
                          className={cn(
                            "flex flex-col items-center justify-center gap-1 rounded-md border p-2 transition-all text-xs",
                            field.value === "" ? "border-primary bg-primary/10" : "border-border hover:border-primary/50"
                          )}
                          title="Без иконки"
                        >
                          <span className="text-sm">✕</span>
                        </button>
                        {ICON_OPTIONS.map((icon) => (
                          <button
                            key={icon.value}
                            type="button"
                            onClick={() => field.onChange(icon.value)}
                            className={cn(
                              "flex flex-col items-center justify-center gap-1 rounded-md border p-2 transition-all",
                              field.value === icon.value ? "border-primary bg-primary/10" : "border-border hover:border-primary/50"
                            )}
                            title={icon.value}
                          >
                            {getIconComponent(icon.value)}
                          </button>
                        ))}
                      </div>
                    </div>
                  </FormControl>
                  <FormDescription>Выберите визуальный идентификатор для навыка</FormDescription>
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
                    <Textarea
                      {...field}
                      placeholder="Кратко опишите назначение навыка"
                      rows={3}
                    />
                  </FormControl>
                  <FormDescription>Помогает коллегам понимать, когда использовать навык.</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="mode"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Тип навыка</FormLabel>
                  <FormControl>
                    <RadioGroup
                      value={field.value}
                      onValueChange={controlsDisabled ? undefined : field.onChange}
                      className="grid gap-3 md:grid-cols-2"
                    >
                      <div className="rounded-lg border p-3">
                        <label className="flex items-start gap-3 text-sm font-medium leading-tight">
                          <RadioGroupItem value="rag" id="skill-mode-rag" className="mt-1" disabled={controlsDisabled} />
                          <span>
                            RAG-навык
                            <span className="block text-xs font-normal text-muted-foreground">
                              Использует базу знаний и поиск перед генерацией ответа.
                            </span>
                          </span>
                        </label>
                      </div>
                      <div className="rounded-lg border p-3">
                        <label className="flex items-start gap-3 text-sm font-medium leading-tight">
                          <RadioGroupItem value="llm" id="skill-mode-llm" className="mt-1" disabled={controlsDisabled} />
                          <span>
                            LLM-навык
                            <span className="block text-xs font-normal text-muted-foreground">
                              Обращается напрямую к модели LLM без RAG-поиска.
                            </span>
                          </span>
                        </label>
                      </div>
                    </RadioGroup>
                  </FormControl>
                  <FormDescription>
                    Определяет, нужен ли этому навыку RAG-пайплайн или только LLM.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            {isRagModeSelected && (
              <FormField
                control={form.control}
                name="knowledgeBaseIds"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Базы знаний</FormLabel>
                    <FormControl>
                      <KnowledgeBaseMultiSelect
                        value={field.value}
                        onChange={field.onChange}
                        knowledgeBases={sortedKnowledgeBases}
                        disabled={selectedKnowledgeBasesDisabled || controlsDisabled}
                      />
                    </FormControl>
                    <FormDescription>
                      Навык будет искать ответы только в выбранных базах знаний.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}
            <FormField
              control={form.control}
              name="llmKey"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>LLM провайдер и модель</FormLabel>
                  <FormControl>
                    <Select value={field.value} onValueChange={field.onChange} disabled={llmDisabled || controlsDisabled}>
                      <SelectTrigger>
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
                  <FormDescription>Используется для генеративных ответов навыка.</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            {isRagModeSelected && (
            <div className="space-y-4 rounded-lg border p-4">
              <div className="space-y-1">
                <h3 className="text-base font-semibold">RAG-настройки</h3>
                <p className="text-sm text-muted-foreground">
                  Управляют тем, по каким коллекциям искать и сколько текста отдавать в ответах навыка.
                </p>
              </div>
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
                    <FormMessage />
                  </FormItem>
                )}
              />
              {isManualRagMode && (
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
                      <FormDescription>
                        {isVectorCollectionsLoading
                          ? "Загружаем список коллекций..."
                          : vectorCollectionsEmpty
                            ? "Коллекций пока нет — создайте их в разделе “Vector Collections”."
                            : "Можно выбрать одну или несколько коллекций рабочего пространства."}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}
              <FormField
                control={form.control}
                name="ragEmbeddingProviderId"
                render={({ field }) => (
                  <FormItem>
                    <div className="flex items-center gap-2">
                      <FormLabel>Сервис эмбеддингов</FormLabel>
                      <InfoTooltipIcon text="Используется для генерации вектора запроса перед поиском по коллекциям." />
                    </div>
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
                    <FormDescription>
                      Провайдер должен совпадать с тем, что используется для выбранных коллекций.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
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
                      <FormMessage />
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
                      <FormMessage />
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
                    <FormDescription>Оставьте поле пустым, чтобы использовать стандартное значение.</FormDescription>
                    <FormMessage />
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
                    <FormDescription>Показывает пользователю документы и ссылки, из которых взяты чанки.</FormDescription>
                    </div>
                    <FormControl>
                      <Switch checked={field.value} onCheckedChange={field.onChange} disabled={controlsDisabled} />
                    </FormControl>
                  </FormItem>
                )}
              />
            </div>
            )}
            <div className="space-y-4 rounded-lg border p-4">
              <div className="space-y-1">
                <h3 className="text-base font-semibold">Поведение при транскрибировании аудио</h3>
                <p className="text-sm text-muted-foreground">
                  Оставить сырую стенограмму или автоматически запустить действие после транскрипции.
                </p>
              </div>
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
                    <FormMessage />
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
                            disabled={
                              controlsDisabled || transcriptActionsQuery.isLoading || transcriptActions.length === 0
                            }
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
                      <FormDescription>
                        Покажем превью обработанного результата и откроем вкладку действия при просмотре стенограммы.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              ) : null}
            </div>
            <FormField
              control={form.control}
              name="systemPrompt"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Системный промпт</FormLabel>
                  <FormControl>
                    <Textarea
                      {...field}
                      rows={4}
                      placeholder="Добавьте инструкции для модели"
                    />
                  </FormControl>
                  <FormDescription>Опциональные инструкции, которые всегда будут отправляться в LLM.</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            </fieldset>

            <fieldset className="space-y-2 rounded-xl border border-dashed border-slate-200 p-4 dark:border-slate-800">
              <div className="space-y-1">
                <FormLabel className="text-base">Действия</FormLabel>
                <FormDescription>
                  Настройте, какие действия доступны в навыке и где они отображаются (холст, сообщения, панель ввода).
                </FormDescription>
              </div>
              {isSystemSkill ? (
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-muted-foreground dark:border-slate-700 dark:bg-slate-900/40">
                  Настройка действий недоступна для системных навыков.
                </div>
              ) : skill?.id ? (
                <SkillActionsPreview skillId={skill.id} />
              ) : (
                <ActionsPreviewForNewSkill />
              )}
            </fieldset>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={onCancel} disabled={isSubmitting}>
                Отменить
              </Button>
              <Button type="submit" disabled={isSubmitting || isSystemSkill}>

                {isSystemSkill ? "Недоступно" : isSubmitting ? "Сохраняем..." : "Сохранить"}

              </Button>
            </DialogFooter>
          </form>
        </Form>
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
    if (knowledgeBases.length === 0) {
      return "Сначала создайте хотя бы одну базу знаний.";
    }
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
    if (!iconName) return null;
    const iconMap: Record<string, typeof Zap> = {
      Zap, Brain, Search, FileText, MessageSquare, Settings, BookOpen, Sparkles,
      Airplay, AlertCircle, Archive, ArrowRight, Award, Backpack, BarChart2, Battery,
      Bell, BellOff, Binoculars, Bluetooth, Bold, BookMarked, Bookmark, Box,
      Briefcase, BriefcaseBusiness, Bug, Building, Building2, Calendar,
      Camera, CameraOff, Captions, Car, CarFront, Carrot, Cast, Castle,
      ChartArea, ChartLine, ChartPie, CheckCircle, CheckCircle2,
      ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Chrome, Circle, CircleDollarSign,
      CircleOff, Clock, Cloud, CloudDrizzle, CloudFog, CloudLightning, CloudOff, CloudRain,
      CloudRainWind, CloudSnow, Code, Code2, Codepen, Codesandbox, Coffee, Cog, Coins,
      Columns, Compass, ConciergeBell, Container, Contrast, Cookie, Copy,
      CreditCard, Crop, Crown, Cuboid, CupSoda,
    };
    const Icon = iconMap[iconName];
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
                {sortedSkills.map((skill) => (
                  <TableRow key={skill.id}>
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
                          skill.mode === "llm"
                            ? "border-green-200 bg-green-100 text-green-800"
                            : "border-blue-200 bg-blue-100 text-blue-800",
                        )}
                      >
                        {skill.mode === "llm" ? "LLM" : "RAG"}
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
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                aria-label="Действия с навыком"
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
                ))}
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
