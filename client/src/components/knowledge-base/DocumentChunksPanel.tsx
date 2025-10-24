import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { ChevronLeft, ChevronRight, HelpCircle } from "lucide-react";
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
  externalOpenDialogSignal?: number;
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

type ChunkSizeMode = "tokens" | "chars";

const buildChunkConfigPayload = (state: ChunkConfigState, mode: ChunkSizeMode): KnowledgeDocumentChunkConfig => {
  const maxTokens = state.maxTokens.trim().length > 0 ? Number.parseInt(state.maxTokens, 10) : undefined;
  const maxChars = state.maxChars.trim().length > 0 ? Number.parseInt(state.maxChars, 10) : undefined;
  const overlapTokens = state.overlapTokens.trim().length > 0 ? Number.parseInt(state.overlapTokens, 10) : undefined;
  const overlapChars = state.overlapChars.trim().length > 0 ? Number.parseInt(state.overlapChars, 10) : undefined;

  const payload: KnowledgeDocumentChunkConfig = {
    maxTokens: mode === "tokens" && Number.isFinite(maxTokens) ? maxTokens : undefined,
    maxChars: mode === "chars" && Number.isFinite(maxChars) ? maxChars : undefined,
    overlapTokens: mode === "tokens" && Number.isFinite(overlapTokens) ? overlapTokens : undefined,
    overlapChars: mode === "chars" && Number.isFinite(overlapChars) ? overlapChars : undefined,
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
  info,
}: {
  title: string;
  items: KnowledgeDocumentChunkItem[];
  info?: ReactNode;
}) => {
  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">Чанков нет.</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold">{title}</h4>
        {info}
      </div>
      <div className="space-y-3">
        {items.map((chunk) => {
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
  externalOpenDialogSignal,
}: DocumentChunksPanelProps) {
  const { toast } = useToast();
  const [configState, setConfigState] = useState<ChunkConfigState>(INITIAL_CONFIG);
  const [sizeMode, setSizeMode] = useState<ChunkSizeMode>("tokens");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const externalOpenSignalRef = useRef<number | undefined>(externalOpenDialogSignal);
  const [preview, setPreview] = useState<KnowledgeDocumentChunkPreview | null>(null);
  const [chunksPage, setChunksPage] = useState(1);
  const [chunksPerPage, setChunksPerPage] = useState(10);

  useEffect(() => {
    setChunksPage(1);
  }, [chunkSet?.id]);

  useEffect(() => {
    setChunksPage(1);
  }, [chunksPerPage]);

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
      setDialogOpen(false);
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

  const setDialogOpen = (open: boolean) => {
    setIsDialogOpen(open);
  };

  const handleOpenDialog = () => {
    if (chunkSet) {
      const nextState: ChunkConfigState = {
        maxTokens: typeof chunkSet.config.maxTokens === "number" ? chunkSet.config.maxTokens.toString() : "",
        maxChars: typeof chunkSet.config.maxChars === "number" ? chunkSet.config.maxChars.toString() : "",
        overlapTokens: typeof chunkSet.config.overlapTokens === "number" ? chunkSet.config.overlapTokens.toString() : "",
        overlapChars: typeof chunkSet.config.overlapChars === "number" ? chunkSet.config.overlapChars.toString() : "",
        splitByPages: chunkSet.config.splitByPages,
        respectHeadings: chunkSet.config.respectHeadings,
      };
      setConfigState(nextState);
      setSizeMode(
        typeof chunkSet.config.maxChars === "number" && Number.isFinite(chunkSet.config.maxChars) ? "chars" : "tokens",
      );
    } else {
      setConfigState(INITIAL_CONFIG);
      setSizeMode("tokens");
    }
    setPreview(null);
    setDialogOpen(true);
  };

  const handlePreview = () => {
    const payload = buildChunkConfigPayload(configState, sizeMode);
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

    const payload = buildChunkConfigPayload(configState, sizeMode);
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

  const totalChunkPages = useMemo(() => {
    if (!chunkSet || chunkSet.chunks.length === 0) {
      return 1;
    }

    return Math.max(1, Math.ceil(chunkSet.chunks.length / chunksPerPage));
  }, [chunkSet, chunksPerPage]);

  useEffect(() => {
    if (chunksPage > totalChunkPages) {
      setChunksPage(totalChunkPages);
    }
  }, [chunksPage, totalChunkPages]);

  const paginatedChunks = useMemo(() => {
    if (!chunkSet) {
      return [] as KnowledgeDocumentChunkItem[];
    }

    const start = (chunksPage - 1) * chunksPerPage;
    const end = start + chunksPerPage;
    return chunkSet.chunks.slice(start, end);
  }, [chunkSet, chunksPage, chunksPerPage]);

  const chunkRangeInfo = useMemo(() => {
    if (!chunkSet || chunkSet.chunks.length === 0) {
      return null;
    }

    const start = (chunksPage - 1) * chunksPerPage;
    const from = start + 1;
    const to = Math.min(chunkSet.chunks.length, start + chunksPerPage);

    return (
      <span className="text-xs text-muted-foreground">
        Чанки {from.toLocaleString("ru-RU")}–{to.toLocaleString("ru-RU")} из {chunkSet.chunks.length.toLocaleString("ru-RU")}
      </span>
    );
  }, [chunkSet, chunksPage, chunksPerPage]);

  useEffect(() => {
    if (externalOpenDialogSignal === undefined) {
      externalOpenSignalRef.current = externalOpenDialogSignal;
      return;
    }

    if (externalOpenSignalRef.current === externalOpenDialogSignal) {
      return;
    }

    externalOpenSignalRef.current = externalOpenDialogSignal;
    handleOpenDialog();
  }, [externalOpenDialogSignal, handleOpenDialog]);

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
            <ChunkList title="Сохранённые чанки" items={paginatedChunks} info={chunkRangeInfo} />
          </ScrollArea>
          {chunkSet.chunks.length > 0 && (
            <div className="mt-3 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Label htmlFor="chunks-per-page" className="text-xs font-medium text-foreground">
                  Показывать по
                </Label>
                <Select
                  value={chunksPerPage.toString()}
                  onValueChange={(value) => {
                    const parsed = Number.parseInt(value, 10);
                    setChunksPerPage(Number.isFinite(parsed) && parsed > 0 ? parsed : 10);
                  }}
                  disabled={previewMutation.isPending || createMutation.isPending}
                >
                  <SelectTrigger id="chunks-per-page" className="h-8 w-28 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[10, 25, 50, 100].map((option) => (
                      <SelectItem key={option} value={option.toString()}>
                        {option.toLocaleString("ru-RU")}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <span>на страницу</span>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setChunksPage((prev) => Math.max(1, prev - 1))}
                  disabled={chunksPage === 1}
                >
                  <ChevronLeft className="h-4 w-4" />
                  Назад
                </Button>
                <span className="text-xs text-muted-foreground">
                  Страница {chunksPage.toLocaleString("ru-RU")} из {totalChunkPages.toLocaleString("ru-RU")}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setChunksPage((prev) => Math.min(totalChunkPages, prev + 1))}
                  disabled={chunksPage >= totalChunkPages}
                >
                  Вперёд
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          Чанки ещё не подготовлены. Нажмите «Разбить документ на чанки», чтобы создать первое разбиение.
        </div>
      )}

      <Dialog open={isDialogOpen} onOpenChange={(open) => setDialogOpen(open)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Настройка чанков</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="space-y-2">
              <Label>Режим ограничений</Label>
              <ToggleGroup
                type="single"
                value={sizeMode}
                onValueChange={(value) => {
                  if (value === "tokens" || value === "chars") {
                    setSizeMode(value);
                  }
                }}
                className="flex w-full gap-2"
                disabled={previewMutation.isPending || createMutation.isPending}
              >
                <ToggleGroupItem value="tokens" className="flex-1">
                  Токены
                </ToggleGroupItem>
                <ToggleGroupItem value="chars" className="flex-1">
                  Символы
                </ToggleGroupItem>
              </ToggleGroup>
              <p className="text-[11px] text-muted-foreground">
                Используйте токены, если доступны данные токенизатора, иначе переключитесь на ограничение по символам.
              </p>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              {sizeMode === "tokens" ? (
                <>
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
                </>
              ) : (
                <>
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
                      Ограничивает длину чанка по символам. Если оставить пустым, будет использовано значение по умолчанию.
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
                      При необходимости добавьте перехлёст по символам для сохранения контекста между чанками.
                    </p>
                  </div>
                </>
              )}
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
                <span className="flex items-center gap-2">
                  Разделять по страницам (при наличии разметки)
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <HelpCircle className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                      </TooltipTrigger>
                      <TooltipContent className="max-w-xs text-xs leading-relaxed">
                        Если документ содержит нумерацию страниц, чанк не будет выходить за границы страницы.
                        Это помогает сохранить исходную структуру PDF, презентаций и сканов.
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </span>
              </label>
              <label className="flex items-center gap-2 text-sm font-medium">
                <Switch
                  checked={configState.respectHeadings}
                  onCheckedChange={(checked) =>
                    setConfigState((prev) => ({ ...prev, respectHeadings: checked }))
                  }
                  disabled={previewMutation.isPending || createMutation.isPending}
                />
                <span className="flex items-center gap-2">
                  Соблюдать границы заголовков
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <HelpCircle className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                      </TooltipTrigger>
                      <TooltipContent className="max-w-xs text-xs leading-relaxed">
                        Разбиение учитывает структуру документа и старается не делить чанки внутри секций,
                        чтобы сохранялся смысловой контекст.
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </span>
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
                  setDialogOpen(false);
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
