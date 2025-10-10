import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  createKnowledgeDocumentChunks,
  replaceChunkInHtml,
  type DocumentChunk,
} from "@/lib/knowledge-document";
import { cn } from "@/lib/utils";
import { Clipboard, ClipboardCheck, PencilLine } from "lucide-react";

interface DocumentChunksTabProps {
  contentHtml: string;
  chunkSize: number;
  chunkOverlap: number;
  onChunkUpdated: (updatedHtml: string) => void;
  onSwitchToDocumentTab?: () => void;
}

const COPY_TIMEOUT = 1500;

export function DocumentChunksTab({
  contentHtml,
  chunkSize,
  chunkOverlap,
  onChunkUpdated,
  onSwitchToDocumentTab,
}: DocumentChunksTabProps) {
  const { chunks } = useMemo(
    () => createKnowledgeDocumentChunks(contentHtml, chunkSize, chunkOverlap),
    [contentHtml, chunkSize, chunkOverlap],
  );

  const [editingChunk, setEditingChunk] = useState<DocumentChunk | null>(null);
  const [editedText, setEditedText] = useState("");
  const [copiedChunkId, setCopiedChunkId] = useState<number | null>(null);
  const { toast } = useToast();

  const handleEditChunk = (chunk: DocumentChunk) => {
    setEditingChunk(chunk);
    setEditedText(chunk.content);
  };

  const handleCloseDialog = () => {
    setEditingChunk(null);
    setEditedText("");
  };

  const handleSaveChunk = () => {
    if (!editingChunk) {
      return;
    }

    const updatedHtml = replaceChunkInHtml(contentHtml, editingChunk, editedText);
    if (updatedHtml === contentHtml) {
      toast({
        title: "Изменений не обнаружено",
        description: "Чанк остался без изменений.",
      });
      handleCloseDialog();
      return;
    }

    onChunkUpdated(updatedHtml);
    toast({
      title: "Чанк обновлён",
      description: "Документ переведён в режим редактирования.",
    });
    handleCloseDialog();
    onSwitchToDocumentTab?.();
  };

  const handleCopyChunk = async (chunk: DocumentChunk) => {
    try {
      await navigator.clipboard.writeText(chunk.content);
      setCopiedChunkId(chunk.index);
      setTimeout(() => setCopiedChunkId(null), COPY_TIMEOUT);
      toast({
        title: "Чанк скопирован",
        description: "Текст чанка находится в буфере обмена.",
      });
    } catch (error) {
      console.error("Не удалось скопировать чанк", error);
      toast({
        title: "Ошибка копирования",
        description: "Не получилось скопировать текст чанка.",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        <Badge variant="outline">Чанков: {chunks.length}</Badge>
        <span>Размер чанка: {chunkSize.toLocaleString("ru-RU")} символов</span>
        <span>Перехлёст: {chunkOverlap.toLocaleString("ru-RU")}</span>
      </div>

      {chunks.length === 0 ? (
        <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          Документ пока пуст — нечего разбивать на чанки.
        </div>
      ) : (
        <ScrollArea className="flex-1 pr-3">
          <div className="space-y-4">
            {chunks.map((chunk) => {
              const isCopied = copiedChunkId === chunk.index;

              return (
                <div
                  key={chunk.index}
                  className="rounded-lg border bg-background p-4 shadow-sm transition hover:border-primary/60"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
                      <span className="font-semibold text-foreground">Чанк #{chunk.index + 1}</span>
                      <span>Символов: {chunk.charCount.toLocaleString("ru-RU")}</span>
                      <span>Слов: {chunk.wordCount.toLocaleString("ru-RU")}</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => handleCopyChunk(chunk)}
                        className={cn("h-8", isCopied && "text-emerald-600")}
                      >
                        {isCopied ? (
                          <ClipboardCheck className="mr-2 h-4 w-4" />
                        ) : (
                          <Clipboard className="mr-2 h-4 w-4" />
                        )}
                        {isCopied ? "Скопировано" : "Скопировать"}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => handleEditChunk(chunk)}
                      >
                        <PencilLine className="mr-2 h-4 w-4" />
                        Редактировать
                      </Button>
                    </div>
                  </div>
                  <pre className="mt-3 whitespace-pre-wrap break-words rounded-md bg-muted/60 p-3 font-mono text-xs leading-relaxed text-muted-foreground">
                    {chunk.content}
                  </pre>
                  <p className="mt-2 text-xs text-muted-foreground/80">
                    {chunk.excerpt}
                  </p>
                </div>
              );
            })}
          </div>
        </ScrollArea>
      )}

      <Dialog open={Boolean(editingChunk)} onOpenChange={(open) => !open && handleCloseDialog()}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {editingChunk ? `Редактирование чанка #${editingChunk.index + 1}` : "Редактирование чанка"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2 text-sm text-muted-foreground">
            <p>
              Изменённый текст заменит содержимое чанка в документе. После сохранения документ перейдёт в режим редактирования,
              и изменения нужно будет сохранить.
            </p>
            <Textarea
              value={editedText}
              onChange={(event) => setEditedText(event.target.value)}
              rows={10}
              className="font-mono text-sm"
              placeholder="Введите обновлённый текст чанка"
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={handleCloseDialog}>
              Отмена
            </Button>
            <Button type="button" onClick={handleSaveChunk}>
              Сохранить чанк
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default DocumentChunksTab;
