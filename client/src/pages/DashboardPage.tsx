import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { 
  AlertCircle, 
  MessageSquarePlus, 
  Sparkles, 
  Brain, 
  Zap,
  MessageSquare,
  Users,
  Loader2,
} from "lucide-react";
import { DashboardHeader } from "@/components/dashboard";
import {
  CreateKnowledgeBaseDialog,
} from "@/components/knowledge-base/CreateKnowledgeBaseDialog";
import type { SessionResponse } from "@/types/session";
import type { KnowledgeBaseSourceType } from "@/lib/knowledge-base";

// =============================================================================
// Types
// =============================================================================

type QuickAction = {
  id: string;
  title: string;
  description: string;
  icon: React.ElementType;
  onClick: () => void;
};

// =============================================================================
// Placeholder Components (будут вынесены в отдельные файлы в следующих стори)
// =============================================================================

function ResourcesSummaryCardsPlaceholder({ isLoading }: { isLoading?: boolean }) {
  if (isLoading) {
    return (
      <div className="grid gap-4 grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <Card key={i}>
            <CardContent className="flex items-center gap-4 p-4">
              <Skeleton className="h-12 w-12 rounded-lg" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-6 w-12" />
                <Skeleton className="h-4 w-20" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  // Placeholder статичные данные - будут заменены на реальные в US-2.2
  const resources = [
    { id: "skills", title: "Навыки", value: "—", icon: Sparkles },
    { id: "actions", title: "Действия", value: "—", icon: Zap },
    { id: "chats", title: "Чаты", value: "—", icon: MessageSquare },
    { id: "knowledge", title: "Базы знаний", value: "—", icon: Brain },
    { id: "members", title: "Участники", value: "—", icon: Users },
  ];

  return (
    <div className="grid gap-4 grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
      {resources.map((resource) => (
        <Card key={resource.id} className="hover:shadow-md transition-shadow cursor-pointer">
          <CardContent className="flex items-center gap-4 p-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10">
              <resource.icon className="h-6 w-6 text-primary" />
            </div>
            <div className="flex-1">
              <p className="text-2xl font-bold">{resource.value}</p>
              <p className="text-sm text-muted-foreground">{resource.title}</p>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function CreditsWidgetPlaceholder({ isLoading }: { isLoading?: boolean }) {
  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-40" />
        </CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-10 w-32" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-48" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <div>
          <CardTitle className="text-lg">Баланс кредитов</CardTitle>
          <CardDescription>Месячное потребление</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-baseline gap-2">
          <span className="text-3xl font-bold text-muted-foreground">—</span>
          <span className="text-sm text-muted-foreground">кредитов</span>
        </div>
        <p className="text-sm text-muted-foreground">
          Данные о кредитах будут доступны в следующем обновлении
        </p>
      </CardContent>
    </Card>
  );
}

function RecentChatsSectionPlaceholder({ isLoading }: { isLoading?: boolean }) {
  if (isLoading) {
    return (
      <section className="space-y-3">
        <Skeleton className="h-5 w-32" />
        <Card>
          <CardContent className="p-0">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex items-center justify-between p-4 border-b last:border-b-0">
                <div className="flex items-center gap-3">
                  <Skeleton className="h-5 w-5" />
                  <div className="space-y-1">
                    <Skeleton className="h-5 w-48" />
                    <Skeleton className="h-4 w-32" />
                  </div>
                </div>
                <Skeleton className="h-8 w-24" />
              </div>
            ))}
          </CardContent>
        </Card>
      </section>
    );
  }

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        Недавние чаты
      </h2>
      <Card>
        <CardHeader className="flex flex-col items-center gap-3 text-center py-8">
          <MessageSquare className="h-12 w-12 text-muted-foreground" />
          <CardTitle className="text-lg">У вас пока нет чатов</CardTitle>
          <CardDescription>
            Начните диалог с AI-ассистентом через быстрые действия ниже
          </CardDescription>
        </CardHeader>
      </Card>
    </section>
  );
}

function QuickActionsGridComponent({ 
  workspaceId, 
  onCreateKnowledgeBase 
}: { 
  workspaceId: string | null;
  onCreateKnowledgeBase: () => void;
}) {
  const [, navigate] = useLocation();

  const actions: QuickAction[] = useMemo(() => [
    {
      id: "new-chat",
      title: "Новый чат",
      description: "Начать диалог",
      icon: MessageSquarePlus,
      onClick: () => workspaceId && navigate(`/workspaces/${workspaceId}/chat`),
    },
    {
      id: "create-skill",
      title: "Создать навык",
      description: "AI-агент",
      icon: Sparkles,
      onClick: () => workspaceId && navigate(`/workspaces/${workspaceId}/skills`),
    },
    {
      id: "create-kb",
      title: "База знаний",
      description: "Добавить документы",
      icon: Brain,
      onClick: onCreateKnowledgeBase,
    },
    {
      id: "create-action",
      title: "Действие",
      description: "Автоматизация",
      icon: Zap,
      onClick: () => workspaceId && navigate(`/workspaces/${workspaceId}/actions`),
    },
  ], [workspaceId, navigate, onCreateKnowledgeBase]);

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        Быстрые действия
      </h2>
      <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
        {actions.map((action) => (
          <Card
            key={action.id}
            className="cursor-pointer hover:shadow-md hover:-translate-y-0.5 transition-all"
            onClick={action.onClick}
            tabIndex={0}
            role="button"
            onKeyDown={(e) => e.key === "Enter" && action.onClick()}
          >
            <CardContent className="flex flex-col items-center gap-2 p-4 text-center">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                <action.icon className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="font-medium text-sm">{action.title}</p>
                <p className="text-xs text-muted-foreground">{action.description}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}

function SystemStatusPanelPlaceholder({ isLoading }: { isLoading?: boolean }) {
  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-32" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-5 w-64" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Loader2 className="h-5 w-5" />
          Статус систем
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          Мониторинг систем будет доступен в следующем обновлении
        </p>
      </CardContent>
    </Card>
  );
}

// =============================================================================
// Main Component
// =============================================================================

export default function DashboardPage() {
  const [, navigate] = useLocation();
  const [isKbDialogOpen, setIsKbDialogOpen] = useState(false);
  const [kbCreationMode, setKbCreationMode] = useState<KnowledgeBaseSourceType>("blank");

  // Получение данных сессии
  const { 
    data: session, 
    isLoading: isSessionLoading,
    isError: isSessionError,
    error: sessionError,
    refetch: refetchSession,
  } = useQuery<SessionResponse>({ 
    queryKey: ["/api/auth/session"],
  });

  // Извлечение данных из сессии
  const workspaceId = session?.workspace?.active?.id ?? null;
  const workspaceName = session?.workspace?.active?.name ?? null;
  const userRole = session?.workspace?.active?.role ?? null;

  // Определение роли пользователя
  const isAdminOrManager = userRole === "owner" || userRole === "manager";

  // Обработчики
  const handleOpenKbDialog = () => {
    setKbCreationMode("blank");
    setIsKbDialogOpen(true);
  };

  const handleKnowledgeBaseCreated = (base: { id: string }) => {
    navigate(`/knowledge/${base.id}`);
  };

  // Состояние ошибки
  if (isSessionError) {
    return (
      <div className="flex h-full flex-col gap-6 px-5 py-6">
        <DashboardHeader />
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Ошибка загрузки</AlertTitle>
          <AlertDescription className="flex items-center justify-between">
            <span>
              {sessionError instanceof Error 
                ? sessionError.message 
                : "Не удалось загрузить данные сессии"}
            </span>
            <Button variant="outline" size="sm" onClick={() => refetchSession()}>
              Повторить
            </Button>
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-6 px-5 py-6">
      {/* Header с заголовком */}
      <DashboardHeader 
        workspaceName={workspaceName ?? undefined} 
        isLoading={isSessionLoading} 
      />

      {/* Карточки сводки ресурсов */}
      <ResourcesSummaryCardsPlaceholder isLoading={isSessionLoading} />

      {/* Виджет кредитов - только для admin/manager */}
      {isAdminOrManager && (
        <CreditsWidgetPlaceholder isLoading={isSessionLoading} />
      )}

      {/* Секция недавних чатов */}
      <RecentChatsSectionPlaceholder isLoading={isSessionLoading} />

      {/* Grid быстрых действий */}
      <QuickActionsGridComponent 
        workspaceId={workspaceId}
        onCreateKnowledgeBase={handleOpenKbDialog}
      />

      {/* Панель статуса систем - только для admin/manager */}
      {isAdminOrManager && (
        <SystemStatusPanelPlaceholder isLoading={isSessionLoading} />
      )}

      {/* Диалог создания базы знаний */}
      <CreateKnowledgeBaseDialog
        open={isKbDialogOpen}
        onOpenChange={setIsKbDialogOpen}
        initialMode={kbCreationMode}
        workspaceId={workspaceId}
        onCreated={handleKnowledgeBaseCreated}
      />
    </div>
  );
}
