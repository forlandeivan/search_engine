import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import AddSiteForm, { type SiteConfig } from "@/components/AddSiteForm";
import CrawlStatusCard, { type CrawlStatus } from "@/components/CrawlStatusCard";
import { type Site } from "@shared/schema";

interface Stats {
  sites: { total: number; crawling: number; completed: number; failed: number; };
  pages: { total: number; };
}
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Plus, Search, AlertTriangle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function AdminPage() {
  const { toast } = useToast();
  const [showAddForm, setShowAddForm] = useState(false);
  const [searchFilter, setSearchFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "crawling" | "completed" | "failed">("all");
  const [siteToDelete, setSiteToDelete] = useState<{ id: string; url: string; pageCount?: number } | null>(null);

  // Fetch sites data with extended stats and auto-refresh if any site is crawling
  type SiteWithStats = Site & { pagesFound?: number; pagesIndexed?: number };

  const { data: sites = [], refetch } = useQuery<SiteWithStats[]>({
    queryKey: ['/api/sites/extended'],
    refetchInterval: (query) => {
      const sitesData = (query.state.data as SiteWithStats[] | undefined) ?? [];
      return sitesData.some((site) => site.status === 'crawling') ? 3000 : false;
    },
  });

  // Fetch stats with auto-refresh if any site is crawling  
  const { data: stats } = useQuery<Stats>({
    queryKey: ['/api/stats'],
    refetchInterval: () => {
      return sites.some((site) => site.status === 'crawling') ? 3000 : false;
    },
  });

  // Add site mutation
  const addSiteMutation = useMutation({
    mutationFn: async (siteData: SiteConfig) => {
      const response = await apiRequest('POST', '/api/sites', siteData);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/sites/extended'] });
      queryClient.invalidateQueries({ queryKey: ['/api/stats'] });
      setShowAddForm(false);
      toast({
        title: "Проект добавлен",
        description: "Проект успешно добавлен для краулинга",
      });
    },
    onError: () => {
      toast({
        title: "Ошибка",
        description: "Не удалось добавить проект",
        variant: "destructive",
      });
    },
  });

  // Start crawl mutation
  const startCrawlMutation = useMutation({
    mutationFn: async (siteId: string) => {
      const response = await apiRequest('POST', `/api/sites/${siteId}/crawl`);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/sites/extended'] });
      queryClient.invalidateQueries({ queryKey: ['/api/stats'] });
      toast({
        title: "Краулинг запущен",
        description: "Краулинг проекта успешно запущен",
      });
    },
  });

  // Stop crawl mutation
  const stopCrawlMutation = useMutation({
    mutationFn: async (siteId: string) => {
      const response = await apiRequest('POST', `/api/sites/${siteId}/stop-crawl`);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/sites/extended'] });
      queryClient.invalidateQueries({ queryKey: ['/api/stats'] });
      toast({
        title: "Краулинг остановлен",
        description: "Краулинг проекта остановлен",
      });
    },
  });

  // Re-crawl mutation
  const recrawlMutation = useMutation({
    mutationFn: async (siteId: string) => {
      const response = await apiRequest('POST', `/api/sites/${siteId}/recrawl`);
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['/api/sites/extended'] });
      queryClient.invalidateQueries({ queryKey: ['/api/stats'] });
      toast({
        title: "Повторный краулинг запущен",
        description: `Повторный краулинг запущен. Текущих страниц: ${data.existingPages}`,
      });
    },
    onError: () => {
      toast({
        title: "Ошибка",
        description: "Не удалось запустить повторный краулинг",
        variant: "destructive",
      });
    },
  });

  const handleAddSite = (config: SiteConfig) => {
    addSiteMutation.mutate(config);
  };

  const handleStartCrawl = (siteId: string) => {
    startCrawlMutation.mutate(siteId);
  };

  const handleStopCrawl = (siteId: string) => {
    stopCrawlMutation.mutate(siteId);
  };

  const handleRetryCrawl = (siteId: string) => {
    startCrawlMutation.mutate(siteId);
  };

  const handleRecrawl = (siteId: string) => {
    console.log('[DEBUG] handleRecrawl called with:', siteId);
    recrawlMutation.mutate(siteId);
  };

  const mapCrawlStatus = (status: SiteWithStats): CrawlStatus => ({
    id: status.id,
    url: status.url ?? "URL не задан",
    status: (status.status ?? "idle") as CrawlStatus["status"],
    progress: 0,
    pagesFound: status.pagesFound ?? 0,
    pagesIndexed: status.pagesIndexed ?? status.pagesFound ?? 0,
    lastCrawled: status.lastCrawled ? new Date(status.lastCrawled) : undefined,
    nextCrawl: status.nextCrawl ? new Date(status.nextCrawl) : undefined,
    error: status.error ?? undefined,
  });

  // Emergency stop all crawls mutation
  const emergencyStopMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest('POST', '/api/emergency/stop-all-crawls', {}, {
        'x-admin-token': 'your_admin_token_here' // Замените на реальный токен из переменных окружения
      });
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['/api/sites/extended'] });
      queryClient.invalidateQueries({ queryKey: ['/api/stats'] });
      toast({
        title: "Экстренная остановка выполнена",
        description: `Остановлено ${data.stoppedCount} краулингов: ${data.stoppedSites?.join(', ')}`,
      });
    },
    onError: () => {
      toast({
        title: "Ошибка",
        description: "Не удалось выполнить экстренную остановку",
        variant: "destructive",
      });
    },
  });

  // Mock refetchSites for now, replace with actual refetch if needed
  const refetchSites = async () => {
    await refetch();
  };

  const handleDeleteSite = async (siteId: string) => {
    try {
      await apiRequest('DELETE', `/api/sites/${siteId}`);
      queryClient.invalidateQueries({ queryKey: ['/api/sites/extended'] });
      queryClient.invalidateQueries({ queryKey: ['/api/stats'] });
      toast({
        title: "Проект удален",
        description: "Проект успешно удален",
      });
      setSiteToDelete(null);
    } catch (error) {
      console.error('Error deleting site:', error);
      toast({
        title: "Ошибка",
        description: "Не удалось удалить проект",
        variant: "destructive",
      });
    }
  };

  const displaySites = sites || [];
  const normalizedSearch = searchFilter.trim().toLowerCase();

  const filteredStatuses = displaySites.filter((status) => {
    const matchesSearch = normalizedSearch.length === 0
      ? true
      : status.url.toLowerCase().includes(normalizedSearch);
    const matchesStatus = statusFilter === "all" || status.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const getStatusCount = (status: string) => {
    return displaySites.filter((s: any) => s.status === status).length;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold">Управление проектами</h1>
            {stats?.sites?.crawling && stats.sites.crawling > 0 && (
              <Badge variant="secondary" className="animate-pulse">
                {stats.sites.crawling} активн{stats.sites.crawling === 1 ? 'ый' : 'ых'}
              </Badge>
            )}
          </div>
          <p className="text-muted-foreground">
            Управляйте знаниями ваших проектов. Настраивайте автоматический краулинг сайтов или загружайте вручную
          </p>
        </div>
        <div className="flex gap-2">
          {stats?.sites?.crawling && stats.sites.crawling > 0 && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button 
                  variant="destructive"
                  data-testid="button-emergency-stop"
                  className="gap-2"
                  disabled={emergencyStopMutation.isPending}
                >
                  <AlertTriangle className="h-4 w-4" />
                  {emergencyStopMutation.isPending ? 'Останавливаем...' : 'Экстренная остановка'}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Экстренная остановка всех краулингов</AlertDialogTitle>
                  <AlertDialogDescription>
                    Вы уверены, что хотите принудительно остановить все активные краулинги? 
                    Это действие немедленно прервёт {stats?.sites?.crawling} активных процесс(ов).
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Отмена</AlertDialogCancel>
                  <AlertDialogAction 
                    onClick={() => emergencyStopMutation.mutate()}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    Остановить все
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
          <Button
            onClick={() => setShowAddForm(true)}
            data-testid="button-add-project"
            className="gap-2"
          >
            <Plus className="h-4 w-4" />
            Добавить проект
          </Button>
        </div>
      </div>

      {showAddForm && (
        <div className="space-y-4">
          <AddSiteForm 
            onSubmit={handleAddSite}
            onCancel={() => setShowAddForm(false)}
          />
        </div>
      )}

      <Tabs value={statusFilter} onValueChange={(value) => setStatusFilter(value as any)}>
        <div className="flex items-center justify-between">
          <TabsList>
            <TabsTrigger value="all" data-testid="tab-all">
              Все ({displaySites.length})
            </TabsTrigger>
            <TabsTrigger value="crawling" data-testid="tab-crawling">
              Краулинг ({getStatusCount("crawling")})
            </TabsTrigger>
            <TabsTrigger value="completed" data-testid="tab-completed">
              Завершено ({getStatusCount("completed")})
            </TabsTrigger>
            <TabsTrigger value="failed" data-testid="tab-failed">
              Ошибки ({getStatusCount("failed")})
            </TabsTrigger>
          </TabsList>

          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Поиск по URL..."
                value={searchFilter}
                onChange={(e) => setSearchFilter(e.target.value)}
                className="pl-8 w-64"
                data-testid="input-filter-search"
              />
            </div>
          </div>
        </div>

        <TabsContent value="all" className="space-y-4">
          {filteredStatuses.length > 0 ? (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {filteredStatuses.map((status) => (
                <CrawlStatusCard
                  key={status.id}
                  crawlStatus={mapCrawlStatus(status)}
                  onStart={handleStartCrawl}
                  onStop={handleStopCrawl}
                  onRetry={handleRetryCrawl}
                  onRecrawl={handleRecrawl}
                  onDelete={() =>
                    setSiteToDelete({
                      id: status.id,
                      url: status.url ?? "Без URL",
                      pageCount: (status.pagesIndexed ?? status.pagesFound) ?? 0,
                    })
                  }
                />
              ))}
            </div>
          ) : (
            <Card>
              <CardContent className="flex items-center justify-center py-12">
                <div className="text-center">
                  <p className="text-muted-foreground mb-4">
                    {searchFilter ? "Проекты не найдены" : "Нет добавленных проектов"}
                  </p>
                  {!searchFilter && (
                    <Button onClick={() => setShowAddForm(true)} variant="outline">
                      <Plus className="h-4 w-4 mr-2" />
                      Добавить первый проект
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="crawling" className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {filteredStatuses.filter((s) => s.status === "crawling").map((status) => (
              <CrawlStatusCard
                key={status.id}
                crawlStatus={mapCrawlStatus(status)}
                onStart={handleStartCrawl}
                onStop={handleStopCrawl}
                onRetry={handleRetryCrawl}
                onRecrawl={handleRecrawl}
                onDelete={() =>
                  setSiteToDelete({
                    id: status.id,
                    url: status.url ?? "Без URL",
                    pageCount: (status.pagesIndexed ?? status.pagesFound) ?? 0,
                  })
                }
              />
            ))}
          </div>
        </TabsContent>

        <TabsContent value="completed" className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {filteredStatuses.filter((s) => s.status === "completed").map((status) => (
              <CrawlStatusCard
                key={status.id}
                crawlStatus={mapCrawlStatus(status)}
                onStart={handleStartCrawl}
                onStop={handleStopCrawl}
                onRetry={handleRetryCrawl}
                onRecrawl={handleRecrawl}
                onDelete={() =>
                  setSiteToDelete({
                    id: status.id,
                    url: status.url ?? "Без URL",
                    pageCount: (status.pagesIndexed ?? status.pagesFound) ?? 0,
                  })
                }
              />
            ))}
          </div>
        </TabsContent>

        <TabsContent value="failed" className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {filteredStatuses.filter((s) => s.status === "failed").map((status) => (
              <CrawlStatusCard
                key={status.id}
                crawlStatus={mapCrawlStatus(status)}
                onStart={handleStartCrawl}
                onStop={handleStopCrawl}
                onRetry={handleRetryCrawl}
                onRecrawl={handleRecrawl}
                onDelete={() =>
                  setSiteToDelete({
                    id: status.id,
                    url: status.url ?? "Без URL",
                    pageCount: (status.pagesIndexed ?? status.pagesFound) ?? 0,
                  })
                }
              />
            ))}
          </div>
        </TabsContent>
      </Tabs>

      <AlertDialog open={!!siteToDelete} onOpenChange={(isOpen) => setSiteToDelete(isOpen ? siteToDelete : null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить проект?</AlertDialogTitle>
            <AlertDialogDescription>
              Вы уверены, что хотите удалить проект "{siteToDelete?.url}"? Это действие необратимо. Будет удалено {siteToDelete?.pageCount} страниц.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction onClick={() => siteToDelete?.id && handleDeleteSite(siteToDelete.id)}>Удалить</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}