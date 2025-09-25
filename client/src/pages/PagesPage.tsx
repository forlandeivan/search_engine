import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Search,
  ExternalLink,
  FileText,
  Calendar,
  Hash,
  Trash2,
  ListOrdered,
  Gauge,
  Loader2,
  Sparkles,
} from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { formatDistanceToNow } from "date-fns";
import { ru } from "date-fns/locale";
import type { ContentChunk, PageMetadata, PublicEmbeddingProvider } from "@shared/schema";

interface Page {
  id: string;
  url: string;
  title: string;
  content: string;
  metaDescription?: string;
  contentHash: string;
  createdAt: string;
  lastModified?: string;
  siteId: string;
  metadata?: PageMetadata;
  chunks?: ContentChunk[];
}

interface Site {
  id: string;
  url: string;
  status: string;
  name?: string;
  maxChunkSize?: number;
  chunkOverlap?: boolean;
  chunkOverlapSize?: number;
}

interface PagesBySite {
  site: Site;
  pages: Page[];
}

interface StatsData {
  sites: {
    total: number;
    crawling: number;
    completed: number;
    failed: number;
  };
}

interface VectorizePageResponse {
  message?: string;
  pointsCount: number;
  collectionName: string;
  vectorSize?: number | null;
  totalUsageTokens?: number;
}

interface VectorizePageDialogProps {
  page: Page;
  providers: PublicEmbeddingProvider[];
}

function VectorizePageDialog({ page, providers }: VectorizePageDialogProps) {
  const { toast } = useToast();
  const [isOpen, setIsOpen] = useState(false);
  const [selectedProviderId, setSelectedProviderId] = useState<string>("");

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    if (providers.length > 0) {
      setSelectedProviderId(providers[0].id);
    } else {
      setSelectedProviderId("");
    }
  }, [providers, isOpen]);

  const vectorizeMutation = useMutation<VectorizePageResponse, Error, string>({
    mutationFn: async (providerId: string) => {
      const response = await apiRequest("POST", `/api/pages/${page.id}/vectorize`, {
        embeddingProviderId: providerId,
      });
      return (await response.json()) as VectorizePageResponse;
    },
    onSuccess: (data) => {
      toast({
        title: "Чанки отправлены",
        description:
          data.message ??
          `Добавлено ${data.pointsCount} чанков в коллекцию ${data.collectionName}`,
      });
      setIsOpen(false);
    },
    onError: (error) => {
      toast({
        title: "Не удалось отправить чанки",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleOpenChange = (open: boolean) => {
    setIsOpen(open);
    if (!open) {
      vectorizeMutation.reset();
    }
  };

  const handleConfirm = () => {
    if (!selectedProviderId) {
      toast({
        title: "Выберите сервис",
        description: "Чтобы отправить чанки, выберите активный сервис эмбеддингов.",
        variant: "destructive",
      });
      return;
    }

    vectorizeMutation.mutate(selectedProviderId);
  };

  const totalChunks = Array.isArray(page.chunks) ? page.chunks.length : 0;
  const disabled = providers.length === 0;

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          disabled={disabled}
          className="whitespace-nowrap"
        >
          <Sparkles className="mr-1 h-4 w-4" />
          Векторизация
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Отправка чанков в Qdrant</DialogTitle>
          <p className="text-sm text-muted-foreground">
            Страница содержит {totalChunks.toLocaleString("ru-RU")} чанков. Они будут
            преобразованы в эмбеддинги выбранным сервисом и записаны в коллекцию Qdrant.
          </p>
        </DialogHeader>

        {providers.length === 0 ? (
          <div className="space-y-4">
            <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
              Нет активных сервисов эмбеддингов. Добавьте и включите сервис на вкладке
              «Эмбеддинги», чтобы выполнять загрузку чанков в Qdrant.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Сервис эмбеддингов</label>
              <Select value={selectedProviderId} onValueChange={setSelectedProviderId}>
                <SelectTrigger>
                  <SelectValue placeholder="Выберите сервис" />
                </SelectTrigger>
                <SelectContent>
                  {providers.map((provider) => (
                    <SelectItem key={provider.id} value={provider.id}>
                      {provider.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Будут использованы настройки Qdrant выбранного сервиса. Убедитесь, что указана
                правильная коллекция.
              </p>
            </div>

            {vectorizeMutation.isError && (
              <p className="rounded-md border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">
                {vectorizeMutation.error.message}
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            Отмена
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={disabled || vectorizeMutation.isPending || !selectedProviderId}
          >
            {vectorizeMutation.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Отправка...
              </>
            ) : (
              <>
                <Sparkles className="mr-2 h-4 w-4" />
                Отправить
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function PagesPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedSite, setSelectedSite] = useState<string>("all");
  const [selectedPages, setSelectedPages] = useState<Set<string>>(new Set());
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const { toast } = useToast();

  // Fetch all pages
  const { data: pages = [], isLoading: pagesLoading } = useQuery<Page[]>({
    queryKey: ['/api/pages'],
    refetchOnWindowFocus: true,
    refetchOnMount: true,
  });

  // Fetch sites for grouping
  const { data: sites = [] } = useQuery<Site[]>({
    queryKey: ['/api/sites'],
  });

  // Fetch crawl statistics to track active crawls
  const { data: stats } = useQuery<StatsData>({
    queryKey: ['/api/stats'],
  });

  const { data: embeddingServices } = useQuery<{ providers: PublicEmbeddingProvider[] }>({
    queryKey: ['/api/embedding/services'],
  });

  const activeEmbeddingProviders = (embeddingServices?.providers ?? []).filter(
    (provider) => provider.isActive,
  );

  // Group pages by site
  const pagesBySite: PagesBySite[] = sites.map(site => ({
    site,
    pages: pages.filter(page => page.siteId === site.id)
  })).filter(group => group.pages.length > 0);

  // Filter pages based on search and site selection
  const filteredPagesBySite = pagesBySite.map(group => ({
    ...group,
    pages: group.pages.filter(page => {
      const matchesSearch = searchQuery === "" || 
        page.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        page.url.toLowerCase().includes(searchQuery.toLowerCase()) ||
        page.content.toLowerCase().includes(searchQuery.toLowerCase());
      
      return matchesSearch;
    })
  })).filter(group => {
    if (selectedSite === "all") return group.pages.length > 0;
    return group.site.id === selectedSite && group.pages.length > 0;
  });

  const totalPages = pages.length;
  const totalSites = pagesBySite.length;
  
  // Auto-refresh pages when there are active crawls
  useEffect(() => {
    const hasActiveCrawls = stats?.sites?.crawling && stats.sites.crawling > 0;
    
    if (hasActiveCrawls) {
      const interval = setInterval(() => {
        queryClient.invalidateQueries({ queryKey: ['/api/pages'] });
        queryClient.invalidateQueries({ queryKey: ['/api/stats'] });
      }, 3000); // Refresh every 3 seconds
      
      return () => clearInterval(interval);
    }
  }, [stats?.sites?.crawling]);

  // Get all visible pages for bulk actions
  const allVisiblePages = filteredPagesBySite.flatMap(group => group.pages);
  const allVisiblePageIds = new Set(allVisiblePages.map(p => p.id));
  
  // Bulk delete mutation
  const deleteBulkMutation = useMutation({
    mutationFn: async (pageIds: string[]) => {
      return apiRequest('DELETE', '/api/pages/bulk-delete', { pageIds });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/pages'] });
      queryClient.invalidateQueries({ queryKey: ['/api/stats'] });
      setSelectedPages(new Set());
      toast({ title: "Страницы успешно удалены" });
      setIsDeleteDialogOpen(false);
    },
    onError: (error: any) => {
      toast({ 
        variant: "destructive",
        title: "Ошибка при удалении страниц", 
        description: error.message || "Произошла ошибка" 
      });
    }
  });

  // Selection handlers
  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedPages(new Set(allVisiblePageIds));
    } else {
      setSelectedPages(new Set());
    }
  };

  const handleSelectPage = (pageId: string, checked: boolean) => {
    const newSelected = new Set(selectedPages);
    if (checked) {
      newSelected.add(pageId);
    } else {
      newSelected.delete(pageId);
    }
    setSelectedPages(newSelected);
  };

  const handleBulkDelete = () => {
    if (selectedPages.size > 0) {
      deleteBulkMutation.mutate(Array.from(selectedPages));
    }
  };

  const isAllSelected = allVisiblePages.length > 0 && allVisiblePages.every(page => selectedPages.has(page.id));
  const isPartiallySelected = allVisiblePages.some(page => selectedPages.has(page.id)) && !isAllSelected;

  if (pagesLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">Загрузка страниц...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold">Индексированные страницы</h1>
            {stats?.sites?.crawling && stats.sites.crawling > 0 && (
              <Badge variant="secondary" className="animate-pulse">
                Автообновление: {stats.sites.crawling} активн{stats.sites.crawling === 1 ? 'ый' : 'ых'}
              </Badge>
            )}
          </div>
          <p className="text-muted-foreground">
            Всего проиндексировано {totalPages} страниц с {totalSites} сайтов
            {stats?.sites?.crawling && stats.sites.crawling > 0 && (
              <span className="ml-2 text-primary">• Обновляется каждые 3 сек</span>
            )}
          </p>
        </div>
      </div>

      {/* Filters */}
      {/* Bulk Actions Bar */}
      {selectedPages.size > 0 && (
        <Card className="bg-muted/50">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Badge variant="secondary" data-testid="text-selected-count">
                  Выбрано: {selectedPages.size}
                </Badge>
                <Button 
                  variant="ghost" 
                  size="sm" 
                  onClick={() => setSelectedPages(new Set())}
                  data-testid="button-clear-selection"
                >
                  Очистить выбор
                </Button>
              </div>
              <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
                <AlertDialogTrigger asChild>
                  <Button 
                    variant="destructive" 
                    size="sm"
                    disabled={selectedPages.size === 0 || deleteBulkMutation.isPending}
                    data-testid="button-bulk-delete"
                  >
                    <Trash2 className="h-4 w-4 mr-1" />
                    {deleteBulkMutation.isPending ? 'Удаление...' : `Удалить (${selectedPages.size})`}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Подтвердите удаление</AlertDialogTitle>
                    <AlertDialogDescription>
                      Вы действительно хотите удалить {selectedPages.size} {selectedPages.size === 1 ? 'страницу' : selectedPages.size < 5 ? 'страницы' : 'страниц'}?
                      <br />
                      Это действие нельзя отменить.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel data-testid="button-cancel-delete">Отмена</AlertDialogCancel>
                    <AlertDialogAction 
                      onClick={handleBulkDelete}
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      data-testid="button-confirm-delete"
                    >
                      Удалить
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Filters and Selection */}
      <div className="flex gap-4 items-center">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Поиск по названию, URL или содержимому..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
            data-testid="input-search-pages"
          />
        </div>
        
        {allVisiblePages.length > 0 && (
          <div className="flex items-center gap-2">
            <Checkbox
              checked={isAllSelected}
              onCheckedChange={handleSelectAll}
              data-testid="checkbox-select-all"
            />
            <label className="text-sm font-medium cursor-pointer" onClick={() => handleSelectAll(!isAllSelected)}>
              Выбрать все ({allVisiblePages.length})
            </label>
          </div>
        )}
        
        <Tabs value={selectedSite} onValueChange={setSelectedSite}>
          <TabsList>
            <TabsTrigger value="all" data-testid="tab-all-sites">
              Все сайты ({totalPages})
            </TabsTrigger>
            {pagesBySite.map(({ site, pages }) => (
              <TabsTrigger 
                key={site.id} 
                value={site.id}
                data-testid={`tab-site-${site.id}`}
              >
                {new URL(site.url).hostname} ({pages.length})
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      {/* Results */}
      {filteredPagesBySite.length === 0 ? (
        <Card>
          <CardContent className="flex items-center justify-center h-32">
            <div className="text-center">
              <FileText className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
              <p className="text-muted-foreground">
                {searchQuery ? "Страницы не найдены" : "Нет проиндексированных страниц"}
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {filteredPagesBySite.map(({ site, pages }) => (
            <Card key={site.id}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <span>{site.url}</span>
                  <Badge variant="secondary">{pages.length} страниц</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid gap-3">
                  {pages.map((page) => {
                    const siteConfig = sites.find(site => site.id === page.siteId);
                    const aggregatedContent = page.content ?? "";
                    const contentLength = aggregatedContent.length;
                    const aggregatedWordCount = page.metadata?.wordCount ??
                      (aggregatedContent ? aggregatedContent.trim().split(/\s+/).filter(Boolean).length : 0);
                    const chunks = page.chunks ?? [];
                    const chunkCharCounts = chunks.map(chunk => chunk.metadata?.charCount ?? chunk.content.length);
                    const chunkWordCounts = chunks.map(chunk => chunk.metadata?.wordCount ??
                      chunk.content.trim().split(/\s+/).filter(Boolean).length);
                    const chunkCount = chunks.length;
                    const totalChunkChars = chunkCharCounts.reduce((sum, value) => sum + value, 0);
                    const maxChunkLength = chunkCharCounts.reduce((max, value) => Math.max(max, value), 0);
                    const avgChunkLength = chunkCount > 0 ? Math.round(totalChunkChars / chunkCount) : 0;
                    const maxChunkWordCount = chunkWordCounts.reduce((max, value) => Math.max(max, value), 0);
                    const configuredChunkSize = siteConfig?.maxChunkSize ?? null;
                    const chunksOverLimit = configuredChunkSize
                      ? chunkCharCounts.filter(length => length > configuredChunkSize).length
                      : 0;

                    return (
                      <div
                        key={page.id}
                        className="p-4 border rounded-lg hover-elevate transition-colors"
                      >
                        <div className="flex items-start gap-4">
                          <Checkbox
                            checked={selectedPages.has(page.id)}
                            onCheckedChange={(checked) => handleSelectPage(page.id, checked as boolean)}
                            className="mt-1"
                            data-testid={`checkbox-page-${page.id}`}
                          />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-2">
                              <h3 className="font-medium truncate">
                                {page.title || "Без названия"}
                              </h3>
                              <Button
                                variant="ghost"
                                size="sm"
                                asChild
                                data-testid={`button-open-page-${page.id}`}
                              >
                                <a
                                  href={page.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="shrink-0"
                                >
                                  <ExternalLink className="h-3 w-3" />
                                </a>
                              </Button>
                            </div>

                            <p className="text-sm text-muted-foreground mb-2 truncate">
                              {page.url}
                            </p>

                            {page.metaDescription && (
                              <p className="text-sm text-muted-foreground mb-2 line-clamp-2">
                                {page.metaDescription}
                              </p>
                            )}

                            <div className="flex items-center gap-4 text-xs text-muted-foreground">
                              <span className="flex items-center gap-1">
                                <Calendar className="h-3 w-3" />
                                {page.createdAt ? formatDistanceToNow(new Date(page.createdAt), {
                                  addSuffix: true,
                                  locale: ru
                                }) : 'Дата неизвестна'}
                              </span>
                              <span className="flex items-center gap-1">
                                <Hash className="h-3 w-3" />
                                {page.contentHash.substring(0, 8)}
                              </span>
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
                                  настройка {configuredChunkSize.toLocaleString("ru-RU")} симв.
                                </span>
                              )}
                              {chunksOverLimit > 0 && (
                                <span className="text-destructive">
                                  {chunksOverLimit.toLocaleString("ru-RU")} чанков превышают лимит
                                </span>
                              )}
                            </div>
                          </div>

                          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                            <Dialog>
                              <DialogTrigger asChild>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  data-testid={`button-view-content-${page.id}`}
                                >
                                  <FileText className="h-4 w-4 mr-1" />
                                  Содержимое
                                </Button>
                              </DialogTrigger>
                              <DialogContent className="max-w-4xl max-h-[80vh]">
                                <DialogHeader>
                                  <DialogTitle className="flex items-center gap-2">
                                    <span className="truncate">{page.title || "Без названия"}</span>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      asChild
                                    >
                                      <a
                                        href={page.url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                      >
                                        <ExternalLink className="h-3 w-3" />
                                      </a>
                                    </Button>
                                  </DialogTitle>
                                  <p className="text-sm text-muted-foreground truncate">
                                    {page.url}
                                  </p>
                                </DialogHeader>
                                <ScrollArea className="h-96 w-full">
                                  <div className="space-y-4">
                                    {page.metaDescription && (
                                      <div>
                                        <h4 className="font-medium mb-2">Описание:</h4>
                                        <p className="text-sm text-muted-foreground">
                                          {page.metaDescription}
                                        </p>
                                      </div>
                                    )}
                                    <div>
                                      <h4 className="font-medium mb-2">Содержимое:</h4>
                                      <div className="flex flex-wrap gap-4 text-xs text-muted-foreground mb-3">
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
                                        <div className="space-y-3 mb-6">
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
                                                  <div className="text-sm font-medium truncate">
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
                                                <p className="mt-2 text-sm text-muted-foreground whitespace-pre-wrap break-words">
                                                  {chunk.content}
                                                </p>
                                              </div>
                                            );
                                          })}
                                        </div>
                                      )}
                                      <pre className="text-sm bg-muted p-4 rounded-lg whitespace-pre-wrap">
                                        {page.content}
                                      </pre>
                                    </div>
                                  </div>
                                </ScrollArea>
                              </DialogContent>
                            </Dialog>
                            <VectorizePageDialog page={page} providers={activeEmbeddingProviders} />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}