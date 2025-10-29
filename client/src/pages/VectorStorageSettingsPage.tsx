import { MouseEvent, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Loader2, RefreshCw, Copy } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";

interface VectorCollectionInfo {
  name: string;
  status: string;
  optimizerStatus?: string | { error: string };
  pointsCount: number | null;
  vectorsCount: number | null;
  vectorSize: number | null;
  distance: string | null;
  segmentsCount: number | null;
  error?: string;
}

interface CollectionsResponse {
  collections: VectorCollectionInfo[];
}

interface AggregatedStats {
  totalCollections: number;
  totalPoints: number;
  estimatedSizeBytes: number;
  collectionsWithKnownSize: number;
}

const numberFormatter = new Intl.NumberFormat("ru-RU");

function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "—";
  }

  return numberFormatter.format(value);
}

function formatBytes(bytes: number): string {
  if (bytes === 0) {
    return "0 Б";
  }

  const units = ["Б", "КБ", "МБ", "ГБ", "ТБ"];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, exponent);

  return `${value.toFixed(value < 10 && exponent > 0 ? 1 : 0)} ${units[exponent]}`;
}

export default function VectorStorageSettingsPage() {
  const {
    data,
    isLoading,
    isError,
    error,
    refetch,
    isFetching,
  } = useQuery<CollectionsResponse>({
    queryKey: ["/api/vector/collections"],
  });

  const { toast } = useToast();

  const handleCopyCollectionId = async (event: MouseEvent<HTMLDivElement>, collectionId: string) => {
    event.preventDefault();
    event.stopPropagation();

    try {
      await navigator.clipboard.writeText(collectionId);
      toast({
        title: "ID коллекции скопирован",
        description: `Идентификатор «${collectionId}» добавлен в буфер обмена.`,
      });
    } catch (copyError) {
      console.error("Не удалось скопировать идентификатор коллекции", copyError);
      toast({
        title: "Ошибка копирования",
        description: "Попробуйте выделить идентификатор вручную и повторите попытку.",
        variant: "destructive",
      });
    }
  };

  const stats: AggregatedStats = useMemo(() => {
    const collections = data?.collections ?? [];

    return collections.reduce<AggregatedStats>(
      (accumulator, collection) => {
        const pointsCount = collection.pointsCount ?? 0;
        const vectorSize = collection.vectorSize ?? null;

        accumulator.totalCollections += 1;
        accumulator.totalPoints += pointsCount;

        if (vectorSize && vectorSize > 0) {
          accumulator.estimatedSizeBytes += pointsCount * vectorSize * 4;
          accumulator.collectionsWithKnownSize += 1;
        }

        return accumulator;
      },
      {
        totalCollections: 0,
        totalPoints: 0,
        estimatedSizeBytes: 0,
        collectionsWithKnownSize: 0,
      },
    );
  }, [data]);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold">Настройки хранилища</h1>
          <p className="text-muted-foreground max-w-2xl">
            На этой странице отображается агрегированная статистика по коллекциям векторного поиска.
            Она помогает оценить объём данных в Qdrant и следить за ростом числа записей.
          </p>
        </div>
        <Button variant="outline" onClick={() => refetch()} disabled={isFetching}>
          {isFetching ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Обновляем...
            </>
          ) : (
            <>
              <RefreshCw className="mr-2 h-4 w-4" /> Обновить
            </>
          )}
        </Button>
      </div>

      {isError && (
        <Alert variant="destructive">
          <AlertTitle>Не удалось загрузить данные</AlertTitle>
          <AlertDescription>
            {error instanceof Error ? error.message : "Попробуйте повторить попытку позже."}
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Всего коллекций</CardTitle>
            <CardDescription>Количество коллекций в Qdrant</CardDescription>
          </CardHeader>
          <CardContent className="text-3xl font-semibold">
            {isLoading ? <Loader2 className="h-6 w-6 animate-spin" /> : formatNumber(stats.totalCollections)}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Всего записей</CardTitle>
            <CardDescription>Суммарное число точек во всех коллекциях</CardDescription>
          </CardHeader>
          <CardContent className="text-3xl font-semibold">
            {isLoading ? <Loader2 className="h-6 w-6 animate-spin" /> : formatNumber(stats.totalPoints)}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Оценка объёма данных</CardTitle>
            <CardDescription>
              Рассчитано по размеру вектора (float32). {stats.collectionsWithKnownSize === stats.totalCollections
                ? ""
                : "Не для всех коллекций известен размер вектора."}
            </CardDescription>
          </CardHeader>
          <CardContent className="text-3xl font-semibold">
            {isLoading ? <Loader2 className="h-6 w-6 animate-spin" /> : formatBytes(stats.estimatedSizeBytes)}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Сводка по коллекциям</CardTitle>
          <CardDescription>
            Подробные сведения о каждой коллекции: статус, количество точек и параметры векторного пространства.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Загружаем сведения о коллекциях...
            </div>
          ) : (
            <div className="space-y-4">
              {(data?.collections ?? []).map((collection) => {
                const pointsCount = collection.pointsCount ?? 0;
                const estimatedSize =
                  collection.vectorSize && collection.vectorSize > 0
                    ? pointsCount * collection.vectorSize * 4
                    : null;
                const optimizerStatus =
                  typeof collection.optimizerStatus === "string"
                    ? collection.optimizerStatus
                    : collection.optimizerStatus?.error;

                return (
                  <div key={collection.name} className="border rounded-lg p-4">
                    <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                      <div className="flex flex-col gap-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-lg font-semibold">{collection.name}</h3>
                          <Badge
                            variant="outline"
                            onClick={(event: MouseEvent<HTMLDivElement>) =>
                              void handleCopyCollectionId(event, collection.name)
                            }
                            className="cursor-pointer gap-1 text-[10px] uppercase tracking-wide"
                          >
                            <Copy className="h-3.5 w-3.5" /> ID: {collection.name}
                          </Badge>
                        </div>
                        <p className="text-sm text-muted-foreground">
                          Статус: {collection.status}
                          {optimizerStatus ? ` · Оптимизатор: ${optimizerStatus}` : ""}
                        </p>
                      </div>
                      <div className="text-sm text-muted-foreground">
                        {collection.distance ? `Метрика: ${collection.distance}` : ""}
                        {collection.vectorSize ? ` · Размер вектора: ${collection.vectorSize}` : ""}
                        {collection.segmentsCount !== null && collection.segmentsCount !== undefined
                          ? ` · Сегментов: ${collection.segmentsCount}`
                          : ""}
                      </div>
                    </div>

                    {collection.error ? (
                      <Alert variant="destructive" className="mt-4">
                        <AlertTitle>Ошибка при получении данных</AlertTitle>
                        <AlertDescription>{collection.error}</AlertDescription>
                      </Alert>
                    ) : (
                      <div className="mt-4 grid gap-4 md:grid-cols-3 text-sm">
                        <div>
                          <div className="text-muted-foreground">Точек в коллекции</div>
                          <div className="text-base font-medium">{formatNumber(pointsCount)}</div>
                        </div>
                        <div>
                          <div className="text-muted-foreground">Всего векторов</div>
                          <div className="text-base font-medium">
                            {formatNumber(collection.vectorsCount)}
                          </div>
                        </div>
                        <div>
                          <div className="text-muted-foreground">Оценка объёма</div>
                          <div className="text-base font-medium">
                            {estimatedSize !== null ? formatBytes(estimatedSize) : "Недостаточно данных"}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}

              {(data?.collections?.length ?? 0) === 0 && (
                <p className="text-sm text-muted-foreground">
                  Коллекции отсутствуют. Создайте новую коллекцию, чтобы начать работу с векторным поиском.
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
