import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronsUpDown, LogOut, Moon, Sun, UserRound } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
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
import { getInitials } from "@/lib/utils";
import type { PublicUser } from "@shared/schema";

type ThemeMode = "light" | "dark";

interface SidebarUserMenuProps {
  user: PublicUser;
}

export default function SidebarUserMenu({ user }: SidebarUserMenuProps) {
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { isMobile } = useSidebar();
  const [theme, setTheme] = useState<ThemeMode>("light");
  const initials = getInitials(user.fullName);
  const avatarUrl = user.googleAvatar || user.yandexAvatar || "";

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const storedTheme = localStorage.getItem("theme") as ThemeMode | null;
    if (storedTheme) {
      setTheme(storedTheme);
      document.documentElement.classList.toggle("dark", storedTheme === "dark");
    }
  }, []);

  const toggleTheme = () => {
    const nextTheme = theme === "dark" ? "light" : "dark";
    setTheme(nextTheme);
    localStorage.setItem("theme", nextTheme);
    document.documentElement.classList.toggle("dark", nextTheme === "dark");
  };

  const logoutMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/auth/logout");
    },
    onSuccess: async () => {
      queryClient.removeQueries({ queryKey: ["/api/auth/session"] });
      queryClient.removeQueries({
        predicate: (query) => {
          const [key] = query.queryKey as [unknown, ...unknown[]];
          return key !== "/api/auth/session";
        },
      });
      toast({ title: "Вы успешно вышли" });
      // Редиректим на страницу авторизации после разлогина
      // Используем window.location для принудительного редиректа
      window.location.href = "/auth";
    },
    onError: (error: Error) => {
      toast({
        title: "Не удалось выйти",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:overflow-visible group-data-[collapsible=icon]:rounded-lg group-data-[collapsible=icon]:hover:bg-transparent group-data-[collapsible=icon]:active:bg-transparent"
            >
              <Avatar className="h-8 w-8 rounded-lg after:rounded-lg">
                <AvatarImage src={avatarUrl} alt={user.fullName} />
                <AvatarFallback className="rounded-lg">
                  {initials || "??"}
                </AvatarFallback>
              </Avatar>
              <div className="grid flex-1 text-left text-sm leading-tight group-data-[collapsible=icon]:hidden">
                <span className="truncate font-medium">{user.fullName}</span>
                <span className="truncate text-xs">{user.email}</span>
              </div>
              <ChevronsUpDown className="ml-auto size-4 group-data-[collapsible=icon]:hidden" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-[--radix-dropdown-menu-trigger-width] min-w-56 rounded-lg"
            side={isMobile ? "bottom" : "right"}
            align="end"
            sideOffset={4}
          >
            <DropdownMenuLabel className="p-0 font-normal">
              <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                <Avatar className="h-8 w-8 rounded-lg after:rounded-lg">
                  <AvatarImage src={avatarUrl} alt={user.fullName} />
                  <AvatarFallback className="rounded-lg">
                    {initials || "??"}
                  </AvatarFallback>
                </Avatar>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-medium">{user.fullName}</span>
                  <span className="truncate text-xs">{user.email}</span>
                </div>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem
                onSelect={() => {
                  navigate("/profile");
                }}
              >
                <UserRound />
                Профиль
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={toggleTheme}>
                {theme === "dark" ? <Sun /> : <Moon />}
                {theme === "dark" ? "Светлая тема" : "Темная тема"}
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => logoutMutation.mutate()}
              disabled={logoutMutation.isPending}
            >
              <LogOut />
              {logoutMutation.isPending ? "Выходим..." : "Выйти"}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
