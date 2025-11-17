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
    .min(1, "Укажите название")
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
});

const buildLlmKey = (providerId: string, modelId: string) => `${providerId}::${modelId}`;

const defaultFormValues = {
  name: "",
  description: "",
  knowledgeBaseIds: [] as string[],
  llmKey: "",
  systemPrompt: "",
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

type SkillFormDialogProps = {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  knowledgeBases: KnowledgeBaseSummary[];
  llmOptions: LlmSelectionOption[];
  onSubmit: (values: SkillFormValues) => Promise<void>;
  isSubmitting: boolean;
  skill?: Skill | null;
};

function SkillFormDialog({
  open,
  onOpenChange,
  knowledgeBases,
  llmOptions,
  onSubmit,
  isSubmitting,
  skill,
}: SkillFormDialogProps) {
  const form = useForm<SkillFormValues>({
    resolver: zodResolver(skillFormSchema),
    defaultValues: defaultFormValues,
  });

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
        label: `${skill.llmProviderConfigId} · ${skill.modelId}`,
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
      form.reset({
        name: skill.name ?? "",
        description: skill.description ?? "",
        knowledgeBaseIds: skill.knowledgeBaseIds ?? [],
        llmKey:
          skill.llmProviderConfigId && skill.modelId
            ? buildLlmKey(skill.llmProviderConfigId, skill.modelId)
            : "",
        systemPrompt: skill.systemPrompt ?? "",
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
          <DialogTitle>{skill ? "Редактирование навыка" : "Создание навыка"}</DialogTitle>
          <DialogDescription>
            Настройте параметры навыка: выберите связанные базы знаний, модель LLM и опционально системный промпт.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={handleSubmit} className="space-y-5">
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
                      disabled={selectedKnowledgeBasesDisabled}
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
                    <Select value={field.value} onValueChange={field.onChange} disabled={llmDisabled}>
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
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
                Отменить
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? "Сохраняем..." : "Сохранить"}
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
  const {
    data: llmProviders = [],
    isLoading: isLlmLoading,
    error: llmError,
  } = useQuery<PublicLlmProvider[]>({
    queryKey: ["/api/llm/providers"],
  });

  const knowledgeBases = knowledgeBaseQuery.data ?? [];
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
          label: `${provider.name} · ${model.label}`,
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
      return "Подключите активного LLM провайдера и модель.";
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
    const payload: SkillPayload = {
      name: values.name.trim(),
      description: values.description?.trim() ? values.description.trim() : null,
      systemPrompt: values.systemPrompt?.trim() ? values.systemPrompt.trim() : null,
      knowledgeBaseIds: values.knowledgeBaseIds,
      llmProviderConfigId: providerId,
      modelId,
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
    const label = option ? option.label : `${skill.llmProviderConfigId} · ${skill.modelId}`;

    return (
      <div className="space-y-1">
        <p className="text-sm font-medium leading-tight">{label}</p>
        {!isActive && <p className="text-xs text-muted-foreground">Провайдер отключён</p>}
      </div>
    );
  };

  const showLoadingState = isSkillsLoading || knowledgeBaseQuery.isLoading || isLlmLoading;

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

      {(isError || knowledgeBaseQuery.error || llmError) && (
        <Alert variant="destructive">
          <AlertTitle>Не удалось загрузить данные</AlertTitle>
          <AlertDescription>
            {error?.message || (knowledgeBaseQuery.error as Error | undefined)?.message || (llmError as Error | undefined)?.message}
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader className="py-4">
          <CardTitle className="text-base">Список навыков</CardTitle>
          <CardDescription>Название, описание, связанные базы и выбранная LLM модель.</CardDescription>
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
                        <p className="font-semibold leading-tight">{skill.name ?? "Без названия"}</p>
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
                      <Button variant="ghost" size="sm" onClick={() => handleEditClick(skill)}>
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
        llmOptions={llmOptions}
        onSubmit={handleSubmit}
        isSubmitting={isSaving}
        skill={editingSkill}
      />
    </div>
  );
}
