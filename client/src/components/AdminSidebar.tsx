import { Link, useLocation } from "wouter";
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
  ArrowLeft,
  Bot,
  Building2,
  CreditCard,
  HardDrive,
  Layers3,
  Mail,
  Mic,
  PanelLeft,
  PanelRight,
  Receipt,
  ScrollText,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Users,
  Wrench,
} from "lucide-react";
import type { PublicUser } from "@shared/schema";
import type { WorkspaceState } from "@/types/session";
import WorkspaceSwitcher from "@/components/WorkspaceSwitcher";
import SidebarUserMenu from "@/components/SidebarUserMenu";

interface SidebarItem {
  title: string;
  url: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: string;
  locked?: boolean;
}

interface AdminSidebarProps {
  user: PublicUser;
  workspace: WorkspaceState;
}

export default function AdminSidebar({ user, workspace }: AdminSidebarProps) {
  const [location] = useLocation();
  const { state, toggleSidebar } = useSidebar();

  const isItemActive = (item: SidebarItem) => location === item.url;

  const getTestId = (item: SidebarItem) =>
    `link-${item.title
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/ё/g, "е")}`;

  const sections: Array<{ label?: string; items: SidebarItem[] }> = [
    {
      label: "Приложение",
      items: [{ title: "К пользовательскому меню", url: "/", icon: ArrowLeft }],
    },
    {
      items: [
        { title: "Рабочие пространства", url: "/admin/workspaces", icon: Building2 },
        { title: "Пользователи", url: "/admin/users", icon: Users },
      ],
    },
    {
      label: "Векторный поиск",
      items: [
        { title: "Настройки хранилища", url: "/admin/storage", icon: HardDrive },
        { title: "Эмбеддинги", url: "/admin/embeddings", icon: Sparkles },
      ],
    },
    {
      label: "Управление LLM",
      items: [
        { title: "Провайдеры LLM", url: "/admin/llm", icon: Bot },
        { title: "Каталог моделей", url: "/admin/models", icon: Layers3 },
        { title: "Журнал запусков LLM", url: "/admin/llm-executions", icon: ScrollText },
      ],
    },
    {
      label: "Guard и лимиты",
      items: [{ title: "Журнал блокировок", url: "/admin/guard-blocks", icon: ShieldAlert }],
    },
    {
      label: "Биллинг",
      items: [
        { title: "Биллинг", url: "/admin/billing", icon: CreditCard },
        { title: "Журнал списаний", url: "/admin/usage-charges", icon: Receipt },
      ],
    },
    {
      label: "Аутентификация",
      items: [{ title: "Настройки входа", url: "/admin/auth", icon: ShieldCheck }],
    },
    {
      label: "Настройки",
      items: [
        { title: "Файловые провайдеры", url: "/admin/file-storage", icon: HardDrive },
        { title: "Правила индексации", url: "/admin/indexing-rules", icon: SlidersHorizontal },
        { title: "Режим обслуживания", url: "/admin/settings/maintenance", icon: Wrench },
        { title: "SMTP", url: "/admin/settings/smtp", icon: Mail },
      ],
    },
    {
      label: "TTS&STT",
      items: [
        { title: "TTS&STT", url: "/admin/tts-stt", icon: Mic },
        { title: "ASR провайдеры", url: "/admin/asr-providers", icon: Mic },
        { title: "ASR executions", url: "/admin/asr-executions", icon: Mic },
      ],
    },
  ];

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <WorkspaceSwitcher workspace={workspace} />
      </SidebarHeader>

      <SidebarContent>
        {sections.map((section, index) => (
          <SidebarGroup key={section.label ?? index}>
            {section.label ? <SidebarGroupLabel>{section.label}</SidebarGroupLabel> : null}
            <SidebarGroupContent>
              <SidebarMenu>
                {section.items.map((item) => {
                  const isActive = isItemActive(item);
                  const testId = getTestId(item);
                  const buttonContent = (
                    <>
                      <item.icon />
                      <span>{item.title}</span>
                    </>
                  );
                  return (
                    <SidebarMenuItem key={item.title}>
                      {item.locked ? (
                        <SidebarMenuButton disabled tooltip="Секция в разработке" data-testid={testId}>
                          {buttonContent}
                        </SidebarMenuButton>
                      ) : (
                        <SidebarMenuButton asChild isActive={isActive} tooltip={item.title} data-testid={testId}>
                          <Link href={item.url}>{buttonContent}</Link>
                        </SidebarMenuButton>
                      )}
                      {item.locked ? <SidebarMenuBadge>Скоро</SidebarMenuBadge> : null}
                      {!item.locked && item.badge ? <SidebarMenuBadge>{item.badge}</SidebarMenuBadge> : null}
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
