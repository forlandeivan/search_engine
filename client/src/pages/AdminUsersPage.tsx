import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, ShieldCheck, ShieldOff } from "lucide-react";
import type { PublicUser } from "@shared/schema";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface UsersResponse {
  users: PublicUser[];
}

interface UpdateRolePayload {
  userId: string;
  role: PublicUser["role"];
}

function formatLastActivity(value: string | Date | null | undefined): string {
  if (!value) {
    return "Нет данных";
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Нет данных";
  }

  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export default function AdminUsersPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data, isLoading, error } = useQuery<UsersResponse>({
    queryKey: ["/api/admin/users"],
  });

  const updateRoleMutation = useMutation({
    mutationFn: async ({ userId, role }: UpdateRolePayload) => {
      const response = await apiRequest("PATCH", `/api/admin/users/${userId}/role`, { role });
      return (await response.json()) as { user: PublicUser };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      toast({
        title: "Роль обновлена",
        description: "Права пользователя успешно изменены",
      });
    },
    onError: (mutationError: unknown) => {
      const message = mutationError instanceof Error ? mutationError.message : "Неизвестная ошибка";
      toast({
        title: "Не удалось обновить роль",
        description: message,
        variant: "destructive",
      });
    },
  });

  const users = data?.users ?? [];

  const sortedUsers = useMemo(() => {
    return [...users].sort((a, b) => a.fullName.localeCompare(b.fullName));
  }, [users]);

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center p-10 text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        Загрузка списка пользователей...
      </div>
    );
  }

  if (error) {
    const message = error instanceof Error ? error.message : "Не удалось загрузить пользователей";
    return (
      <div className="p-6">
        <h1 className="text-2xl font-semibold mb-2">Пользователи</h1>
        <p className="text-destructive">{message}</p>
      </div>
    );
  }

  const pendingUserId = updateRoleMutation.variables?.userId;

  const handleToggleRole = (user: PublicUser) => {
    const nextRole = user.role === "admin" ? "user" : "admin";
    updateRoleMutation.mutate({ userId: user.id, role: nextRole });
  };

  return (
    <div className="p-6 space-y-6">
      <div className="space-y-1">
        <h1 className="text-3xl font-semibold">Пользователи</h1>
        <p className="text-muted-foreground">
          Управляйте доступом к платформе и просматривайте активность всех зарегистрированных пользователей.
        </p>
      </div>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[280px]">Имя</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Роль</TableHead>
              <TableHead>Последняя активность</TableHead>
              <TableHead className="text-right">Действия</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedUsers.map((user) => {
              const isPending = updateRoleMutation.isPending && pendingUserId === user.id;
              const isAdmin = user.role === "admin";

              return (
                <TableRow key={user.id}>
                  <TableCell className="font-medium">{user.fullName}</TableCell>
                  <TableCell>{user.email}</TableCell>
                  <TableCell>
                    <Badge variant={isAdmin ? "destructive" : "secondary"} className="capitalize">
                      {isAdmin ? "Админ" : "Пользователь"}
                    </Badge>
                  </TableCell>
                  <TableCell>{formatLastActivity(user.lastActiveAt)}</TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant={isAdmin ? "outline" : "default"}
                      size="sm"
                      onClick={() => handleToggleRole(user)}
                      disabled={isPending}
                    >
                      {isPending ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Обновляем...
                        </>
                      ) : isAdmin ? (
                        <>
                          <ShieldOff className="mr-2 h-4 w-4" /> Снять роль
                        </>
                      ) : (
                        <>
                          <ShieldCheck className="mr-2 h-4 w-4" /> Назначить админом
                        </>
                      )}
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
            {sortedUsers.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                  Пока нет зарегистрированных пользователей
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
