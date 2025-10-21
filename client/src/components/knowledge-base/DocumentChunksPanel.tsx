import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import type {
  KnowledgeDocumentChunkPreview,
  KnowledgeDocumentChunkSet,
  KnowledgeDocumentChunkConfig,
  KnowledgeDocumentChunkItem,
} from "@shared/knowledge-base";

interface DocumentChunksPanelProps {
  baseId: string;
  nodeId: string;
  documentId: string;
  chunkSet?: KnowledgeDocumentChunkSet | null;
  onChunkSetCreated: (chunkSet: KnowledgeDocumentChunkSet) => void;
}

interface ChunkConfigState {
  maxTokens: string;
  maxChars: string;
  overlapTokens: string;
  overlapChars: string;
  splitByPages: boolean;
  respectHeadings: boolean;
}

const INITIAL_CONFIG: ChunkConfigState = {
  maxTokens: "400",
  maxChars: "",
  overlapTokens: "80",
  overlapChars: "",
  splitByPages: false,
  respectHeadings: true,
};

const formatNumber = (value: number | null | undefined) => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "—";
  }
  return value.toLocaleString("ru-RU");
};

const buildChunkConfigPayload = (state: ChunkConfigState): KnowledgeDocumentChunkConfig => {
  const maxTokens = state.maxTokens.trim().length > 0 ? Number.parseInt(state.maxTokens, 10) : undefined;
  const maxChars = state.maxChars.trim().length > 0 ? Number.parseInt(state.maxChars, 10) : undefined;
  const overlapTokens = state.overlapTokens.trim().length > 0 ? Number.parseInt(state.overlapTokens, 10) : undefined;
  const overlapChars = state.overlapChars.trim().length > 0 ? Number.parseInt(state.overlapChars, 10) : undefined;

  const payload: KnowledgeDocumentChunkConfig = {
    maxTokens: Number.isFinite(maxTokens) ? maxTokens : undefined,
    maxChars: Number.isFinite(maxChars) ? maxChars : undefined,
    overlapTokens: Number.isFinite(overlapTokens) ? overlapTokens : undefined,
    overlapChars: Number.isFinite(overlapChars) ? overlapChars : undefined,
    splitByPages: state.splitByPages,
    respectHeadings: state.respectHeadings,
  };

  return payload;
};

const renderMetadata = (metadata: Record<string, unknown> | undefined) => {
  if (!metadata || Object.keys(metadata).length === 0) {
    return <p className="text-xs text-muted-foreground">Дополнительных метаданных нет.</p>;
  }

  return (
    <pre className="mt-2 whitespace-pre-wrap rounded-md bg-muted/50 p-2 text-[11px] text-muted-foreground">
      {JSON.stringify(metadata, null, 2)}
    </pre>
  );
};

const ChunkList = ({
  title,
  items,
  limit,
}: {
  title: string;
  items: KnowledgeDocumentChunkItem[];
  limit?: number;
}) => {
  const displayed = typeof limit === "number" ? items.slice(0, limit) : items;

  if (displayed.length === 0) {
    return <p className="text-sm text-muted-foreground">Чанков нет.</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold">{title}</h4>
        {typeof limit === "number" && items.length > limit && (
          <span className="text-xs text-muted-foreground">
            Показаны первые {limit.toLocaleString("ru-RU")} из {items.length.toLocaleString("ru-RU")}
          </span>
        )}
      </div>
      <div className="space-y-3">
        {displayed.map((chunk) => {
          const charStart = typeof chunk.charStart === "number" ? chunk.charStart : null;
          const charEnd = typeof chunk.charEnd === "number" ? chunk.charEnd : null;
          const spanLabel = charStart !== null && charEnd !== null ? `${charStart.toLocaleString("ru-RU")}–${charEnd.toLocaleString("ru-RU")}` : "—";

          return (
            <div key={chunk.id ?? `chunk-${chunk.index}`} className="rounded-lg border bg-background p-3 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                <div className="flex items-center gap-2 font-medium text-foreground">
                  <span>Чанк #{(chunk.index ?? 0) + 1}</span>
                  <Badge variant="outline">Токенов: {formatNumber(chunk.tokenCount)}</Badge>
                  <Badge variant="outline">Символов: {chunk.text.length.toLocaleString("ru-RU")}</Badge>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="secondary">Диапазон: {spanLabel}</Badge>
                  {chunk.contentHash && (
                    <Badge variant="outline" className="font-mono text-[10px] uppercase">
                      {chunk.contentHash.slice(0, 12)}
                    </Badge>
                  )}
                </div>
              </div>
              <p className="mt-2 whitespace-pre-wrap break-words text-sm text-foreground">{chunk.text}</p>
              {renderMetadata(chunk.metadata as Record<string, unknown> | undefined)}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export function DocumentChunksPanel({
  baseId,
  nodeId,
  documentId,
  chunkSet,
  onChunkSetCreated,
}: DocumentChunksPanelProps) {
  const { toast } = useToast();
  const [configState, setConfigState] = useState<ChunkConfigState>(INITIAL_CONFIG);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [preview, setPreview] = useState<KnowledgeDocumentChunkPreview | null>(null);

  const previewMutation = useMutation({
    mutationFn: async (config: KnowledgeDocumentChunkConfig) => {
      const response = await apiRequest(
        "POST",
        `/api/knowledge/bases/${baseId}/documents/${nodeId}/chunks/preview`,
        { config },
      );

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: "Не удалось получить предпросмотр" }));
        throw new Error(error.error ?? "Не удалось получить предпросмотр");
      }

      return (await response.json()) as KnowledgeDocumentChunkPreview;
    },
    onSuccess: (data) => {
      setPreview(data);
      toast({
        title: "Предпросмотр готов",
        description: `Получено ${data.totalChunks.toLocaleString("ru-RU")} чанков.`,
      });
    },
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : "Не удалось подготовить предпросмотр";
      toast({ title: "Ошибка", description: message, variant: "destructive" });
    },
  });

  const createMutation = useMutation({
    mutationFn: async (config: KnowledgeDocumentChunkConfig) => {
      const response = await apiRequest(
        "POST",
        `/api/knowledge/bases/${baseId}/documents/${nodeId}/chunks`,
        { config },
      );

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: "Не удалось сохранить чанки" }));
        throw new Error(error.error ?? "Не удалось сохранить чанки");
      }

      return (await response.json()) as KnowledgeDocumentChunkSet;
    },
    onSuccess: (data) => {
      setIsDialogOpen(false);
      setPreview(null);
      onChunkSetCreated(data);
      toast({
        title: "Чанки сохранены",
        description: `Создано ${data.chunkCount.toLocaleString("ru-RU")} чанков для документа`,
      });
    },
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : "Не удалось сохранить чанки";
      toast({ title: "Ошибка", description: message, variant: "destructive" });
    },
  });

  const handleOpenDialog = () => {
    setConfigState(INITIAL_CONFIG);
    setPreview(null);
    setIsDialogOpen(true);
  };

  const handlePreview = () => {
    const payload = buildChunkConfigPayload(configState);
    previewMutation.mutate(payload);
  };

  const handleSaveChunks = () => {
    if (!preview) {
      toast({
        title: "Сначала подготовьте предпросмотр",
        description: "Создайте предпросмотр, чтобы убедиться в корректности параметров.",
        variant: "destructive",
      });
      return;
    }

    const payload = buildChunkConfigPayload(configState);
    createMutation.mutate(payload);
  };

  const hasStoredChunks = Boolean(chunkSet && chunkSet.chunks.length > 0);

  const chunkSummary = useMemo(() => {
    if (!chunkSet) {
      return null;
    }

    const { config } = chunkSet;
    const sizeLabel =
      typeof config.maxTokens === "number"
        ? `${config.maxTokens.toLocaleString("ru-RU")} токенов`
        : typeof config.maxChars === "number"
        ? `${config.maxChars.toLocaleString("ru-RU")} символов`
        : "—";

    const overlapLabel =
      typeof config.overlapTokens === "number"
        ? `${config.overlapTokens.toLocaleString("ru-RU")} токенов`
        : typeof config.overlapChars === "number"
        ? `${config.overlapChars.toLocaleString("ru-RU")} символов`
        : "—";

    return {
      sizeLabel,
      overlapLabel,
    };
  }, [chunkSet]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <h3 className="text-base font-semibold">Чанки документа</h3>
          <p className="text-sm text-muted-foreground">
            Разбейте документ на семантические чанки для векторизации и последующего поиска.
          </p>
        </div>
        <Button type="button" onClick={handleOpenDialog}>
          {hasStoredChunks ? "Пересобрать чанки" : "Разбить документ на чанки"}
        </Button>
      </div>

      {chunkSet ? (
        <div className="rounded-lg border bg-muted/20 p-4">
          <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            <Badge variant="outline">Чанков: {chunkSet.chunkCount.toLocaleString("ru-RU")}</Badge>
            <Badge variant="outline">Токенов: {chunkSet.totalTokens.toLocaleString("ru-RU")}</Badge>
            <Badge variant="outline">Символов: {chunkSet.totalChars.toLocaleString("ru-RU")}</Badge>
            {chunkSummary && (
              <>
                <span>Лимит: {chunkSummary.sizeLabel}</span>
                <span>Перехлёст: {chunkSummary.overlapLabel}</span>
              </>
            )}
            <span>
              Обновлено: {new Date(chunkSet.updatedAt).toLocaleString("ru-RU")}
            </span>
          </div>
          <Separator className="my-3" />
          <ScrollArea className="h-80 pr-3">
            <ChunkList title="Сохранённые чанки" items={chunkSet.chunks} limit={10} />
          </ScrollArea>
        </div>
      ) : (
        <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          Чанки ещё не подготовлены. Нажмите «Разбить документ на чанки», чтобы создать первое разбиение.
        </div>
      )}

      <Dialog open={isDialogOpen} onOpenChange={(open) => (!open ? setIsDialogOpen(false) : setIsDialogOpen(true))}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Настройка чанков</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="chunk-max-tokens">Максимум токенов</Label>
                <Input
                  id="chunk-max-tokens"
                  inputMode="numeric"
                  value={configState.maxTokens}
                  onChange={(event) =>
                    setConfigState((prev) => ({ ...prev, maxTokens: event.target.value.replace(/[^0-9]/g, "") }))
                  }
                  placeholder="Например, 400"
                  disabled={previewMutation.isPending || createMutation.isPending}
                />
                <p className="text-[11px] text-muted-foreground">
                  Рекомендуется 300–500 токенов. Если поле пустое, будет использовано значение по умолчанию.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="chunk-max-chars">Максимум символов</Label>
                <Input
                  id="chunk-max-chars"
                  inputMode="numeric"
                  value={configState.maxChars}
                  onChange={(event) =>
                    setConfigState((prev) => ({ ...prev, maxChars: event.target.value.replace(/[^0-9]/g, "") }))
                  }
                  placeholder="Например, 2000"
                  disabled={previewMutation.isPending || createMutation.isPending}
                />
                <p className="text-[11px] text-muted-foreground">
                  Можно указать ограничение по символам, если токены недоступны.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="chunk-overlap-tokens">Перехлёст токенов</Label>
                <Input
                  id="chunk-overlap-tokens"
                  inputMode="numeric"
                  value={configState.overlapTokens}
                  onChange={(event) =>
                    setConfigState((prev) => ({ ...prev, overlapTokens: event.target.value.replace(/[^0-9]/g, "") }))
                  }
                  placeholder="Например, 80"
                  disabled={previewMutation.isPending || createMutation.isPending}
                />
                <p className="text-[11px] text-muted-foreground">
                  Обычно 10–25% от размера чанка. Если оставить пустым, значение подберётся автоматически.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="chunk-overlap-chars">Перехлёст символов</Label>
                <Input
                  id="chunk-overlap-chars"
                  inputMode="numeric"
                  value={configState.overlapChars}
                  onChange={(event) =>
                    setConfigState((prev) => ({ ...prev, overlapChars: event.target.value.replace(/[^0-9]/g, "") }))
                  }
                  placeholder="Например, 200"
                  disabled={previewMutation.isPending || createMutation.isPending}
                />
                <p className="text-[11px] text-muted-foreground">
                  Укажите при необходимости перехлёст по символам.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-6">
              <label className="flex items-center gap-2 text-sm font-medium">
                <Switch
                  checked={configState.splitByPages}
                  onCheckedChange={(checked) =>
                    setConfigState((prev) => ({ ...prev, splitByPages: checked }))
                  }
                  disabled={previewMutation.isPending || createMutation.isPending}
                />
                Разделять по страницам (при наличии разметки)
              </label>
              <label className="flex items-center gap-2 text-sm font-medium">
                <Switch
                  checked={configState.respectHeadings}
                  onCheckedChange={(checked) =>
                    setConfigState((prev) => ({ ...prev, respectHeadings: checked }))
                  }
                  disabled={previewMutation.isPending || createMutation.isPending}
                />
                Соблюдать границы заголовков
              </label>
            </div>
            {preview && (
              <div className="space-y-2 rounded-lg border bg-muted/20 p-3 text-xs text-muted-foreground">
                <div className="flex flex-wrap items-center gap-3">
                  <Badge variant="outline">Чанков: {preview.totalChunks.toLocaleString("ru-RU")}</Badge>
                  <Badge variant="outline">Токенов: {preview.totalTokens.toLocaleString("ru-RU")}</Badge>
                  <Badge variant="outline">Символов: {preview.totalChars.toLocaleString("ru-RU")}</Badge>
                </div>
                <ScrollArea className="h-60 pr-3">
                  <ChunkList title="Предпросмотр" items={preview.items} />
                </ScrollArea>
              </div>
            )}
          </div>
          <DialogFooter className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <div className="flex flex-1 flex-col items-start gap-1 text-xs text-muted-foreground sm:items-center sm:text-right">
              <span>
                Документ: <code className="font-mono text-[11px]">{documentId}</code>
              </span>
              <span>Перед сохранением обязательно просмотрите чанки.</span>
            </div>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setIsDialogOpen(false);
                  setPreview(null);
                }}
                disabled={previewMutation.isPending || createMutation.isPending}
              >
                Отмена
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={handlePreview}
                disabled={previewMutation.isPending || createMutation.isPending}
              >
                {previewMutation.isPending ? "Готовим..." : "Предпросмотр"}
              </Button>
              <Button
                type="button"
                onClick={handleSaveChunks}
                disabled={createMutation.isPending || previewMutation.isPending || !preview}
              >
                {createMutation.isPending ? "Сохраняем..." : "Сохранить чанки"}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default DocumentChunksPanel;
