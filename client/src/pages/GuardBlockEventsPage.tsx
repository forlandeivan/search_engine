import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ShieldAlert, Loader2, RefreshCw } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAdminWorkspaces } from "@/hooks/useAdminWorkspaces";
import { apiRequest } from "@/lib/queryClient";

type GuardBlockEventRow = {
  id: string;
  workspaceId: string;
  workspaceName?: string | null;
  operationType: string;
  resourceType: string;
  reasonCode: string;
  message: string;
  upgradeAvailable: boolean;
  expectedCost?: Record<string, unknown> | null;
  usageSnapshot?: Record<string, unknown> | null;
  meta?: Record<string, unknown> | null;
  requestId?: string | null;
  actorType?: string | null;
  actorId?: string | null;
  isSoft?: boolean;
  createdAt: string;
};

type GuardBlocksResponse = {
  items: GuardBlockEventRow[];
  totalCount: number;
  limit: number;
  offset: number;
};

const OPERATION_OPTIONS = [
  { value: "all", label: "Все операции" },
  { value: "LLM_REQUEST", label: "LLM запрос" },
  { value: "EMBEDDINGS", label: "Embeddings" },
  { value: "ASR_TRANSCRIPTION", label: "ASR" },
  { value: "STORAGE_UPLOAD", label: "Загрузка в хранилище" },
  { value: "CREATE_SKILL", label: "Создание skill" },
  { value: "CREATE_KNOWLEDGE_BASE", label: "Создание KB" },
  { value: "CREATE_ACTION", label: "Создание action" },
  { value: "INVITE_WORKSPACE_MEMBER", label: "Приглашение участника" },
];

const RESOURCE_OPTIONS = [
  { value: "all", label: "Все ресурсы" },
  { value: "tokens", label: "Tokens" },
  { value: "embeddings", label: "Embeddings" },
  { value: "asr", label: "ASR" },
  { value: "storage", label: "Хранилище" },
  { value: "objects", label: "Объекты" },
  { value: "other", label: "Другое" },
];

const REASON_OPTIONS = [
  { value: "all", label: "Все причины" },
  { value: "USAGE_LIMIT_REACHED", label: "Лимит исчерпан" },
  { value: "OPERATION_NOT_ALLOWED", label: "Операция запрещена" },
  { value: "PLAN_RESTRICTED", label: "Ограничено планом" },
  { value: "WORKSPACE_SUSPENDED", label: "Воркспейс приостановлен" },
  { value: "UNKNOWN", label: "Другая причина" },
];

function useGuardBlockEvents(params: Record<string, string | number | undefined>) {
  const queryKey = useMemo(() => ["/api/admin/guard-blocks", params], [params]);

  return useQuery({
    queryKey,
    queryFn: async () => {
      const search = new URLSearchParams();
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== "") {
          search.set(key, String(value));
        }
      });
      const res = await apiRequest("GET", `/api/admin/guard-blocks?${search.toString()}`);
      const payload = (await res.json()) as GuardBlocksResponse;
      return payload;
    },
    keepPreviousData: true,
  });
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function formatJson(value?: Record<string, unknown> | null) {
  if (!value || Object.keys(value).length === 0) return "—";
  return JSON.stringify(value, null, 2);
}

export default function GuardBlockEventsPage() {
  const { workspaces } = useAdminWorkspaces();
  const [workspaceId, setWorkspaceId] = useState<string>("all");
  const [operationType, setOperationType] = useState<string>("all");
  const [resourceType, setResourceType] = useState<string>("all");
  const [reasonCode, setReasonCode] = useState<string>("all");
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<GuardBlockEventRow | null>(null);

  const limit = 20;
  const offset = (page - 1) * limit;

  const filters = useMemo(
    () => ({
      workspaceId: workspaceId === "all" ? undefined : workspaceId,
      operationType: operationType === "all" ? undefined : operationType,
      resourceType: resourceType === "all" ? undefined : resourceType,
      reasonCode: reasonCode === "all" ? undefined : reasonCode,
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
      limit,
      offset,
    }),
    [workspaceId, operationType, resourceType, reasonCode, dateFrom, dateTo, limit, offset],
  );

  const { data, isLoading, isFetching, refetch } = useGuardBlockEvents(filters);
  const totalPages = data ? Math.max(1, Math.ceil(data.totalCount / limit)) : 1;

  const resetFilters = () => {
    setWorkspaceId("all");
    setOperationType("all");
    setResourceType("all");
    setReasonCode("all");
    setDateFrom("");
    setDateTo("");
    setPage(1);
  };

  const onFilterChange = (callback: () => void) => {
    callback();
    setPage(1);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <ShieldAlert className="h-4 w-4" />
          <span>Журнал блокировок guard (только DENY)</span>
          {isFetching && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        </div>
        <h1 className="text-2xl font-semibold">Guard — блокировки</h1>
        <p className="text-muted-foreground max-w-3xl">
          Список отказов guard: что, где и почему было заблокировано. Отображаются только события DENY, ALLOW в
          журнал не попадают.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Фильтры</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="workspace">Workspace</Label>
              <Select value={workspaceId} onValueChange={(value) => onFilterChange(() => setWorkspaceId(value))}>
                <SelectTrigger id="workspace">
                  <SelectValue placeholder="Все пространства" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Все пространства</SelectItem>
                  {workspaces.map((ws) => (
                    <SelectItem key={ws.id} value={ws.id}>
                      {ws.name ?? ws.id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="operation">Operation type</Label>
              <Select
                value={operationType}
                onValueChange={(value) => onFilterChange(() => setOperationType(value))}
              >
                <SelectTrigger id="operation">
                  <SelectValue placeholder="Все операции" />
                </SelectTrigger>
                <SelectContent>
                  {OPERATION_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value || "all"} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="resource">Resource type</Label>
              <Select
                value={resourceType}
                onValueChange={(value) => onFilterChange(() => setResourceType(value))}
              >
                <SelectTrigger id="resource">
                  <SelectValue placeholder="Все ресурсы" />
                </SelectTrigger>
                <SelectContent>
                  {RESOURCE_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value || "all"} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="reason">Reason code</Label>
              <Select value={reasonCode} onValueChange={(value) => onFilterChange(() => setReasonCode(value))}>
                <SelectTrigger id="reason">
                  <SelectValue placeholder="Все причины" />
                </SelectTrigger>
                <SelectContent>
                  {REASON_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value || "all"} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="dateFrom">Дата с</Label>
              <Input
                id="dateFrom"
                type="date"
                value={dateFrom}
                onChange={(e) => onFilterChange(() => setDateFrom(e.target.value))}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="dateTo">Дата по</Label>
              <Input
                id="dateTo"
                type="date"
                value={dateTo}
                onChange={(e) => onFilterChange(() => setDateTo(e.target.value))}
              />
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={resetFilters}>
              Сбросить фильтры
            </Button>
            <Button variant="ghost" onClick={() => refetch()}>
              <RefreshCw className="mr-2 h-4 w-4" />
              Обновить
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Журнал блокировок</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>Загружаем события...</span>
            </div>
          ) : data && data.items.length > 0 ? (
            <>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Время</TableHead>
                      <TableHead>Workspace</TableHead>
                      <TableHead>Operation</TableHead>
                      <TableHead>Resource</TableHead>
                      <TableHead>Reason</TableHead>
                      <TableHead>Mode</TableHead>
                      <TableHead>Message</TableHead>
                      <TableHead>Upgrade</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.items.map((event) => (
                      <TableRow key={event.id}>
                        <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                          {formatDate(event.createdAt)}
                        </TableCell>
                        <TableCell className="max-w-[180px]">
                          <div className="flex flex-col gap-0.5">
                            <span className="font-medium truncate">
                              {event.workspaceName ?? event.workspaceId}
                            </span>
                            <span className="text-xs text-muted-foreground truncate">{event.workspaceId}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary" className="font-mono text-xs">
                            {event.operationType}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="font-mono text-xs">
                            {event.resourceType}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant="destructive" className="font-mono text-xs">
                            {event.reasonCode}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {event.isSoft ? (
                            <Badge variant="secondary" className="text-xs">
                              SOFT
                            </Badge>
                          ) : (
                            <Badge variant="destructive" className="text-xs">
                              HARD
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="max-w-[260px]">
                          <span className="line-clamp-2 text-sm">{event.message}</span>
                        </TableCell>
                        <TableCell>
                          {event.upgradeAvailable ? (
                            <Badge variant="default" className="text-xs">
                              Можно апгрейдить
                            </Badge>
                          ) : (
                            <Badge variant="secondary" className="text-xs">
                              Нет
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button variant="outline" size="sm" onClick={() => setSelected(event)}>
                            Детали
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              <div className="flex items-center justify-between gap-3 text-sm text-muted-foreground">
                <div>
                  Показано {data.items.length} из {data.totalCount}
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                    Назад
                  </Button>
                  <span className="text-xs">
                    Страница {page} / {totalPages}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page >= totalPages}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    Вперед
                  </Button>
                </div>
              </div>
            </>
          ) : (
            <div className="flex items-center gap-2 rounded-md border border-dashed p-4 text-sm text-muted-foreground">
              <ShieldAlert className="h-4 w-4" />
              <span>Блокировок пока не было.</span>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Детали блокировки</DialogTitle>
          </DialogHeader>
          {selected ? (
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-muted-foreground">Время</p>
                  <p>{formatDate(selected.createdAt)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Workspace</p>
                  <p>{selected.workspaceName ?? selected.workspaceId}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Operation</p>
                  <p className="font-mono">{selected.operationType}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Resource</p>
                  <p className="font-mono">{selected.resourceType}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Reason</p>
                  <p className="font-mono">{selected.reasonCode}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Upgrade</p>
                  <p>{selected.upgradeAvailable ? "Возможен" : "Нет"}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Сообщение</p>
                  <p>{selected.message}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Режим</p>
                  <p className="text-xs font-mono">{selected.isSoft ? "SOFT (would block)" : "HARD"}</p>
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-muted-foreground text-xs uppercase">Expected cost</p>
                <pre className="rounded-md bg-muted p-3 text-xs leading-relaxed whitespace-pre-wrap">
                  {formatJson(selected.expectedCost as Record<string, unknown> | null)}
                </pre>
              </div>

              <div className="space-y-2">
                <p className="text-muted-foreground text-xs uppercase">Usage snapshot</p>
                <pre className="rounded-md bg-muted p-3 text-xs leading-relaxed whitespace-pre-wrap">
                  {formatJson(selected.usageSnapshot as Record<string, unknown> | null)}
                </pre>
              </div>

              <div className="space-y-2">
                <p className="text-muted-foreground text-xs uppercase">Meta</p>
                <pre className="rounded-md bg-muted p-3 text-xs leading-relaxed whitespace-pre-wrap">
                  {formatJson(selected.meta as Record<string, unknown> | null)}
                </pre>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-muted-foreground">RequestId</p>
                  <p className="font-mono text-xs">{selected.requestId ?? "—"}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Actor</p>
                  <p className="text-xs">
                    {selected.actorType ?? "—"} {selected.actorId ? `(${selected.actorId})` : ""}
                  </p>
                </div>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
