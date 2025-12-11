import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  SidebarRail,
  SidebarFooter,
  useSidebar,
} from "@/components/ui/sidebar";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  Search,
  BookOpen,
  Boxes,
  Brain,
  Shield,
  Users,
  LayoutDashboard,
  Sparkles,
  MessageCircle,
  Waypoints,
  PanelLeft,
  PanelRight,
} from "lucide-react";
import type { PublicUser } from "@shared/schema";
import {
  KNOWLEDGE_BASE_EVENT,
  readKnowledgeBaseStorage,
  syncKnowledgeBaseStorageFromSummaries,
} from "@/lib/knowledge-base";
import { apiRequest } from "@/lib/queryClient";
import type { KnowledgeBaseSummary } from "@shared/knowledge-base";
import { UserAvatar } from "@/components/UserAvatar";
import { WorkspaceIcon } from "@/components/WorkspaceIcon";

function WorkspaceIcon({
  iconUrl,
  size,
  testId,
}: {
  iconUrl?: string | null;
  size: number;
  testId?: string;
}) {
  const [src, setSrc] = useState(iconUrl || defaultWorkspaceIcon);

  useEffect(() => {
    setSrc(iconUrl || defaultWorkspaceIcon);
  }, [iconUrl]);

  return (
    <div
      className="flex shrink-0 items-center justify-center overflow-hidden rounded-[5px] border border-[#0e4c7d]"
      style={{ width: size, height: size }}
      data-testid={testId}
    >
      <img
        src={src}
        alt="Иконка рабочего пространства"
        className="h-full w-full object-cover"
        onError={() => setSrc(defaultWorkspaceIcon)}
      />
    </div>
  );
}

interface SidebarItem {
  title: string;
  url: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: string;
  badgeVariant?: "default" | "secondary" | "destructive" | "outline";
  locked?: boolean;
  testId?: string;
}

interface MainSidebarProps {
  showAdminLink?: boolean;
  user: PublicUser;
  workspaceId?: string;
  iconUrl?: string | null;
}

export default function MainSidebar({ showAdminLink = false, user, workspaceId, iconUrl }: MainSidebarProps) {
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
      .replace(/\s+/g, "-")
      .replace(/ё/g, "е")}`;

  const chatUrl = workspaceId ? `/workspaces/${workspaceId}/chat` : "/chat";
  const actionsUrl = workspaceId ? `/workspaces/${workspaceId}/actions` : "/workspaces/actions";

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
        {
          title: "Навыки",
          url: "/skills",
          icon: Sparkles,
        },
        {
          title: "Чат",
          url: chatUrl,
          icon: MessageCircle,
        },
      ],
    },
    {
      label: "Данные",
      items: [
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
      label: "Рабочее пространство",
      items: [
        {
          title: "Участники",
          url: "/workspaces/members",
          icon: Users,
        },
        {
          title: "Действия",
          url: actionsUrl,
          icon: Waypoints,
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

  const renderMenuItem = (item: SidebarItem) => {
    const isActive = isItemActive(item);
    const testId = item.testId ?? (item.url === chatUrl ? "link-chat" : getTestId(item));

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

    const iconElement = (
      <item.icon
        className={cn(
          "h-6 w-6 shrink-0",
          isActive ? "text-[#0f5a90]" : "text-slate-500"
        )}
      />
    );

    const labelElement = !isCollapsed && (
      <span
        className={cn(
          "flex-1 truncate text-base font-medium",
          isActive ? "text-[#0f5a90]" : "text-slate-800 dark:text-slate-200"
        )}
      >
        {item.title}
      </span>
    );

    const badgeElement = !isCollapsed && item.badge && !item.locked && (
      <div className="flex h-6 items-center justify-center rounded bg-[rgba(15,90,144,0.11)] px-2">
        <span className="text-[11px] font-medium text-slate-800 dark:text-slate-200">
          {item.badge}
        </span>
      </div>
    );

    const proElement = !isCollapsed && item.locked && (
      <Badge variant="outline" className="ml-auto text-xs border-dashed text-muted-foreground">
        PRO
      </Badge>
    );

    if (item.locked) {
      return (
        <SidebarMenuButton
          className={cn(
            "h-12 gap-3 rounded-lg px-3 py-3 opacity-60 cursor-not-allowed",
            isCollapsed ? "justify-center" : "justify-start"
          )}
          disabled
          tooltip={isCollapsed ? collapsedTooltip : "Доступно в платной версии"}
          data-testid={testId}
        >
          {iconElement}
          {labelElement}
          {proElement}
        </SidebarMenuButton>
      );
    }

    return (
      <SidebarMenuButton
        asChild
        isActive={isActive}
        className={cn(
          "h-12 gap-3 rounded-lg px-3 py-3 transition-colors",
          isCollapsed ? "justify-center" : "justify-start",
          isActive
            ? "bg-[rgba(15,90,144,0.11)] hover:bg-[rgba(15,90,144,0.15)]"
            : "hover:bg-slate-200/60 dark:hover:bg-slate-700/40"
        )}
        tooltip={isCollapsed ? collapsedTooltip : undefined}
        data-testid={testId}
      >
        <Link
          href={item.url}
          className={cn(
            "flex w-full items-center gap-2",
            isCollapsed && "justify-center gap-0"
          )}
        >
          {iconElement}
          {labelElement}
          {badgeElement}
        </Link>
      </SidebarMenuButton>
    );
  };

  return (
    <Sidebar
      collapsible="icon"
      className="border-r border-black/[0.03] bg-slate-100 dark:border-white/[0.05] dark:bg-slate-900"
    >
      <SidebarRail />

      {/* Logo Section */}
      <SidebarHeader
        className={cn(
          "h-20 shrink-0 border-b-0 px-2 py-3",
          isCollapsed ? "items-center justify-center" : "items-center"
        )}
      >
        {isCollapsed ? (
          <div
            className="flex h-[38px] w-[38px] items-center justify-center overflow-hidden rounded-[5px] border border-[#0e4c7d]"
            <WorkspaceIcon iconUrl={iconUrl} size={48} testId="icon-judicial-emblem" />
          ) : (
            <div className="flex w-full items-center gap-2 px-1">
              <WorkspaceIcon iconUrl={iconUrl} size={38} testId="icon-judicial-emblem-expanded" />
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-base font-bold text-slate-800 dark:text-slate-100">
                AI KMS
              </span>
              <span className="truncate text-[11px] font-light text-slate-500">
                gostuspace
              </span>
            </div>
          </div>
        )}
      </SidebarHeader>

      {/* Main Navigation */}
      <SidebarContent className="px-1">
        {sections.map((section, sectionIndex) => (
          <SidebarGroup key={section.label} className="px-1 py-0">
            {/* Section Divider */}
            {!isCollapsed ? (
              <div className="flex h-[18px] items-center px-2">
                <span className="text-[11px] font-light tracking-[-0.26px] text-black/30 dark:text-white/40">
                  {section.label}
                </span>
              </div>
            ) : (
              <div className="my-1 h-px w-full bg-gradient-to-r from-transparent via-slate-300 to-transparent dark:via-slate-700" />
            )}

            <SidebarGroupContent>
              <SidebarMenu className="gap-0">
                {section.items.map((item) => (
                  <SidebarMenuItem key={item.title} className="p-1">
                    {renderMenuItem(item)}
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>

            {/* Spacer between sections */}
            {sectionIndex < sections.length - 1 && <div className="h-3" />}
          </SidebarGroup>
        ))}
      </SidebarContent>

      {/* Footer with User Profile */}
      <SidebarFooter className="mt-auto border-t border-black/[0.03] px-2 py-2 dark:border-white/[0.05]">
        {/* User Profile */}
        <SidebarMenu>
          <SidebarMenuItem className="p-1">
            <SidebarMenuButton
              asChild
              isActive={location === "/profile"}
              className={cn(
                "h-10 gap-2 rounded-md p-1 transition-colors",
                isCollapsed ? "justify-center" : "justify-start",
                location === "/profile"
                  ? "bg-[rgba(15,90,144,0.11)]"
                  : "hover:bg-slate-200/60 dark:hover:bg-slate-700/40"
              )}
              tooltip={isCollapsed ? user.fullName : undefined}
              data-testid="link-profile"
            >
              <Link
                href="/profile"
                className={cn(
                  "flex w-full items-center gap-2",
                  isCollapsed && "justify-center gap-0"
                )}
              >
                <UserAvatar
                  user={user}
                  size="sm"
                  className="h-8 w-8 shrink-0"
                />
                {!isCollapsed && (
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-[13px] font-medium text-slate-800 dark:text-slate-200">
                      {user.fullName}
                    </span>
                    <span className="truncate text-[11px] font-light text-slate-500">
                      {user.email}
                    </span>
                  </div>
                )}
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>

        {/* Toggle Button */}
        <div className="flex h-8 items-center justify-center">
          <button
            onClick={toggleSidebar}
            className="flex h-[18px] w-[18px] items-center justify-center text-slate-500 transition-colors hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
            aria-label={isCollapsed ? "Развернуть меню" : "Свернуть меню"}
            data-testid="button-toggle-sidebar"
          >
            {isCollapsed ? (
              <PanelRight className="h-[18px] w-[18px]" />
            ) : (
              <PanelLeft className="h-[18px] w-[18px]" />
            )}
          </button>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
