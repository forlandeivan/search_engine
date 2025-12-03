import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { EllipsisVertical, Loader2 } from "lucide-react";
import { apiRequest, getQueryFn } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { ActionDto } from "@shared/skills";
import type { SessionResponse } from "@/types/session";

type WorkspaceActionsResponse = {
  actions: (ActionDto & { editable: boolean })[];
};

type LlmProvider = {
  id: string;
  name: string;
  provider: string;
  model: string;
  isDefault: boolean;
};

type WorkspaceActionsPageProps = {
  params?: { workspaceId?: string };
};

type CreateActionState = {
  label: string;
  description: string;
  target: string;
  placements: Set<string>;
  inputType: string;
  outputMode: string;
  promptTemplate: string;
  llmConfigId: string;
  saving: boolean;
  open: boolean;
  editingActionId: string | null;
};

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

export default function WorkspaceActionsPage({ params }: WorkspaceActionsPageProps) {
  const { toast } = useToast();
  const sessionQuery = useQuery({
    queryKey: ["/api/auth/session"],
    queryFn: getQueryFn<SessionResponse>({ on401: "returnNull" }),
    staleTime: 0,
  });

  const workspaceId = params?.workspaceId ?? sessionQuery.data?.workspace.active.id ?? null;

  const actionsQuery = useQuery({
    queryKey: ["/api/workspaces", workspaceId, "actions"],
    enabled: Boolean(workspaceId),
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/workspaces/${workspaceId}/actions`);
      return (await res.json()) as WorkspaceActionsResponse;
    },
  });

  const llmProvidersQuery = useQuery({
    queryKey: ["/api/llm/providers"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/llm/providers");
      if (!res.ok) return [] as LlmProvider[];
      const data = await res.json();
      return (data.providers ?? []) as LlmProvider[];
    },
  });

  const actions = actionsQuery.data?.actions ?? [];

  const placementLabels = useMemo(
    () => ({
      canvas: "Canvas",
      chat_message: "Message",
      chat_toolbar: "Toolbar",
    }),
    [],
  );

  const [createState, setCreateState] = useState<CreateActionState>({
    label: "",
    description: "",
    target: "transcript",
    placements: new Set(["canvas"]),
    inputType: "full_transcript",
    outputMode: "replace_text",
    promptTemplate: "",
    llmConfigId: "",
    saving: false,
    open: false,
    editingActionId: null,
  });

  const resetCreateState = () =>
    setCreateState({
      label: "",
      description: "",
      target: "transcript",
      placements: new Set(["canvas"]),
      inputType: "full_transcript",
      outputMode: "replace_text",
      promptTemplate: "",
      llmConfigId: "",
      saving: false,
      open: false,
      editingActionId: null,
    });

  const togglePlacement = (key: string) =>
    setCreateState((prev) => {
      const next = new Set(prev.placements);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return { ...prev, placements: next };
    });

  const handleCreateOrUpdate = async () => {
    if (!workspaceId) return;
    if (!createState.label.trim()) {
      toast({ title: "Название обязательно", variant: "destructive" });
      return;
    }
    if (createState.placements.size === 0) {
      toast({ title: "Выберите хотя бы одну площадку", variant: "destructive" });
      return;
    }
    if (!createState.promptTemplate.trim()) {
      toast({ title: "Укажите промпт для действия", variant: "destructive" });
      return;
    }
    setCreateState((prev) => ({ ...prev, saving: true }));
    try {
      const body = {
        label: createState.label.trim(),
        description: createState.description.trim() || null,
        target: createState.target,
        placements: Array.from(createState.placements),
        inputType: createState.inputType,
        outputMode: createState.outputMode,
        promptTemplate: createState.promptTemplate,
        llmConfigId: createState.llmConfigId.trim() || null,
      };
      const url = createState.editingActionId
        ? `/api/workspaces/${workspaceId}/actions/${createState.editingActionId}`
        : `/api/workspaces/${workspaceId}/actions`;
      const method = createState.editingActionId ? "PATCH" : "POST";
      const res = await apiRequest(method, url, body);
      if (!res.ok) {
        const msg = (await res.json())?.message ?? "Не удалось сохранить действие";
        throw new Error(msg);
      }
      await actionsQuery.refetch();
      toast({ title: createState.editingActionId ? "Действие обновлено" : "Действие создано" });
      resetCreateState();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Не удалось сохранить действие";
      toast({ title: "Ошибка", description: message, variant: "destructive" });
      setCreateState((prev) => ({ ...prev, saving: false }));
    }
  };

  if (!workspaceId) {
    return (
      <div className="p-6 space-y-3">
        <Card>
          <CardHeader>
            <CardTitle>Действия рабочего пространства</CardTitle>
            <CardDescription>Выберите рабочее пространство, чтобы увидеть библиотеку действий.</CardDescription>
          </CardHeader>
          <CardContent>
            <Alert>
              <AlertTitle>Рабочее пространство не выбрано</AlertTitle>
              <AlertDescription>Сначала выберите рабочее пространство в шапке.</AlertDescription>
            </Alert>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4">
      <div>
        <p className="text-sm text-muted-foreground">Рабочее пространство</p>
        <h1 className="text-2xl font-semibold">Действия</h1>
        <p className="text-sm text-muted-foreground">
          Библиотека действий (system + workspace), доступных в этом рабочем пространстве.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => setCreateState((prev) => ({ ...prev, open: true }))}>Создать действие</Button>
        {createState.open && (
          <Card className="w-full">
            <CardHeader>
              <CardTitle className="text-base">
                {createState.editingActionId ? "Редактировать действие" : "Новое действие"}
              </CardTitle>
              <CardDescription>Задайте название, цели и промпт для действия.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-1">
                  <p className="text-sm font-medium">Название</p>
                  <Input
                    value={createState.label}
                    onChange={(e) => setCreateState((prev) => ({ ...prev, label: e.target.value }))}
                    placeholder="Например, Исправить опечатки"
                  />
                </div>
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium">Target</p>
                    <TooltipProvider delayDuration={200}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="text-muted-foreground text-xs cursor-help">?</span>
                        </TooltipTrigger>
                        <TooltipContent side="bottom" className="text-xs max-w-xs">
                          К какому объекту применяется действие: стенограмма, сообщение, выделенный текст или весь диалог.
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </div>
                  <Select
                    value={createState.target}
                    onValueChange={(value) => setCreateState((prev) => ({ ...prev, target: value }))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="transcript">Стенограмма</SelectItem>
                      <SelectItem value="message">Сообщение</SelectItem>
                      <SelectItem value="selection">Выделение</SelectItem>
                      <SelectItem value="conversation">Диалог</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-1">
                <p className="text-sm font-medium">Описание (необязательно)</p>
                <Textarea
                  value={createState.description}
                  onChange={(e) => setCreateState((prev) => ({ ...prev, description: e.target.value }))}
                  rows={2}
                  placeholder="Подсказка для коллег, что делает действие"
                />
              </div>
              <div className="grid gap-3 md:grid-cols-3">
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium">Площадки</p>
                    <TooltipProvider delayDuration={200}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="text-muted-foreground text-xs cursor-help">?</span>
                        </TooltipTrigger>
                        <TooltipContent side="bottom" className="text-xs max-w-xs">
                          Где показывать действие: в холсте стенограммы, в меню сообщения или в тулбаре чата.
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </div>
                  {["canvas", "chat_message", "chat_toolbar"].map((p) => (
                    <label key={p} className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={createState.placements.has(p)}
                        onCheckedChange={() => togglePlacement(p)}
                      />
                      {placementLabels[p] ?? p}
                    </label>
                  ))}
                </div>
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium">Input type</p>
                    <TooltipProvider delayDuration={200}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="text-muted-foreground text-xs cursor-help">?</span>
                        </TooltipTrigger>
                        <TooltipContent side="bottom" className="text-xs max-w-xs">
                          Что передать в действие: весь текст выбранного объекта или только выделенный фрагмент.
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </div>
                  <Select
                    value={createState.inputType}
                    onValueChange={(value) => setCreateState((prev) => ({ ...prev, inputType: value }))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="full_transcript">Весь текст</SelectItem>
                      <SelectItem value="selection">Выделение</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium">Output</p>
                    <TooltipProvider delayDuration={200}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="text-muted-foreground text-xs cursor-help">?</span>
                        </TooltipTrigger>
                        <TooltipContent side="bottom" className="text-xs max-w-xs">
                          Что делать с результатом: заменить текст, создать новую версию, добавить сообщение или сформировать документ.
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </div>
                  <Select
                    value={createState.outputMode}
                    onValueChange={(value) => setCreateState((prev) => ({ ...prev, outputMode: value }))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="replace_text">Заменить текст</SelectItem>
                      <SelectItem value="new_version">Новая версия</SelectItem>
                      <SelectItem value="new_message">Новое сообщение</SelectItem>
                      <SelectItem value="document">Документ</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-1">
                <p className="text-sm font-medium">Промпт</p>
                <Textarea
                  value={createState.promptTemplate}
                  onChange={(e) => setCreateState((prev) => ({ ...prev, promptTemplate: e.target.value }))}
                  rows={4}
                  placeholder="Используйте {{text}} для подстановки входного текста"
                />
              </div>
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium">LLM провайдер</p>
                  <TooltipProvider delayDuration={200}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="text-muted-foreground text-xs cursor-help">?</span>
                      </TooltipTrigger>
                      <TooltipContent side="bottom" className="text-xs max-w-xs">
                        Выберите LLM провайдера для выполнения действия. Если не выбран, будет использован провайдер по умолчанию.
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
                <Select
                  value={createState.llmConfigId || "_none"}
                  onValueChange={(value) => setCreateState((prev) => ({ ...prev, llmConfigId: value === "_none" ? "" : value }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="По умолчанию" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_none">По умолчанию</SelectItem>
                    {llmProvidersQuery.data?.map((provider) => (
                      <SelectItem key={provider.id} value={provider.id}>
                        {provider.name} ({provider.provider} / {provider.model})
                        {provider.isDefault && " ★"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-2">
                <Button onClick={handleCreateOrUpdate} disabled={createState.saving}>
                  {createState.saving ? "Сохраняем..." : createState.editingActionId ? "Сохранить" : "Создать"}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={resetCreateState}
                  disabled={createState.saving}
                >
                  Отмена
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      <Card>
        <CardHeader className="py-4">
          <CardTitle className="text-base">Список действий</CardTitle>
          <CardDescription>Настроенные действия и их доступность в рабочем пространстве.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {actionsQuery.isLoading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Загружаем действия...
            </div>
          ) : actionsQuery.isError ? (
            <Alert variant="destructive" className="m-4">
              <AlertTitle>Не удалось загрузить</AlertTitle>
              <AlertDescription>
                Попробуйте обновить страницу или проверьте, что у вас есть доступ к этому рабочему пространству.
              </AlertDescription>
            </Alert>
          ) : actions.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">Пока нет доступных действий.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Название</TableHead>
                  <TableHead>Scope</TableHead>
                  <TableHead>Target</TableHead>
                  <TableHead>Placements</TableHead>
                  <TableHead>Output</TableHead>
                  <TableHead className="text-right">Действия</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {actions.map((action) => (
                  <TableRow key={action.id}>
                    <TableCell>
                      <div className="space-y-1">
                        <p className="text-sm font-medium leading-tight">{action.label}</p>
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
                    <TableCell>{targetLabels[action.target] ?? action.target}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {action.placements.map((p) => (
                          <Badge key={p} variant="secondary" className="text-[11px]">
                            {placementLabels[p] ?? p}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell>{outputModeLabels[action.outputMode] ?? action.outputMode}</TableCell>
                    <TableCell className="text-right">
                      {action.editable ? (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Меню действия">
                              <EllipsisVertical className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              onClick={() =>
                                setCreateState({
                                  label: action.label,
                                  description: action.description ?? "",
                                  target: action.target,
                                  placements: new Set(action.placements),
                                  inputType: action.inputType,
                                  outputMode: action.outputMode,
                                  promptTemplate: action.promptTemplate,
                                  llmConfigId: action.llmConfigId ?? "",
                                  saving: false,
                                  open: true,
                                  editingActionId: action.id,
                                })
                              }
                            >
                              Редактировать
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      ) : (
                        <Badge variant="secondary" className="text-[11px]">
                          Только чтение
                        </Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
