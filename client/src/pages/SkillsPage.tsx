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

import { useSkills, useCreateSkill, useUpdateSkill } from "@/hooks/useSkills";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";

import type { KnowledgeBaseSummary } from "@shared/knowledge-base";
import type { ActionDto, SkillActionDto } from "@shared/skills";
import type { PublicEmbeddingProvider, PublicLlmProvider } from "@shared/schema";
import type { Skill, SkillPayload } from "@/types/skill";

const ICON_OPTIONS = [
  { value: "Zap", label: "⚡ Zap" },
  { value: "Brain", label: "🧠 Brain" },
  { value: "Search", label: "🔍 Search" },
  { value: "FileText", label: "📄 FileText" },
  { value: "MessageSquare", label: "💬 MessageSquare" },
  { value: "Settings", label: "⚙️ Settings" },
  { value: "BookOpen", label: "📖 BookOpen" },
  { value: "Sparkles", label: "✨ Sparkles" },
];

const skillFormSchema = z.object({
  name: z.string().trim().min(1, "Название обязательно").max(200, "Не более 200 символов"),
  description: z
    .string()
    .max(4000, "Не более 4000 символов")
    .optional()
    .or(z.literal("")),
  knowledgeBaseIds: z.array(z.string()).min(1, "Выберите хотя бы одну базу знаний"),
  llmKey: z.string().min(1, "Выберите конфиг LLM"),
  systemPrompt: z
    .string()
    .max(20000, "Не более 20000 символов")
    .optional()
    .or(z.literal("")),
  icon: z.string().optional().or(z.literal("")),
  ragMode: z.enum(["all_collections", "selected_collections"]),
  ragCollectionIds: z.array(z.string()),
  ragTopK: z.string().optional(),
  ragMinScore: z.string().optional(),
  ragMaxContextTokens: z.string().optional(),
  ragShowSources: z.boolean(),
  ragEmbeddingProviderId: z.string().optional().or(z.literal("")),
});




const buildLlmKey = (providerId: string, modelId: string) => `${providerId}::${modelId}`;

const NO_EMBEDDING_PROVIDER_VALUE = "__none";

const defaultFormValues = {
  name: "",
  description: "",
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
};

type SkillFormValues = z.infer<typeof skillFormSchema>;

type LlmSelectionOption = {
  key: string;
  label: string;
  providerId: string;
  providerName: string;
  modelId: string;
  providerIsActive: boolean;
  disabled: boolean;
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

type SkillFormDialogProps = {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  knowledgeBases: KnowledgeBaseSummary[];
  vectorCollections: VectorCollectionSummary[];
  isVectorCollectionsLoading: boolean;
  embeddingProviders: PublicEmbeddingProvider[];
  isEmbeddingProvidersLoading: boolean;
  llmOptions: LlmSelectionOption[];
  onSubmit: (values: SkillFormValues) => Promise<void>;
  isSubmitting: boolean;
  skill?: Skill | null;
};

function SkillFormDialog({
  open,
  onOpenChange,
  knowledgeBases,
  vectorCollections,
  isVectorCollectionsLoading,
  embeddingProviders,
  isEmbeddingProvidersLoading,
  llmOptions,
  onSubmit,
  isSubmitting,
  skill,
}: SkillFormDialogProps) {
  const form = useForm<SkillFormValues>({
    resolver: zodResolver(skillFormSchema),
    defaultValues: defaultFormValues,
  });
  const isSystemSkill = Boolean(skill?.isSystem);
  const ragMode = form.watch("ragMode");
  const isManualRagMode = ragMode === "selected_collections";
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
    if (!open) {
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
      });
      return;
    }

    const fallbackLlmKey = effectiveLlmOptions.find((option) => !option.disabled)?.key ?? "";
    form.reset({ ...defaultFormValues, llmKey: fallbackLlmKey });
  }, [open, skill, form, effectiveLlmOptions]);

  const handleSubmit = form.handleSubmit(async (values) => {
    if (isSystemSkill) {
      return;
    }
    await onSubmit(values);
  });

  const selectedKnowledgeBasesDisabled = sortedKnowledgeBases.length === 0;
  const llmDisabled = effectiveLlmOptions.length === 0;

  const getIconComponent = (iconName: string | null | undefined) => {
    if (!iconName) return null;
    const iconMap: Record<string, typeof Zap> = {
      Zap, Brain, Search, FileText, MessageSquare, Settings, BookOpen, Sparkles,
    };
    const Icon = iconMap[iconName];
    return Icon ? <Icon className="h-4 w-4" /> : null;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {skill?.icon && getIconComponent(skill.icon)}
            {skill ? "Редактирование навыка" : "Создание навыка"}
          </DialogTitle>
          <DialogDescription>
            Настройте параметры навыка: выберите связанные базы знаний, модель LLM и при необходимости систем промпт.
          </DialogDescription>

          {isSystemSkill && (
            <Alert variant="default">
              <AlertTitle>Системный навык</AlertTitle>
              <AlertDescription>{systemSkillDescription}</AlertDescription>
            </Alert>
          )}
        </DialogHeader>
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
                    <div className="grid grid-cols-4 gap-2">
                      <button
                        type="button"
                        onClick={() => field.onChange("")}
                        className={cn(
                          "flex flex-col items-center justify-center gap-1 rounded-lg border-2 p-3 transition-all",
                          field.value === "" ? "border-primary bg-primary/10" : "border-border hover:border-primary/50"
                        )}
                      >
                        <span className="text-lg">✕</span>
                        <span className="text-xs text-muted-foreground">Нет</span>
                      </button>
                      {ICON_OPTIONS.map((icon) => (
                        <button
                          key={icon.value}
                          type="button"
                          onClick={() => field.onChange(icon.value)}
                          className={cn(
                            "flex flex-col items-center justify-center gap-1 rounded-lg border-2 p-3 transition-all",
                            field.value === icon.value ? "border-primary bg-primary/10" : "border-border hover:border-primary/50"
                          )}
                        >
                          {getIconComponent(icon.value)}
                          <span className="text-xs text-muted-foreground text-center">{icon.value}</span>
                        </button>
                      ))}
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
                              <span>{option.label}</span>
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
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
                Отменить
              </Button>
              <Button type="submit" disabled={isSubmitting || isSystemSkill}>

                {isSystemSkill ? "Недоступно" : isSubmitting ? "Сохраняем..." : "Сохранить"}

              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

async function fetchKnowledgeBases(): Promise<KnowledgeBaseSummary[]> {
  const response = await apiRequest("GET", "/api/knowledge/bases");
  return (await response.json()) as KnowledgeBaseSummary[];
}

export default function SkillsPage() {
  const { skills, isLoading: isSkillsLoading, isError, error } = useSkills();
  const knowledgeBaseQuery = useQuery<KnowledgeBaseSummary[]>({
    queryKey: ["knowledge-bases"],
    queryFn: fetchKnowledgeBases,
  });
  const vectorCollectionsQuery = useQuery<VectorCollectionsResponse>({
    queryKey: ["/api/vector/collections"],
    queryFn: async () => {
      const response = await apiRequest("GET", "/api/vector/collections");
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

  const llmProviders = llmProvidersResponse?.providers ?? [];

  const knowledgeBases = knowledgeBaseQuery.data ?? [];
  const vectorCollections = vectorCollectionsQuery.data?.collections ?? [];
  const vectorCollectionsError = vectorCollectionsQuery.error as Error | undefined;
  const embeddingProviders = embeddingProvidersResponse?.providers ?? [];
  const embeddingProvidersError = embeddingProvidersErrorRaw as Error | undefined;
  const { toast } = useToast();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingSkill, setEditingSkill] = useState<Skill | null>(null);

  const { createSkill, isCreating } = useCreateSkill({
    onSuccess: () => {
      toast({ title: "Навык сохранён" });
    },
  });
  const { updateSkill, isUpdating } = useUpdateSkill({
    onSuccess: () => {
      toast({ title: "Навык сохранён" });
    },
  });

  const isSaving = isCreating || isUpdating;

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

    for (const provider of llmProviders) {
      const models = provider.availableModels && provider.availableModels.length > 0
        ? provider.availableModels
        : provider.model
          ? [{ label: provider.model, value: provider.model }]
          : [];

      for (const model of models) {
        options.push({
          key: buildLlmKey(provider.id, model.value),
          label: `${provider.name} В· ${model.label}`,
          providerId: provider.id,
          providerName: provider.name,
          modelId: model.value,
          providerIsActive: provider.isActive,
          disabled: !provider.isActive,
        });
      }
    }

    return options.sort((a, b) => a.label.localeCompare(b.label, "ru"));
  }, [llmProviders]);

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
      return "Подключите активного провайдера LLM и модель.";
    }
    return null;
  })();

  const openCreateDialog = () => {
    setEditingSkill(null);
    setIsDialogOpen(true);
  };

  const handleDialogChange = (nextOpen: boolean) => {
    setIsDialogOpen(nextOpen);
    if (!nextOpen) {
      setEditingSkill(null);
    }
  };

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

    setEditingSkill(skill);
    setIsDialogOpen(true);
  };

  const handleSubmit = async (values: SkillFormValues) => {
    const [providerId, modelId] = values.llmKey.split("::");
    const parseIntegerOrDefault = (candidate: string | undefined, fallback: number) => {
      if (!candidate) {
        return fallback;
      }
      const parsed = Number.parseInt(candidate, 10);
      if (!Number.isFinite(parsed)) {
        return fallback;
      }
      return parsed;
    };
    const parseScoreOrDefault = (candidate: string | undefined, fallback: number) => {
      if (!candidate) {
        return fallback;
      }
      const parsed = Number.parseFloat(candidate);
      if (!Number.isFinite(parsed)) {
        return fallback;
      }
      return Math.min(1, Math.max(0, Number(parsed.toFixed(3))));
    };
    const ragTopK = Math.max(1, parseIntegerOrDefault(values.ragTopK, 5));
    const ragMinScore = parseScoreOrDefault(values.ragMinScore, 0.7);
    const sanitizedMaxTokens = values.ragMaxContextTokens?.trim();
    let ragMaxContextTokens: number | null = null;
    if (sanitizedMaxTokens) {
      const parsed = Number.parseInt(sanitizedMaxTokens, 10);
      ragMaxContextTokens = Number.isFinite(parsed) && parsed > 0 ? parsed : null;
    }
    const ragCollectionIds =
      values.ragMode === "selected_collections"
        ? values.ragCollectionIds.map((name) => name.trim()).filter((name) => name.length > 0)
        : [];
    const payload: SkillPayload = {
      name: values.name.trim(),
      description: values.description?.trim() ? values.description.trim() : null,
      systemPrompt: values.systemPrompt?.trim() ? values.systemPrompt.trim() : null,
      icon: values.icon?.trim() ? values.icon.trim() : null,
      knowledgeBaseIds: values.knowledgeBaseIds,
      llmProviderConfigId: providerId,
      modelId,
      ragConfig: {
        mode: values.ragMode,
        collectionIds: ragCollectionIds,
        topK: ragTopK,
        minScore: ragMinScore,
        maxContextTokens: ragMaxContextTokens,
        showSources: values.ragShowSources,
        embeddingProviderId:
          values.ragEmbeddingProviderId && values.ragEmbeddingProviderId !== NO_EMBEDDING_PROVIDER_VALUE
            ? values.ragEmbeddingProviderId.trim()
            : null,
        bm25Weight: null,
        bm25Limit: null,
        vectorWeight: null,
        vectorLimit: null,
        llmTemperature: null,
        llmMaxTokens: null,
        llmResponseFormat: null,
      },
    };

    try {
      if (editingSkill) {
        await updateSkill({ skillId: editingSkill.id, payload });
      } else {
        await createSkill(payload);
      }
      handleDialogChange(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Неизвестная ошибка";
      toast({
        title: "Не удалось сохранить навык",
        description: message,
        variant: "destructive",
      });
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
    const label = option ? option.label : `${skill.llmProviderConfigId} В· ${skill.modelId}`;

    return (
      <div className="space-y-1">
        <p className="text-sm font-medium leading-tight">{label}</p>
        {!isActive && <p className="text-xs text-muted-foreground">Провайдер отключён</p>}
      </div>
    );
  };

  const showLoadingState =
    isSkillsLoading ||
    knowledgeBaseQuery.isLoading ||
    isLlmLoading ||
    vectorCollectionsQuery.isLoading ||
    isEmbeddingProvidersLoading;

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
          <Button onClick={openCreateDialog} disabled={Boolean(creationDisabledReason)}>
            <Plus className="mr-2 h-4 w-4" /> Создать навык
          </Button>
          {creationDisabledReason && (
            <p className="text-xs text-muted-foreground text-right max-w-xs">{creationDisabledReason}</p>
          )}
        </div>
      </div>

      {(isError || knowledgeBaseQuery.error || llmError || vectorCollectionsError || embeddingProvidersError) && (
        <Alert variant="destructive">
          <AlertTitle>Не удалось загрузить данные</AlertTitle>
          <AlertDescription>
            {error?.message || (knowledgeBaseQuery.error as Error | undefined)?.message || (llmError as Error | undefined)?.message || vectorCollectionsError?.message}
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader className="py-4">
          <CardTitle className="text-base">Список навыков</CardTitle>
          <CardDescription>Название, описание, связанные базы и выбранная модель LLM.</CardDescription>
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
                  <TableHead className="w-[220px]">Название</TableHead>
                  <TableHead>Описание</TableHead>
                  <TableHead className="w-[240px]">Базы знаний</TableHead>
                  <TableHead className="w-[240px]">LLM модель</TableHead>
                  <TableHead className="w-[140px]">Обновлено</TableHead>
                  <TableHead className="w-[80px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedSkills.map((skill) => (
                  <TableRow key={skill.id}>
                                        <TableCell>

                      <div className="space-y-1">

                        <div className="flex items-center gap-2">

                          {getIconComponent(skill.icon)}

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
                    <TableCell>{renderKnowledgeBases(skill)}</TableCell>
                    <TableCell>{renderLlmInfo(skill)}</TableCell>
                    <TableCell>
                      <p className="text-sm text-muted-foreground">
                        {dateFormatter.format(new Date(skill.updatedAt))}
                      </p>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button

                        variant="ghost"

                        size="sm"

                        onClick={() => handleEditClick(skill)}

                        disabled={skill.isSystem}

                        title={
                          skill.isSystem
                            ? "Системные навыки редактируются администратором инстанса"
                            : undefined
                        }
                      >
                        <Pencil className="mr-2 h-4 w-4" /> Редактировать

                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <SkillFormDialog
        open={isDialogOpen}
        onOpenChange={handleDialogChange}
        knowledgeBases={knowledgeBases}
        vectorCollections={vectorCollections}
        isVectorCollectionsLoading={vectorCollectionsQuery.isLoading}
        embeddingProviders={embeddingProviders}
        isEmbeddingProvidersLoading={isEmbeddingProvidersLoading}
        llmOptions={llmOptions}
        onSubmit={handleSubmit}
        isSubmitting={isSaving}
        skill={editingSkill}
      />
    </div>
  );
}










