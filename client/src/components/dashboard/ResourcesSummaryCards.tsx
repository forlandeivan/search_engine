import { useMemo } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Sparkles, Zap, MessageSquare, Brain, Users } from "lucide-react";
import { useSkills } from "@/hooks/useSkills";
import { useChats } from "@/hooks/useChats";
import { apiRequest } from "@/lib/queryClient";
import type { KnowledgeBaseSummary } from "@shared/knowledge-base";

// =============================================================================
// Types
// =============================================================================

type ResourceCard = {
  id: string;
  title: string;
  value: number | string;
  subtitle?: string;
  icon: React.ElementType;
  href: string;
  isLoading?: boolean;
};

type ResourcesSummaryCardsProps = {
  workspaceId: string | null;
  isSessionLoading?: boolean;
};

type ActionsResponse = {
  actions: Array<{ id: string; status?: string }>;
};

type MembersResponse = {
  members: Array<{ id: string }>;
};

// =============================================================================
// Helpers
// =============================================================================

function isToday(date: Date): boolean {
  const today = new Date();
  return (
    date.getDate() === today.getDate() &&
    date.getMonth() === today.getMonth() &&
    date.getFullYear() === today.getFullYear()
  );
}

function getWeekAgo(): Date {
  const date = new Date();
  date.setDate(date.getDate() - 7);
  return date;
}

// =============================================================================
// ResourceCard Component
// =============================================================================

function ResourceCard({ title, value, subtitle, icon: Icon, href, isLoading }: ResourceCard) {
  const [, navigate] = useLocation();

  const handleClick = () => {
    if (href) {
      navigate(href);
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center gap-4 p-4">
          <Skeleton className="h-12 w-12 rounded-lg" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-6 w-12" />
            <Skeleton className="h-4 w-20" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card
      className="hover:shadow-md transition-shadow cursor-pointer"
      onClick={handleClick}
      tabIndex={0}
      role="button"
      onKeyDown={(e) => e.key === "Enter" && handleClick()}
    >
      <CardContent className="flex items-center gap-4 p-4">
        <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10">
          <Icon className="h-6 w-6 text-primary" />
        </div>
        <div className="flex-1">
          <p className="text-2xl font-bold">{value}</p>
          <p className="text-sm text-muted-foreground">{title}</p>
          {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
        </div>
      </CardContent>
    </Card>
  );
}

// =============================================================================
// Main Component
// =============================================================================

export function ResourcesSummaryCards({ workspaceId, isSessionLoading }: ResourcesSummaryCardsProps) {
  // Skills
  const { skills, isLoading: skillsLoading } = useSkills({
    workspaceId,
    enabled: Boolean(workspaceId),
  });

  // Chats
  const { chats, isLoading: chatsLoading } = useChats(workspaceId ?? undefined, undefined, {
    includeArchived: false,
  });

  // Actions
  const { data: actionsData, isLoading: actionsLoading } = useQuery<ActionsResponse>({
    queryKey: ["/api/workspaces", workspaceId, "actions"],
    queryFn: async () => {
      const res = await apiRequest(
        "GET",
        `/api/workspaces/${workspaceId}/actions`,
        undefined,
        undefined,
        { workspaceId: workspaceId ?? undefined }
      );
      return res.json();
    },
    enabled: Boolean(workspaceId),
  });

  // Members
  const { data: membersData, isLoading: membersLoading } = useQuery<MembersResponse>({
    queryKey: ["/api/workspaces/members"],
    queryFn: async () => {
      const res = await apiRequest(
        "GET",
        `/api/workspaces/members`,
        undefined,
        undefined,
        { workspaceId: workspaceId ?? undefined }
      );
      return res.json();
    },
    enabled: Boolean(workspaceId),
  });

  // Knowledge Bases
  const { data: knowledgeBasesData, isLoading: knowledgeBasesLoading } = useQuery<KnowledgeBaseSummary[]>({
    queryKey: ["knowledge-bases", workspaceId],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/knowledge/bases", undefined, undefined, {
        workspaceId: workspaceId ?? undefined,
      });
      const data = await res.json();
      // Поддержка обоих форматов: массив или { bases: [...] }
      if (Array.isArray(data)) return data;
      if (data?.bases && Array.isArray(data.bases)) return data.bases;
      return [];
    },
    enabled: Boolean(workspaceId),
  });

  // Computed values
  const skillsCount = skills.length;
  const skillsNewThisWeek = useMemo(() => {
    const weekAgo = getWeekAgo();
    return skills.filter((skill) => new Date(skill.createdAt) > weekAgo).length;
  }, [skills]);

  const actionsCount = actionsData?.actions?.length ?? 0;
  const activeActionsCount = useMemo(() => {
    return actionsData?.actions?.filter((action) => action.status !== "archived").length ?? 0;
  }, [actionsData]);

  const todayChatsCount = useMemo(() => {
    return chats.filter((chat) => isToday(new Date(chat.createdAt))).length;
  }, [chats]);

  const membersCount = membersData?.members?.length ?? 0;

  const knowledgeBasesCount = knowledgeBasesData?.length ?? 0;
  const indexingBasesCount = useMemo(() => {
    if (!knowledgeBasesData) return 0;
    return knowledgeBasesData.filter((kb) => kb.indexStatus === "indexing").length;
  }, [knowledgeBasesData]);

  // Loading state
  const isLoading =
    isSessionLoading || skillsLoading || chatsLoading || actionsLoading || membersLoading || knowledgeBasesLoading;

  // Cards configuration
  const cards: ResourceCard[] = useMemo(
    () => [
      {
        id: "skills",
        title: "Навыки",
        value: skillsCount,
        subtitle: skillsNewThisWeek > 0 ? `+${skillsNewThisWeek} за неделю` : undefined,
        icon: Sparkles,
        href: "/skills",
        isLoading,
      },
      {
        id: "actions",
        title: "Действия",
        value: actionsCount,
        subtitle: `активных: ${activeActionsCount}`,
        icon: Zap,
        href: workspaceId ? `/workspaces/${workspaceId}/actions` : "/",
        isLoading,
      },
      {
        id: "chats",
        title: "Чаты",
        value: todayChatsCount,
        subtitle: "за сегодня",
        icon: MessageSquare,
        href: workspaceId ? `/workspaces/${workspaceId}/chat` : "/",
        isLoading,
      },
      {
        id: "knowledge",
        title: "Базы знаний",
        value: knowledgeBasesCount,
        subtitle: indexingBasesCount > 0 ? `индексируется: ${indexingBasesCount}` : undefined,
        icon: Brain,
        href: "/knowledge",
        isLoading,
      },
      {
        id: "members",
        title: "Участники",
        value: membersCount,
        subtitle: undefined,
        icon: Users,
        href: workspaceId ? `/workspaces/${workspaceId}/settings?tab=members` : "/",
        isLoading,
      },
    ],
    [
      skillsCount,
      skillsNewThisWeek,
      actionsCount,
      activeActionsCount,
      todayChatsCount,
      knowledgeBasesCount,
      indexingBasesCount,
      membersCount,
      workspaceId,
      isLoading,
    ]
  );

  return (
    <div className="grid gap-4 grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
      {cards.map((card) => (
        <ResourceCard key={card.id} {...card} />
      ))}
    </div>
  );
}
