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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { Loader2 } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Skill } from "@/types/skill";
import type { SkillActionsPreviewProps, SkillActionRowState, SkillActionConfigItem } from "../types";

export function SkillActionsPreview({ skillId, canEdit = true }: SkillActionsPreviewProps) {
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
