import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { AlertCircle } from "lucide-react";
import { 
  DashboardHeader, 
  ResourcesSummaryCards, 
  RecentChatsSection,
  QuickActionsGrid,
  CreditsWidget,
  SystemStatusPanel,
} from "@/components/dashboard";
import {
  CreateKnowledgeBaseDialog,
} from "@/components/knowledge-base/CreateKnowledgeBaseDialog";
import type { SessionResponse } from "@/types/session";
import type { KnowledgeBaseSourceType } from "@/lib/knowledge-base";

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
        <CreditsWidget workspaceId={workspaceId} />
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
        <SystemStatusPanel workspaceId={workspaceId} />
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
