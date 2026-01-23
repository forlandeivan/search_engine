import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Activity,
  CheckCircle,
  Loader2,
  AlertTriangle,
  Brain,
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";

// =============================================================================
// Types
// =============================================================================

type SystemStatusPanelProps = {
  workspaceId: string | null;
};

type LLMExecutionsResponse = {
  pagination?: {
    total?: number;
    page?: number;
    perPage?: number;
    totalPages?: number;
  };
};

// =============================================================================
// Helpers
// =============================================================================

const getStatusLabel = (status: string): string => {
  const labels: Record<string, string> = {
    indexing: "Индексация",
    vectorizing: "Векторизация",
    syncing: "Синхронизация",
    processing: "Обработка",
  };
  return labels[status] || status;
};

// =============================================================================
// Sub-components
// =============================================================================

function SystemStatusSkeleton() {
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

type IndexingTaskItemProps = {
  taskName: string;
  status: string;
  progress?: number;
};

function IndexingTaskItem({ taskName, status, progress }: IndexingTaskItemProps) {
  return (
    <div className="flex items-center justify-between p-2 rounded border">
      <div className="flex items-center gap-2">
        <Brain className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm">{taskName}</span>
      </div>
      <div className="flex items-center gap-2">
        {progress !== undefined && (
          <span className="text-xs text-muted-foreground">{progress}%</span>
        )}
        <Badge variant="secondary" className="text-xs">
          {getStatusLabel(status)}
        </Badge>
      </div>
    </div>
  );
}

// =============================================================================
// Main Component
// =============================================================================

export function SystemStatusPanel({ workspaceId }: SystemStatusPanelProps) {
  // Получение количества ошибок LLM за 24 часа
  const { data: llmErrorsData, isLoading: isLlmErrorsLoading } =
    useQuery<LLMExecutionsResponse>({
      queryKey: ["llm-errors-count", workspaceId],
      queryFn: async () => {
        const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        const res = await apiRequest(
          "GET",
          `/api/admin/llm-executions?status=error&since=${since}&limit=1`
        );
        return res.json();
      },
      enabled: Boolean(workspaceId),
      refetchInterval: 60000, // Обновлять каждую минуту
    });

  const llmErrorsCount = llmErrorsData?.pagination?.total ?? 0;

  // TODO: В будущем можно добавить получение статуса индексации
  // const { data: indexingTasks } = useQuery({
  //   queryKey: ["active-indexing", workspaceId],
  //   queryFn: async () => {
  //     const res = await apiRequest("GET", `/api/knowledge/bases?status=indexing`);
  //     return res.json();
  //   },
  //   enabled: Boolean(workspaceId),
  //   refetchInterval: 10000,
  // });

  const indexingTasks: IndexingTaskItemProps[] = [];
  const providerIssues: string[] = [];

  const allHealthy = indexingTasks.length === 0 && llmErrorsCount === 0 && providerIssues.length === 0;

  // Обработчик перехода к журналу LLM
  const handleGoToLlmLog = () => {
    // TODO: Реализовать переход на страницу журнала LLM
    console.log("Go to LLM log");
  };

  if (isLlmErrorsLoading) {
    return <SystemStatusSkeleton />;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Activity className="h-5 w-5" />
          Статус систем
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-4">
        {allHealthy ? (
          <div className="flex items-center gap-2 text-green-600 dark:text-green-500">
            <CheckCircle className="h-5 w-5" />
            <span className="text-sm">Все системы работают нормально</span>
          </div>
        ) : (
          <>
            {/* Активные индексации */}
            {indexingTasks.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-sm font-medium flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
                  Индексация: {indexingTasks.length} задач
                </h4>
                {indexingTasks.map((task, index) => (
                  <IndexingTaskItem key={index} {...task} />
                ))}
              </div>
            )}

            {/* Ошибки LLM */}
            {llmErrorsCount > 0 && (
              <div className="flex items-center justify-between p-3 rounded border border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800">
                <div className="flex items-center gap-2 text-amber-600 dark:text-amber-500">
                  <AlertTriangle className="h-4 w-4" />
                  <span className="text-sm font-medium">
                    {llmErrorsCount} {llmErrorsCount === 1 ? "ошибка" : "ошибок"} LLM за
                    сегодня
                  </span>
                </div>
                <Button variant="ghost" size="sm" onClick={handleGoToLlmLog}>
                  Журнал →
                </Button>
              </div>
            )}

            {/* Проблемы провайдеров */}
            {providerIssues.length > 0 && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Проблемы с провайдерами</AlertTitle>
                <AlertDescription>{providerIssues.join(", ")}</AlertDescription>
              </Alert>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
