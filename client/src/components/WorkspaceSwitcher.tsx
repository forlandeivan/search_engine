import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { SessionResponse, WorkspaceState } from "@/types/session";
import defaultWorkspaceIcon from "/branding/logo.svg";

interface WorkspaceSwitcherProps {
  workspace: WorkspaceState;
}

export default function WorkspaceSwitcher({ workspace }: WorkspaceSwitcherProps) {
  const queryClient = useQueryClient();
  const [location, navigate] = useLocation();
  const { toast } = useToast();
  const { isMobile } = useSidebar();

  type SwitchWorkspaceResponse = {
    workspaceId: string;
    status: string;
    name?: string | null;
  };

  const switchWorkspaceMutation = useMutation<SwitchWorkspaceResponse, Error, string>({
    mutationFn: async (workspaceId) => {
      const res = await apiRequest("POST", "/api/workspaces/switch", { workspaceId });
      return (await res.json()) as SwitchWorkspaceResponse;
    },
    onSuccess: (data) => {
      const nextWorkspaceId = data.workspaceId;
      queryClient.setQueryData(["/api/auth/session"], (prev: SessionResponse | null | undefined) => {
        if (!prev) return prev;
        const memberships = prev.workspace.memberships ?? [];
        const nextActive = memberships.find((m) => m.id === nextWorkspaceId);
        if (!nextActive) {
          return {
            ...prev,
            activeWorkspaceId: nextWorkspaceId,
          };
        }
        return {
          ...prev,
          activeWorkspaceId: nextWorkspaceId,
          workspace: {
            ...prev.workspace,
            active: nextActive,
          },
        };
      });
      queryClient.invalidateQueries({
        predicate: () => true,
      });
      toast({
        title: "Рабочее пространство переключено",
        description: `Текущее пространство - ${(data.name ?? "") || nextWorkspaceId}`,
      });
      const currentWorkspaceId = workspace.active.id;
      if (currentWorkspaceId && location.includes(currentWorkspaceId)) {
        navigate(location.replace(currentWorkspaceId, nextWorkspaceId));
      }
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
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground group-data-[collapsible=icon]:justify-center"
              disabled={switchWorkspaceMutation.isPending}
            >
              <img
                src={workspace.active.iconUrl || defaultWorkspaceIcon}
                alt={workspace.active.name}
                className="size-8 shrink-0 rounded-lg object-cover"
                onError={(event) => {
                  event.currentTarget.src = defaultWorkspaceIcon;
                }}
              />
              <div className="grid flex-1 text-left text-sm leading-tight group-data-[collapsible=icon]:hidden">
                <span className="truncate font-medium">{workspace.active.name}</span>
                <span className="truncate text-xs">{workspace.active.plan}</span>
              </div>
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-[--radix-dropdown-menu-trigger-width] min-w-56 rounded-lg"
            align="start"
            side={isMobile ? "bottom" : "right"}
            sideOffset={4}
          >
            <DropdownMenuLabel className="text-muted-foreground text-xs">
              Рабочие пространства
            </DropdownMenuLabel>
            {workspace.memberships.map((membership) => (
              <DropdownMenuItem
                key={membership.id}
                onClick={() => handleSelect(membership.id)}
                className="gap-2 p-2"
              >
                <img
                  src={membership.iconUrl || defaultWorkspaceIcon}
                  alt={membership.name}
                  className="size-6 shrink-0 rounded-md object-cover"
                  onError={(event) => {
                    event.currentTarget.src = defaultWorkspaceIcon;
                  }}
                />
                {membership.name}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
