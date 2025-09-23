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
  SidebarHeader
} from "@/components/ui/sidebar";
import { Badge } from "@/components/ui/badge";
import { 
  Search, 
  Settings, 
  Globe, 
  Database, 
  Activity,
  Webhook,
  Calendar,
  BookOpen,
  Boxes
} from "lucide-react";

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

export default function AdminSidebar() {
  const [location] = useLocation();
  
  // Fetch live statistics
  const { data: stats } = useQuery<Stats>({
    queryKey: ['/api/stats'],
    refetchInterval: 10000, // Update every 10 seconds
  });

  const { data: sites } = useQuery<Site[]>({
    queryKey: ['/api/sites/extended'],
    refetchInterval: 10000,
  });

  const isItemActive = (item: SidebarItem) => location === item.url;

  const getTestId = (item: SidebarItem) =>
    `link-${item.title
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/ё/g, "е")}`;

  const renderMenuButton = (item: SidebarItem) => {
    const content = (
      <>
        <item.icon className="h-4 w-4" />
        <span>{item.title}</span>
        {item.locked ? (
          <Badge variant="outline" className="ml-auto text-xs border-dashed text-muted-foreground">
            PRO
          </Badge>
        ) : (
          item.badge && (
            <Badge variant={item.badgeVariant || "default"} className="ml-auto text-xs">
              {item.badge}
            </Badge>
          )
        )}
      </>
    );

    if (item.locked) {
      return (
        <SidebarMenuButton
          className="justify-start opacity-60 cursor-not-allowed"
          disabled
          tooltip="Доступно в платной версии"
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
          badgeVariant: "secondary"
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
          badgeVariant: "default"
        },
        {
          title: "Статистика краулинга",
          url: "/admin/stats",
          icon: Activity,
          locked: true
        },
        {
          title: "Расписание",
          url: "/admin/schedule",
          icon: Calendar,
          locked: true
        },
        {
          title: "Вебхуки",
          url: "/admin/webhooks",
          icon: Webhook,
          locked: true
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
          icon: BookOpen
        },
        {
          title: "Настройки",
          url: "/admin/settings",
          icon: Settings
        }
      ],
    },
  ];

  return (
    <Sidebar>
      <SidebarHeader className="p-4 border-b">
        <h2 className="text-lg font-semibold">Поисковый движок</h2>
        <p className="text-sm text-muted-foreground">Админ-панель</p>
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
    </Sidebar>
  );
}