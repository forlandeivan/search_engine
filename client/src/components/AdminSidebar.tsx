import { useState } from "react";
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
  BookOpen
} from "lucide-react";

interface SidebarItem {
  title: string;
  url: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: string;
  badgeVariant?: "default" | "secondary" | "destructive" | "outline";
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

  const isItemActive = (item: SidebarItem) => {
    if (item.url === "/admin/sites") {
      return location === item.url || location.startsWith("/admin/sites/");
    }
    return location === item.url;
  };

  const menuItems: SidebarItem[] = [
    {
      title: "Поиск",
      url: "/",
      icon: Search,
    },
    {
      title: "Сайты для краулинга", 
      url: "/admin/sites",
      icon: Globe,
      badge: sites ? sites.length.toString() : "0",
      badgeVariant: "secondary"
    },
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
      icon: Activity
    },
    {
      title: "Расписание",
      url: "/admin/schedule",
      icon: Calendar
    },
    {
      title: "Вебхуки",
      url: "/admin/webhooks",
      icon: Webhook
    },
    {
      title: "API для Тильды",
      url: "/admin/api",
      icon: BookOpen
    },
    {
      title: "Настройки",
      url: "/admin/settings",
      icon: Settings
    }
  ];

  return (
    <Sidebar>
      <SidebarHeader className="p-4 border-b">
        <h2 className="text-lg font-semibold">Поисковый движок</h2>
        <p className="text-sm text-muted-foreground">Админ-панель</p>
      </SidebarHeader>
      
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Основное</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {menuItems.slice(0, 2).map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton
                    asChild
                    isActive={isItemActive(item)}
                    data-testid={`link-${item.title.toLowerCase().replace(/\s+/g, '-')}`}
                  >
                    <Link href={item.url}>
                      <item.icon className="h-4 w-4" />
                      <span>{item.title}</span>
                      {item.badge && (
                        <Badge 
                          variant={item.badgeVariant || "default"} 
                          className="ml-auto text-xs"
                        >
                          {item.badge}
                        </Badge>
                      )}
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Управление</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {menuItems.slice(2, 6).map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton
                    asChild
                    isActive={isItemActive(item)}
                    data-testid={`link-${item.title.toLowerCase().replace(/\s+/g, '-').replace(/ё/g, 'е')}`}
                  >
                    <Link href={item.url}>
                      <item.icon className="h-4 w-4" />
                      <span>{item.title}</span>
                      {item.badge && (
                        <Badge 
                          variant={item.badgeVariant || "default"} 
                          className="ml-auto text-xs"
                        >
                          {item.badge}
                        </Badge>
                      )}
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Система</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {menuItems.slice(6).map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton
                    asChild
                    isActive={isItemActive(item)}
                    data-testid={`link-${item.title.toLowerCase().replace(/\s+/g, '-')}`}
                  >
                    <Link href={item.url}>
                      <item.icon className="h-4 w-4" />
                      <span>{item.title}</span>
                      {item.badge && (
                        <Badge 
                          variant={item.badgeVariant || "default"} 
                          className="ml-auto text-xs"
                        >
                          {item.badge}
                        </Badge>
                      )}
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}