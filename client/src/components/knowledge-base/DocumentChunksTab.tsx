import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  buildDocumentChunkId,
  createKnowledgeDocumentChunks,
  replaceChunkInHtml,
  type DocumentChunk,
} from "@/lib/knowledge-document";
import { cn } from "@/lib/utils";
import {
  Clipboard,
  ClipboardCheck,
  PencilLine,
  Save,
  Sparkles,
  Trash2,
  Undo2,
} from "lucide-react";

interface DocumentChunksTabProps {
  documentId: string;
  contentHtml: string;
  storedChunks: KnowledgeDocumentChunks | null;
  onChunksSaved: (chunks: KnowledgeDocumentChunks) => void;
  onChunksCleared: () => void;
  onChunkUpdated: (updatedHtml: string) => void;
  onSwitchToDocumentTab?: () => void;
}

const COPY_TIMEOUT = 1500;
const DEFAULT_CHUNK_SIZE = 800;
const DEFAULT_CHUNK_OVERLAP = 200;
const MIN_CHUNK_SIZE = 1;
const MAX_CHUNK_SIZE = 8000;
const MAX_CHUNK_OVERLAP = 4000;

type KnowledgeDocumentChunks = {
  chunkSize: number;
  chunkOverlap: number;
  generatedAt: string;
  items: DocumentChunk[];
};

export function DocumentChunksTab({
  documentId,
  contentHtml,
  storedChunks,
  onChunksSaved,
  onChunksCleared,
  onChunkUpdated,
  onSwitchToDocumentTab,
}: DocumentChunksTabProps) {
  const { toast } = useToast();
  const [editingChunk, setEditingChunk] = useState<DocumentChunk | null>(null);
  const [editedText, setEditedText] = useState("");
  const [copiedChunkId, setCopiedChunkId] = useState<string | null>(null);
  const [chunkSizeInput, setChunkSizeInput] = useState<string>(
    String(storedChunks?.chunkSize ?? DEFAULT_CHUNK_SIZE),
  );
  const [chunkOverlapInput, setChunkOverlapInput] = useState<string>(
    String(storedChunks?.chunkOverlap ?? DEFAULT_CHUNK_OVERLAP),
  );
  const [previewChunks, setPreviewChunks] = useState<DocumentChunk[] | null>(null);
  const [previewSettings, setPreviewSettings] = useState<{
    chunkSize: number;
    chunkOverlap: number;
  } | null>(null);

  useEffect(() => {
    setChunkSizeInput(String(storedChunks?.chunkSize ?? DEFAULT_CHUNK_SIZE));
    setChunkOverlapInput(String(storedChunks?.chunkOverlap ?? DEFAULT_CHUNK_OVERLAP));
    setPreviewChunks(null);
    setPreviewSettings(null);
  }, [documentId, storedChunks?.chunkSize, storedChunks?.chunkOverlap, storedChunks?.generatedAt]);

  useEffect(() => {
    setCopiedChunkId(null);
  }, [documentId, storedChunks?.generatedAt, previewChunks]);

  const chunkSizeNumber = Number.parseInt(chunkSizeInput, 10);
  const chunkOverlapNumber = Number.parseInt(chunkOverlapInput, 10);

  const chunkSizeValid =
    Number.isFinite(chunkSizeNumber) &&
    chunkSizeNumber >= MIN_CHUNK_SIZE &&
    chunkSizeNumber <= MAX_CHUNK_SIZE;

  const chunkOverlapValid =
    Number.isFinite(chunkOverlapNumber) &&
    chunkOverlapNumber >= 0 &&
    chunkOverlapNumber <= MAX_CHUNK_OVERLAP &&
    (!chunkSizeValid || chunkOverlapNumber < chunkSizeNumber);

  const chunkSettingsValid = chunkSizeValid && chunkOverlapValid;

  const isPreviewActive = previewChunks !== null && previewSettings !== null;
  const hasStoredChunks = Boolean(storedChunks && storedChunks.items.length > 0);

  const displayedChunks = useMemo(() => {
    if (previewChunks) {
      return previewChunks;
    }

    return storedChunks?.items ?? [];
  }, [previewChunks, storedChunks?.items]);

  const summaryChunkSize = previewSettings?.chunkSize ?? storedChunks?.chunkSize ?? null;
  const summaryChunkOverlap = previewSettings?.chunkOverlap ?? storedChunks?.chunkOverlap ?? null;

  const handleGeneratePreview = () => {
    if (!chunkSettingsValid) {
      toast({
        title: "Некорректные параметры",
        description: "Проверьте размер и перехлёст чанка и попробуйте снова.",
        variant: "destructive",
      });
      return;
    }

    const safeSize = Math.max(
      MIN_CHUNK_SIZE,
      Math.min(MAX_CHUNK_SIZE, Math.round(chunkSizeNumber)),
    );
    const safeOverlap = Math.max(
      0,
      Math.min(MAX_CHUNK_OVERLAP, Math.min(Math.round(chunkOverlapNumber), safeSize - 1)),
    );

    const { chunks } = createKnowledgeDocumentChunks(contentHtml, safeSize, safeOverlap, {
      idPrefix: documentId,
    });

    if (chunks.length === 0) {
      toast({
        title: "Не удалось сформировать чанки",
        description: "Документ пока пуст или содержит только пробелы.",
        variant: "destructive",
      });
      setPreviewChunks(null);
      setPreviewSettings(null);
      return;
    }

    setPreviewChunks(chunks);
    setPreviewSettings({ chunkSize: safeSize, chunkOverlap: safeOverlap });
    toast({
      title: "Предпросмотр готов",
      description: `Получено ${chunks.length.toLocaleString("ru-RU")} чанков. Сохраните результат, чтобы зафиксировать его в базе.`,
    });
  };

  const handleSavePreview = () => {
    if (!previewChunks || !previewSettings) {
      return;
    }

    const generatedAt = new Date().toISOString();
    onChunksSaved({
      chunkSize: previewSettings.chunkSize,
      chunkOverlap: previewSettings.chunkOverlap,
      generatedAt,
      items: previewChunks.map((chunk, index) => ({
        ...chunk,
        id: chunk.id || buildDocumentChunkId(documentId, index),
      })),
    });

    setPreviewChunks(null);
    setPreviewSettings(null);

    toast({
      title: "Чанки сохранены",
      description: "Сохранённое разбиение теперь доступно для векторизации.",
    });
  };

  const handleCancelPreview = () => {
    setPreviewChunks(null);
    setPreviewSettings(null);
  };

  const handleClearChunks = () => {
    if (!hasStoredChunks) {
      return;
    }

    onChunksCleared();
    toast({
      title: "Чанки удалены",
      description: "Сохранённое разбиение удалено. Сгенерируйте новую версию при необходимости.",
    });
  };

  const handleEditChunk = (chunk: DocumentChunk) => {
    if (isPreviewActive) {
      toast({
        title: "Сначала сохраните чанки",
        description: "Редактирование доступно только для сохранённого разбиения.",
        variant: "destructive",
      });
      return;
    }

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
      description: "Документ переведён в режим редактирования. Сохраните изменения, чтобы они применились.",
    });
    handleCloseDialog();
    onSwitchToDocumentTab?.();
  };

  const handleCopyChunk = async (chunk: DocumentChunk) => {
    try {
      await navigator.clipboard.writeText(chunk.content);
      setCopiedChunkId(chunk.id);
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

  const chunkCount = displayedChunks.length;

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="rounded-lg border bg-muted/20 p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          <Badge variant="outline">Чанков: {chunkCount.toLocaleString("ru-RU")}</Badge>
          <span>
            Размер чанка: {summaryChunkSize ? summaryChunkSize.toLocaleString("ru-RU") : "—"}
          </span>
          <span>
            Перехлёст: {summaryChunkOverlap ? summaryChunkOverlap.toLocaleString("ru-RU") : "—"}
          </span>
          {storedChunks && !isPreviewActive && (
            <span>
              Сохранено: {new Date(storedChunks.generatedAt).toLocaleString("ru-RU")}
            </span>
          )}
          {isPreviewActive && <Badge variant="secondary">Предпросмотр</Badge>}
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label className="text-xs font-medium" htmlFor="document-chunk-size">
              Размер чанка (символов)
            </label>
            <Input
              id="document-chunk-size"
              inputMode="numeric"
              value={chunkSizeInput}
              onChange={(event) =>
                setChunkSizeInput(event.target.value.replace(/[^0-9]/g, ""))
              }
              placeholder="Например, 800"
            />
            <p className="text-[11px] text-muted-foreground">Допустимо от 200 до 8000 символов.</p>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium" htmlFor="document-chunk-overlap">
              Перехлёст (символов)
            </label>
            <Input
              id="document-chunk-overlap"
              inputMode="numeric"
              value={chunkOverlapInput}
              onChange={(event) =>
                setChunkOverlapInput(event.target.value.replace(/[^0-9]/g, ""))
              }
              placeholder="Например, 200"
            />
            <p className="text-[11px] text-muted-foreground">Перехлёст должен быть меньше размера чанка.</p>
          </div>
        </div>

        {!chunkSettingsValid && (
          <p className="mt-2 text-[11px] text-destructive">
            Проверьте значения: размер 200–8000, перехлёст 0–4000 и меньше размера чанка.
          </p>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          <Button type="button" onClick={handleGeneratePreview}>
            <Sparkles className="mr-2 h-4 w-4" /> Предпросмотр
          </Button>
          <Button type="button" onClick={handleSavePreview} disabled={!isPreviewActive}>
            <Save className="mr-2 h-4 w-4" /> Сохранить чанки
          </Button>
          {isPreviewActive && (
            <Button type="button" variant="outline" onClick={handleCancelPreview}>
              <Undo2 className="mr-2 h-4 w-4" /> Отменить предпросмотр
            </Button>
          )}
          {hasStoredChunks && !isPreviewActive && (
            <Button
              type="button"
              variant="outline"
              onClick={handleClearChunks}
              className="border-destructive/40 text-destructive hover:bg-destructive/10"
            >
              <Trash2 className="mr-2 h-4 w-4" /> Удалить сохранённые чанки
            </Button>
          )}
        </div>

        {!hasStoredChunks && !isPreviewActive && (
          <p className="mt-3 text-xs text-muted-foreground">
            Чанки пока не сохранены. Сформируйте предпросмотр, убедитесь в корректности и сохраните его.
          </p>
        )}
      </div>

      {displayedChunks.length === 0 ? (
        <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          {contentHtml.trim()
            ? "Сохранённых чанков нет. Используйте форму выше, чтобы сгенерировать разбиение."
            : "Документ пока пуст — нечего разбивать на чанки."}
        </div>
      ) : (
        <ScrollArea className="flex-1 pr-3">
          <div className="space-y-4">
            {displayedChunks.map((chunk, index) => {
              const isCopied = copiedChunkId === chunk.id;

              return (
                <div
                  key={chunk.id || `${documentId}-${index}`}
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
                        disabled={isPreviewActive}
                        title={
                          isPreviewActive
                            ? "Сначала сохраните разбиение, чтобы редактировать чанки"
                            : undefined
                        }
                      >
                        <PencilLine className="mr-2 h-4 w-4" />
                        Редактировать
                      </Button>
                    </div>
                  </div>
                  <pre className="mt-3 whitespace-pre-wrap break-words rounded-md bg-muted/60 p-3 font-mono text-xs leading-relaxed text-muted-foreground">
                    {chunk.content}
                  </pre>
                  <p className="mt-2 text-xs text-muted-foreground/80">{chunk.excerpt}</p>
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
              Изменённый текст заменит содержимое чанка в документе. После сохранения документ перейдёт в режим
              редактирования, и изменения нужно будет сохранить.
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
