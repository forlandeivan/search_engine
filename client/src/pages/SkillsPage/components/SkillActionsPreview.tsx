/**
 * Skill Actions Preview Component
 *
 * Displays and manages skill actions with filtering and editing capabilities
 */

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Checkbox } from "@/components/ui/checkbox";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Loader2, X, ExternalLink, Pencil, PlusCircle, Ellipsis } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { SkillActionsPreviewProps, SkillActionRowState, SkillActionConfigItem } from "../types";

export function SkillActionsPreview({ skillId, canEdit = true }: SkillActionsPreviewProps) {
  const { toast } = useToast();
  const [, navigate] = useLocation();
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
  const [scopeFilters, setScopeFilters] = useState<Set<string>>(new Set());
  const [enabledFilters, setEnabledFilters] = useState<Set<string>>(new Set());
  const [targetFilters, setTargetFilters] = useState<Set<string>>(new Set());

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

    if (scopeFilters.size > 0 && !scopeFilters.has(row.action.scope)) return false;

    if (enabledFilters.size > 0) {
      const enabledStatus = row.enabled ? "enabled" : "disabled";
      if (!enabledFilters.has(enabledStatus)) return false;
    }

    if (targetFilters.size > 0 && !targetFilters.has(row.action.target)) return false;

    return true;
  });

  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-muted-foreground dark:border-slate-700 dark:bg-slate-900/40">
        Для этого навыка пока нет доступных действий.
      </div>
    );
  }

  const hasActiveFilters = scopeFilters.size > 0 || enabledFilters.size > 0 || targetFilters.size > 0 || search.trim().length > 0;

  const resetFilters = () => {
    setScopeFilters(new Set());
    setEnabledFilters(new Set());
    setTargetFilters(new Set());
    setSearch("");
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Отметьте, какие действия доступны в этом навыке и где они отображаются: в холсте, сообщениях чата или в панели ввода
      </p>

      {/* Поиск и фильтры */}
      <div className="flex items-center gap-2">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Поиск действий..."
          className="h-8 w-[150px] lg:w-[250px]"
        />
        
        {/* Scope фильтр */}
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="h-8 border-dashed">
              <PlusCircle className="mr-2 h-4 w-4" />
              Scope
              {scopeFilters.size > 0 && (
                <>
                  <Separator orientation="vertical" className="mx-2 h-4" />
                  <Badge variant="secondary" className="rounded-sm px-1 font-normal lg:hidden">
                    {scopeFilters.size}
                  </Badge>
                  <div className="hidden gap-1 lg:flex">
                    {scopeFilters.size > 2 ? (
                      <Badge variant="secondary" className="rounded-sm px-1 font-normal">
                        {scopeFilters.size} выбрано
                      </Badge>
                    ) : (
                      Array.from(scopeFilters).map((value) => (
                        <Badge key={value} variant="secondary" className="rounded-sm px-1 font-normal">
                          {value === "system" ? "Системные" : "Рабочее пространство"}
                        </Badge>
                      ))
                    )}
                  </div>
                </>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[200px] p-0" align="start">
            <Command>
              <CommandList>
                <CommandGroup>
                  {[
                    { value: "system", label: "Системные" },
                    { value: "workspace", label: "Рабочего пространства" },
                  ].map((option) => {
                    const isSelected = scopeFilters.has(option.value);
                    return (
                      <CommandItem
                        key={option.value}
                        onSelect={() => {
                          const newFilters = new Set(scopeFilters);
                          if (isSelected) {
                            newFilters.delete(option.value);
                          } else {
                            newFilters.add(option.value);
                          }
                          setScopeFilters(newFilters);
                        }}
                      >
                        <Checkbox
                          checked={isSelected}
                          className="mr-2"
                        />
                        {option.label}
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
                {scopeFilters.size > 0 && (
                  <>
                    <CommandSeparator />
                    <CommandGroup>
                      <CommandItem
                        onSelect={() => setScopeFilters(new Set())}
                        className="justify-center text-center"
                      >
                        Очистить фильтр
                      </CommandItem>
                    </CommandGroup>
                  </>
                )}
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>

        {/* Status фильтр */}
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="h-8 border-dashed">
              <PlusCircle className="mr-2 h-4 w-4" />
              Статус
              {enabledFilters.size > 0 && (
                <>
                  <Separator orientation="vertical" className="mx-2 h-4" />
                  <Badge variant="secondary" className="rounded-sm px-1 font-normal">
                    {enabledFilters.size}
                  </Badge>
                </>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[200px] p-0" align="start">
            <Command>
              <CommandList>
                <CommandGroup>
                  {[
                    { value: "enabled", label: "Включённые" },
                    { value: "disabled", label: "Выключенные" },
                  ].map((option) => {
                    const isSelected = enabledFilters.has(option.value);
                    return (
                      <CommandItem
                        key={option.value}
                        onSelect={() => {
                          const newFilters = new Set(enabledFilters);
                          if (isSelected) {
                            newFilters.delete(option.value);
                          } else {
                            newFilters.add(option.value);
                          }
                          setEnabledFilters(newFilters);
                        }}
                      >
                        <Checkbox
                          checked={isSelected}
                          className="mr-2"
                        />
                        {option.label}
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
                {enabledFilters.size > 0 && (
                  <>
                    <CommandSeparator />
                    <CommandGroup>
                      <CommandItem
                        onSelect={() => setEnabledFilters(new Set())}
                        className="justify-center text-center"
                      >
                        Очистить фильтр
                      </CommandItem>
                    </CommandGroup>
                  </>
                )}
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>

        {/* Target фильтр */}
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="h-8 border-dashed">
              <PlusCircle className="mr-2 h-4 w-4" />
              Цель
              {targetFilters.size > 0 && (
                <>
                  <Separator orientation="vertical" className="mx-2 h-4" />
                  <Badge variant="secondary" className="rounded-sm px-1 font-normal">
                    {targetFilters.size}
                  </Badge>
                </>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[200px] p-0" align="start">
            <Command>
              <CommandList>
                <CommandGroup>
                  {[
                    { value: "transcript", label: "Стенограмма" },
                    { value: "message", label: "Сообщение" },
                    { value: "selection", label: "Выделение" },
                    { value: "conversation", label: "Диалог" },
                  ].map((option) => {
                    const isSelected = targetFilters.has(option.value);
                    return (
                      <CommandItem
                        key={option.value}
                        onSelect={() => {
                          const newFilters = new Set(targetFilters);
                          if (isSelected) {
                            newFilters.delete(option.value);
                          } else {
                            newFilters.add(option.value);
                          }
                          setTargetFilters(newFilters);
                        }}
                      >
                        <Checkbox
                          checked={isSelected}
                          className="mr-2"
                        />
                        {option.label}
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
                {targetFilters.size > 0 && (
                  <>
                    <CommandSeparator />
                    <CommandGroup>
                      <CommandItem
                        onSelect={() => setTargetFilters(new Set())}
                        className="justify-center text-center"
                      >
                        Очистить фильтр
                      </CommandItem>
                    </CommandGroup>
                  </>
                )}
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>

        {hasActiveFilters && (
          <Button
            variant="ghost"
            size="sm"
            onClick={resetFilters}
            className="h-8 px-2 lg:px-3"
          >
            Сбросить
            <X className="ml-2 h-4 w-4" />
          </Button>
        )}
      </div>

      <div className="rounded-md border">
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
            <TableHead className="w-[50px]"></TableHead>
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
                        <p className="text-sm font-medium leading-tight">{label}</p>
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
                <TableCell>
                  {ui.editable && !row.editing && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0"
                          disabled={row.saving}
                        >
                          <Ellipsis className="h-4 w-4" />
                          <span className="sr-only">Открыть меню</span>
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
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
                          <Pencil className="mr-2 h-4 w-4" />
                          Переименовать
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => navigate(`/skills/${skillId}/actions/${row.action.id}/edit`)}
                        >
                          <ExternalLink className="mr-2 h-4 w-4" />
                          Открыть страницу
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      </div>

      {filteredRows.length === 0 && (
        <div className="py-8 text-center text-sm text-muted-foreground">
          Действия не найдены.
        </div>
      )}

      {isFetching && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Обновляем список...
        </div>
      )}
    </div>
  );
}
