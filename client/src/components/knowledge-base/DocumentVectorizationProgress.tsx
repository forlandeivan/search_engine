import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Loader2, CheckCircle2, AlertCircle, X } from "lucide-react";

export type DocumentVectorizationProgressStatus = "pending" | "running" | "completed" | "failed";

interface DocumentVectorizationProgressProps {
  title: string;
  totalChunks: number;
  processedChunks: number;
  status: DocumentVectorizationProgressStatus;
  errorMessage?: string | null;
  onDismiss?: () => void;
  dismissible?: boolean;
}

const statusConfig: Record<
  DocumentVectorizationProgressStatus,
  { label: string; icon: typeof Loader2; tone: "default" | "success" | "destructive" }
> = {
  pending: { label: "Подготовка", icon: Loader2, tone: "default" },
  running: { label: "Векторизация", icon: Loader2, tone: "default" },
  completed: { label: "Готово", icon: CheckCircle2, tone: "success" },
  failed: { label: "Ошибка", icon: AlertCircle, tone: "destructive" },
};

export default function DocumentVectorizationProgress({
  title,
  totalChunks,
  processedChunks,
  status,
  errorMessage,
  onDismiss,
  dismissible = true,
}: DocumentVectorizationProgressProps) {
  const { percent, label, Icon, tone } = useMemo(() => {
    const config = statusConfig[status];
    const total = Math.max(1, Math.max(totalChunks, processedChunks));
    const value = Math.max(0, Math.min(100, Math.round((processedChunks / total) * 100)));
    return { percent: value, label: config.label, Icon: config.icon, tone: config.tone };
  }, [processedChunks, status, totalChunks]);

  const progressLabel = `${Math.min(processedChunks, Math.max(totalChunks, processedChunks)).toLocaleString(
    "ru-RU",
  )} из ${Math.max(totalChunks, processedChunks).toLocaleString("ru-RU")} чанков`;

  const showDismissButton = dismissible && typeof onDismiss === "function";

  return (
    <div className="fixed bottom-6 right-6 z-50 w-full max-w-sm">
      <Card className="shadow-lg">
        <CardHeader className="flex flex-row items-start justify-between space-y-0">
          <div className="space-y-1">
            <CardTitle className="text-base font-semibold">{title}</CardTitle>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Icon
                className={`h-4 w-4 ${
                  status === "running" || status === "pending" ? "animate-spin" : ""
                } ${tone === "success" ? "text-emerald-500" : tone === "destructive" ? "text-destructive" : ""}`}
              />
              <span>{label}</span>
            </div>
          </div>
          {showDismissButton && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground"
              onClick={onDismiss}
              aria-label="Скрыть прогресс"
            >
              <X className="h-4 w-4" />
            </Button>
          )}
        </CardHeader>
        <CardContent className="space-y-3">
          <Progress value={percent} className="h-2" />
          <div className="text-sm text-muted-foreground">{progressLabel}</div>
          {errorMessage && status === "failed" && (
            <p className="text-sm text-destructive">Ошибка: {errorMessage}</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
