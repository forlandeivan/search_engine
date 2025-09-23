import { useMemo } from "react";
import { useRoute, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ExternalLink, RefreshCw } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ru } from "date-fns/locale";
import { type Page, type Site } from "@shared/schema";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import CrawlerLogPanel from "@/components/CrawlerLogPanel";

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

      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
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
                <CardContent className="p-0">
                  {pagesLoading ? (
                    <div className="space-y-2 p-6">
                      <Skeleton className="h-5 w-1/2" />
                      <Skeleton className="h-5 w-2/3" />
                      <Skeleton className="h-5 w-3/4" />
                    </div>
                  ) : pagesError ? (
                    <div className="p-6">
                      <Alert variant="destructive">
                        <AlertTitle>Не удалось загрузить страницы</AlertTitle>
                        <AlertDescription>
                          {(pagesError as Error).message || "Повторите попытку позже."}
                        </AlertDescription>
                      </Alert>
                    </div>
                  ) : sortedPages.length === 0 ? (
                    <div className="flex h-48 flex-col items-center justify-center gap-2 p-6 text-center text-sm text-muted-foreground">
                      <p>Страницы ещё не проиндексированы.</p>
                      {isCrawling ? (
                        <p>Краулинг выполняется, записи появятся автоматически.</p>
                      ) : (
                        <p>Запустите краулинг, чтобы начать индексировать страницы.</p>
                      )}
                    </div>
                  ) : (
                    <ScrollArea className="max-h-[540px]">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-16">#</TableHead>
                            <TableHead>Заголовок</TableHead>
                            <TableHead>URL</TableHead>
                            <TableHead className="w-24 text-right">Код</TableHead>
                            <TableHead className="w-48">Последнее сканирование</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {sortedPages.map((page, index) => {
                            const lastCrawledLabel = page.lastCrawled
                              ? new Date(page.lastCrawled).toLocaleString("ru")
                              : "—";
                            return (
                              <TableRow key={page.id} className="hover:bg-muted/40">
                                <TableCell className="text-xs text-muted-foreground">{index + 1}</TableCell>
                                <TableCell className="font-medium">
                                  {page.title ? page.title : "Без заголовка"}
                                </TableCell>
                                <TableCell>
                                  <a
                                    href={page.url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="text-xs text-blue-600 underline-offset-2 hover:underline dark:text-blue-300"
                                  >
                                    {page.url}
                                  </a>
                                </TableCell>
                                <TableCell className="text-right font-mono text-xs">
                                  {page.statusCode ?? "—"}
                                </TableCell>
                                <TableCell className="text-xs text-muted-foreground">
                                  {lastCrawledLabel}
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </ScrollArea>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>

        <div className="space-y-4">
          <CrawlerLogPanel siteId={siteId} />
        </div>
      </div>
    </div>
  );
}
