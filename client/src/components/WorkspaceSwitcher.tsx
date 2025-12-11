import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { WorkspaceState, SessionResponse } from "@/types/session";
import type { WorkspaceMemberRole } from "@shared/schema";
import { WorkspaceIcon } from "@/components/WorkspaceIcon";

const roleLabels: Record<WorkspaceMemberRole, string> = {
  owner: "Владелец",
  manager: "Менеджер",
  user: "Пользователь",
};

interface WorkspaceSwitcherProps {
  workspace: WorkspaceState;
}

export default function WorkspaceSwitcher({ workspace }: WorkspaceSwitcherProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const switchWorkspaceMutation = useMutation<SessionResponse, Error, string>({
    mutationFn: async (workspaceId) => {
      const res = await apiRequest("POST", "/api/workspaces/switch", { workspaceId });
      return (await res.json()) as SessionResponse;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["/api/auth/session"], data);
      toast({
        title: "Рабочее пространство переключено",
        description: `Текущее пространство — ${data.workspace.active.name}`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Не удалось переключить рабочее пространство",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleSelect = (workspaceId: string) => {
    if (workspaceId === workspace.active.id || switchWorkspaceMutation.isPending) {
      return;
    }
    switchWorkspaceMutation.mutate(workspaceId);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="flex items-center gap-2 font-medium"
          disabled={switchWorkspaceMutation.isPending}
        >
          {switchWorkspaceMutation.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Check className="h-4 w-4 opacity-0" />
          )}
          <span className="max-w-[160px] truncate" title={workspace.active.name}>
            {workspace.active.name}
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[220px]">
        <DropdownMenuLabel>Рабочие пространства</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {workspace.memberships.map((membership) => {
          const isActive = membership.id === workspace.active.id;
          return (
            <DropdownMenuItem
              key={membership.id}
              onSelect={(event) => {
                event.preventDefault();
                handleSelect(membership.id);
              }}
              className="flex items-center justify-between gap-2"
            >
              <div className="flex min-w-0 flex-col">
                <span className={`truncate ${isActive ? "font-semibold" : ""}`}>
                  {membership.name}
                </span>
                <span className="text-xs text-muted-foreground">{membership.plan}</span>
              </div>
              <div className="flex items-center gap-2">
                <WorkspaceIcon iconUrl={membership.iconUrl} size={24} />
                <Badge variant={isActive ? "default" : "secondary"}>
                  {roleLabels[membership.role]}
                </Badge>
                {isActive ? <Check className="h-4 w-4" /> : null}
              </div>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
