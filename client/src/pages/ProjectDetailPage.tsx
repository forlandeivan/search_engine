import { useMemo, useState } from "react";
import { useRoute, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  Calendar,
  ChevronLeft,
  ExternalLink,
  FileText,
  Gauge,
  Hash,
  ListOrdered,
  RefreshCw,
  ScrollText,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ru } from "date-fns/locale";
import { type Page, type Site } from "@shared/schema";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import CrawlerLogPanel from "@/components/CrawlerLogPanel";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

const statusLabels: Record<Site["status"], string> = {
  idle: "Ожидает",
  crawling: "Краулится",
  completed: "Завершено",
  failed: "Ошибка",
};

const statusVariants: Record<Site["status"], "default" | "secondary" | "destructive"> = {
  idle: "secondary",
  crawling: "default",
  completed: "default",
  failed: "destructive",
};

function formatDate(value?: string | Date | null) {
  if (!value) {
    return "—";
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "—";
  }

  return date.toLocaleString("ru");
}

function formatDistance(value?: string | Date | null) {
  if (!value) {
    return null;
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return formatDistanceToNow(date, { addSuffix: true, locale: ru });
}

export default function ProjectDetailPage() {
  const [match, params] = useRoute("/admin/projects/:siteId");
  const siteId = params?.siteId ?? null;

  const {
    data: site,
    isLoading: siteLoading,
    error: siteError,
  } = useQuery<Site>({
    queryKey: ["/api/sites", siteId ?? ""],
    enabled: Boolean(siteId),
  });

  const {
    data: pages = [],
    isLoading: pagesLoading,
    error: pagesError,
  } = useQuery<Page[]>({
    queryKey: ["/api/sites", siteId ?? "", "pages"],
    enabled: Boolean(siteId),
    refetchInterval: () => (site?.status === "crawling" ? 5000 : false),
  });

  const isCrawling = site?.status === "crawling";
  const [isLogDialogOpen, setIsLogDialogOpen] = useState(false);

  const sortedPages = useMemo(() => {
    return pages
      .slice()
      .sort((a, b) => {
        const aTime = a.lastCrawled ? new Date(a.lastCrawled).getTime() : 0;
        const bTime = b.lastCrawled ? new Date(b.lastCrawled).getTime() : 0;
        return bTime - aTime;
      });
  }, [pages]);

  if (!match) {
    return null;
  }

  if (!siteId) {
    return (
      <div className="p-6">
        <Alert>
          <AlertTitle>Проект не найден</AlertTitle>
          <AlertDescription>Не удалось определить идентификатор проекта.</AlertDescription>
        </Alert>
      </div>
    );
  }

  if (siteError) {
    return (
      <div className="p-6">
        <Alert variant="destructive">
          <AlertTitle>Не удалось загрузить проект</AlertTitle>
          <AlertDescription>
            {(siteError as Error).message || "Попробуйте обновить страницу чуть позже."}
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="sm" className="gap-2 px-2">
          <Link href="/admin">
            <ChevronLeft className="h-4 w-4" />
            Назад к проектам
          </Link>
        </Button>
        {site && <Badge variant={statusVariants[site.status]}>{statusLabels[site.status]}</Badge>}
      </div>

      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2">
            <h1 className="text-2xl font-bold leading-tight">
              {siteLoading ? <Skeleton className="h-7 w-48" /> : site?.url ?? "Проект"}
            </h1>
            {site && (
              <p className="text-sm text-muted-foreground">
                Глубина краулинга: {site.crawlDepth}. Внешние ссылки: {site.followExternalLinks ? "включены" : "выключены"}.
              </p>
            )}
          </div>
          {site?.url && (
            <Button asChild variant="outline" size="sm" className="gap-2" disabled={!site?.url}>
              <a href={site.url} target="_blank" rel="noreferrer">
                Открыть сайт
                <ExternalLink className="h-4 w-4" />
              </a>
            </Button>
          )}
        </div>

        {site?.error && (
          <Alert variant="destructive">
            <AlertTitle>Последняя ошибка</AlertTitle>
            <AlertDescription>{site.error}</AlertDescription>
          </Alert>
        )}

        <Card>
          <CardContent className="grid gap-4 pt-6 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <p className="text-xs uppercase text-muted-foreground">Статус</p>
              <p className="text-base font-medium">{site ? statusLabels[site.status] : "—"}</p>
            </div>
            <div>
              <p className="text-xs uppercase text-muted-foreground">Последний краулинг</p>
              <p className="text-base font-medium">
                {site?.lastCrawled ? formatDate(site.lastCrawled) : "Еще не выполнялся"}
              </p>
              {site?.lastCrawled && (
                <p className="text-xs text-muted-foreground">{formatDistance(site.lastCrawled)}</p>
              )}
            </div>
            <div>
              <p className="text-xs uppercase text-muted-foreground">Следующий краулинг</p>
              <p className="text-base font-medium">{formatDate(site?.nextCrawl)}</p>
            </div>
            <div>
              <p className="text-xs uppercase text-muted-foreground">Шаблоны исключений</p>
              <p className="text-base font-medium">
                {site?.excludePatterns?.length ? site.excludePatterns.join(", ") : "Отсутствуют"}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-4">
        <Tabs defaultValue="pages" className="space-y-4">
          <TabsList>
            <TabsTrigger value="pages">Проиндексированные страницы</TabsTrigger>
            <TabsTrigger value="coming-soon" disabled className="gap-2">
              <RefreshCw className="h-3 w-3" />
              Скоро
            </TabsTrigger>
          </TabsList>

          <TabsContent value="pages">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-lg">
                  Страницы проекта {site ? `(${sortedPages.length})` : ""}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4 pt-0">
                {pagesLoading ? (
                  <div className="space-y-2">
                    <Skeleton className="h-5 w-1/2" />
                    <Skeleton className="h-5 w-2/3" />
                    <Skeleton className="h-5 w-3/4" />
                  </div>
                ) : pagesError ? (
                  <Alert variant="destructive">
                    <AlertTitle>Не удалось загрузить страницы</AlertTitle>
                    <AlertDescription>
                      {(pagesError as Error).message || "Повторите попытку позже."}
                    </AlertDescription>
                  </Alert>
                ) : sortedPages.length === 0 ? (
                  <div className="flex flex-col items-center justify-center gap-2 py-12 text-center text-sm text-muted-foreground">
                    <p>Страницы ещё не проиндексированы.</p>
                    {isCrawling ? (
                      <p>Краулинг выполняется, записи появятся автоматически.</p>
                    ) : (
                      <p>Запустите краулинг, чтобы начать индексировать страницы.</p>
                    )}
                  </div>
                ) : (
                  <div className="space-y-4">
                    {sortedPages.map((page) => {
                      const siteConfig = site ?? null;
                      const aggregatedContent = page.content ?? "";
                      const contentLength = aggregatedContent.length;
                      const aggregatedWordCount = page.metadata?.wordCount ??
                        (aggregatedContent ? aggregatedContent.trim().split(/\s+/).filter(Boolean).length : 0);
                      const chunks = Array.isArray(page.chunks) ? page.chunks : [];
                      const chunkCharCounts = chunks.map((chunk) => chunk.metadata?.charCount ?? chunk.content.length);
                      const chunkWordCounts = chunks.map((chunk) => chunk.metadata?.wordCount ??
                        chunk.content.trim().split(/\s+/).filter(Boolean).length);
                      const chunkCount = chunks.length;
                      const totalChunkChars = chunkCharCounts.reduce((sum, value) => sum + value, 0);
                      const maxChunkLength = chunkCharCounts.reduce((max, value) => Math.max(max, value), 0);
                      const avgChunkLength = chunkCount > 0 ? Math.round(totalChunkChars / chunkCount) : 0;
                      const maxChunkWordCount = chunkWordCounts.reduce((max, value) => Math.max(max, value), 0);
                      const configuredChunkSize = siteConfig?.maxChunkSize ?? null;
                      const chunksOverLimit = configuredChunkSize
                        ? chunkCharCounts.filter((length) => length > configuredChunkSize).length
                        : 0;
                      const lastCrawledRelative = formatDistance(page.lastCrawled);
                      const hasStatusCode = typeof page.statusCode === "number";

                      return (
                        <div
                          key={page.id}
                          className="rounded-lg border p-4 transition-colors hover-elevate"
                        >
                          <div className="flex flex-col gap-4">
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                              <div className="flex-1 min-w-0 space-y-2">
                                <div className="flex flex-wrap items-center gap-2">
                                  <h3 className="font-medium leading-tight">
                                    {page.title ? page.title : "Без названия"}
                                  </h3>
                                  {hasStatusCode && (
                                    <Badge variant="outline" className="text-[11px]">
                                      HTTP {page.statusCode}
                                    </Badge>
                                  )}
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    asChild
                                    className="px-2"
                                  >
                                    <a href={page.url} target="_blank" rel="noopener noreferrer">
                                      <ExternalLink className="h-3 w-3" />
                                    </a>
                                  </Button>
                                </div>
                                <p className="text-sm text-muted-foreground break-all">{page.url}</p>
                                {page.metaDescription && (
                                  <p className="text-sm text-muted-foreground line-clamp-2">{page.metaDescription}</p>
                                )}
                              </div>

                              <Dialog>
                                <DialogTrigger asChild>
                                  <Button variant="outline" size="sm" className="gap-2">
                                    <FileText className="h-4 w-4" />
                                    Содержимое
                                  </Button>
                                </DialogTrigger>
                                <DialogContent className="max-w-4xl max-h-[80vh]">
                                  <DialogHeader>
                                    <DialogTitle className="flex items-center gap-2">
                                      <span className="truncate">{page.title || "Без названия"}</span>
                                      <Button variant="ghost" size="sm" asChild>
                                        <a href={page.url} target="_blank" rel="noopener noreferrer">
                                          <ExternalLink className="h-3 w-3" />
                                        </a>
                                      </Button>
                                    </DialogTitle>
                                    <p className="text-sm text-muted-foreground truncate">{page.url}</p>
                                  </DialogHeader>
                                  <ScrollArea className="h-96 w-full">
                                    <div className="space-y-4">
                                      {page.metaDescription && (
                                        <div>
                                          <h4 className="font-medium mb-2">Описание:</h4>
                                          <p className="text-sm text-muted-foreground">{page.metaDescription}</p>
                                        </div>
                                      )}
                                      <div>
                                        <h4 className="font-medium mb-2">Содержимое:</h4>
                                        <div className="mb-3 flex flex-wrap gap-4 text-xs text-muted-foreground">
                                          <span>Символов (агрегировано): {contentLength.toLocaleString("ru-RU")}</span>
                                          <span>Слов (агрегировано): {aggregatedWordCount.toLocaleString("ru-RU")}</span>
                                          {chunkCount > 0 && (
                                            <>
                                              <span>Чанков: {chunkCount.toLocaleString("ru-RU")}</span>
                                              <span>Макс. чанк: {maxChunkLength.toLocaleString("ru-RU")} символов</span>
                                              <span>Сред. чанк: {avgChunkLength.toLocaleString("ru-RU")} символов</span>
                                              <span>Макс. слов в чанке: {maxChunkWordCount.toLocaleString("ru-RU")}</span>
                                              {configuredChunkSize && (
                                                <span>Лимит проекта: {configuredChunkSize.toLocaleString("ru-RU")} символов</span>
                                              )}
                                              {chunksOverLimit > 0 && (
                                                <span className="text-destructive">
                                                  {chunksOverLimit.toLocaleString("ru-RU")} чанков превышают лимит
                                                </span>
                                              )}
                                            </>
                                          )}
                                        </div>
                                        {chunkCount > 0 && (
                                          <div className="mb-6 space-y-3">
                                            <h5 className="text-sm font-medium">Разбивка по чанкам:</h5>
                                            {chunks.map((chunk, index) => {
                                              const chunkCharCount = chunk.metadata?.charCount ?? chunk.content.length;
                                              const chunkWordCount = chunk.metadata?.wordCount ??
                                                chunk.content.trim().split(/\s+/).filter(Boolean).length;
                                              return (
                                                <div
                                                  key={chunk.id || `${page.id}-chunk-${index}`}
                                                  className="rounded-lg border bg-muted/30 p-3"
                                                >
                                                  <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                                                    <div className="truncate text-sm font-medium">
                                                      {chunk.heading || `Чанк ${index + 1}`}
                                                    </div>
                                                    <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                                                      <span>Символов: {chunkCharCount.toLocaleString("ru-RU")}</span>
                                                      <span>Слов: {chunkWordCount.toLocaleString("ru-RU")}</span>
                                                      {chunk.metadata?.position !== undefined && (
                                                        <span>Позиция: {chunk.metadata.position + 1}</span>
                                                      )}
                                                    </div>
                                                  </div>
                                                  <p className="mt-2 whitespace-pre-wrap break-words text-sm text-muted-foreground">
                                                    {chunk.content}
                                                  </p>
                                                </div>
                                              );
                                            })}
                                          </div>
                                        )}
                                        <pre className="whitespace-pre-wrap rounded-lg bg-muted p-4 text-sm">
                                          {aggregatedContent}
                                        </pre>
                                      </div>
                                    </div>
                                  </ScrollArea>
                                </DialogContent>
                              </Dialog>
                            </div>

                            <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
                              {lastCrawledRelative ? (
                                <span className="flex items-center gap-1">
                                  <Calendar className="h-3 w-3" />
                                  {lastCrawledRelative}
                                </span>
                              ) : (
                                <span className="flex items-center gap-1">
                                  <Calendar className="h-3 w-3" />
                                  Дата неизвестна
                                </span>
                              )}
                              {page.contentHash && (
                                <span className="flex items-center gap-1">
                                  <Hash className="h-3 w-3" />
                                  {page.contentHash.substring(0, 8)}
                                </span>
                              )}
                              {chunkCount > 0 && (
                                <span className="flex items-center gap-1">
                                  <ListOrdered className="h-3 w-3" />
                                  {chunkCount.toLocaleString("ru-RU")} чанков
                                </span>
                              )}
                              {chunkCount > 0 && (
                                <span className="flex items-center gap-1">
                                  <Gauge className="h-3 w-3" />
                                  макс {maxChunkLength.toLocaleString("ru-RU")} симв.
                                </span>
                              )}
                              {configuredChunkSize && (
                                <span className="flex items-center gap-1">
                                  <Gauge className="h-3 w-3" />
                                  лимит {configuredChunkSize.toLocaleString("ru-RU")} симв.
                                </span>
                              )}
                              {chunksOverLimit > 0 && (
                                <span className="text-destructive">
                                  {chunksOverLimit.toLocaleString("ru-RU")} чанков превышают лимит
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      <div className="flex justify-end">
        <Dialog open={isLogDialogOpen} onOpenChange={setIsLogDialogOpen}>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm" className="gap-2">
              <ScrollText className="h-4 w-4" />
              Лог краулинга
            </Button>
          </DialogTrigger>
          <DialogContent className="w-full max-w-3xl overflow-hidden p-0">
            <CrawlerLogPanel siteId={siteId} />
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
