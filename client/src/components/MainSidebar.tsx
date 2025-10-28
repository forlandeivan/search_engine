import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
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
  Search,
  Database,
  BookOpen,
  Boxes,
  Brain,
  ChevronLeft,
  Settings,
  Shield,
  CircleUser,
  Users,
  LayoutDashboard,
  Bot,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { PublicUser } from "@shared/schema";
import {
  KNOWLEDGE_BASE_EVENT,
  readKnowledgeBaseStorage,
  syncKnowledgeBaseStorageFromSummaries,
} from "@/lib/knowledge-base";
import { apiRequest } from "@/lib/queryClient";
import type { KnowledgeBaseSummary } from "@shared/knowledge-base";

interface SidebarItem {
  title: string;
  url: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: string;
  badgeVariant?: "default" | "secondary" | "destructive" | "outline";
  locked?: boolean;
}

interface Stats {
  pages: { total: number; };
}

interface MainSidebarProps {
  showAdminLink?: boolean;
  user: PublicUser;
}

export default function MainSidebar({ showAdminLink = false, user }: MainSidebarProps) {
  const [location] = useLocation();
  const { state, toggleSidebar } = useSidebar();
  const isCollapsed = state === "collapsed";
  const [knowledgeBaseCount, setKnowledgeBaseCount] = useState(
    () => readKnowledgeBaseStorage().knowledgeBases.length
  );

  const { data: knowledgeBases } = useQuery<KnowledgeBaseSummary[]>({
    queryKey: ["knowledge-bases"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/knowledge/bases");
      return (await res.json()) as KnowledgeBaseSummary[];
    },
  });

  const { data: stats } = useQuery<Stats>({
    queryKey: ['/api/stats'],
    refetchInterval: 10000,
  });

  useEffect(() => {
    if (!knowledgeBases) {
      return;
    }

    const updated = syncKnowledgeBaseStorageFromSummaries(knowledgeBases);
    setKnowledgeBaseCount(updated.knowledgeBases.length);
  }, [knowledgeBases]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const sync = () => {
      setKnowledgeBaseCount(readKnowledgeBaseStorage().knowledgeBases.length);
    };

    window.addEventListener(KNOWLEDGE_BASE_EVENT, sync);
    window.addEventListener("storage", sync);

    return () => {
      window.removeEventListener(KNOWLEDGE_BASE_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const isItemActive = (item: SidebarItem) => location === item.url;

  const getTestId = (item: SidebarItem) =>
    `link-${item.title
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/ё/g, 'е')}`;

  const renderMenuButton = (item: SidebarItem) => {
    const collapsedTooltip = item.locked
      ? {
          children: (
            <div className="space-y-1">
              <p className="text-sm font-medium leading-none">{item.title}</p>
              <p className="text-xs text-muted-foreground">Доступно в платной версии</p>
            </div>
          ),
        }
      : item.title;

    const content = (
      <>
        <item.icon className={cn("h-4 w-4", isCollapsed && "mx-auto")} />
        {!isCollapsed && <span className="truncate">{item.title}</span>}
        {!isCollapsed &&
          (item.locked ? (
            <Badge variant="outline" className="ml-auto text-xs border-dashed text-muted-foreground">
              PRO
            </Badge>
          ) : (
            item.badge && (
              <Badge variant={item.badgeVariant || "default"} className="ml-auto text-xs">
                {item.badge}
              </Badge>
            )
          ))}
      </>
    );

    if (item.locked) {
      return (
        <SidebarMenuButton
          className={cn(
            "justify-start opacity-60 cursor-not-allowed",
            isCollapsed && "justify-center"
          )}
          disabled
          tooltip={isCollapsed ? collapsedTooltip : "Доступно в платной версии"}
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
        className={cn("justify-start", isCollapsed && "justify-center")}
        tooltip={isCollapsed ? collapsedTooltip : undefined}
        data-testid={getTestId(item)}
      >
        <Link
          href={item.url}
          className={cn("flex flex-1 items-center gap-2", isCollapsed && "justify-center gap-0")}
        >
          {content}
        </Link>
      </SidebarMenuButton>
    );
  };

  const sections: Array<{ label: string; items: SidebarItem[] }> = [
    {
      label: "Навигация",
      items: [
        {
          title: "Дашборд",
          url: "/",
          icon: LayoutDashboard,
        },
        {
          title: "Глобальный поиск",
          url: "/search",
          icon: Search,
        },
        {
          title: "Базы знаний",
          url: "/knowledge",
          icon: Brain,
          badge: knowledgeBaseCount.toString(),
          badgeVariant: "secondary",
        },
      ],
    },
    {
      label: "Данные",
      items: [
        {
          title: "Индексированные страницы",
          url: "/pages",
          icon: Database,
          badge: stats?.pages ? stats.pages.total.toString() : "0",
          badgeVariant: "default",
        },
        {
          title: "Коллекции",
          url: "/vector/collections",
          icon: Boxes,
        },
        {
          title: "Документация API",
          url: "/integrations/api",
          icon: BookOpen,
        },
      ],
    },
    {
      label: "Виджеты",
      items: [
        {
          title: "Чат-виджет",
          url: "/integrations/widget",
          icon: Bot,
        },
      ],
    },
    {
      label: "Рабочее пространство",
      items: [
        {
          title: "Участники",
          url: "/workspaces/members",
          icon: Users,
        },
        {
          title: "Настройки",
          url: "/settings",
          icon: Settings,
          locked: true,
        },
      ],
    },
  ];

  if (showAdminLink) {
    sections[sections.length - 1].items.push({
      title: "Администрирование",
      url: "/admin/workspaces",
      icon: Shield,
    });
  }

  return (
    <Sidebar collapsible="icon">
      <SidebarRail />
      <SidebarHeader className={cn("border-b px-3 py-2", isCollapsed && "items-center p-2.5")}>
        {isCollapsed ? (
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-sm font-semibold text-primary-foreground">
            AI
          </div>
        ) : (
          <div className="flex items-center justify-between gap-2">
            <div>
              <h2 className="text-lg font-semibold">AI KMS</h2>
              <p className="text-sm text-muted-foreground">Рабочее пространство</p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={toggleSidebar}
              aria-label={state === "expanded" ? "Свернуть меню" : "Развернуть меню"}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
          </div>
        )}
      </SidebarHeader>

      <SidebarContent className="px-1 py-2">
        {sections.map((section) => (
          <SidebarGroup key={section.label} className="px-2 py-1">
            <SidebarGroupLabel className="h-7 text-[11px] uppercase tracking-wide text-muted-foreground">
              {section.label}
            </SidebarGroupLabel>
            <SidebarGroupContent className="space-y-1">
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
      <SidebarFooter className="border-t gap-2 px-3 py-3">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              isActive={location === "/profile"}
              className={cn("justify-start", isCollapsed && "justify-center")}
              tooltip={isCollapsed ? user.fullName : undefined}
              data-testid="link-profile"
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
        <SidebarTrigger
          className={isCollapsed ? "h-8 w-8 self-center p-0" : "w-full justify-center"}
          aria-label="Переключить меню"
        />
      </SidebarFooter>
    </Sidebar>
  );
}
