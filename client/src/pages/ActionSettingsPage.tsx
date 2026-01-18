import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import type { ActionDto, SkillActionDto } from "@shared/skills";
import type { SessionResponse } from "@/types/session";

type SkillActionConfigItem = {
  action: ActionDto;
  skillAction: SkillActionDto | null;
  ui: {
    effectiveLabel: string;
    editable: boolean;
  };
};

type ActionSettingsPageProps = {
  skillId?: string;
  actionId?: string;
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
  draftLabel: string;
};

export default function ActionSettingsPage({ skillId, actionId }: ActionSettingsPageProps) {
  const [, navigate] = useLocation();
  const cameFromHistory = useRef<boolean>(false);
  const { toast } = useToast();

  useEffect(() => {
    cameFromHistory.current = window.history.length > 1;
  }, []);

  const goBack = () => {
    if (cameFromHistory.current) {
      window.history.back();
    } else {
      navigate("/skills");
    }
  };

  const { data: session } = useQuery<SessionResponse>({
    queryKey: ["/api/auth/session"],
  });
  const workspaceId = session?.workspace?.active?.id ?? session?.activeWorkspaceId ?? null;

  const {
    data,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery<SkillActionConfigItem[]>({
    queryKey: ["skill-actions-page", skillId],
    enabled: Boolean(skillId) && Boolean(workspaceId),
    queryFn: async () => {
      const response = await apiRequest("GET", `/api/skills/${skillId}/actions`);
      const json = await response.json();
      return (json.items ?? []) as SkillActionConfigItem[];
    },
  });

  const [row, setRow] = useState<SkillActionRowState | null>(null);

  useEffect(() => {
    if (!data || !actionId) return;
    const item = data.find((x) => x.action.id === actionId);
    if (!item) {
      setRow(null);
      return;
    }
    setRow({
      ...item,
      enabled: item.skillAction?.enabled ?? false,
      enabledPlacements: item.skillAction?.enabledPlacements ?? [],
      labelOverride: item.skillAction?.labelOverride ?? null,
      draftLabel: item.skillAction?.labelOverride ?? "",
      saving: false,
    });
  }, [data, actionId]);

  const placementTooltips: Record<string, string> = {
    canvas: "Холст — панель действий справа от стенограммы",
    chat_message: "Действия в меню конкретного сообщения",
    chat_toolbar: "Быстрые действия над полем ввода/диалогом",
  };

  const targetLabels: Record<string, string> = {
    transcript: "Стенограмма",
    message: "Сообщение",
    selection: "Выделение",
    conversation: "Диалог",
  };

  const saveChanges = async (next?: Partial<SkillActionRowState>) => {
    if (!row || !skillId) return;
    const nextState: SkillActionRowState = { ...row, ...next, saving: true };
    const payload = {
      enabled: nextState.enabled,
      enabledPlacements:
        nextState.enabledPlacements.length > 0 ? nextState.enabledPlacements : [...(row.action.placements ?? [])],
      labelOverride: nextState.labelOverride && nextState.labelOverride.trim().length > 0 ? nextState.labelOverride : null,
    };
    setRow({ ...nextState });
    try {
      const response = await apiRequest("PUT", `/api/skills/${skillId}/actions/${row.action.id}`, payload);
      if (!response.ok) {
        throw new Error("Не удалось сохранить изменения");
      }
      setRow({
        ...nextState,
        saving: false,
        enabled: payload.enabled,
        enabledPlacements: payload.enabledPlacements,
        labelOverride: payload.labelOverride,
        draftLabel: payload.labelOverride ?? "",
        ui: { ...row.ui, effectiveLabel: payload.labelOverride ?? row.action.label },
      });
      toast({ title: "Сохранено" });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Не удалось сохранить изменения";
      toast({
        title: "Ошибка",
        description: message,
        variant: "destructive",
      });
      setRow({ ...row, saving: false });
    }
  };

  const loadingState = isLoading || (row === null && Boolean(data));

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={goBack} className="shrink-0">
          <ArrowLeft className="h-4 w-4 mr-1" />
          Назад
        </Button>
        <div>
          <p className="text-xs text-muted-foreground">Действие навыка</p>
          <h1 className="text-2xl font-semibold break-all">{row?.ui.effectiveLabel ?? "Редактирование действия"}</h1>
          {actionId && <p className="text-xs text-muted-foreground">Action ID: {actionId}</p>}
          {skillId && <p className="text-xs text-muted-foreground">Skill ID: {skillId}</p>}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Настройки действия</CardTitle>
          <CardDescription>Включение, видимость и название действия внутри навыка.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {loadingState ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Загружаем данные...
            </div>
          ) : isError ? (
            <Alert variant="destructive">
              <AlertTitle>Не удалось загрузить действие</AlertTitle>
              <AlertDescription className="flex items-center justify-between gap-4">
                <span className="text-sm">{(error as Error)?.message ?? "Ошибка загрузки"}</span>
                <Button type="button" size="sm" variant="outline" onClick={() => refetch()}>
                  Повторить
                </Button>
              </AlertDescription>
            </Alert>
          ) : !row ? (
            <Alert variant="destructive">
              <AlertTitle>Действие не найдено</AlertTitle>
              <AlertDescription>Проверьте ссылку или вернитесь к списку навыков.</AlertDescription>
            </Alert>
          ) : (
            <>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="uppercase text-[11px]">
                    {row.action.scope === "system" ? "Системное" : "Рабочей области"}
                  </Badge>
                  <Badge variant="secondary">{targetLabels[row.action.target] ?? row.action.target}</Badge>
                </div>
                <p className="text-sm text-muted-foreground">{row.action.description ?? "Без описания"}</p>
              </div>

              <Separator />

              <div className="space-y-4">
                <div className="flex items-center justify-between rounded-lg border p-3">
                  <div className="space-y-0.5">
                    <Label className="text-base">Включить действие</Label>
                    <p className="text-sm text-muted-foreground">Отображать действие в интерфейсе навыка.</p>
                  </div>
                  <Checkbox
                    checked={row.enabled}
                    onCheckedChange={(checked) => saveChanges({ enabled: Boolean(checked) })}
                    disabled={row.saving || !row.ui.editable}
                    aria-label="enabled"
                  />
                </div>

                <div className="space-y-2">
                  <Label className="text-base">Название в интерфейсе</Label>
                  <Input
                    value={row.draftLabel}
                    onChange={(e) => setRow({ ...row, draftLabel: e.target.value })}
                    onBlur={() => saveChanges({ labelOverride: row.draftLabel })}
                    placeholder={row.action.label}
                    disabled={row.saving || !row.ui.editable}
                  />
                  <p className="text-xs text-muted-foreground">Если оставить пустым — возьмём базовое название действия.</p>
                </div>

                <div className="space-y-2">
                  <Label className="text-base">Где показывать</Label>
                  <div className="grid gap-3 md:grid-cols-3">
                    {["canvas", "chat_message", "chat_toolbar"].map((placement) => {
                      const supported = row.action.placements.includes(placement as any);
                      const active = supported && row.enabledPlacements.includes(placement as any);
                      return (
                        <div key={placement} className="rounded-lg border p-3">
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <Checkbox
                                checked={active}
                                disabled={!supported || row.saving || !row.ui.editable}
                                aria-label={placement}
                                onCheckedChange={(checked) => {
                                  if (!supported) return;
                                  const nextPlacements = checked
                                    ? [...row.enabledPlacements, placement]
                                    : row.enabledPlacements.filter((p) => p !== placement);
                                  saveChanges({ enabledPlacements: nextPlacements });
                                }}
                              />
                              <span className="text-sm font-medium">
                                {placement === "canvas"
                                  ? "Холст"
                                  : placement === "chat_message"
                                    ? "Меню сообщения"
                                    : "Панель ввода"}
                              </span>
                            </div>
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span className="text-xs text-muted-foreground cursor-help">?</span>
                                </TooltipTrigger>
                                <TooltipContent className="max-w-xs text-xs">
                                  {placementTooltips[placement] ?? placement}
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          </div>
                          {!supported && (
                            <p className="mt-2 text-xs text-muted-foreground">Недоступно для этого действия</p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" onClick={goBack}>
                  Назад
                </Button>
                <Button onClick={() => saveChanges()} disabled={row.saving || !row.ui.editable}>
                  {row.saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Сохранить
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
