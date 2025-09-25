import { ReactNode, useMemo } from "react";
import { Link, useRoute } from "wouter";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { ChevronLeft, HelpCircle, RefreshCw } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { apiRequest } from "@/lib/queryClient";

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

function formatValue(value: unknown): string {
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
    return JSON.stringify(value, null, 2);
  } catch (error) {
    console.error("Не удалось преобразовать значение в строку", error);
    return String(value);
  }
}

export default function VectorCollectionDetailPage() {
  const [match, params] = useRoute("/vector/collections/:name");
  const encodedName = params?.name ?? "";
  const collectionName = encodedName ? decodeURIComponent(encodedName) : null;

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
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-40">ID</TableHead>
                    <TableHead>Данные</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {points.map((point) => {
                    const { payload, ...rest } = point;
                    const extraFields = Object.entries(rest).filter(([key, value]) => key !== "id" && value !== undefined);

                    return (
                      <TableRow key={String(point.id)}>
                        <TableCell>
                          <span className="font-mono text-sm">{point.id}</span>
                        </TableCell>
                        <TableCell>
                          <div className="space-y-4">
                            <div>
                              <p className="text-xs font-medium uppercase text-muted-foreground">Payload</p>
                              {payload && Object.keys(payload).length > 0 ? (
                                <div className="mt-2 space-y-3">
                                  {Object.entries(payload).map(([key, value]) => (
                                    <div key={key}>
                                      <p className="text-xs font-medium text-muted-foreground">{key}</p>
                                      <pre className="mt-1 whitespace-pre-wrap break-words rounded-md bg-muted/50 p-2 text-xs">
                                        {formatValue(value)}
                                      </pre>
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <p className="text-sm text-muted-foreground">Пустой payload</p>
                              )}
                            </div>

                            {extraFields.length > 0 && (
                              <div className="space-y-3">
                                {extraFields.map(([key, value]) => (
                                  <div key={key}>
                                    <p className="text-xs font-medium uppercase text-muted-foreground">{key}</p>
                                    <pre className="mt-1 whitespace-pre-wrap break-words rounded-md bg-muted/50 p-2 text-xs">
                                      {formatValue(value)}
                                    </pre>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
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
    </div>
  );
}
