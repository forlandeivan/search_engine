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

import { useSkills, useCreateSkill, useUpdateSkill } from "@/hooks/useSkills";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";

import type { KnowledgeBaseSummary } from "@shared/knowledge-base";
import type { PublicLlmProvider } from "@shared/schema";
import type { Skill, SkillPayload } from "@/types/skill";

const skillFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Нужно указать название")
    .max(200, "Название до 200 символов"),
  description: z
    .string()
    .max(4000, "Описание до 4000 символов")
    .optional()
    .or(z.literal("")),
  knowledgeBaseIds: z.array(z.string()).min(1, "Выберите хотя бы одну базу знаний"),
  llmKey: z.string().min(1, "Выберите модель LLM"),
  systemPrompt: z
    .string()
    .max(20000, "Системный промпт до 20000 символов")
    .optional()
    .or(z.literal("")),
  ragMode: z.enum(["all_collections", "selected_collections"]),
  ragCollectionIds: z.array(z.string()),
  ragTopK: z.string().optional(),
  ragMinScore: z.string().optional(),
  ragMaxContextTokens: z.string().optional(),
  ragShowSources: z.boolean(),
});

const buildLlmKey = (providerId: string, modelId: string) => `${providerId}::${modelId}`;

const defaultFormValues = {
  name: "",
  description: "",
  knowledgeBaseIds: [] as string[],
  llmKey: "",
  systemPrompt: "",
  ragMode: "all_collections" as "all_collections" | "selected_collections",
  ragCollectionIds: [] as string[],
  ragTopK: "5",
  ragMinScore: "0.7",
  ragMaxContextTokens: "3000",
  ragShowSources: true,
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

function KnowledgeBaseMultiSelect({ value, onChange, knowledgeBases, disabled }: KnowledgeBaseMultiSelectProps) {
  const [open, setOpen] = useState(false);
  const selectedSet = useMemo(() => new Set(value), [value]);
  const selectedBases = useMemo(() => {
    return knowledgeBases.filter((kb) => selectedSet.has(kb.id));
  }, [knowledgeBases, selectedSet]);

  const buttonLabel = selectedBases.length
    ? `${selectedBases[0].name}${selectedBases.length > 1 ? ` +${selectedBases.length - 1}` : ""}`
    : "Р’С‹Р±РµСЂРёС‚Рµ Р±Р°Р·С‹ Р·РЅР°РЅРёР№";

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
            <span className="truncate">{knowledgeBases.length === 0 ? "РќРµС‚ РґРѕСЃС‚СѓРїРЅС‹С… Р±Р°Р·" : buttonLabel}</span>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[360px] p-0">
          <Command>
            <CommandInput placeholder="РџРѕРёСЃРє РїРѕ РЅР°Р·РІР°РЅРёСЋ..." />
            <CommandList>
              <CommandEmpty>РќРёС‡РµРіРѕ РЅРµ РЅР°Р№РґРµРЅРѕ</CommandEmpty>
              <CommandGroup heading="Р‘Р°Р·С‹ Р·РЅР°РЅРёР№">
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

type SkillFormDialogProps = {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  knowledgeBases: KnowledgeBaseSummary[];
  vectorCollections: VectorCollectionSummary[];
  isVectorCollectionsLoading: boolean;
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
  llmOptions,
  onSubmit,
  isSubmitting,
  skill,
}: SkillFormDialogProps) {
  const form = useForm<SkillFormValues>({
    resolver: zodResolver(skillFormSchema),
    defaultValues: defaultFormValues,
  });
  const ragMode = form.watch("ragMode");
  const isManualRagMode = ragMode === "selected_collections";
  const vectorCollectionsEmpty = vectorCollections.length === 0;
  const vectorCollectionsDisabled = isVectorCollectionsLoading || vectorCollectionsEmpty;

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
        ragMode: ragConfig.mode,
        ragCollectionIds: ragConfig.collectionIds,
        ragTopK: String(ragConfig.topK),
        ragMinScore: String(ragConfig.minScore),
        ragMaxContextTokens: ragConfig.maxContextTokens !== null ? String(ragConfig.maxContextTokens) : "",
        ragShowSources: ragConfig.showSources,
      });
      return;
    }

    const fallbackLlmKey = effectiveLlmOptions.find((option) => !option.disabled)?.key ?? "";
    form.reset({ ...defaultFormValues, llmKey: fallbackLlmKey });
  }, [open, skill, form, effectiveLlmOptions]);

  const handleSubmit = form.handleSubmit(async (values) => {
    await onSubmit(values);
  });

  const selectedKnowledgeBasesDisabled = sortedKnowledgeBases.length === 0;
  const llmDisabled = effectiveLlmOptions.length === 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{skill ? "Р РµРґР°РєС‚РёСЂРѕРІР°РЅРёРµ РЅР°РІС‹РєР°" : "РЎРѕР·РґР°РЅРёРµ РЅР°РІС‹РєР°"}</DialogTitle>
          <DialogDescription>
            РќР°СЃС‚СЂРѕР№С‚Рµ РїР°СЂР°РјРµС‚СЂС‹ РЅР°РІС‹РєР°: РІС‹Р±РµСЂРёС‚Рµ СЃРІСЏР·Р°РЅРЅС‹Рµ Р±Р°Р·С‹ Р·РЅР°РЅРёР№, РјРѕРґРµР»СЊ LLM Рё РѕРїС†РёРѕРЅР°Р»СЊРЅРѕ СЃРёСЃС‚РµРјРЅС‹Р№ РїСЂРѕРјРїС‚.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={handleSubmit} className="space-y-5">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>РќР°Р·РІР°РЅРёРµ</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="РќР°РїСЂРёРјРµСЂ, РџРѕРґРґРµСЂР¶РєР° РєР»РёРµРЅС‚РѕРІ" />
                  </FormControl>
                  <FormDescription>Р­С‚Рѕ РёРјСЏ Р±СѓРґРµС‚ РѕС‚РѕР±СЂР°Р¶Р°С‚СЊСЃСЏ РІ СЃРїРёСЃРєРµ РЅР°РІС‹РєРѕРІ.</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>РћРїРёСЃР°РЅРёРµ</FormLabel>
                  <FormControl>
                    <Textarea
                      {...field}
                      placeholder="РљСЂР°С‚РєРѕ РѕРїРёС€РёС‚Рµ РЅР°Р·РЅР°С‡РµРЅРёРµ РЅР°РІС‹РєР°"
                      rows={3}
                    />
                  </FormControl>
                  <FormDescription>РџРѕРјРѕРіР°РµС‚ РєРѕР»Р»РµРіР°Рј РїРѕРЅРёРјР°С‚СЊ, РєРѕРіРґР° РёСЃРїРѕР»СЊР·РѕРІР°С‚СЊ РЅР°РІС‹Рє.</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="knowledgeBaseIds"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Р‘Р°Р·С‹ Р·РЅР°РЅРёР№</FormLabel>
                  <FormControl>
                    <KnowledgeBaseMultiSelect
                      value={field.value}
                      onChange={field.onChange}
                      knowledgeBases={sortedKnowledgeBases}
                      disabled={selectedKnowledgeBasesDisabled}
                    />
                  </FormControl>
                  <FormDescription>
                    РќР°РІС‹Рє Р±СѓРґРµС‚ РёСЃРєР°С‚СЊ РѕС‚РІРµС‚С‹ С‚РѕР»СЊРєРѕ РІ РІС‹Р±СЂР°РЅРЅС‹С… Р±Р°Р·Р°С… Р·РЅР°РЅРёР№.
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
                  <FormLabel>LLM РїСЂРѕРІР°Р№РґРµСЂ Рё РјРѕРґРµР»СЊ</FormLabel>
                  <FormControl>
                    <Select value={field.value} onValueChange={field.onChange} disabled={llmDisabled}>
                      <SelectTrigger>
                        <SelectValue placeholder="Р’С‹Р±РµСЂРёС‚Рµ РјРѕРґРµР»СЊ" />
                      </SelectTrigger>
                      <SelectContent>
                        {effectiveLlmOptions.map((option) => (
                          <SelectItem key={option.key} value={option.key} disabled={option.disabled}>
                            <div className="flex flex-col gap-0.5">
                              <span>{option.label}</span>
                              {!option.providerIsActive && (
                                <span className="text-xs text-muted-foreground">РџСЂРѕРІР°Р№РґРµСЂ РѕС‚РєР»СЋС‡С‘РЅ</span>
                              )}
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FormControl>
                  <FormDescription>РСЃРїРѕР»СЊР·СѓРµС‚СЃСЏ РґР»СЏ РіРµРЅРµСЂР°С‚РёРІРЅС‹С… РѕС‚РІРµС‚РѕРІ РЅР°РІС‹РєР°.</FormDescription>
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
                        onValueChange={field.onChange}
                        className="grid gap-3 md:grid-cols-2"
                      >
                        <div className="rounded-lg border p-3">
                          <label className="flex items-start gap-3 text-sm font-medium leading-tight">
                            <RadioGroupItem value="all_collections" id="rag-mode-all" className="mt-1" />
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
                            <RadioGroupItem value="selected_collections" id="rag-mode-selected" className="mt-1" />
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
                      <FormDescription>Показывает пользователю документы и ссылки, из которых взяты чанк�.</FormDescription>
                    </div>
                    <FormControl>
                      <Switch checked={field.value} onCheckedChange={field.onChange} />
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
                  <FormLabel>РЎРёСЃС‚РµРјРЅС‹Р№ РїСЂРѕРјРїС‚</FormLabel>
                  <FormControl>
                    <Textarea
                      {...field}
                      rows={4}
                      placeholder="Р”РѕР±Р°РІСЊС‚Рµ РёРЅСЃС‚СЂСѓРєС†РёРё РґР»СЏ РјРѕРґРµР»Рё"
                    />
                  </FormControl>
                  <FormDescription>РћРїС†РёРѕРЅР°Р»СЊРЅС‹Рµ РёРЅСЃС‚СЂСѓРєС†РёРё, РєРѕС‚РѕСЂС‹Рµ РІСЃРµРіРґР° Р±СѓРґСѓС‚ РѕС‚РїСЂР°РІР»СЏС‚СЊСЃСЏ РІ LLM.</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
                РћС‚РјРµРЅРёС‚СЊ
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? "РЎРѕС…СЂР°РЅСЏРµРј..." : "РЎРѕС…СЂР°РЅРёС‚СЊ"}
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
  const { toast } = useToast();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingSkill, setEditingSkill] = useState<Skill | null>(null);

  const { createSkill, isCreating } = useCreateSkill({
    onSuccess: () => {
      toast({ title: "РќР°РІС‹Рє СЃРѕС…СЂР°РЅС‘РЅ" });
    },
  });
  const { updateSkill, isUpdating } = useUpdateSkill({
    onSuccess: () => {
      toast({ title: "РќР°РІС‹Рє СЃРѕС…СЂР°РЅС‘РЅ" });
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
      return "РЎРЅР°С‡Р°Р»Р° СЃРѕР·РґР°Р№С‚Рµ С…РѕС‚СЏ Р±С‹ РѕРґРЅСѓ Р±Р°Р·Сѓ Р·РЅР°РЅРёР№.";
    }
    if (llmOptions.length === 0) {
      return "РџРѕРґРєР»СЋС‡РёС‚Рµ Р°РєС‚РёРІРЅРѕРіРѕ LLM РїСЂРѕРІР°Р№РґРµСЂР° Рё РјРѕРґРµР»СЊ.";
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
      const message = err instanceof Error ? err.message : "РќРµРёР·РІРµСЃС‚РЅР°СЏ РѕС€РёР±РєР°";
      toast({
        title: "РќРµ СѓРґР°Р»РѕСЃСЊ СЃРѕС…СЂР°РЅРёС‚СЊ РЅР°РІС‹Рє",
        description: message,
        variant: "destructive",
      });
    }
  };

  const renderKnowledgeBases = (skill: Skill) => {
    const ids = skill.knowledgeBaseIds ?? [];
    if (ids.length === 0) {
      return <span className="text-sm text-muted-foreground">РќРµ РІС‹Р±СЂР°РЅРѕ</span>;
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
      return <span className="text-sm text-muted-foreground">РќРµ Р·Р°РґР°РЅРѕ</span>;
    }

    const key = buildLlmKey(skill.llmProviderConfigId, skill.modelId);
    const option = llmOptionByKey.get(key);
    const isActive = option ? option.providerIsActive : true;
    const label = option ? option.label : `${skill.llmProviderConfigId} В· ${skill.modelId}`;

    return (
      <div className="space-y-1">
        <p className="text-sm font-medium leading-tight">{label}</p>
        {!isActive && <p className="text-xs text-muted-foreground">РџСЂРѕРІР°Р№РґРµСЂ РѕС‚РєР»СЋС‡С‘РЅ</p>}
      </div>
    );
  };

  const showLoadingState =
    isSkillsLoading || knowledgeBaseQuery.isLoading || isLlmLoading || vectorCollectionsQuery.isLoading;

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="inline-flex items-center gap-2 text-sm font-medium text-primary">
            <Sparkles className="h-4 w-4" /> РќР°РІС‹РєРё Р°СЃСЃРёСЃС‚РµРЅС‚Р°
          </div>
          <h1 className="text-2xl font-semibold">РќР°РІС‹РєРё</h1>
          <p className="text-sm text-muted-foreground">
            РЈРїСЂР°РІР»СЏР№С‚Рµ СЃС†РµРЅР°СЂРёСЏРјРё СЂР°Р±РѕС‚С‹ РР-Р°СЃСЃРёСЃС‚РµРЅС‚Р°: РѕРїСЂРµРґРµР»СЏР№С‚Рµ, РєР°РєРёРµ Р±Р°Р·С‹ Р·РЅР°РЅРёР№ Рё РјРѕРґРµР»СЊ LLM РёСЃРїРѕР»СЊР·РѕРІР°С‚СЊ РІ РєР°Р¶РґРѕРј РєРµР№СЃРµ.
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <Button onClick={openCreateDialog} disabled={Boolean(creationDisabledReason)}>
            <Plus className="mr-2 h-4 w-4" /> РЎРѕР·РґР°С‚СЊ РЅР°РІС‹Рє
          </Button>
          {creationDisabledReason && (
            <p className="text-xs text-muted-foreground text-right max-w-xs">{creationDisabledReason}</p>
          )}
        </div>
      </div>

      {(isError || knowledgeBaseQuery.error || llmError || vectorCollectionsError) && (
        <Alert variant="destructive">
          <AlertTitle>Не удалось загрузить данные</AlertTitle>
          <AlertDescription>
            {error?.message || (knowledgeBaseQuery.error as Error | undefined)?.message || (llmError as Error | undefined)?.message || vectorCollectionsError?.message}
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader className="py-4">
          <CardTitle className="text-base">РЎРїРёСЃРѕРє РЅР°РІС‹РєРѕРІ</CardTitle>
          <CardDescription>РќР°Р·РІР°РЅРёРµ, РѕРїРёСЃР°РЅРёРµ, СЃРІСЏР·Р°РЅРЅС‹Рµ Р±Р°Р·С‹ Рё РІС‹Р±СЂР°РЅРЅР°СЏ LLM РјРѕРґРµР»СЊ.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {showLoadingState ? (
            <div className="flex items-center justify-center gap-2 py-12 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Р—Р°РіСЂСѓР·РєР° РґР°РЅРЅС‹С…...
            </div>
          ) : skills.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              РџРѕРєР° РЅРµС‚ РЅРё РѕРґРЅРѕРіРѕ РЅР°РІС‹РєР° вЂ” СЃРѕР·РґР°Р№С‚Рµ РїРµСЂРІС‹Р№, С‡С‚РѕР±С‹ СѓСЃРєРѕСЂРёС‚СЊ РѕС‚РІРµС‚С‹ Р°СЃСЃРёСЃС‚РµРЅС‚Р°.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[220px]">РќР°Р·РІР°РЅРёРµ</TableHead>
                  <TableHead>РћРїРёСЃР°РЅРёРµ</TableHead>
                  <TableHead className="w-[240px]">Р‘Р°Р·С‹ Р·РЅР°РЅРёР№</TableHead>
                  <TableHead className="w-[240px]">LLM РјРѕРґРµР»СЊ</TableHead>
                  <TableHead className="w-[140px]">РћР±РЅРѕРІР»РµРЅРѕ</TableHead>
                  <TableHead className="w-[80px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedSkills.map((skill) => (
                  <TableRow key={skill.id}>
                    <TableCell>
                      <div className="space-y-1">
                        <p className="font-semibold leading-tight">{skill.name ?? "Р‘РµР· РЅР°Р·РІР°РЅРёСЏ"}</p>
                        <p className="text-xs text-muted-foreground">ID: {skill.id}</p>
                      </div>
                    </TableCell>
                    <TableCell>
                      {skill.description ? (
                        <p className="text-sm text-muted-foreground line-clamp-3">{skill.description}</p>
                      ) : (
                        <span className="text-sm text-muted-foreground">РќРµС‚ РѕРїРёСЃР°РЅРёСЏ</span>
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
                      <Button variant="ghost" size="sm" onClick={() => handleEditClick(skill)}>
                        <Pencil className="mr-2 h-4 w-4" /> Р РµРґР°РєС‚РёСЂРѕРІР°С‚СЊ
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
        llmOptions={llmOptions}
        onSubmit={handleSubmit}
        isSubmitting={isSaving}
        skill={editingSkill}
      />
    </div>
  );
}


