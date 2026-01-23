import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, ShieldCheck, ShieldOff, CheckCircle2, Trash2 } from "lucide-react";
import type { PublicUser } from "@shared/schema";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface UsersResponse {
  users: PublicUser[];
}

interface UpdateRolePayload {
  userId: string;
  role: PublicUser["role"];
}

interface DeleteUserPayload {
  userId: string;
  confirmEmail: string;
}

interface DeleteUserResponse {
  success: boolean;
  message: string;
  deletedUser: {
    id: string;
    email: string;
    fullName: string;
  };
  deletedWorkspaces: Array<{
    id: string;
    name: string;
  }>;
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
  
  // Состояние для диалога удаления
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [userToDelete, setUserToDelete] = useState<PublicUser | null>(null);
  const [confirmEmailInput, setConfirmEmailInput] = useState("");

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

  const activateUserMutation = useMutation({
    mutationFn: async (userId: string) => {
      const response = await apiRequest("POST", `/api/admin/users/${userId}/activate`, {});
      return (await response.json()) as { user: PublicUser };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      toast({
        title: "Пользователь активирован",
        description: "Учетная запись успешно активирована",
      });
    },
    onError: (mutationError: unknown) => {
      const message = mutationError instanceof Error ? mutationError.message : "Неизвестная ошибка";
      toast({
        title: "Не удалось активировать пользователя",
        description: message,
        variant: "destructive",
      });
    },
  });

  const deleteUserMutation = useMutation({
    mutationFn: async ({ userId, confirmEmail }: DeleteUserPayload) => {
      const response = await apiRequest("DELETE", `/api/admin/users/${userId}`, { confirmEmail });
      return (await response.json()) as DeleteUserResponse;
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      const workspacesCount = result.deletedWorkspaces?.length ?? 0;
      toast({
        title: "Пользователь удалён",
        description: `${result.deletedUser.email} и ${workspacesCount} рабочих пространств удалены`,
      });
      closeDeleteDialog();
    },
    onError: (mutationError: unknown) => {
      const message = mutationError instanceof Error ? mutationError.message : "Неизвестная ошибка";
      toast({
        title: "Не удалось удалить пользователя",
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
  const activatingUserId = activateUserMutation.variables;

  const handleToggleRole = (user: PublicUser) => {
    const nextRole = user.role === "admin" ? "user" : "admin";
    updateRoleMutation.mutate({ userId: user.id, role: nextRole });
  };

  const handleActivateUser = (user: PublicUser) => {
    activateUserMutation.mutate(user.id);
  };

  const openDeleteDialog = (user: PublicUser) => {
    setUserToDelete(user);
    setConfirmEmailInput("");
    setDeleteDialogOpen(true);
  };

  const closeDeleteDialog = () => {
    setDeleteDialogOpen(false);
    setUserToDelete(null);
    setConfirmEmailInput("");
  };

  const handleDeleteUser = () => {
    if (!userToDelete) return;
    deleteUserMutation.mutate({
      userId: userToDelete.id,
      confirmEmail: confirmEmailInput,
    });
  };

  const isEmailMatch = userToDelete && confirmEmailInput.toLowerCase() === userToDelete.email.toLowerCase();

  const isUserActive = (user: PublicUser) => {
    return user.status === "active" && user.isEmailConfirmed;
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
              <TableHead>Статус</TableHead>
              <TableHead>Последняя активность</TableHead>
              <TableHead className="text-right">Действия</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedUsers.map((user) => {
              const isPending = updateRoleMutation.isPending && pendingUserId === user.id;
              const isActivating = activateUserMutation.isPending && activatingUserId === user.id;
              const isAdmin = user.role === "admin";
              const isActive = isUserActive(user);

              return (
                <TableRow key={user.id}>
                  <TableCell className="font-medium">{user.fullName}</TableCell>
                  <TableCell>{user.email}</TableCell>
                  <TableCell>
                    <Badge variant={isAdmin ? "destructive" : "secondary"} className="capitalize">
                      {isAdmin ? "Админ" : "Пользователь"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {isActive ? (
                      <Badge variant="default" className="capitalize">
                        Активен
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="capitalize text-muted-foreground">
                        Не активирован
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>{formatLastActivity(user.lastActiveAt)}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      {!isActive && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleActivateUser(user)}
                          disabled={isActivating}
                        >
                          {isActivating ? (
                            <>
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Активируем...
                            </>
                          ) : (
                            <>
                              <CheckCircle2 className="mr-2 h-4 w-4" /> Активировать
                            </>
                          )}
                        </Button>
                      )}
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
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => openDeleteDialog(user)}
                        className="text-destructive hover:text-destructive hover:bg-destructive/10"
                        title="Удалить пользователя"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
            {sortedUsers.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                  Пока нет зарегистрированных пользователей
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* Диалог подтверждения удаления */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-destructive">Удаление пользователя</DialogTitle>
            <DialogDescription>
              Это действие необратимо. Будут удалены:
              <ul className="list-disc list-inside mt-2 space-y-1">
                <li>Учётная запись пользователя</li>
                <li>Все рабочие пространства, где пользователь — владелец</li>
                <li>Все навыки, базы знаний, чаты и файлы в этих пространствах</li>
              </ul>
            </DialogDescription>
          </DialogHeader>
          
          {userToDelete && (
            <div className="space-y-4 py-4">
              <div className="rounded-lg bg-muted p-3 space-y-1">
                <p className="text-sm font-medium">{userToDelete.fullName}</p>
                <p className="text-sm text-muted-foreground">{userToDelete.email}</p>
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="confirm-email">
                  Для подтверждения введите email пользователя:
                </Label>
                <Input
                  id="confirm-email"
                  type="email"
                  placeholder={userToDelete.email}
                  value={confirmEmailInput}
                  onChange={(e) => setConfirmEmailInput(e.target.value)}
                  className={isEmailMatch ? "border-green-500" : ""}
                />
                {confirmEmailInput && !isEmailMatch && (
                  <p className="text-xs text-destructive">Email не совпадает</p>
                )}
              </div>
            </div>
          )}

          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={closeDeleteDialog}>
              Отмена
            </Button>
            <Button
              variant="destructive"
              onClick={handleDeleteUser}
              disabled={!isEmailMatch || deleteUserMutation.isPending}
            >
              {deleteUserMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Удаляем...
                </>
              ) : (
                <>
                  <Trash2 className="mr-2 h-4 w-4" />
                  Удалить пользователя
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
