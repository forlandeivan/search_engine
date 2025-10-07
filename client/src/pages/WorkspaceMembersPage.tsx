import type { ReactNode } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
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
import { Loader2, Trash2 } from "lucide-react";
import type { WorkspaceMemberRole } from "@shared/schema";

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
  fullName: string;
  role: WorkspaceMemberRole;
  createdAt: string;
  updatedAt: string;
  isYou: boolean;
};

type MembersResponse = {
  members: WorkspaceMember[];
};

export default function WorkspaceMembersPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const membersQuery = useQuery({
    queryKey: ["/api/workspaces/members"],
    queryFn: getQueryFn<MembersResponse>({ on401: "returnNull" }),
    staleTime: 0,
  });

  const inviteForm = useForm<InviteMemberValues>({
    resolver: zodResolver(inviteMemberSchema),
    defaultValues: { email: "", role: "user" },
  });

  const inviteMemberMutation = useMutation<MembersResponse, Error, InviteMemberValues>({
    mutationFn: async (values) => {
      const res = await apiRequest("POST", "/api/workspaces/members", values);
      return (await res.json()) as MembersResponse;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["/api/workspaces/members"], data);
      inviteForm.reset({ email: "", role: data.members.find((member) => member.isYou)?.role ?? "user" });
      toast({ title: "Приглашение отправлено" });
    },
    onError: (error: Error) => {
      toast({
        title: "Не удалось добавить участника",
        description: error.message,
        variant: "destructive",
      });
    },
  });

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

  const isLoading = membersQuery.isLoading;
  const isUnauthorized = !isLoading && membersQuery.data === null;
  const members = membersQuery.data?.members ?? [];

  const canInvite = !inviteMemberMutation.isPending;

  const inviteEmailError = inviteForm.formState.errors.email?.message;

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
            <TableHead className="w-[120px]">Статус</TableHead>
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
                    {member.isYou ? <Badge variant="secondary">Это вы</Badge> : null}
                  </div>
                </TableCell>
                <TableCell>{member.email}</TableCell>
                <TableCell>
                  <Select
                    value={member.role}
                    onValueChange={(value) =>
                      updateRoleMutation.mutate({ memberId: member.id, role: value as WorkspaceMemberRole })
                    }
                    disabled={isUpdating || member.isYou}
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
                    {new Date(member.createdAt).toLocaleDateString("ru-RU")}
                  </div>
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => removeMemberMutation.mutate({ memberId: member.id })}
                    disabled={isRemoving || member.isYou}
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

  return (
    <div className="flex flex-col gap-6 p-6">
      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle>Пригласить участника</CardTitle>
          <CardDescription>
            Добавьте пользователя по email и выберите его роль в рабочем пространстве.
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
