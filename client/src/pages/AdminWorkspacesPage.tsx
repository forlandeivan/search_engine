import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface WorkspaceSummary {
  id: string;
  name: string;
  usersCount: number;
  managerFullName: string | null;
  createdAt: string;
}

interface WorkspacesResponse {
  workspaces: WorkspaceSummary[];
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
  const { data, isLoading, error } = useQuery<WorkspacesResponse>({
    queryKey: ["/api/admin/workspaces"],
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

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[260px]">Название РП</TableHead>
              <TableHead>Идентификатор</TableHead>
              <TableHead className="w-[160px] text-center">Пользователи</TableHead>
              <TableHead className="w-[220px]">Менеджер РП</TableHead>
              <TableHead className="w-[180px]">Дата создания</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedWorkspaces.map((workspace) => (
              <TableRow key={workspace.id}>
                <TableCell className="font-medium">{workspace.name}</TableCell>
                <TableCell className="font-mono text-sm">{workspace.id}</TableCell>
                <TableCell className="text-center">{workspace.usersCount}</TableCell>
                <TableCell>{workspace.managerFullName ?? "Не назначен"}</TableCell>
                <TableCell>{formatDate(workspace.createdAt)}</TableCell>
              </TableRow>
            ))}
            {sortedWorkspaces.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
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
