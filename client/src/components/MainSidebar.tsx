import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  BookOpen,
  Brain,
  LayoutDashboard,
  Layers,
  MessageCircle,
  PanelLeft,
  PanelRight,
  Shield,
  Sparkle,
  Users,
  Zap,
} from "lucide-react";
import type { PublicUser } from "@shared/schema";
import type { WorkspaceState } from "@/types/session";
import {
  KNOWLEDGE_BASE_EVENT,
  readKnowledgeBaseStorage,
  syncKnowledgeBaseStorageFromSummaries,
} from "@/lib/knowledge-base";
import { apiRequest } from "@/lib/queryClient";
import type { KnowledgeBaseSummary } from "@shared/knowledge-base";
import WorkspaceSwitcher from "@/components/WorkspaceSwitcher";
import SidebarUserMenu from "@/components/SidebarUserMenu";

interface SidebarItem {
  title: string;
  url: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: string;
  locked?: boolean;
  testId?: string;
}

interface MainSidebarProps {
  showAdminLink?: boolean;
  user: PublicUser;
  workspace: WorkspaceState;
}

export default function MainSidebar({ showAdminLink = false, user, workspace }: MainSidebarProps) {
  const [location] = useLocation();
  const { state, toggleSidebar } = useSidebar();
  const [knowledgeBaseCount, setKnowledgeBaseCount] = useState(
    () => readKnowledgeBaseStorage().knowledgeBases.length
  );

  const workspaceId = workspace.active?.id;
  const chatUrl = workspaceId ? `/workspaces/${workspaceId}/chat` : "/chat";
  const actionsUrl = workspaceId ? `/workspaces/${workspaceId}/actions` : "/workspaces/actions";
  const workspaceSettingsUrl = workspaceId ? `/workspaces/${workspaceId}/settings` : "/workspaces/settings";

  const { data: knowledgeBases } = useQuery<KnowledgeBaseSummary[]>({
    queryKey: ["knowledge-bases", workspaceId],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/knowledge/bases");
      const data = await res.json();
      if (Array.isArray(data)) return data;
      if (data?.bases && Array.isArray(data.bases)) return data.bases;
      return [];
    },
    enabled: Boolean(workspaceId),
  });

  useEffect(() => {
    if (!knowledgeBases || !Array.isArray(knowledgeBases)) {
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

  const isItemActive = (item: SidebarItem) => {
    if (item.url === "/knowledge") {
      return location.startsWith("/knowledge");
    }
    return location === item.url;
  };

  const getTestId = (item: SidebarItem) =>
    `link-${item.title
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/ё/g, "е")}`;

  const settingsItems: SidebarItem[] = [
    {
      title: "Рабочее пространство",
      url: workspaceSettingsUrl,
      icon: Users,
    },
  ];

  if (showAdminLink) {
    settingsItems.push({
      title: "Администрирование",
      url: "/admin/workspaces",
      icon: Shield,
    });
  }

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
          title: "Базы знаний",
          url: "/knowledge",
          icon: Brain,
          badge: knowledgeBaseCount.toString(),
        },
        {
          title: "Навыки",
          url: "/skills",
          icon: Sparkle,
        },
        {
          title: "Действия",
          url: actionsUrl,
          icon: Zap,
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
          icon: Layers,
        },
        {
          title: "Документация API",
          url: "/integrations/api",
          icon: BookOpen,
        },
      ],
    },
    {
      label: "Настройки",
      items: settingsItems,
    },
  ];

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <WorkspaceSwitcher workspace={workspace} />
      </SidebarHeader>

      <SidebarContent>
        {sections.map((section) => (
          <SidebarGroup key={section.label}>
            <SidebarGroupLabel>{section.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {section.items.map((item) => {
                  const isActive = isItemActive(item);
                  const testId = item.testId ?? (item.url === chatUrl ? "link-chat" : getTestId(item));
                  const buttonContent = (
                    <>
                      <item.icon />
                      <span>{item.title}</span>
                    </>
                  );
                  return (
                    <SidebarMenuItem key={item.title}>
                      {item.locked ? (
                        <SidebarMenuButton
                          disabled
                          tooltip="Доступно в платной версии"
                          data-testid={testId}
                        >
                          {buttonContent}
                        </SidebarMenuButton>
                      ) : (
                        <SidebarMenuButton
                          asChild
                          isActive={isActive}
                          tooltip={item.title}
                          data-testid={testId}
                        >
                          <Link href={item.url}>{buttonContent}</Link>
                        </SidebarMenuButton>
                      )}
                      {item.locked ? <SidebarMenuBadge>PRO</SidebarMenuBadge> : null}
                      {!item.locked && item.badge ? (
                        <SidebarMenuBadge>{item.badge}</SidebarMenuBadge>
                      ) : null}
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter>
        <SidebarUserMenu user={user} />
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              onClick={toggleSidebar}
              tooltip={state === "expanded" ? "Свернуть меню" : "Развернуть меню"}
              data-testid="button-sidebar-toggle"
            >
              {state === "expanded" ? <PanelLeft /> : <PanelRight />}
              <span>{state === "expanded" ? "Свернуть меню" : "Развернуть меню"}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
