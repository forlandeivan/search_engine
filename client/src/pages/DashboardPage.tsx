import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { 
  AlertCircle, 
  Loader2,
} from "lucide-react";
import { 
  DashboardHeader, 
  ResourcesSummaryCards, 
  RecentChatsSection,
  QuickActionsGrid,
} from "@/components/dashboard";
import {
  CreateKnowledgeBaseDialog,
} from "@/components/knowledge-base/CreateKnowledgeBaseDialog";
import type { SessionResponse } from "@/types/session";
import type { KnowledgeBaseSourceType } from "@/lib/knowledge-base";

// =============================================================================
// Placeholder Components (будут вынесены в отдельные файлы в следующих стори)
// =============================================================================

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
      <ResourcesSummaryCards 
        workspaceId={workspaceId}
        isSessionLoading={isSessionLoading}
      />

      {/* Виджет кредитов - только для admin/manager */}
      {isAdminOrManager && (
        <CreditsWidgetPlaceholder isLoading={isSessionLoading} />
      )}

      {/* Секция недавних чатов */}
      <RecentChatsSection workspaceId={workspaceId} />

      {/* Grid быстрых действий */}
      <QuickActionsGrid 
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
