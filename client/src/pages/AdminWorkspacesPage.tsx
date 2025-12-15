import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/components/ui/use-toast";

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

  const tariffsQuery = useQuery<TariffSummary[]>({
    queryKey: ["admin", "tariffs"],
    queryFn: fetchTariffs,
    staleTime: 5 * 60 * 1000,
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
              </TableRow>
            ))}
            {sortedWorkspaces.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                  Рабочие пространства не найдены.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
