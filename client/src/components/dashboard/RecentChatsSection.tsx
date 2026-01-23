import { useMemo } from "react";
import { useLocation } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { MessageSquare } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ru } from "date-fns/locale";
import { useChats } from "@/hooks/useChats";
import { useSkills } from "@/hooks/useSkills";

// =============================================================================
// Types
// =============================================================================

type RecentChatsSectionProps = {
  workspaceId: string | null;
  maxItems?: number;
};

type ChatWithSkill = {
  id: string;
  title: string | null;
  skillId: string | null;
  updatedAt: string;
  skillName?: string;
};

// =============================================================================
// Helpers
// =============================================================================

const formatRelativeTime = (date: string) => {
  try {
    return formatDistanceToNow(new Date(date), { addSuffix: true, locale: ru });
  } catch {
    return "недавно";
  }
};

// =============================================================================
// Sub-components
// =============================================================================

function ChatListSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="divide-y">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex items-center justify-between p-4">
          <div className="flex items-center gap-3 flex-1">
            <Skeleton className="h-5 w-5 shrink-0" />
            <div className="space-y-2 flex-1">
              <Skeleton className="h-5 w-48" />
              <Skeleton className="h-4 w-32" />
            </div>
          </div>
          <Skeleton className="h-8 w-24" />
        </div>
      ))}
    </div>
  );
}

function EmptyChatsState({ onCreateChat }: { onCreateChat: () => void }) {
  return (
    <CardHeader className="flex flex-col items-center gap-3 text-center py-8">
      <MessageSquare className="h-12 w-12 text-muted-foreground" />
      <CardTitle className="text-lg">У вас пока нет чатов</CardTitle>
      <CardDescription>
        Начните первый диалог с AI-ассистентом
      </CardDescription>
      <Button onClick={onCreateChat} className="mt-2">
        Начать чат
      </Button>
    </CardHeader>
  );
}

type ChatListItemProps = {
  chat: ChatWithSkill;
  workspaceId: string;
};

function ChatListItem({ chat, workspaceId }: ChatListItemProps) {
  const [, navigate] = useLocation();

  const handleNavigate = () => {
    navigate(`/workspaces/${workspaceId}/chat/${chat.id}`);
  };

  const handleRowClick = (e: React.MouseEvent) => {
    // Не переходить если кликнули на кнопку
    if ((e.target as HTMLElement).closest("button")) {
      return;
    }
    handleNavigate();
  };

  return (
    <div
      className="flex items-center justify-between p-4 hover:bg-muted/50 transition-colors cursor-pointer"
      onClick={handleRowClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === "Enter" && handleNavigate()}
    >
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <MessageSquare className="h-5 w-5 text-muted-foreground shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="font-medium truncate">{chat.title || "Новый чат"}</p>
          <p className="text-sm text-muted-foreground truncate">
            {chat.skillName || "Без навыка"} • {formatRelativeTime(chat.updatedAt)}
          </p>
        </div>
      </div>
      <Button
        size="sm"
        variant="outline"
        onClick={handleNavigate}
        className="shrink-0"
      >
        Продолжить
      </Button>
    </div>
  );
}

// =============================================================================
// Main Component
// =============================================================================

export function RecentChatsSection({
  workspaceId,
  maxItems = 5,
}: RecentChatsSectionProps) {
  const [, navigate] = useLocation();

  // Получение чатов
  const { chats, isLoading: chatsLoading } = useChats(
    workspaceId ?? undefined,
    undefined,
    { includeArchived: false }
  );

  // Получение навыков для отображения названий
  const { skills, isLoading: skillsLoading } = useSkills({
    workspaceId,
    enabled: Boolean(workspaceId),
  });

  // Создание мапы skillId -> skillName
  const skillsMap = useMemo(() => {
    const map = new Map<string, string>();
    skills.forEach((skill) => {
      map.set(skill.id, skill.name);
    });
    return map;
  }, [skills]);

  // Обогащение чатов названиями навыков и сортировка
  const recentChats = useMemo<ChatWithSkill[]>(() => {
    return [...chats]
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .slice(0, maxItems)
      .map((chat) => ({
        ...chat,
        skillName: chat.skillId ? skillsMap.get(chat.skillId) : undefined,
      }));
  }, [chats, maxItems, skillsMap]);

  // Обработчики
  const handleCreateChat = () => {
    if (workspaceId) {
      navigate(`/workspaces/${workspaceId}/chat`);
    }
  };

  const handleViewAllChats = () => {
    if (workspaceId) {
      navigate(`/workspaces/${workspaceId}/chat`);
    }
  };

  const isLoading = chatsLoading || skillsLoading;

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Недавние чаты
        </h2>
        {recentChats.length > 0 && (
          <Button variant="ghost" size="sm" onClick={handleViewAllChats}>
            Все чаты →
          </Button>
        )}
      </div>

      <Card>
        {isLoading ? (
          <ChatListSkeleton count={3} />
        ) : recentChats.length === 0 ? (
          <EmptyChatsState onCreateChat={handleCreateChat} />
        ) : (
          <CardContent className="p-0">
            <div className="divide-y">
              {recentChats.map((chat) => (
                <ChatListItem
                  key={chat.id}
                  chat={chat}
                  workspaceId={workspaceId!}
                />
              ))}
            </div>
          </CardContent>
        )}
      </Card>
    </section>
  );
}
