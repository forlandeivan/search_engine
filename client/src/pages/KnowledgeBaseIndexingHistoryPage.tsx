import { useState } from "react";
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
import { useQuery } from "@tanstack/react-query";
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

  const { data: session } = useQuery<SessionResponse>({ queryKey: ["/api/auth/session"] });
  const workspaceId = session?.workspace?.active?.id ?? session?.activeWorkspaceId ?? null;

  const { data, isLoading, isError, error } = useKnowledgeBaseIndexingHistory(baseId, 25);
  const { data: indexingSummary } = useKnowledgeBaseIndexingSummary(workspaceId, baseId);
  const { data: activeActions = [] } = useActiveIndexingActions(workspaceId);
  const activeActionForBase = baseId
    ? activeActions.find((action) => action.baseId === baseId)
    : undefined;

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
        <p className="text-sm text-muted-foreground">
          Просмотр истории последних индексаций базы знаний с детальной информацией о каждом запуске.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Журнал индексаций</CardTitle>
        </CardHeader>
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
