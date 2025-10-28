import { Link, useLocation } from "wouter";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  SidebarRail,
  SidebarTrigger,
  SidebarFooter,
  useSidebar,
} from "@/components/ui/sidebar";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  Users,
  Sparkles,
  ChevronLeft,
  ChevronRight,
  ArrowLeft,
  HardDrive,
  CircleUser,
  ShieldCheck,
  Building2,
  Bot,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { PublicUser } from "@shared/schema";

interface SidebarItem {
  title: string;
  url: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: string;
  badgeVariant?: "default" | "secondary" | "destructive" | "outline";
  locked?: boolean;
}

interface AdminSidebarProps {
  user: PublicUser;
}

export default function AdminSidebar({ user }: AdminSidebarProps) {
  const [location] = useLocation();
  const { state, toggleSidebar } = useSidebar();
  const isCollapsed = state === "collapsed";

  const isItemActive = (item: SidebarItem) => location === item.url;

  const getTestId = (item: SidebarItem) =>
    `link-${item.title
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/ё/g, 'е')}`;

  const renderMenuButton = (item: SidebarItem) => {
    const content = (
      <>
        <item.icon className="h-4 w-4" />
        <span>{item.title}</span>
        {item.locked && (
          <Badge variant="outline" className="ml-auto text-xs border-dashed text-muted-foreground">
            Скоро
          </Badge>
        )}
        {item.badge && !item.locked && (
          <Badge variant={item.badgeVariant || "default"} className="ml-auto text-xs">
            {item.badge}
          </Badge>
        )}
      </>
    );

    if (item.locked) {
      return (
        <SidebarMenuButton
          className="justify-start opacity-60 cursor-not-allowed"
          disabled
          tooltip="Секция в разработке"
          data-testid={getTestId(item)}
        >
          {content}
        </SidebarMenuButton>
      );
    }

    return (
      <SidebarMenuButton
        asChild
        isActive={isItemActive(item)}
        className="justify-start"
        data-testid={getTestId(item)}
      >
        <Link href={item.url}>{content}</Link>
      </SidebarMenuButton>
    );
  };

  const sections: Array<{ label?: string; items: SidebarItem[] }> = [
    {
      items: [
        {
          title: "Рабочие пространства",
          url: "/admin/workspaces",
          icon: Building2,
        },
        {
          title: "Пользователи",
          url: "/admin/users",
          icon: Users,
        },
      ],
    },
    {
      label: "Векторный поиск",
      items: [
        {
          title: "Настройки хранилища",
          url: "/admin/storage",
          icon: HardDrive,
        },
        {
          title: "Эмбеддинги",
          url: "/admin/embeddings",
          icon: Sparkles,
        },
      ],
    },
    {
      label: "Управление LLM",
      items: [
        {
          title: "Провайдеры LLM",
          url: "/admin/llm",
          icon: Bot,
        },
      ],
    },
    {
      label: "Аутентификация",
      items: [
        {
          title: "Настройки входа",
          url: "/admin/auth",
          icon: ShieldCheck,
        },
      ],
    },
  ];

  return (
    <Sidebar collapsible="icon">
      <SidebarRail />
      <SidebarHeader className="p-4 border-b">
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h2 className="text-lg font-semibold">Администрирование</h2>
              <p className="text-sm text-muted-foreground">Управление платформой</p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={toggleSidebar}
              aria-label={state === "expanded" ? "Свернуть меню" : "Развернуть меню"}
            >
              {state === "expanded" ? (
                <ChevronLeft className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
            </Button>
          </div>
          <Button
            asChild
            variant="outline"
            size={isCollapsed ? "icon" : "sm"}
            className={isCollapsed ? "h-8 w-8 self-end" : "justify-start gap-2"}
            aria-label="Вернуться к пользовательскому меню"
          >
            <Link href="/">
              <ArrowLeft className="h-4 w-4" />
              {!isCollapsed && <span>К пользовательскому меню</span>}
            </Link>
          </Button>
        </div>
      </SidebarHeader>

      <SidebarContent>
        {sections.map((section, index) => (
          <SidebarGroup key={section.label ?? index}>
            {section.label ? <SidebarGroupLabel>{section.label}</SidebarGroupLabel> : null}
            <SidebarGroupContent>
              <SidebarMenu>
                {section.items.map((item) => (
                  <SidebarMenuItem key={item.title}>
                    {renderMenuButton(item)}
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
      <SidebarFooter className="border-t gap-3">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              isActive={location === "/profile"}
              className={cn("justify-start", isCollapsed && "justify-center")}
              tooltip={isCollapsed ? user.fullName : undefined}
              data-testid="link-profile-admin"
            >
              <Link
                href="/profile"
                className={cn("flex flex-1 items-center gap-2", isCollapsed && "justify-center gap-0")}
              >
                <CircleUser className={cn("h-5 w-5", isCollapsed && "mx-auto")} />
                {!isCollapsed && (
                  <div className="flex flex-col text-left leading-tight">
                    <span className="text-sm font-medium">Профиль</span>
                    <span className="text-xs text-muted-foreground truncate">{user.fullName}</span>
                    <span className="text-[11px] text-muted-foreground/70 truncate">{user.email}</span>
                  </div>
                )}
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <SidebarTrigger className="w-full justify-center" aria-label="Переключить меню" />
      </SidebarFooter>
    </Sidebar>
  );
}
