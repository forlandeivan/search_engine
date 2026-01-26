import { useState, useEffect, useRef } from "react";
import { useRoute } from "wouter";
import { Link } from "wouter";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { IndexingHistoryPanel } from "@/components/knowledge-base/IndexingHistoryPanel";
import { IndexingLogDialog } from "@/components/knowledge-base/IndexingLogDialog";
import { useKnowledgeBaseIndexingHistory } from "@/hooks/useKnowledgeBaseIndexingHistory";
import { useKnowledgeBaseIndexingSummary } from "@/hooks/useKnowledgeBaseIndexingSummary";
import { useActiveIndexingActions } from "@/hooks/useActiveIndexingActions";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { SessionResponse } from "@/types/session";

type KnowledgeBaseIndexingHistoryPageProps = {
  params?: {
    knowledgeBaseId?: string;
  };
};

export default function KnowledgeBaseIndexingHistoryPage({ params }: KnowledgeBaseIndexingHistoryPageProps = {}) {
  const [, routeParams] = useRoute("/knowledge/:baseId/indexing/history");
  const baseId = params?.knowledgeBaseId ?? routeParams?.baseId ?? null;
  const [selectedActionId, setSelectedActionId] = useState<string | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const queryClient = useQueryClient();
  const prevActiveActionIdRef = useRef<string | null>(null);

  const { data: session } = useQuery<SessionResponse>({ queryKey: ["/api/auth/session"] });
  const workspaceId = session?.workspace?.active?.id ?? session?.activeWorkspaceId ?? null;

  const { data, isLoading, isError, error, refetch } = useKnowledgeBaseIndexingHistory(baseId, 25);
  const { data: indexingSummary } = useKnowledgeBaseIndexingSummary(workspaceId, baseId);
  const { data: activeActions = [] } = useActiveIndexingActions(workspaceId);
  const activeActionForBase = baseId
    ? activeActions.find((action) => action.baseId === baseId)
    : undefined;

  // Автоматическое обновление истории при завершении индексации
  useEffect(() => {
    if (!baseId) {
      prevActiveActionIdRef.current = null;
      return;
    }

    const currentActionId = activeActionForBase?.actionId ?? null;
    const prevActionId = prevActiveActionIdRef.current;

    const finishedStatuses = new Set(["done", "canceled", "error"]);
    const isFinishedNow =
      Boolean(activeActionForBase?.status) &&
      finishedStatuses.has(activeActionForBase!.status);

    // Сценарий A: индексация закончилась и действие исчезло из списка активных
    const becameInactive = Boolean(prevActionId) && !currentActionId;
    // Сценарий B: бэкенд вернул финальный статус, но действие ещё видно в active
    const becameFinished = Boolean(currentActionId) && isFinishedNow;

    if (becameInactive || becameFinished) {
      // Инвалидируем и обновляем историю индексаций
      void queryClient.invalidateQueries({
        queryKey: ["/api/knowledge/bases", baseId, "indexing/actions/history"],
      });
      void refetch();
    }

    prevActiveActionIdRef.current = currentActionId;
  }, [baseId, activeActionForBase?.actionId, activeActionForBase?.status, queryClient, refetch]);

  const handleViewLog = (actionId: string) => {
    setSelectedActionId(actionId);
    setIsDialogOpen(true);
  };

  const handleDialogClose = (open: boolean) => {
    setIsDialogOpen(open);
    if (!open) {
      setSelectedActionId(null);
    }
  };

  return (
    <div className="p-6 space-y-6">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link href={baseId ? `/knowledge/${baseId}` : "/knowledge"}>Обзор базы</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>История индексаций</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">История индексаций</h1>
      </div>

      <Card>
        <CardContent>
          <IndexingHistoryPanel
            items={data?.items ?? []}
            isLoading={isLoading}
            isError={isError}
            error={error}
            onViewLog={handleViewLog}
            activeAction={activeActionForBase}
            baseId={baseId ?? undefined}
            totalDocumentsInBase={indexingSummary?.totalDocuments ?? null}
          />
        </CardContent>
      </Card>

      <IndexingLogDialog
        open={isDialogOpen}
        onOpenChange={handleDialogClose}
        baseId={baseId}
        actionId={selectedActionId}
      />
    </div>
  );
}
