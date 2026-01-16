import { useState, useEffect } from "react";
import { Copy, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { useKnowledgeBaseIndexingLogs } from "@/hooks/useKnowledgeBaseIndexingLogs";
import { formatIndexingLog } from "@/lib/indexing-log-formatter";

type IndexingLogDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  baseId: string | null;
  actionId: string | null;
};

export function IndexingLogDialog({
  open,
  onOpenChange,
  baseId,
  actionId,
}: IndexingLogDialogProps) {
  const { toast } = useToast();
  const { data: logsData, isLoading, isError, error } = useKnowledgeBaseIndexingLogs(
    baseId,
    actionId,
    { enabled: open && Boolean(baseId && actionId) },
  );

  const [formattedLog, setFormattedLog] = useState<string | null>(null);

  useEffect(() => {
    if (logsData) {
      setFormattedLog(formatIndexingLog(logsData));
    } else {
      setFormattedLog(null);
    }
  }, [logsData]);

  const handleCopy = async () => {
    if (!formattedLog) {
      return;
    }

    try {
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
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh]">
        <DialogHeader>
          <DialogTitle>Лог индексации</DialogTitle>
          <DialogDescription>
            Полный лог индексации базы знаний. Используйте кнопку "Скопировать" для сохранения в буфер обмена.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {isLoading && (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              <span className="ml-2 text-sm text-muted-foreground">Загрузка лога...</span>
            </div>
          )}

          {isError && (
            <div className="flex flex-col items-center justify-center gap-2 py-8 text-center text-sm text-destructive">
              <p>Не удалось загрузить лог индексации</p>
              {error && <p className="text-xs text-muted-foreground">{error.message}</p>}
            </div>
          )}

          {!isLoading && !isError && formattedLog && (
            <ScrollArea className="h-[60vh] w-full rounded-md border p-4">
              <pre className="whitespace-pre-wrap break-words text-sm font-mono">
                {formattedLog}
              </pre>
            </ScrollArea>
          )}

          {!isLoading && !isError && !formattedLog && (
            <div className="flex flex-col items-center justify-center gap-2 py-8 text-center text-sm text-muted-foreground">
              <p>Лог не найден</p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={handleCopy}
            disabled={!formattedLog || isLoading}
          >
            <Copy className="mr-2 h-4 w-4" />
            Скопировать
          </Button>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
            Закрыть
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
