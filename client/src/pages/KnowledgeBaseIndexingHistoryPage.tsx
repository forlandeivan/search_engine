import { useState, useEffect } from "react";
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
import { useKnowledgeBaseIndexingHistory } from "@/hooks/useKnowledgeBaseIndexingHistory";
import { useKnowledgeBaseIndexingLogs } from "@/hooks/useKnowledgeBaseIndexingLogs";
import { formatIndexingLog } from "@/lib/indexing-log-formatter";
import { useToast } from "@/hooks/use-toast";

type KnowledgeBaseIndexingHistoryPageProps = {
  params?: {
    knowledgeBaseId?: string;
  };
};

export default function KnowledgeBaseIndexingHistoryPage({ params }: KnowledgeBaseIndexingHistoryPageProps = {}) {
  const [, routeParams] = useRoute("/knowledge/:baseId/indexing/history");
  const baseId = params?.knowledgeBaseId ?? routeParams?.baseId ?? null;
  const { toast } = useToast();
  const [copyingActionId, setCopyingActionId] = useState<string | null>(null);

  const { data, isLoading, isError, error } = useKnowledgeBaseIndexingHistory(baseId, 25);
  const { data: logsData, isLoading: isLogsLoading, error: logsError } = useKnowledgeBaseIndexingLogs(
    baseId,
    copyingActionId,
    { enabled: Boolean(copyingActionId) },
  );

  const handleCopyLog = async (actionId: string) => {
    setCopyingActionId(actionId);
  };

  // Обработка копирования после загрузки лога
  useEffect(() => {
    if (logsData && copyingActionId) {
      const copyLog = async () => {
        try {
          const formattedLog = formatIndexingLog(logsData);
          await navigator.clipboard.writeText(formattedLog);
          toast({
            title: "Лог скопирован",
            description: "Лог индексации скопирован в буфер обмена",
          });
        } catch (copyError) {
          console.error("Не удалось скопировать лог", copyError);
          toast({
            title: "Ошибка копирования",
            description: "Не удалось скопировать лог в буфер обмена",
            variant: "destructive",
          });
        } finally {
          setCopyingActionId(null);
        }
      };
      void copyLog();
    }
  }, [logsData, copyingActionId, toast]);

  // Обработка ошибки загрузки лога
  useEffect(() => {
    if (copyingActionId && logsError && !isLogsLoading) {
      toast({
        title: "Ошибка загрузки",
        description: "Не удалось загрузить лог индексации",
        variant: "destructive",
      });
      setCopyingActionId(null);
    }
  }, [copyingActionId, logsError, isLogsLoading, toast]);

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
            onCopyLog={handleCopyLog}
            copyingActionId={copyingActionId}
          />
        </CardContent>
      </Card>
    </div>
  );
}
