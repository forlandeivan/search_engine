import { ReactNode, useMemo, useState } from "react";
import { Link, useRoute } from "wouter";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import {
  Check,
  ChevronLeft,
  Copy,
  HelpCircle,
  Maximize2,
  Minimize2,
  RefreshCw,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
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

const POINTS_PAGE_SIZE = 20;

const statusLabels: Record<string, string> = {
  green: "Готова",
  yellow: "Оптимизируется",
  red: "Ошибка",
};

const statusVariants: Record<string, "default" | "secondary" | "destructive"> = {
  green: "default",
  yellow: "secondary",
  red: "destructive",
};

function formatNumber(value: number | null | undefined) {
  if (value === null || value === undefined) {
    return "—";
  }

  return new Intl.NumberFormat("ru-RU").format(value);
}

function formatOptimizerStatus(value: VectorCollectionDetail["optimizerStatus"]) {
  if (!value) {
    return "—";
  }

  if (typeof value === "string") {
    return value;
  }

  if (value.error) {
    return `Ошибка: ${value.error}`;
  }

  return "—";
}

export default function VectorCollectionDetailPage() {
  const [match, params] = useRoute("/vector/collections/:name");
  const encodedName = params?.name ?? "";
  const collectionName = encodedName ? decodeURIComponent(encodedName) : null;
  const [selectedPoint, setSelectedPoint] = useState<CollectionPoint | null>(null);
  const [isJsonCopied, setIsJsonCopied] = useState(false);
  const [isPointPreviewFullScreen, setIsPointPreviewFullScreen] = useState(false);
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

  const getPreviewFields = (point: CollectionPoint) => {
    const MAX_FIELDS = 3;
    const preview: Array<{ label: string; value: string }> = [];

    const normalized = (value: unknown) => {
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
        console.error("Не удалось преобразовать значение для предпросмотра", error);
        return String(value);
      }
    };

    const addField = (label: string, value: unknown) => {
      if (preview.length >= MAX_FIELDS) {
        return;
      }

      const formatted = normalized(value);

      if (!formatted || formatted === "—") {
        return;
      }

      preview.push({ label, value: formatted });
    };

    const priorityTextKeys = ["title", "name", "heading", "headline"];
    const priorityContentKeys = ["text", "content", "body", "description", "summary"];

    const payloadEntries = Object.entries(point.payload ?? {});
    const restEntries = Object.entries(point).filter(
      ([key]) => !["id", "payload", "vector", "shard_key", "order_value"].includes(key),
    );

    const takeByKeys = (entries: [string, unknown][], keys: string[]) => {
      keys.forEach((key) => {
        const index = entries.findIndex(([entryKey]) => entryKey === key);
        if (index !== -1) {
          const [label, value] = entries[index];
          addField(label, value);
          entries.splice(index, 1);
        }
      });
    };

    const payloadEntriesCopy = [...payloadEntries];
    takeByKeys(payloadEntriesCopy, priorityTextKeys);
    takeByKeys(payloadEntriesCopy, priorityContentKeys);

    payloadEntriesCopy.forEach(([label, value]) => addField(label, value));
    restEntries.forEach(([label, value]) => addField(label, value));

    return preview;
  };

  const renderPreviewField = (field: { label: string; value: string }, index: number) => {
    return (
      <div
        key={`${field.label}-${index}`}
        className="rounded-md border border-border/60 bg-muted/40 p-3 transition-colors group-hover:border-primary/40"
      >
        <p className="text-[11px] font-medium uppercase text-muted-foreground">{field.label}</p>
        <p className="mt-1 line-clamp-3 text-sm text-muted-foreground">{field.value}</p>
      </div>
    );
  };

  const infoItems: Array<{ label: string; value: ReactNode; tooltip?: string }> = [
    {
      label: "Статус",
      value: collection?.status ? (
        <Badge variant={statusVariants[collection.status] ?? "secondary"}>
          {statusLabels[collection.status] ?? collection.status}
        </Badge>
      ) : (
        "—"
      ),
    },
    {
      label: "Оптимизатор",
      tooltip:
        "Фоновый процесс Qdrant, который поддерживает коллекцию в оптимальном состоянии, перераспределяя данные и ресурсы.",
      value: formatOptimizerStatus(collection?.optimizerStatus),
    },
    { label: "Записей", value: formatNumber(collection?.pointsCount) },
    { label: "Размер вектора", value: formatNumber(collection?.vectorSize) },
    { label: "Метрика", value: collection?.distance ?? "—" },
    {
      label: "Сегментов",
      tooltip:
        "Логические части коллекции, на которые Qdrant делит данные. Количество сегментов влияет на скорость поиска и обновлений.",
      value: formatNumber(collection?.segmentsCount),
    },
  ];

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Button asChild variant="ghost" size="sm" className="gap-2 px-2">
            <Link href="/vector/collections">
              <ChevronLeft className="h-4 w-4" />
              Назад к коллекциям
            </Link>
          </Button>
          {collection?.status && (
            <Badge variant={statusVariants[collection.status] ?? "secondary"}>
              {statusLabels[collection.status] ?? collection.status}
            </Badge>
          )}
        </div>
        <Button variant="outline" onClick={handleRefresh} disabled={isRefreshing}>
          <RefreshCw className="mr-2 h-4 w-4" />
          Обновить
        </Button>
      </div>

      <div className="space-y-2">
        <h1 className="text-2xl font-bold">
          {collectionLoading ? <Skeleton className="h-7 w-56" /> : collection?.name ?? collectionName}
        </h1>
        <p className="text-sm text-muted-foreground">
          Просмотр содержимого и параметров коллекции Qdrant
        </p>
      </div>

      {collectionError && (
        <Alert variant="destructive">
          <AlertTitle>Не удалось загрузить информацию</AlertTitle>
          <AlertDescription>{(collectionError as Error).message}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Информация о коллекции</CardTitle>
          <CardDescription>
            Подробные сведения о конфигурации и состоянии коллекции
          </CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {infoItems.map((item) => (
              <div
                key={item.label}
                className="rounded-lg border border-border/60 bg-muted/30 p-4 shadow-sm backdrop-blur-sm"
              >
                <dt className="flex items-start gap-2 text-sm font-medium text-muted-foreground">
                  <span className="leading-tight">{item.label}</span>
                  {item.tooltip && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="cursor-help text-muted-foreground transition-colors hover:text-foreground">
                          <HelpCircle className="h-4 w-4" />
                        </span>
                      </TooltipTrigger>
                      <TooltipContent className="max-w-xs text-balance text-sm leading-relaxed">
                        {item.tooltip}
                      </TooltipContent>
                    </Tooltip>
                  )}
                </dt>
                <dd className="mt-3 text-lg font-semibold text-foreground">
                  {collectionLoading ? <Skeleton className="h-6 w-24" /> : item.value}
                </dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Записи коллекции</CardTitle>
          <CardDescription>
            Отображаются все поля записей, кроме векторов
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {pointsError && (
            <Alert variant="destructive">
              <AlertTitle>Не удалось загрузить записи</AlertTitle>
              <AlertDescription>{pointsError.message}</AlertDescription>
            </Alert>
          )}

          {pointsLoading && !points.length ? (
            <p className="text-muted-foreground">Загрузка записей...</p>
          ) : points.length === 0 ? (
            <p className="text-muted-foreground">В коллекции пока нет записей.</p>
          ) : (
            <div className="space-y-4">
              {points.map((point) => {
                const previewFields = getPreviewFields(point);
                const isSelected = selectedPoint?.id === point.id;

                return (
                  <button
                    type="button"
                    key={String(point.id)}
                    onClick={() => setSelectedPoint(point)}
                    className={cn(
                      "group w-full rounded-lg border border-border/60 bg-card/80 p-4 text-left shadow-sm transition-all",
                      "hover:border-primary/60 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                      isSelected && "border-primary shadow-md",
                    )}
                  >
                    <div className="flex flex-col gap-4">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                        <div className="flex flex-wrap items-center gap-3">
                          <div>
                            <p className="text-xs text-muted-foreground">ID записи</p>
                            <p className="font-mono text-sm font-semibold text-foreground">{point.id}</p>
                          </div>
                          <Badge variant="outline" className="bg-background/60">
                            {previewFields.length} полей
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground sm:text-right">
                          Нажмите, чтобы открыть полную запись
                        </p>
                      </div>

                      <div>
                        {previewFields.length > 0 ? (
                          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                            {previewFields.map((field, index) => renderPreviewField(field, index))}
                          </div>
                        ) : (
                          <p className="text-sm text-muted-foreground">Данных для предпросмотра нет…</p>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {hasNextPage && (
            <div className="flex justify-center">
              <Button onClick={() => fetchNextPage()} disabled={isFetchingNextPage} variant="outline">
                {isFetchingNextPage ? "Загрузка..." : "Загрузить ещё"}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

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
          className={cn(
            "flex w-full flex-col gap-4",
            isPointPreviewFullScreen ? "max-w-[95vw]" : "max-w-6xl",
          )}
        >
          <SheetHeader className="space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-1">
                <SheetTitle>Запись коллекции</SheetTitle>
                <SheetDescription>
                  Просмотр полного JSON без поля вектора. Вы можете скопировать данные для анализа или отладки.
                </SheetDescription>
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
                <Button variant="outline" size="sm" onClick={handleCopyJson} disabled={!selectedPointJson}>
                  {isJsonCopied ? <Check className="mr-2 h-4 w-4" /> : <Copy className="mr-2 h-4 w-4" />}
                  {isJsonCopied ? "Скопировано" : "Скопировать JSON"}
                </Button>
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
