import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent } from "react";
import { Link, useRoute } from "wouter";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import {
  Check,
  ChevronLeft,
  Copy,
  Download,
  Maximize2,
  Minimize2,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";

interface VectorCollectionDetail {
  name: string;
  status: string;
  optimizerStatus?: string | { error: string };
  pointsCount: number;
  vectorsCount: number | null;
  segmentsCount: number | null;
  vectorSize: number | null;
  distance: string | null;
  config?: Record<string, unknown> | null;
}

type CollectionPoint = {
  id: string | number;
  payload: Record<string, unknown> | null;
  shard_key?: unknown;
  order_value?: unknown;
  [key: string]: unknown;
};

interface CollectionPointsResponse {
  points: CollectionPoint[];
  nextPageOffset: string | number | null;
}

const POINTS_PAGE_SIZE = 24;

const statusLabels: Record<string, string> = {
  green: "Готова",
  yellow: "Оптимизируется",
  red: "Ошибка",
};

const statusIndicatorVariants: Record<string, string> = {
  green: "bg-emerald-500",
  yellow: "bg-amber-500",
  red: "bg-red-500",
};

function formatNumber(value: number | null | undefined) {
  if (value === null || value === undefined) {
    return "—";
  }

  return new Intl.NumberFormat("ru-RU").format(value);
}

export default function VectorCollectionDetailPage() {
  const [match, params] = useRoute("/vector/collections/:name");
  const encodedName = params?.name ?? "";
  const collectionName = encodedName ? decodeURIComponent(encodedName) : null;
  const [selectedPoint, setSelectedPoint] = useState<CollectionPoint | null>(null);
  const [isJsonCopied, setIsJsonCopied] = useState(false);
  const [isCurlCopied, setIsCurlCopied] = useState(false);
  const [isPointPreviewFullScreen, setIsPointPreviewFullScreen] = useState(false);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const { toast } = useToast();

  const {
    data: collection,
    isLoading: collectionLoading,
    isFetching: collectionFetching,
    error: collectionError,
    refetch: refetchCollection,
  } = useQuery<VectorCollectionDetail>({
    queryKey: ["/api/vector/collections", collectionName ?? ""],
    enabled: Boolean(collectionName),
  });

  const {
    data: pointsData,
    isLoading: pointsLoading,
    isFetching: pointsFetching,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
    error: pointsError,
    refetch: refetchPoints,
  } = useInfiniteQuery<CollectionPointsResponse, Error>({
    queryKey: ["/api/vector/collections", collectionName ?? "", "points"],
    initialPageParam: undefined as string | number | undefined,
    enabled: Boolean(collectionName),
    queryFn: async ({ pageParam }) => {
      if (!collectionName) {
        return { points: [], nextPageOffset: null };
      }

      const params = new URLSearchParams();
      params.set("limit", String(POINTS_PAGE_SIZE));
      if (pageParam !== undefined && pageParam !== null) {
        params.set("offset", String(pageParam));
      }

      const response = await apiRequest(
        "GET",
        `/api/vector/collections/${encodeURIComponent(collectionName)}/points?${params.toString()}`,
      );
      return (await response.json()) as CollectionPointsResponse;
    },
    getNextPageParam: (lastPage) => lastPage.nextPageOffset ?? undefined,
  });

  const isRefreshing = collectionFetching || pointsFetching;

  const points = useMemo(() => {
    return pointsData?.pages.flatMap((page) => page.points) ?? [];
  }, [pointsData]);

  const curlCommand = useMemo(() => {
    if (!collectionName) {
      return "";
    }

    const origin = typeof window !== "undefined" ? window.location.origin : "";
    const baseUrl = origin
      ? `${origin}/api/vector/collections/${encodeURIComponent(collectionName)}/search`
      : `/api/vector/collections/${encodeURIComponent(collectionName)}/search`;
    const vectorHint = collection?.vectorSize
      ? `<${collection.vectorSize}_vector_values>`
      : "<vector_values>";

    return [
      `curl -X POST '${baseUrl}' \\`,
      `  -H 'Content-Type: application/json' \\`,
      "  -d '{",
      `    "vector": ["${vectorHint}"],`,
      '    "limit": 10,',
      '    "with_payload": true',
      "  }'",
    ].join("\n");
  }, [collectionName, collection?.vectorSize]);

  useEffect(() => {
    const node = loadMoreRef.current;

    if (!node || !hasNextPage) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const [entry] = entries;
        if (entry?.isIntersecting && !isFetchingNextPage) {
          void fetchNextPage();
        }
      },
      {
        rootMargin: "200px",
      },
    );

    observer.observe(node);

    return () => {
      observer.disconnect();
    };
  }, [fetchNextPage, hasNextPage, isFetchingNextPage, points.length]);

  const selectedPointJson = useMemo(() => {
    if (!selectedPoint) {
      return "";
    }

    const { vector, ...rest } = selectedPoint;

    try {
      return JSON.stringify(rest, null, 2);
    } catch (error) {
      console.error("Не удалось подготовить JSON записи", error);
      return "";
    }
  }, [selectedPoint]);

  const selectedPointDownloadJson = useMemo(() => {
    if (!selectedPoint) {
      return "";
    }

    try {
      return JSON.stringify(selectedPoint, null, 2);
    } catch (error) {
      console.error("Не удалось подготовить полный JSON записи", error);
      return "";
    }
  }, [selectedPoint]);

  if (!match) {
    return null;
  }

  if (!collectionName) {
    return (
      <div className="p-6">
        <Alert variant="destructive">
          <AlertTitle>Коллекция не найдена</AlertTitle>
          <AlertDescription>Не удалось определить имя коллекции.</AlertDescription>
        </Alert>
      </div>
    );
  }

  const handleRefresh = () => {
    void refetchCollection();
    void refetchPoints();
  };

  const handleCopyCurl = async () => {
    if (!curlCommand) {
      return;
    }

    try {
      await navigator.clipboard.writeText(curlCommand);
      setIsCurlCopied(true);
      toast({
        title: "Команда скопирована",
        description: "curl для поиска по коллекции добавлен в буфер обмена.",
      });
      window.setTimeout(() => setIsCurlCopied(false), 2000);
    } catch (error) {
      toast({
        title: "Не удалось скопировать",
        description: "Скопируйте текст вручную и попробуйте ещё раз.",
        variant: "destructive",
      });
    }
  };

  const closePointPreview = () => {
    setSelectedPoint(null);
    setIsJsonCopied(false);
    setIsPointPreviewFullScreen(false);
  };

  const handleCopyJson = async () => {
    if (!selectedPointJson) {
      return;
    }

    try {
      await navigator.clipboard.writeText(selectedPointJson);
      setIsJsonCopied(true);
      toast({
        title: "JSON скопирован",
        description: "Полное содержимое записи добавлено в буфер обмена.",
      });
      window.setTimeout(() => setIsJsonCopied(false), 2000);
    } catch (error) {
      toast({
        title: "Не удалось скопировать",
        description: "Скопируйте данные вручную и попробуйте ещё раз.",
        variant: "destructive",
      });
    }
  };

  const handleDownloadJson = () => {
    if (!selectedPointDownloadJson || !selectedPoint) {
      return;
    }

    try {
      const blob = new Blob([selectedPointDownloadJson], {
        type: "text/plain;charset=utf-8",
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      const normalizedCollectionName = (collectionName ?? "collection").replace(/[^\p{L}\p{N}_-]+/gu, "-");
      link.href = url;
      link.download = `${normalizedCollectionName}-record-${selectedPoint.id}.txt`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      toast({
        title: "Файл скачан",
        description: "Полный JSON записи сохранён в формате TXT.",
      });
    } catch (error) {
      console.error("Не удалось скачать JSON записи", error);
      toast({
        title: "Не удалось скачать",
        description: "Попробуйте ещё раз или скопируйте данные вручную.",
        variant: "destructive",
      });
    }
  };

  const getPointEntries = (point: CollectionPoint) => {
    const entries: Array<{ key: string; value: string }> = [];

    const formatValue = (value: unknown): string => {
      if (value === null) {
        return "null";
      }

      if (value === undefined) {
        return "—";
      }

      if (typeof value === "string") {
        return value;
      }

      if (typeof value === "number" || typeof value === "boolean") {
        return String(value);
      }

      try {
        return JSON.stringify(value);
      } catch (error) {
        console.error("Не удалось преобразовать значение поля записи", error);
        return String(value);
      }
    };

    const pushEntries = (source: Record<string, unknown> | null | undefined, prefix?: string) => {
      if (!source) {
        return;
      }

      Object.entries(source).forEach(([key, value]) => {
        entries.push({
          key: prefix ? `${prefix}.${key}` : key,
          value: formatValue(value),
        });
      });
    };

    pushEntries(point.payload ?? undefined);

    Object.entries(point).forEach(([key, value]) => {
      if (["id", "payload", "vector", "shard_key", "order_value"].includes(key)) {
        return;
      }

      entries.push({ key, value: formatValue(value) });
    });

    return entries;
  };

  const handleCopyPointId = async (event: MouseEvent<HTMLSpanElement>, id: string | number) => {
    event.stopPropagation();

    try {
      await navigator.clipboard.writeText(String(id));
      toast({
        title: "ID скопирован",
        description: "Идентификатор записи добавлен в буфер обмена.",
      });
    } catch (error) {
      toast({
        title: "Не удалось скопировать",
        description: "Скопируйте значение вручную и попробуйте ещё раз.",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <Button asChild variant="ghost" size="sm" className="gap-2 px-2">
            <Link href="/vector/collections">
              <ChevronLeft className="h-4 w-4" />
              Назад
            </Link>
          </Button>
          <h1 className="text-2xl font-semibold">
            {collectionLoading ? <Skeleton className="h-7 w-56" /> : collection?.name ?? collectionName}
          </h1>
          {collection?.status && (
            <span className="flex items-center gap-1 text-sm text-muted-foreground">
              <span
                aria-hidden
                className={cn(
                  "h-2.5 w-2.5 rounded-full",
                  statusIndicatorVariants[collection.status] ?? "bg-muted-foreground",
                )}
              />
              {statusLabels[collection.status] ?? collection.status}
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleRefresh} disabled={isRefreshing}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Обновить
          </Button>
          <Button variant="outline" size="sm" onClick={handleCopyCurl} disabled={!curlCommand}>
            <Copy className="mr-2 h-4 w-4" />
            {isCurlCopied ? "Скопировано" : "curl для поиска"}
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground">
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground/70">Записей</span>
          <span className="font-semibold text-foreground">
            {collectionLoading ? <Skeleton className="h-4 w-12" /> : formatNumber(collection?.pointsCount)}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground/70">Размер вектора</span>
          <span className="font-semibold text-foreground">
            {collectionLoading ? <Skeleton className="h-4 w-16" /> : formatNumber(collection?.vectorSize)}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground/70">Метрика</span>
          <span className="font-semibold text-foreground">
            {collectionLoading ? <Skeleton className="h-4 w-16" /> : collection?.distance ?? "—"}
          </span>
        </div>
      </div>

      {collectionError && (
        <Alert variant="destructive">
          <AlertTitle>Не удалось загрузить информацию</AlertTitle>
          <AlertDescription>{(collectionError as Error).message}</AlertDescription>
        </Alert>
      )}

      {pointsError && (
        <Alert variant="destructive">
          <AlertTitle>Не удалось загрузить записи</AlertTitle>
          <AlertDescription>{pointsError.message}</AlertDescription>
        </Alert>
      )}

      <div className="rounded-xl border border-border/70 bg-card/60">
        {pointsLoading && !points.length ? (
          <div className="p-6 text-sm text-muted-foreground">Загрузка записей...</div>
        ) : points.length === 0 ? (
          <div className="p-6 text-sm text-muted-foreground">В коллекции пока нет записей.</div>
        ) : (
          <div className="divide-y divide-border/60">
            {points.map((point) => {
              const entries = getPointEntries(point);
              const isSelected = selectedPoint?.id === point.id;

              return (
                <div
                  key={String(point.id)}
                  role="button"
                  tabIndex={0}
                  onClick={() => setSelectedPoint(point)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      setSelectedPoint(point);
                    }
                  }}
                  className={cn(
                    "flex flex-col gap-3 p-4 transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                    isSelected && "bg-muted/50",
                  )}
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <span
                      className="flex cursor-pointer items-center gap-2 font-mono text-sm text-foreground"
                      onClick={(event) => void handleCopyPointId(event, point.id)}
                    >
                      {point.id}
                      <Copy className="h-3.5 w-3.5 text-muted-foreground" />
                    </span>
                    <span className="text-xs text-muted-foreground">Открыть полную запись</span>
                  </div>

                  {entries.length > 0 ? (
                    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-sm">
                      {entries.map((entry, index) => (
                        <Fragment key={`${entry.key}-${index}`}>
                          <dt className="truncate text-xs uppercase text-muted-foreground">{entry.key}</dt>
                          <dd className="break-all font-mono text-[13px] text-foreground">{entry.value}</dd>
                        </Fragment>
                      ))}
                    </dl>
                  ) : (
                    <p className="text-sm text-muted-foreground">Нет данных для отображения.</p>
                  )}
                </div>
              );
            })}
            <div ref={loadMoreRef} className="h-6" />
            {isFetchingNextPage && (
              <div className="p-4 text-sm text-muted-foreground">Загрузка дополнительных записей…</div>
            )}
          </div>
        )}
      </div>

      <Sheet
        open={Boolean(selectedPoint)}
        onOpenChange={(open) => {
          if (!open) {
            closePointPreview();
          }
        }}
      >
        <SheetContent
          side="right"
          size={isPointPreviewFullScreen ? "fullscreen" : "xl"}
          className="flex h-full flex-col gap-4"
        >
          <SheetHeader className="space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-1">
                <SheetTitle>Запись коллекции</SheetTitle>
                <SheetDescription>Полный JSON записи без поля вектора.</SheetDescription>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="gap-2"
                onClick={() => setIsPointPreviewFullScreen((prev) => !prev)}
              >
                {isPointPreviewFullScreen ? (
                  <>
                    <Minimize2 className="h-4 w-4" />
                    Свернуть
                  </>
                ) : (
                  <>
                    <Maximize2 className="h-4 w-4" />
                    На весь экран
                  </>
                )}
              </Button>
            </div>
          </SheetHeader>

          {selectedPoint && (
            <div className="flex flex-1 flex-col gap-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm text-muted-foreground">
                  ID: <span className="font-mono text-foreground">{selectedPoint.id}</span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleDownloadJson}
                    disabled={!selectedPointDownloadJson}
                  >
                    <Download className="mr-2 h-4 w-4" />
                    Скачать TXT
                  </Button>
                  <Button variant="outline" size="sm" onClick={handleCopyJson} disabled={!selectedPointJson}>
                    {isJsonCopied ? <Check className="mr-2 h-4 w-4" /> : <Copy className="mr-2 h-4 w-4" />}
                    {isJsonCopied ? "Скопировано" : "Скопировать JSON"}
                  </Button>
                </div>
              </div>

              <ScrollArea
                className={cn(
                  "rounded-lg border border-border/60 bg-muted/30 p-4",
                  isPointPreviewFullScreen ? "h-[calc(100vh-220px)]" : "h-[70vh]",
                )}
              >
                {selectedPointJson ? (
                  <pre className="text-sm leading-relaxed text-foreground">
                    {selectedPointJson}
                  </pre>
                ) : (
                  <p className="text-sm text-muted-foreground">Не удалось подготовить JSON запись.</p>
                )}
              </ScrollArea>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
