import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  useCrawlerLogs,
  type CrawlerLogLevel,
  type CrawlerLogConnectionState,
} from "@/hooks/useCrawlerLogs";

interface CrawlerLogPanelProps {
  siteId: string;
}

const levelVariants: Record<CrawlerLogLevel, string> = {
  info: "bg-muted text-muted-foreground",
  warning: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-100",
  error: "bg-destructive text-destructive-foreground",
  debug: "bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-200",
};

const connectionVariant: Record<CrawlerLogConnectionState, string> = {
  open: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-200",
  connecting: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-200",
  error: "bg-destructive text-destructive-foreground",
  closed: "bg-muted text-muted-foreground",
};

export function CrawlerLogPanel({ siteId }: CrawlerLogPanelProps) {
  const { logs, connectionState, statusLabel, clearLogs } = useCrawlerLogs(siteId);

  const formattedLogs = useMemo(() => {
    return logs.slice().reverse();
  }, [logs]);

  return (
    <Card className="h-full">
      <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <CardTitle className="text-lg">Лог краулера</CardTitle>
          <p className="text-sm text-muted-foreground">Обновляется в реальном времени</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge className={connectionVariant[connectionState] ?? connectionVariant.closed}>
            {statusLabel}
          </Badge>
          <Button variant="outline" size="sm" onClick={clearLogs} disabled={logs.length === 0}>
            Очистить
          </Button>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <Separator className="mb-4" />
        {logs.length === 0 ? (
          <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
            Нет записей лога для этого проекта
          </div>
        ) : (
          <ScrollArea className="h-80 pr-3">
            <div className="space-y-3">
              {formattedLogs.map((log) => {
                const timestamp = new Date(log.timestamp);
                const timeLabel = Number.isNaN(timestamp.valueOf())
                  ? log.timestamp
                  : timestamp.toLocaleTimeString("ru", {
                      hour: "2-digit",
                      minute: "2-digit",
                      second: "2-digit",
                    });
                const levelClass = levelVariants[log.level] ?? levelVariants.info;

                return (
                  <div
                    key={log.id}
                    className="rounded-lg border bg-card/30 p-3 text-xs shadow-sm transition hover:bg-card/60"
                  >
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <Badge className={levelClass}>{log.level.toUpperCase()}</Badge>
                      <span className="font-mono text-[11px] text-muted-foreground">{timeLabel}</span>
                    </div>
                    <p className="font-medium text-foreground">{log.message}</p>
                    {log.context && (
                      <pre className="mt-2 overflow-auto rounded bg-muted p-2 text-[11px] leading-tight text-muted-foreground">
                        {JSON.stringify(log.context, null, 2)}
                      </pre>
                    )}
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}

export default CrawlerLogPanel;
