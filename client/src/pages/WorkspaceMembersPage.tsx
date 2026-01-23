import type { ReactNode } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@/lib/zod-resolver";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { workspaceMemberRoles } from "@shared/schema";
import { apiRequest, getQueryFn } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
import { Badge } from "@/components/ui/badge";
import { Loader2, Trash2, RefreshCw, Clock, Mail } from "lucide-react";
import type { WorkspaceMemberRole } from "@shared/schema";

// ============================================================================
// Helpers
// ============================================================================

function formatDate(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Нет данных";
  }

  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "medium",
  }).format(date);
}

// ============================================================================
// Types
// ============================================================================

const inviteMemberSchema = z.object({
  email: z.string().trim().email("Введите корректный email"),
  role: z.enum(workspaceMemberRoles).default("user"),
});

type InviteMemberValues = z.infer<typeof inviteMemberSchema>;

const roleLabels: Record<WorkspaceMemberRole, string> = {
  owner: "Владелец",
  manager: "Менеджер",
  user: "Пользователь",
};

type WorkspaceMember = {
  id: string;
  email: string;
  fullName: string | null;
  role: WorkspaceMemberRole;
  joinedAt: string;
  isCurrentUser: boolean;
};

type MembersResponse = {
  members: WorkspaceMember[];
};

type InviteMemberResponse = {
  added: boolean;
  invited: boolean;
  members?: WorkspaceMember[];
  invitation?: {
    id: string;
    email: string;
    expiresAt: string;
  };
};

type PendingInvitation = {
  id: string;
  email: string;
  role: WorkspaceMemberRole;
  createdAt: string;
  expiresAt: string;
  invitedBy: {
    fullName: string | null;
    email: string;
  } | null;
};

type InvitationsResponse = {
  invitations: PendingInvitation[];
};

// ============================================================================
// Component
// ============================================================================

export default function WorkspaceMembersPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Fetch members
  const membersQuery = useQuery({
    queryKey: ["/api/workspaces/members"],
    queryFn: getQueryFn<MembersResponse>({ on401: "returnNull" }),
    staleTime: 0,
  });

  // Fetch pending invitations
  const invitationsQuery = useQuery({
    queryKey: ["/api/workspaces/invitations"],
    queryFn: getQueryFn<InvitationsResponse>({ on401: "returnNull" }),
    staleTime: 0,
  });

  const inviteForm = useForm<InviteMemberValues>({
    resolver: zodResolver(inviteMemberSchema),
    defaultValues: { email: "", role: "user" },
  });

  // Invite member mutation
  const inviteMemberMutation = useMutation<InviteMemberResponse, Error, InviteMemberValues>({
    mutationFn: async (values) => {
      const res = await apiRequest("POST", "/api/workspaces/members", values);
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || "Не удалось отправить приглашение");
      }
      return (await res.json()) as InviteMemberResponse;
    },
    onSuccess: (data) => {
      inviteForm.reset({ email: "", role: "user" });
      
      if (data.added) {
        // User was added directly
        queryClient.invalidateQueries({ queryKey: ["/api/workspaces/members"] });
        toast({ title: "Пользователь добавлен в рабочее пространство" });
      } else if (data.invited) {
        // Invitation was sent
        queryClient.invalidateQueries({ queryKey: ["/api/workspaces/invitations"] });
        toast({ title: `Приглашение отправлено на ${data.invitation?.email}` });
      }
    },
    onError: (error: Error) => {
      toast({
        title: "Не удалось отправить приглашение",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Update member role mutation
  const updateRoleMutation = useMutation<
    MembersResponse,
    Error,
    { memberId: string; role: WorkspaceMemberRole }
  >({
    mutationFn: async ({ memberId, role }) => {
      const res = await apiRequest("PATCH", `/api/workspaces/members/${memberId}`, { role });
      return (await res.json()) as MembersResponse;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["/api/workspaces/members"], data);
      toast({ title: "Роль обновлена" });
    },
    onError: (error: Error) => {
      toast({
        title: "Не удалось обновить роль",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Remove member mutation
  const removeMemberMutation = useMutation<MembersResponse, Error, { memberId: string }>({
    mutationFn: async ({ memberId }) => {
      const res = await apiRequest("DELETE", `/api/workspaces/members/${memberId}`);
      return (await res.json()) as MembersResponse;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["/api/workspaces/members"], data);
      toast({ title: "Участник удалён" });
    },
    onError: (error: Error) => {
      toast({
        title: "Не удалось удалить участника",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Cancel invitation mutation
  const cancelInvitationMutation = useMutation<void, Error, string>({
    mutationFn: async (invitationId) => {
      const res = await apiRequest("DELETE", `/api/workspaces/invitations/${invitationId}`);
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || "Не удалось отменить приглашение");
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/workspaces/invitations"] });
      toast({ title: "Приглашение отменено" });
    },
    onError: (error: Error) => {
      toast({
        title: "Не удалось отменить приглашение",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Resend invitation mutation
  const resendInvitationMutation = useMutation<void, Error, string>({
    mutationFn: async (invitationId) => {
      const res = await apiRequest("POST", `/api/workspaces/invitations/${invitationId}/resend`);
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || "Не удалось отправить приглашение повторно");
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/workspaces/invitations"] });
      toast({ title: "Приглашение отправлено повторно" });
    },
    onError: (error: Error) => {
      toast({
        title: "Не удалось отправить приглашение повторно",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const isLoading = membersQuery.isLoading;
  const isUnauthorized = !isLoading && membersQuery.data === null;
  const members = membersQuery.data?.members ?? [];
  const invitations = invitationsQuery.data?.invitations ?? [];

  const canInvite = !inviteMemberMutation.isPending;
  const inviteEmailError = inviteForm.formState.errors.email?.message;

  // ============================================================================
  // Render Members Table
  // ============================================================================

  let membersContent: ReactNode;
  if (membersQuery.isError) {
    membersContent = (
      <div className="py-10 text-center text-destructive">
        {(membersQuery.error as Error).message || "Не удалось загрузить участников."}
      </div>
    );
  } else if (isUnauthorized) {
    membersContent = (
      <div className="py-10 text-center text-muted-foreground">
        У вас нет доступа к списку участников этого рабочего пространства.
      </div>
    );
  } else if (isLoading) {
    membersContent = (
      <div className="py-10 text-center text-muted-foreground">
        <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" />
        Загружаем список участников…
      </div>
    );
  } else if (members.length === 0) {
    membersContent = (
      <div className="py-10 text-center text-muted-foreground">
        В рабочем пространстве пока нет участников.
      </div>
    );
  } else {
    membersContent = (
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[280px]">Имя</TableHead>
            <TableHead>Email</TableHead>
            <TableHead className="w-[180px]">Роль</TableHead>
            <TableHead className="w-[120px]">Добавлен</TableHead>
            <TableHead className="text-right w-[80px]">Действия</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {members.map((member) => {
            const isUpdating =
              updateRoleMutation.isPending && updateRoleMutation.variables?.memberId === member.id;
            const isRemoving =
              removeMemberMutation.isPending && removeMemberMutation.variables?.memberId === member.id;
            return (
              <TableRow key={member.id}>
                <TableCell className="font-medium">
                  <div className="flex items-center gap-2">
                    <span>{member.fullName || "Без имени"}</span>
                    {member.isCurrentUser ? <Badge variant="secondary">Это вы</Badge> : null}
                  </div>
                </TableCell>
                <TableCell>{member.email}</TableCell>
                <TableCell>
                  <Select
                    value={member.role}
                    onValueChange={(value) =>
                      updateRoleMutation.mutate({ memberId: member.id, role: value as WorkspaceMemberRole })
                    }
                    disabled={isUpdating || member.isCurrentUser}
                  >
                    <SelectTrigger className="w-[160px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {workspaceMemberRoles.map((role) => (
                        <SelectItem key={role} value={role}>
                          {roleLabels[role]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </TableCell>
                <TableCell>
                  <div className="text-sm text-muted-foreground">
                    {formatDate(member.joinedAt)}
                  </div>
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => removeMemberMutation.mutate({ memberId: member.id })}
                    disabled={isRemoving || member.isCurrentUser}
                    aria-label={`Удалить ${member.fullName || member.email}`}
                  >
                    {isRemoving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                  </Button>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    );
  }

  // ============================================================================
  // Render
  // ============================================================================

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Invite Form */}
      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle>Пригласить участника</CardTitle>
          <CardDescription>
            Добавьте пользователя по email. Если пользователь уже зарегистрирован, он будет добавлен сразу. 
            Если нет — ему придёт приглашение на почту.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="flex flex-col gap-4 sm:flex-row sm:items-end"
            onSubmit={inviteForm.handleSubmit((values) => inviteMemberMutation.mutate(values))}
          >
            <div className="flex-1 space-y-2">
              <label className="text-sm font-medium" htmlFor="workspace-invite-email">
                Email
              </label>
              <Input
                id="workspace-invite-email"
                type="email"
                placeholder="user@example.com"
                {...inviteForm.register("email")}
                disabled={inviteMemberMutation.isPending}
                aria-invalid={inviteEmailError ? "true" : "false"}
              />
              {inviteEmailError ? (
                <p className="text-sm text-destructive" role="alert">
                  {inviteEmailError}
                </p>
              ) : null}
            </div>
            <div className="w-full sm:w-56 space-y-2">
              <label className="text-sm font-medium" htmlFor="workspace-invite-role">
                Роль
              </label>
              <Select
                value={inviteForm.watch("role")}
                onValueChange={(value) => inviteForm.setValue("role", value as WorkspaceMemberRole)}
                disabled={inviteMemberMutation.isPending}
              >
                <SelectTrigger id="workspace-invite-role">
                  <SelectValue placeholder="Выберите роль" />
                </SelectTrigger>
                <SelectContent>
                  {workspaceMemberRoles.map((role) => (
                    <SelectItem key={role} value={role}>
                      {roleLabels[role]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button type="submit" disabled={!canInvite}>
              {inviteMemberMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Пригласить"}
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Pending Invitations */}
      {invitations.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Mail className="h-5 w-5" />
              Ожидающие приглашения
              <Badge variant="secondary">{invitations.length}</Badge>
            </CardTitle>
            <CardDescription>
              Пользователи, которые ещё не приняли приглашение
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead className="w-[140px]">Роль</TableHead>
                  <TableHead className="w-[120px]">Отправлено</TableHead>
                  <TableHead className="w-[160px]">Истекает</TableHead>
                  <TableHead className="text-right w-[100px]">Действия</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invitations.map((invitation) => {
                  const expiresAt = new Date(invitation.expiresAt);
                  const now = new Date();
                  const hoursLeft = (expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60);
                  const isExpiringSoon = hoursLeft < 24 && hoursLeft > 0;
                  
                  const isCancelling = cancelInvitationMutation.isPending && 
                    cancelInvitationMutation.variables === invitation.id;
                  const isResending = resendInvitationMutation.isPending && 
                    resendInvitationMutation.variables === invitation.id;
                  
                  return (
                    <TableRow key={invitation.id}>
                      <TableCell className="font-medium">{invitation.email}</TableCell>
                      <TableCell>{roleLabels[invitation.role]}</TableCell>
                      <TableCell>
                        <div className="text-sm text-muted-foreground">
                          {new Date(invitation.createdAt).toLocaleDateString("ru-RU")}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Clock className="h-4 w-4 text-muted-foreground" />
                          <span className="text-sm text-muted-foreground">
                            {expiresAt.toLocaleDateString("ru-RU")}
                          </span>
                          {isExpiringSoon && (
                            <Badge variant="outline" className="text-yellow-600 border-yellow-600">
                              Скоро истекает
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => resendInvitationMutation.mutate(invitation.id)}
                            disabled={isResending || isCancelling}
                            title="Отправить повторно"
                          >
                            {isResending ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <RefreshCw className="h-4 w-4" />
                            )}
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => cancelInvitationMutation.mutate(invitation.id)}
                            disabled={isCancelling || isResending}
                            title="Отменить приглашение"
                          >
                            {isCancelling ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Trash2 className="h-4 w-4" />
                            )}
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Members List */}
      <Card>
        <CardHeader>
          <CardTitle>Участники</CardTitle>
          <CardDescription>Управляйте ролями и доступом участников рабочего пространства.</CardDescription>
        </CardHeader>
        <CardContent>{membersContent}</CardContent>
      </Card>
    </div>
  );
}
