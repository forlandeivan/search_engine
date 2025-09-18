import { useMemo, useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import SearchBar from "@/components/SearchBar";
import SearchResultComponent, { type SearchResult } from "@/components/SearchResult";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { AlertCircle, ArrowLeft, Globe, Loader2 } from "lucide-react";

interface Site {
  id: string;
  url: string;
  status: string;
  crawlDepth?: number;
  followExternalLinks?: boolean;
  crawlFrequency?: string;
  excludePatterns?: string[];
  lastCrawled?: string | null;
  nextCrawl?: string | null;
  error?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

interface PageSummary {
  id: string;
  url: string;
  title?: string | null;
  lastCrawled: string;
  statusCode?: number | null;
}

interface SearchResponse {
  results: SearchResult[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

interface SiteDetailsPageProps {
  siteId: string;
}

export default function SiteDetailsPage({ siteId }: SiteDetailsPageProps) {
  const normalizedSiteId = siteId;
  const [activeTab, setActiveTab] = useState("search");
  const [searchQuery, setSearchQuery] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [favorites, setFavorites] = useState<Set<string>>(new Set());

  const {
    data: site,
    isLoading: isSiteLoading,
    error: siteError
  } = useQuery<Site>({
    queryKey: ["site", normalizedSiteId],
    enabled: Boolean(normalizedSiteId),
    queryFn: async () => {
      const response = await fetch(`/api/sites/${normalizedSiteId}`);
      if (!response.ok) {
        throw new Error("Не удалось загрузить информацию о сайте");
      }
      return response.json();
    }
  });

  const {
    data: pages,
    isLoading: isPagesLoading,
    error: pagesError
  } = useQuery<PageSummary[]>({
    queryKey: ["site", normalizedSiteId, "pages"],
    enabled: activeTab === "pages" && Boolean(normalizedSiteId),
    queryFn: async () => {
      const response = await fetch(`/api/sites/${normalizedSiteId}/pages`);
      if (!response.ok) {
        throw new Error("Не удалось загрузить страницы сайта");
      }
      return response.json();
    }
  });

  const {
    data: searchData,
    isLoading: isSearchLoading,
    error: searchError
  } = useQuery<SearchResponse>({
    queryKey: ["site-search", normalizedSiteId, searchQuery, currentPage],
    enabled: Boolean(normalizedSiteId && searchQuery.trim()),
    queryFn: async () => {
      const params = new URLSearchParams({
        q: searchQuery,
        page: currentPage.toString(),
        limit: "10",
        siteId: normalizedSiteId
      });

      const response = await fetch(`/api/search?${params.toString()}`);
      if (!response.ok) {
        throw new Error("Поиск по сайту завершился ошибкой");
      }
      return response.json();
    }
  });

  const searchResults = searchData?.results ?? [];
  const totalResults = searchData?.total ?? 0;
  const totalPages = searchData?.totalPages ?? 0;

  const statusVariant = useMemo(() => {
    switch (site?.status) {
      case "completed":
        return "default" as const;
      case "crawling":
        return "secondary" as const;
      case "failed":
        return "destructive" as const;
      default:
        return "outline" as const;
    }
  }, [site?.status]);

  const handleSearch = (query: string) => {
    setSearchQuery(query);
    setCurrentPage(1);
  };

  const handleToggleFavorite = (id: string) => {
    setFavorites(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <Link href="/admin/sites">
          <Button variant="ghost" className="gap-2" data-testid="button-back-sites">
            <ArrowLeft className="h-4 w-4" />
            Назад к списку сайтов
          </Button>
        </Link>
        {site?.status && (
          <Badge variant={statusVariant} className="uppercase" data-testid="badge-site-status">
            {site.status}
          </Badge>
        )}
      </div>

      {isSiteLoading ? (
        <Card>
          <CardContent className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin" />
          </CardContent>
        </Card>
      ) : siteError ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-4 py-12 text-center text-muted-foreground">
            <AlertCircle className="h-6 w-6 text-destructive" />
            <p>Не удалось загрузить информацию о сайте.</p>
          </CardContent>
        </Card>
      ) : site ? (
        <>
          <Card>
            <CardHeader className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <div className="flex items-center gap-3">
                <Globe className="h-5 w-5 text-primary" />
                <div>
                  <CardTitle className="text-xl" data-testid="text-site-url">
                    {site.url}
                  </CardTitle>
                  <CardDescription>
                    Управление краулингом и поиском для выбранного сайта
                  </CardDescription>
                </div>
              </div>
              <div className="text-sm text-muted-foreground">
                Последнее обновление: {site.updatedAt ? new Date(site.updatedAt).toLocaleString("ru") : "—"}
              </div>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <p className="text-xs uppercase text-muted-foreground">Глубина краулинга</p>
                <p className="text-lg font-semibold">{site.crawlDepth ?? "—"}</p>
              </div>
              <div>
                <p className="text-xs uppercase text-muted-foreground">Следовать внешним ссылкам</p>
                <p className="text-lg font-semibold">{site.followExternalLinks ? "Да" : "Нет"}</p>
              </div>
              <div>
                <p className="text-xs uppercase text-muted-foreground">Частота краулинга</p>
                <p className="text-lg font-semibold">{site.crawlFrequency ?? "—"}</p>
              </div>
              <div>
                <p className="text-xs uppercase text-muted-foreground">Последнее сканирование</p>
                <p className="text-lg font-semibold">
                  {site.lastCrawled ? new Date(site.lastCrawled).toLocaleString("ru") : "—"}
                </p>
              </div>
            </CardContent>
          </Card>

          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList>
              <TabsTrigger value="search">Поисковая строка</TabsTrigger>
              <TabsTrigger value="pages">Страницы</TabsTrigger>
              <TabsTrigger value="settings">Настройки</TabsTrigger>
            </TabsList>

            <TabsContent value="search" className="mt-4">
              <Card>
                <CardHeader>
                  <CardTitle>Поиск по сайту</CardTitle>
                  <CardDescription>
                    Проверьте, как работает поисковый движок для выбранного сайта
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <SearchBar
                    onSearch={handleSearch}
                    placeholder="Введите запрос для поиска по сайту"
                    defaultValue={searchQuery}
                  />

                  {searchQuery && (
                    <div className="flex items-center justify-between text-sm text-muted-foreground">
                      <span>
                        Результаты по запросу «{searchQuery}»: {totalResults}
                      </span>
                      {totalPages > 1 && (
                        <span>
                          Страница {currentPage} из {totalPages}
                        </span>
                      )}
                    </div>
                  )}

                  {isSearchLoading ? (
                    <div className="flex justify-center py-12">
                      <Loader2 className="h-6 w-6 animate-spin" />
                    </div>
                  ) : searchError ? (
                    <div className="flex flex-col items-center gap-2 py-12 text-center text-muted-foreground">
                      <AlertCircle className="h-6 w-6 text-destructive" />
                      <p>Не удалось выполнить поиск по сайту. Попробуйте позже.</p>
                    </div>
                  ) : searchResults.length > 0 ? (
                    <div className="space-y-4">
                      {searchResults.map((result: SearchResult) => (
                        <SearchResultComponent
                          key={result.id}
                          result={{ ...result, isFavorite: favorites.has(result.id) }}
                          onToggleFavorite={handleToggleFavorite}
                          searchQuery={searchQuery}
                        />
                      ))}

                      {totalPages > 1 && (
                        <div className="flex items-center justify-center gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                            disabled={currentPage === 1}
                          >
                            Предыдущая
                          </Button>
                          <span className="text-sm text-muted-foreground">{currentPage}</span>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                            disabled={currentPage === totalPages}
                          >
                            Следующая
                          </Button>
                        </div>
                      )}
                    </div>
                  ) : searchQuery ? (
                    <div className="py-12 text-center text-muted-foreground">
                      Ничего не найдено по запросу «{searchQuery}»
                    </div>
                  ) : (
                    <div className="py-12 text-center text-muted-foreground">
                      Введите запрос, чтобы выполнить поиск по этому сайту
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="pages" className="mt-4">
              <Card>
                <CardHeader>
                  <CardTitle>Страницы сайта</CardTitle>
                  <CardDescription>
                    Последние проиндексированные страницы для выбранного сайта
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {isPagesLoading ? (
                    <div className="flex justify-center py-12">
                      <Loader2 className="h-6 w-6 animate-spin" />
                    </div>
                  ) : pagesError ? (
                    <div className="flex flex-col items-center gap-2 py-12 text-center text-muted-foreground">
                      <AlertCircle className="h-6 w-6 text-destructive" />
                      <p>Не удалось загрузить страницы сайта.</p>
                    </div>
                  ) : pages && pages.length > 0 ? (
                    <div className="space-y-4">
                      {pages.map(page => (
                        <div key={page.id} className="rounded-lg border p-4">
                          <div className="flex flex-col gap-1">
                            <a
                              href={page.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-sm font-medium text-primary hover:underline"
                            >
                              {page.title || page.url}
                            </a>
                            <span className="text-xs text-muted-foreground break-all">{page.url}</span>
                          </div>
                          <Separator className="my-3" />
                          <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
                            <span>
                              Последнее сканирование: {new Date(page.lastCrawled).toLocaleString("ru")}
                            </span>
                            {typeof page.statusCode === "number" && (
                              <Badge variant="outline">HTTP {page.statusCode}</Badge>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="py-12 text-center text-muted-foreground">
                      Для этого сайта еще нет проиндексированных страниц
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="settings" className="mt-4">
              <Card>
                <CardHeader>
                  <CardTitle>Настройки краулинга</CardTitle>
                  <CardDescription>
                    Текущие настройки и ограничения для краулинга сайта
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h3 className="text-sm font-semibold uppercase text-muted-foreground">Исключенные паттерны</h3>
                    {site.excludePatterns && site.excludePatterns.length > 0 ? (
                      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                        {site.excludePatterns.map(pattern => (
                          <li key={pattern}>{pattern}</li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-2 text-sm text-muted-foreground">Исключенные паттерны не заданы</p>
                    )}
                  </div>

                  <Separator />

                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <h3 className="text-sm font-semibold uppercase text-muted-foreground">Следующее сканирование</h3>
                      <p className="mt-1 text-sm">
                        {site.nextCrawl ? new Date(site.nextCrawl).toLocaleString("ru") : "Не запланировано"}
                      </p>
                    </div>
                    <div>
                      <h3 className="text-sm font-semibold uppercase text-muted-foreground">Последняя ошибка</h3>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {site.error ? site.error : "Ошибок не зафиксировано"}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </>
      ) : null}
    </div>
  );
}
