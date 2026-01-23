import { useState } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ChevronDown, ChevronUp } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { format } from "date-fns";
import { ru } from "date-fns/locale";

// =============================================================================
// Types
// =============================================================================

type CreditsWidgetProps = {
  workspaceId: string | null;
};

type CreditsSummary = {
  workspaceId: string;
  balance: {
    currentBalance: number;
    nextTopUpAt: string | null;
  };
  planIncludedCredits: {
    amount: number;
    period: string;
  };
  policy: string;
};

type UsageSummary = {
  totalTokens?: number;
  totalMinutes?: number;
  totalRequests?: number;
  inputTokens?: number;
  outputTokens?: number;
  totalDuration?: number;
};

type StorageSummary = {
  totalBytes: number;
  filesCount: number;
};

type UsageBreakdown = {
  llmTokens: number;
  asrMinutes: number;
  embeddingsTokens: number;
  storageBytes: number;
};

// =============================================================================
// Helpers
// =============================================================================

const formatCredits = (credits: number): string => {
  return credits.toLocaleString("ru-RU");
};

const formatNumber = (n: number): string => {
  return n.toLocaleString("ru-RU");
};

const formatMinutes = (m: number): string => {
  return `${m.toFixed(1)} мин`;
};

const formatBytes = (b: number): string => {
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 * 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB`;
  return `${(b / 1024 / 1024 / 1024).toFixed(2)} GB`;
};

const getProgressColor = (percent: number): string => {
  if (percent >= 90) return "[&>div]:bg-red-500";
  if (percent >= 70) return "[&>div]:bg-amber-500";
  return "[&>div]:bg-green-500";
};

// =============================================================================
// Sub-components
// =============================================================================

function CreditsWidgetSkeleton() {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-4 w-32" />
      </CardHeader>
      <CardContent className="space-y-4">
        <Skeleton className="h-10 w-32" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-48" />
      </CardContent>
    </Card>
  );
}

type UsageBreakdownGridProps = {
  breakdown: UsageBreakdown;
  isLoading?: boolean;
};

function UsageBreakdownGrid({ breakdown, isLoading }: UsageBreakdownGridProps) {
  if (isLoading) {
    return (
      <div className="grid grid-cols-2 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-lg border p-3">
            <Skeleton className="h-4 w-20 mb-2" />
            <Skeleton className="h-6 w-24" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-3">
      <div className="rounded-lg border p-3">
        <p className="text-xs text-muted-foreground">LLM токены</p>
        <p className="text-lg font-semibold">{formatNumber(breakdown.llmTokens)}</p>
      </div>
      <div className="rounded-lg border p-3">
        <p className="text-xs text-muted-foreground">Транскрипции</p>
        <p className="text-lg font-semibold">{formatMinutes(breakdown.asrMinutes)}</p>
      </div>
      <div className="rounded-lg border p-3">
        <p className="text-xs text-muted-foreground">Эмбеддинги</p>
        <p className="text-lg font-semibold">{formatNumber(breakdown.embeddingsTokens)}</p>
      </div>
      <div className="rounded-lg border p-3">
        <p className="text-xs text-muted-foreground">Хранилище</p>
        <p className="text-lg font-semibold">{formatBytes(breakdown.storageBytes)}</p>
      </div>
    </div>
  );
}

// =============================================================================
// Main Component
// =============================================================================

export function CreditsWidget({ workspaceId }: CreditsWidgetProps) {
  const [, navigate] = useLocation();
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);

  // Получение данных о кредитах
  const { data: creditsSummary, isLoading: isCreditsLoading } = useQuery<CreditsSummary>({
    queryKey: ["workspace-credits-summary", workspaceId],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/workspaces/${workspaceId}/credits`);
      return res.json();
    },
    enabled: Boolean(workspaceId),
  });

  // Получение данных об использовании LLM
  const { data: llmUsage, isLoading: isLlmLoading } = useQuery<UsageSummary>({
    queryKey: ["workspace-llm-usage", workspaceId],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/workspaces/${workspaceId}/usage/llm`);
      return res.json();
    },
    enabled: Boolean(workspaceId),
  });

  // Получение данных об использовании ASR
  const { data: asrUsage, isLoading: isAsrLoading } = useQuery<UsageSummary>({
    queryKey: ["workspace-asr-usage", workspaceId],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/workspaces/${workspaceId}/usage/asr`);
      return res.json();
    },
    enabled: Boolean(workspaceId),
  });

  // Получение данных об использовании embeddings
  const { data: embeddingsUsage, isLoading: isEmbeddingsLoading } = useQuery<UsageSummary>({
    queryKey: ["workspace-embeddings-usage", workspaceId],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/workspaces/${workspaceId}/usage/embeddings`);
      return res.json();
    },
    enabled: Boolean(workspaceId),
  });

  // Получение данных о хранилище
  const { data: storageUsage, isLoading: isStorageLoading } = useQuery<StorageSummary>({
    queryKey: ["workspace-storage-usage", workspaceId],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/workspaces/${workspaceId}/usage/storage`);
      return res.json();
    },
    enabled: Boolean(workspaceId),
  });

  // Вычисление процента использования
  const usedPercent = creditsSummary
    ? Math.round(
        ((creditsSummary.planIncludedCredits.amount - creditsSummary.balance.currentBalance) /
          creditsSummary.planIncludedCredits.amount) *
          100
      )
    : 0;

  // Формирование breakdown
  const usageBreakdown: UsageBreakdown = {
    llmTokens: llmUsage?.totalTokens ?? 0,
    asrMinutes: asrUsage?.totalMinutes ?? asrUsage?.totalDuration ?? 0,
    embeddingsTokens: embeddingsUsage?.totalTokens ?? 0,
    storageBytes: storageUsage?.totalBytes ?? 0,
  };

  const isUsageLoading = isLlmLoading || isAsrLoading || isEmbeddingsLoading || isStorageLoading;

  // Обработчики
  const handleGoToHistory = () => {
    // TODO: Реализовать переход на страницу истории кредитов
    console.log("Go to credits history");
  };

  const handleGoToBilling = () => {
    if (workspaceId) {
      navigate(`/workspaces/${workspaceId}/settings/billing`);
    }
  };

  if (isCreditsLoading) {
    return <CreditsWidgetSkeleton />;
  }

  if (!creditsSummary) {
    return null;
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
        <div>
          <CardTitle className="text-lg">Баланс кредитов</CardTitle>
          <CardDescription>Месячное потребление</CardDescription>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={handleGoToHistory}>
            История
          </Button>
          <Button variant="outline" size="sm" onClick={handleGoToBilling}>
            Пополнить
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Основной баланс */}
        <div className="flex items-baseline gap-2">
          <span className="text-3xl font-bold">
            {formatCredits(creditsSummary.balance.currentBalance)}
          </span>
          <span className="text-sm text-muted-foreground">кредитов</span>
        </div>

        {/* Progress bar */}
        <div className="space-y-1">
          <div className="flex justify-between text-sm">
            <span>Использовано за месяц</span>
            <span>{usedPercent}%</span>
          </div>
          <Progress value={usedPercent} className={getProgressColor(usedPercent)} />
        </div>

        {/* Дата пополнения */}
        {creditsSummary.balance.nextTopUpAt && (
          <p className="text-sm text-muted-foreground">
            Следующее пополнение:{" "}
            {format(new Date(creditsSummary.balance.nextTopUpAt), "d MMMM yyyy", {
              locale: ru,
            })}
          </p>
        )}

        {/* Collapsible детали */}
        <Collapsible open={isDetailsOpen} onOpenChange={setIsDetailsOpen}>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="w-full justify-between">
              Детали потребления
              {isDetailsOpen ? (
                <ChevronUp className="h-4 w-4 ml-2" />
              ) : (
                <ChevronDown className="h-4 w-4 ml-2" />
              )}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-2">
            <UsageBreakdownGrid breakdown={usageBreakdown} isLoading={isUsageLoading} />
          </CollapsibleContent>
        </Collapsible>
      </CardContent>
    </Card>
  );
}
