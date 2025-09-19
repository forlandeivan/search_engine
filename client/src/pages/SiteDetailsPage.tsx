import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import SearchBar from "@/components/SearchBar";
import SearchResultComponent, { type SearchResult } from "@/components/SearchResult";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { AlertCircle, ArrowLeft, Globe, Info, Loader2 } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { defaultSearchSettings, type SearchSettings } from "@shared/schema";

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
  searchSettings?: SearchSettings;
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

type SearchSettingPath = {
  [Group in keyof SearchSettings]: [Group, keyof SearchSettings[Group]];
}[keyof SearchSettings];

const cloneSearchSettings = (settings?: SearchSettings | null): SearchSettings =>
  JSON.parse(JSON.stringify(settings ?? defaultSearchSettings)) as SearchSettings;

const searchSettingsSections: Array<{
  title: string;
  description: string;
  fields: Array<{
    path: SearchSettingPath;
    label: string;
    tooltip: string;
    min?: number;
    step?: number;
  }>;
}> = [
  {
    title: "Полнотекстовый поиск",
    description: "Весовые коэффициенты для ts_rank() без опечаток",
    fields: [
      {
        path: ["fts", "titleBoost"],
        label: "Вес заголовка (ts_rank)",
        tooltip: "Множитель для ts_rank по заголовку. Повышайте, если точные совпадения в title должны быть важнее всего.",
        min: 0,
        step: 0.5,
      },
      {
        path: ["fts", "contentBoost"],
        label: "Вес контента (ts_rank)",
        tooltip: "Множитель для ts_rank по содержимому и мета-описанию. Определяет влияние полного текста страницы.",
        min: 0,
        step: 0.5,
      },
    ],
  },
  {
    title: "pg_trgm similarity",
    description: "Порог и веса для similarity() из расширения pg_trgm",
    fields: [
      {
        path: ["similarity", "titleThreshold"],
        label: "Порог similarity для заголовка",
        tooltip: "Минимальное значение similarity(title, запрос), при котором документ считается подходящим по заголовку.",
        min: 0,
        step: 0.005,
      },
      {
        path: ["similarity", "contentThreshold"],
        label: "Порог similarity для контента",
        tooltip: "Минимальное значение similarity(content, запрос) для включения документа по тексту страницы.",
        min: 0,
        step: 0.005,
      },
      {
        path: ["similarity", "titleWeight"],
        label: "Вес similarity заголовка",
        tooltip: "Коэффициент, которым умножается similarity заголовка при расчете итогового рейтинга.",
        min: 0,
        step: 0.5,
      },
      {
        path: ["similarity", "contentWeight"],
        label: "Вес similarity контента",
        tooltip: "Коэффициент для similarity по содержимому. Чем выше, тем важнее совпадения в тексте.",
        min: 0,
        step: 0.5,
      },
    ],
  },
  {
    title: "pg_trgm word_similarity",
    description: "Настройки нечеткого сравнения слов для опечаток",
    fields: [
      {
        path: ["wordSimilarity", "titleThreshold"],
        label: "Порог word_similarity заголовка",
        tooltip: "Минимальное значение word_similarity(title, запрос) для обработки опечаток в заголовке.",
        min: 0,
        step: 0.01,
      },
      {
        path: ["wordSimilarity", "contentThreshold"],
        label: "Порог word_similarity контента",
        tooltip: "Минимальное значение word_similarity(content, запрос) для учёта опечаток в тексте страницы.",
        min: 0,
        step: 0.01,
      },
      {
        path: ["wordSimilarity", "titleWeight"],
        label: "Вес word_similarity заголовка",
        tooltip: "Коэффициент, которым умножается word_similarity для заголовка при подсчёте итогового балла.",
        min: 0,
        step: 0.5,
      },
      {
        path: ["wordSimilarity", "contentWeight"],
        label: "Вес word_similarity контента",
        tooltip: "Коэффициент для word_similarity(content, запрос), влияющий на обработку опечаток.",
        min: 0,
        step: 0.5,
      },
    ],
  },
  {
    title: "Частичные совпадения (ILIKE)",
    description: "Бонусы за попадание запроса в заголовок или текст",
    fields: [
      {
        path: ["ilike", "titleBoost"],
        label: "Бонус за совпадение в заголовке",
        tooltip: "Дополнительные баллы за частичное совпадение запроса в заголовке через ILIKE.",
        min: 0,
        step: 0.5,
      },
      {
        path: ["ilike", "contentBoost"],
        label: "Бонус за совпадение в тексте",
        tooltip: "Вес для совпадения запроса в содержимом страницы через ILIKE.",
        min: 0,
        step: 0.5,
      },
    ],
  },
  {
    title: "Поиск внутри коллекции",
    description: "Настройки выдачи на вкладке \"Поисковая строка\" для выбранного сайта",
    fields: [
      {
        path: ["collectionSearch", "similarityTitleThreshold"],
        label: "Порог similarity (заголовок)",
        tooltip: "Минимальное значение similarity(title, запрос) для отображения результата в поиске по сайту.",
        min: 0,
        step: 0.01,
      },
      {
        path: ["collectionSearch", "similarityContentThreshold"],
        label: "Порог similarity (контент)",
        tooltip: "Минимальное значение similarity(content, запрос) в поиске по сайту.",
        min: 0,
        step: 0.01,
      },
      {
        path: ["collectionSearch", "ftsMatchBonus"],
        label: "Бонус за точное FTS совпадение",
        tooltip: "Сколько дополнительных баллов выдаётся, если полнотекстовый поиск нашёл точное совпадение.",
        min: 0,
        step: 0.1,
      },
      {
        path: ["collectionSearch", "similarityWeight"],
        label: "Вес similarity при сортировке",
        tooltip: "Множитель для значения similarity в сортировке результатов вкладки поиска.",
        min: 0,
        step: 0.1,
      },
    ],
  },
  {
    title: "Fallback без pg_trgm",
    description: "Запасные веса, если расширение pg_trgm недоступно",
    fields: [
      {
        path: ["fallback", "ftsTitleBoost"],
        label: "Вес заголовка (ts_rank)",
        tooltip: "Множитель для ts_rank(title) при отсутствии pg_trgm.",
        min: 0,
        step: 0.5,
      },
      {
        path: ["fallback", "ftsContentBoost"],
        label: "Вес контента (ts_rank)",
        tooltip: "Множитель для ts_rank(content) при отсутствии расширения.",
        min: 0,
        step: 0.5,
      },
      {
        path: ["fallback", "ilikeTitleBoost"],
        label: "Бонус ILIKE заголовка",
        tooltip: "Дополнительный вес за совпадение по заголовку через ILIKE без pg_trgm.",
        min: 0,
        step: 0.5,
      },
      {
        path: ["fallback", "ilikeContentBoost"],
        label: "Бонус ILIKE контента",
        tooltip: "Бонус за совпадение по содержимому через ILIKE без pg_trgm.",
        min: 0,
        step: 0.5,
      },
    ],
  },
];

export default function SiteDetailsPage({ siteId }: SiteDetailsPageProps) {
  const normalizedSiteId = siteId;
  const [activeTab, setActiveTab] = useState("search");
  const [searchQuery, setSearchQuery] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [settingsForm, setSettingsForm] = useState<SearchSettings>(cloneSearchSettings());
  const [isSavingSettings, setIsSavingSettings] = useState(false);

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

  useEffect(() => {
    setSettingsForm(cloneSearchSettings(site?.searchSettings));
  }, [site?.searchSettings]);

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

  const getSettingValue = (settings: SearchSettings, path: SearchSettingPath): number => {
    const [group, key] = path;
    const normalized = settings as unknown as Record<string, Record<string, number>>;
    return normalized[group as string][key as string];
  };

  const handleSettingChange = (path: SearchSettingPath, rawValue: string) => {
    const numericValue = rawValue === "" ? 0 : Number(rawValue);
    if (Number.isNaN(numericValue)) {
      return;
    }

    setSettingsForm(prev => {
      const next = cloneSearchSettings(prev);
      const normalized = next as unknown as Record<string, Record<string, number>>;
      const [group, key] = path;
      normalized[group as string][key as string] = numericValue;
      return next;
    });
  };

  const handleResetSettings = () => {
    setSettingsForm(cloneSearchSettings());
  };

  const handleSaveSettings = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!site) {
      return;
    }

    try {
      setIsSavingSettings(true);
      await apiRequest("PUT", `/api/sites/${site.id}`, {
        searchSettings: settingsForm,
      });
      await queryClient.invalidateQueries({ queryKey: ["site", normalizedSiteId] });
      toast({
        title: "Настройки обновлены",
        description: "Весовые коэффициенты сохранены",
      });
    } catch (error) {
      console.error("Failed to update search settings", error);
      toast({
        title: "Не удалось сохранить",
        description: "Проверьте соединение с сервером и попробуйте ещё раз",
        variant: "destructive",
      });
    } finally {
      setIsSavingSettings(false);
    }
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

            <TabsContent value="settings" className="mt-4 space-y-4">
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

              <Card>
                <CardHeader>
                  <CardTitle>Настройки поиска</CardTitle>
                  <CardDescription>
                    Управляйте весами pg_trgm и полнотекстового поиска для обработки опечаток
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <form className="space-y-6" onSubmit={handleSaveSettings}>
                    {searchSettingsSections.map((section, sectionIndex) => (
                      <div key={section.title} className="space-y-4">
                        <div>
                          <h3 className="text-sm font-semibold text-foreground">{section.title}</h3>
                          <p className="text-sm text-muted-foreground">{section.description}</p>
                        </div>

                        <div className="grid gap-4 sm:grid-cols-2">
                          {section.fields.map(field => {
                            const inputId = `search-setting-${field.path.join("-")}`;
                            const value = getSettingValue(settingsForm, field.path);
                            return (
                              <div key={inputId} className="space-y-2">
                                <div className="flex items-center justify-between gap-2">
                                  <Label htmlFor={inputId} className="text-sm font-medium leading-none">
                                    {field.label}
                                  </Label>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <button
                                        type="button"
                                        className="inline-flex h-5 w-5 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                                        aria-label={field.tooltip}
                                      >
                                        <Info className="h-4 w-4" />
                                      </button>
                                    </TooltipTrigger>
                                    <TooltipContent side="top" align="start" className="max-w-xs text-xs leading-relaxed">
                                      {field.tooltip}
                                    </TooltipContent>
                                  </Tooltip>
                                </div>
                                <Input
                                  id={inputId}
                                  type="number"
                                  min={field.min}
                                  step={field.step ?? 0.1}
                                  value={value}
                                  onChange={event => handleSettingChange(field.path, event.target.value)}
                                />
                              </div>
                            );
                          })}
                        </div>

                        {sectionIndex < searchSettingsSections.length - 1 && <Separator />}
                      </div>
                    ))}

                    <div className="flex flex-wrap justify-end gap-2 pt-2">
                      <Button type="button" variant="outline" onClick={handleResetSettings} disabled={isSavingSettings}>
                        Сбросить по умолчанию
                      </Button>
                      <Button type="submit" disabled={isSavingSettings}>
                        {isSavingSettings ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Сохранение...
                          </>
                        ) : (
                          "Сохранить настройки"
                        )}
                      </Button>
                    </div>
                  </form>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </>
      ) : null}
    </div>
  );
}
