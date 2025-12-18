import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { formatCredits } from "@shared/credits";

interface WorkspaceSummary {
  id: string;
  name: string;
  usersCount: number;
  managerFullName: string | null;
  createdAt: string;
  tariffPlanId: string | null;
  tariffPlanCode: string | null;
  tariffPlanName: string | null;
}

interface WorkspacesResponse {
  workspaces: WorkspaceSummary[];
}

interface TariffSummary {
  id: string;
  code: string;
  name: string;
}

type CreditsSummary = {
  workspaceId: string;
  balance: {
    currentBalance: number;
    nextTopUpAt: string | null;
  };
};

type ManualAdjustment = {
  id: string;
  amountDelta: number;
  reason: string | null;
  actorUserId: string | null;
  actorFullName: string | null;
  occurredAt: string;
};

async function fetchTariffs(): Promise<TariffSummary[]> {
  const res = await apiRequest("GET", "/api/admin/tariffs");
  const data = (await res.json()) as { tariffs?: TariffSummary[] };
  return data.tariffs ?? [];
}

function formatDate(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Нет данных";
  }

  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "medium",
  }).format(date);
}

export default function AdminWorkspacesPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [selectedPlans, setSelectedPlans] = useState<Record<string, string>>({});
  const [updatingWorkspaceId, setUpdatingWorkspaceId] = useState<string | null>(null);
  const [adjustTarget, setAdjustTarget] = useState<{ id: string; name: string } | null>(null);
  const [adjustAmount, setAdjustAmount] = useState<string>("0");
  const [adjustReason, setAdjustReason] = useState<string>("");

  const tariffsQuery = useQuery<TariffSummary[]>({
    queryKey: ["admin", "tariffs"],
    queryFn: fetchTariffs,
    staleTime: 5 * 60 * 1000,
  });

  const creditsSummaryQuery = useQuery<CreditsSummary>({
    queryKey: ["admin", "workspace-credits", adjustTarget?.id],
    enabled: Boolean(adjustTarget?.id),
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/workspaces/${adjustTarget?.id}/credits`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || "Не удалось загрузить баланс");
      }
      return (await res.json()) as CreditsSummary;
    },
  });

  const recentAdjustmentsQuery = useQuery<{ items: ManualAdjustment[] }>({
    queryKey: ["admin", "workspace-credits-adjustments", adjustTarget?.id],
    enabled: Boolean(adjustTarget?.id),
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/admin/workspaces/${adjustTarget?.id}/credits/adjustments/recent`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || "Не удалось загрузить корректировки");
      }
      return (await res.json()) as { items: ManualAdjustment[] };
    },
    staleTime: 10 * 1000,
  });

  const { data, isLoading, error } = useQuery<WorkspacesResponse>({
    queryKey: ["/api/admin/workspaces"],
  });

  const updatePlanMutation = useMutation({
    mutationFn: async ({ workspaceId, planCode }: { workspaceId: string; planCode: string }) => {
      await apiRequest("PUT", `/api/admin/workspaces/${workspaceId}/plan`, { planCode });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/workspaces"] });
      queryClient.invalidateQueries({
        predicate: (query) =>
          Array.isArray(query.queryKey) &&
          ((query.queryKey[0] === "workspace-plan" && query.queryKey[1]) ||
            (query.queryKey[0] === "workspace-credits" && query.queryKey[1])),
      });
      toast({ title: "Тариф обновлён", description: "Тариф рабочего пространства успешно изменён" });
    },
    onError: (err) => {
      const message = err instanceof Error ? err.message : "Не удалось обновить тариф рабочего пространства";
      toast({ variant: "destructive", title: "Ошибка", description: message });
    },
    onSettled: () => {
      setUpdatingWorkspaceId(null);
    },
  });

  const adjustCreditsMutation = useMutation({
    mutationFn: async () => {
      if (!adjustTarget?.id) throw new Error("Рабочее пространство не выбрано");
      const res = await apiRequest("POST", `/api/admin/workspaces/${adjustTarget.id}/credits/adjust`, {
        amountDelta: adjustAmount,
        reason: adjustReason,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || "Не удалось применить корректировку");
      }
      return (await res.json()) as CreditsSummary;
    },
    onSuccess: () => {
      toast({ title: "Баланс скорректирован" });
      queryClient.invalidateQueries({ queryKey: ["admin", "workspace-credits", adjustTarget?.id] });
      queryClient.invalidateQueries({ queryKey: ["admin", "workspace-credits-adjustments", adjustTarget?.id] });
    },
    onError: (err) => {
      const message = err instanceof Error ? err.message : "Не удалось скорректировать баланс";
      toast({ variant: "destructive", title: "Ошибка", description: message });
    },
  });

  const workspaces = data?.workspaces ?? [];

  const sortedWorkspaces = useMemo(() => {
    return [...workspaces].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [workspaces]);

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center p-10 text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        Загрузка рабочих пространств...
      </div>
    );
  }

  if (error) {
    const message = error instanceof Error ? error.message : "Не удалось загрузить рабочие пространства";
    return (
      <div className="p-6">
        <h1 className="text-2xl font-semibold mb-2">Рабочие пространства</h1>
        <p className="text-destructive">{message}</p>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="space-y-1">
        <h1 className="text-3xl font-semibold">Рабочие пространства</h1>
        <p className="text-muted-foreground">
          Просматривайте список всех рабочих пространств инстанса и контролируйте ключевые показатели.
        </p>
      </div>

      {tariffsQuery.isError && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
          Не удалось загрузить тарифы для админки. Перезагрузите страницу или попробуйте позже.
        </div>
      )}

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[260px]">Название РП</TableHead>
              <TableHead>Идентификатор</TableHead>
              <TableHead className="w-[160px] text-center">Пользователи</TableHead>
              <TableHead className="w-[220px]">Менеджер РП</TableHead>
              <TableHead className="w-[180px]">Дата создания</TableHead>
              <TableHead className="w-[260px]">Тариф</TableHead>
              <TableHead className="w-[200px]">Кредиты</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedWorkspaces.map((workspace) => (
              <TableRow key={workspace.id} className="align-top">
                <TableCell className="font-medium">{workspace.name}</TableCell>
                <TableCell className="font-mono text-sm">{workspace.id}</TableCell>
                <TableCell className="text-center">{workspace.usersCount}</TableCell>
                <TableCell>{workspace.managerFullName ?? "Не назначен"}</TableCell>
                <TableCell>{formatDate(workspace.createdAt)}</TableCell>
                <TableCell>
                  <div className="space-y-2">
                    <div className="text-sm text-muted-foreground">
                      Текущий: {workspace.tariffPlanName ?? workspace.tariffPlanCode ?? "—"}
                    </div>
                    <div className="flex items-center gap-2">
                      <Select
                        value={
                          selectedPlans[workspace.id] ??
                          workspace.tariffPlanCode ??
                          (tariffsQuery.data?.[0]?.code ?? undefined)
                        }
                        onValueChange={(value) =>
                          setSelectedPlans((prev) => ({
                            ...prev,
                            [workspace.id]: value,
                          }))
                        }
                        disabled={tariffsQuery.isLoading || tariffsQuery.isError || updatingWorkspaceId === workspace.id}
                      >
                        <SelectTrigger className="w-[150px]">
                          <SelectValue placeholder="Выберите тариф" />
                        </SelectTrigger>
                        <SelectContent>
                          {(tariffsQuery.data ?? []).map((plan) => (
                            <SelectItem key={plan.id} value={plan.code}>
                              {plan.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button
                        size="sm"
                        onClick={() => {
                          const planCode =
                            selectedPlans[workspace.id] ??
                            workspace.tariffPlanCode ??
                            tariffsQuery.data?.[0]?.code;
                          if (!planCode) {
                            toast({
                              variant: "destructive",
                              title: "Выберите тариф",
                              description: "Нельзя обновить тариф без выбранного значения",
                            });
                            return;
                          }
                          setUpdatingWorkspaceId(workspace.id);
                          updatePlanMutation.mutate({ workspaceId: workspace.id, planCode });
                        }}
                        disabled={
                          updatePlanMutation.isPending ||
                          tariffsQuery.isLoading ||
                          tariffsQuery.isError ||
                          updatingWorkspaceId === workspace.id
                        }
                      >
                        {updatingWorkspaceId === workspace.id ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Сохранение...
                          </>
                        ) : (
                          "Сохранить"
                        )}
                      </Button>
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex flex-col gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setAdjustTarget({ id: workspace.id, name: workspace.name });
                        setAdjustAmount("0");
                        setAdjustReason("");
                      }}
                    >
                      Скорректировать баланс
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {sortedWorkspaces.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                  Рабочие пространства не найдены.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog
        open={Boolean(adjustTarget)}
        onOpenChange={(open) => {
          if (!open) {
            setAdjustTarget(null);
            setAdjustAmount("0");
            setAdjustReason("");
          }
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Скорректировать баланс</DialogTitle>
          </DialogHeader>
          {adjustTarget && (
            <div className="space-y-4">
              <div className="text-sm text-muted-foreground">
                Рабочее пространство: <span className="font-medium text-foreground">{adjustTarget.name}</span>
              </div>
              <div className="grid gap-3">
                <div className="space-y-1">
                  <Label htmlFor="adjust-amount">Изменение баланса</Label>
                  <Input
                    id="adjust-amount"
                    type="text"
                    inputMode="decimal"
                    value={adjustAmount}
                    onChange={(e) => setAdjustAmount(e.target.value)}
                    placeholder="Например, 500 или -2,25"
                  />
                  <p className="text-xs text-muted-foreground">
                    Положительное значение — начислить бонус, отрицательное — списать.
                  </p>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="adjust-reason">Причина</Label>
                  <Textarea
                    id="adjust-reason"
                    rows={3}
                    value={adjustReason}
                    onChange={(e) => setAdjustReason(e.target.value)}
                    placeholder="Причина корректировки (обязательно)"
                  />
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-md border p-3">
                  <p className="text-xs text-muted-foreground">Текущий баланс</p>
                  {creditsSummaryQuery.isLoading ? (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Загрузка...
                    </div>
                  ) : creditsSummaryQuery.isError ? (
                    <p className="text-sm text-destructive">Не удалось загрузить</p>
                  ) : (
                    <p className="text-lg font-semibold">
                      {formatCredits(creditsSummaryQuery.data?.balance.currentBalance)}
                    </p>
                  )}
                </div>
                <div className="rounded-md border p-3">
                  <p className="text-xs text-muted-foreground">Следующее пополнение</p>
                  {creditsSummaryQuery.isLoading ? (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Загрузка...
                    </div>
                  ) : creditsSummaryQuery.isError ? (
                    <p className="text-sm text-destructive">Не удалось загрузить</p>
                  ) : (
                    <p className="text-lg font-semibold">
                      {creditsSummaryQuery.data?.balance.nextTopUpAt
                        ? new Date(creditsSummaryQuery.data.balance.nextTopUpAt).toLocaleString("ru-RU")
                        : "—"}
                    </p>
                  )}
                </div>
              </div>

              {recentAdjustmentsQuery.data?.items?.[0] && (
                <div className="rounded-md border p-3 space-y-1">
                  <p className="text-xs text-muted-foreground">Последняя корректировка</p>
                  <p className="text-sm">
                    {recentAdjustmentsQuery.data.items[0].amountDelta > 0 ? "+" : ""}
                    {formatCredits(recentAdjustmentsQuery.data.items[0].amountDelta)} •{" "}
                    {recentAdjustmentsQuery.data.items[0].reason || "без причины"} •{" "}
                    {new Date(recentAdjustmentsQuery.data.items[0].occurredAt).toLocaleString("ru-RU")}
                  </p>
                </div>
              )}
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setAdjustTarget(null);
                setAdjustAmount("0");
                setAdjustReason("");
              }}
              disabled={adjustCreditsMutation.isPending}
            >
              Отмена
            </Button>
            <Button
              onClick={() => adjustCreditsMutation.mutate()}
              disabled={adjustCreditsMutation.isPending || !adjustReason.trim() || !adjustAmount}
            >
              {adjustCreditsMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Сохранить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
