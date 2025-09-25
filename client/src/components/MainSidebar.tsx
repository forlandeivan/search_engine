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
  useSidebar,
} from "@/components/ui/sidebar";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  Search,
  Globe,
  Database,
  Activity,
  Webhook,
  Calendar,
  BookOpen,
  Boxes,
  Brain,
  ChevronLeft,
  Settings,
  Shield,
} from "lucide-react";
import { Button } from "@/components/ui/button";

interface SidebarItem {
  title: string;
  url: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: string;
  badgeVariant?: "default" | "secondary" | "destructive" | "outline";
  locked?: boolean;
}

interface Stats {
  sites: { total: number; crawling: number; completed: number; failed: number; };
  pages: { total: number; };
}

interface Site {
  id: string;
  url: string;
  status: string;
}

interface MainSidebarProps {
  showAdminLink?: boolean;
}

export default function MainSidebar({ showAdminLink = false }: MainSidebarProps) {
  const [location] = useLocation();
  const { state, toggleSidebar } = useSidebar();
  const isCollapsed = state === "collapsed";

  const { data: stats } = useQuery<Stats>({
    queryKey: ['/api/stats'],
    refetchInterval: 10000,
  });

  const { data: sites } = useQuery<Site[]>({
    queryKey: ['/api/sites/extended'],
    refetchInterval: 10000,
  });

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
      label: "Основное",
      items: [
        {
          title: "Поиск",
          url: "/",
          icon: Search,
        },
        {
          title: "Проекты",
          url: "/admin/sites",
          icon: Globe,
          badge: sites ? sites.length.toString() : "0",
          badgeVariant: "secondary",
        },
        {
          title: "Загрузка знаний",
          url: "/admin/knowledge",
          icon: Brain,
        },
      ],
    },
    {
      label: "Управление",
      items: [
        {
          title: "Индексированные страницы",
          url: "/admin/pages",
          icon: Database,
          badge: stats?.pages ? stats.pages.total.toString() : "0",
          badgeVariant: "default",
        },
        {
          title: "Статистика каулинга",
          url: "/admin/stats",
          icon: Activity,
          locked: true,
        },
        {
          title: "Расписание",
          url: "/admin/schedule",
          icon: Calendar,
          locked: true,
        },
        {
          title: "Вебхуки",
          url: "/admin/webhooks",
          icon: Webhook,
          locked: true,
        },
      ],
    },
    {
      label: "Векторный поиск",
      items: [
        {
          title: "Коллекции",
          url: "/admin/vector/collections",
          icon: Boxes,
        },
      ],
    },
    {
      label: "Система",
      items: [
        {
          title: "Документация API",
          url: "/admin/api",
          icon: BookOpen,
        },
        {
          title: "Настройки",
          url: "/admin/settings",
          icon: Settings,
          locked: true,
        },
      ],
    },
  ];

  if (showAdminLink) {
    sections[sections.length - 1].items.push({
      title: "Администрирование",
      url: "/admin/users",
      icon: Shield,
    });
  }

  return (
    <Sidebar collapsible="icon">
      <SidebarRail />
      <SidebarHeader className={cn("border-b p-4", isCollapsed && "items-center p-3")}> 
        {isCollapsed ? (
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-sm font-semibold text-primary-foreground">
            ПД
          </div>
        ) : (
          <div className="flex items-center justify-between gap-2">
            <div>
              <h2 className="text-lg font-semibold">Поисковый движок</h2>
              <p className="text-sm text-muted-foreground">Рабочая область</p>
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

      <SidebarContent>
        {sections.map((section) => (
          <SidebarGroup key={section.label}>
            <SidebarGroupLabel>{section.label}</SidebarGroupLabel>
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
      <div className="border-t p-4">
        <SidebarTrigger
          className={isCollapsed ? "h-8 w-8 self-center p-0" : "w-full justify-center"}
          aria-label="Переключить меню"
        />
      </div>
    </Sidebar>
  );
}
