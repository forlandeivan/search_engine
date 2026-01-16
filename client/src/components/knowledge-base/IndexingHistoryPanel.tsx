import { format } from "date-fns";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { IndexingHistoryItem } from "@shared/schema";

const INDEXING_STATUS_COLORS: Record<IndexingHistoryItem["status"], string> = {
  processing: "bg-blue-600 hover:bg-blue-600",
  done: "bg-emerald-600 hover:bg-emerald-600",
  error: "bg-destructive hover:bg-destructive",
};

const INDEXING_STATUS_LABELS: Record<IndexingHistoryItem["status"], string> = {
  processing: "Выполняется",
  done: "Завершено",
  error: "Ошибка",
};

function formatDateTime(value: string | null | undefined): string {
  if (!value) {
    return "—";
  }

  try {
    return format(new Date(value), "dd.MM.yyyy HH:mm");
  } catch {
    return value;
  }
}

function formatUser(userName: string | null, userEmail: string | null): string {
  if (userName) {
    return userName;
  }
  if (userEmail) {
    return userEmail;
  }
  return "Система";
}

function formatDocumentsCount(processed: number, total: number): string {
  return `${processed} / ${total}`;
}

type IndexingHistoryPanelProps = {
  items: IndexingHistoryItem[];
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  onViewLog?: (actionId: string) => void;
};

export function IndexingHistoryPanel({
  items,
  isLoading,
  isError,
  error,
  onViewLog,
}: IndexingHistoryPanelProps) {
  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 5 }).map((_, index) => (
          <Skeleton key={index} className="h-12 w-full" />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-8 text-center text-sm text-destructive">
        <p>Не удалось загрузить историю индексаций</p>
        {error && <p className="text-xs text-muted-foreground">{error.message}</p>}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-8 text-center text-sm text-muted-foreground">
        <p>История индексаций пуста</p>
        <p className="text-xs">Запустите индексацию, чтобы увидеть историю</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[180px]">Время запуска</TableHead>
            <TableHead>Пользователь</TableHead>
            <TableHead className="w-[120px]">Статус</TableHead>
            <TableHead className="w-[140px] text-right">Документы</TableHead>
            <TableHead>Результат</TableHead>
            <TableHead className="w-[140px] text-right">Действия</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item) => (
            <TableRow key={item.actionId}>
              <TableCell className="font-medium">
                <div className="flex flex-col">
                  <span>{formatDateTime(item.startedAt)}</span>
                  <span className="text-xs text-muted-foreground font-mono">{item.actionId.slice(0, 8)}…</span>
                </div>
              </TableCell>
              <TableCell>
                <div className="flex flex-col">
                  <span>{formatUser(item.userName, item.userEmail)}</span>
                  {item.userId && (
                    <span className="text-xs text-muted-foreground font-mono">{item.userId.slice(0, 8)}…</span>
                  )}
                </div>
              </TableCell>
              <TableCell>
                <Badge
                  className={cn(
                    "justify-center text-xs",
                    INDEXING_STATUS_COLORS[item.status] ?? "bg-muted text-muted-foreground",
                  )}
                >
                  {INDEXING_STATUS_LABELS[item.status] ?? item.status}
                </Badge>
              </TableCell>
              <TableCell className="text-right">
                <div className="flex flex-col items-end">
                  <span className="font-medium">{formatDocumentsCount(item.processedDocuments, item.totalDocuments)}</span>
                  {item.failedDocuments > 0 && (
                    <span className="text-xs text-destructive">Ошибок: {item.failedDocuments}</span>
                  )}
                </div>
              </TableCell>
              <TableCell>
                <div className="flex flex-col">
                  {item.displayText && (
                    <span className="text-sm">{item.displayText}</span>
                  )}
                  {item.totalChunks > 0 && (
                    <span className="text-xs text-muted-foreground">Чанков: {item.totalChunks.toLocaleString("ru-RU")}</span>
                  )}
                </div>
              </TableCell>
              <TableCell className="text-right">
                {onViewLog && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => onViewLog(item.actionId)}
                  >
                    Лог
                  </Button>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
