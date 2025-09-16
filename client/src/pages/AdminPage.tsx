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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Plus, Search, Filter } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function AdminPage() {
  const { toast } = useToast();
  const [showAddForm, setShowAddForm] = useState(false);
  const [searchFilter, setSearchFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "crawling" | "completed" | "failed">("all");

  // Fetch sites data with auto-refresh if any site is crawling
  const { data: sites = [], isLoading, refetch } = useQuery<Site[]>({
    queryKey: ['/api/sites'],
    refetchInterval: (query) => {
      const sitesData = query.state.data as Site[] || [];
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
      queryClient.invalidateQueries({ queryKey: ['/api/sites'] });
      queryClient.invalidateQueries({ queryKey: ['/api/stats'] });
      setShowAddForm(false);
      toast({
        title: "Сайт добавлен",
        description: "Сайт успешно добавлен для краулинга",
      });
    },
    onError: () => {
      toast({
        title: "Ошибка",
        description: "Не удалось добавить сайт",
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
      queryClient.invalidateQueries({ queryKey: ['/api/sites'] });
      queryClient.invalidateQueries({ queryKey: ['/api/stats'] });
      toast({
        title: "Краулинг запущен",
        description: "Краулинг сайта успешно запущен",
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
      queryClient.invalidateQueries({ queryKey: ['/api/sites'] });
      queryClient.invalidateQueries({ queryKey: ['/api/stats'] });
      toast({
        title: "Краулинг остановлен",
        description: "Краулинг сайта остановлен",
      });
    },
  });


  const handleAddSite = (config: SiteConfig) => {
    addSiteMutation.mutate(config);
  };

  const handleStartCrawl = (id: string) => {
    startCrawlMutation.mutate(id);
  };

  const handleStopCrawl = (id: string) => {
    stopCrawlMutation.mutate(id);
  };

  const handleRetryCrawl = (id: string) => {
    startCrawlMutation.mutate(id);
  };

  const displaySites = sites || [];
  
  const filteredStatuses = displaySites.filter((status: any) => {
    const matchesSearch = status.url.toLowerCase().includes(searchFilter.toLowerCase());
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
          <h1 className="text-2xl font-bold">Управление краулингом</h1>
          <p className="text-muted-foreground">
            Настройте сайты для индексации и отслеживайте процесс краулинга
          </p>
        </div>
        <Button 
          onClick={() => setShowAddForm(true)}
          data-testid="button-add-site"
          className="gap-2"
        >
          <Plus className="h-4 w-4" />
          Добавить сайт
        </Button>
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
                  crawlStatus={{
                    ...status,
                    status: status.status as "idle" | "crawling" | "completed" | "failed",
                    progress: 0,
                    pagesFound: 0,
                    pagesIndexed: 0,
                    lastCrawled: status.lastCrawled || undefined,
                    nextCrawl: status.nextCrawl || undefined,
                    error: status.error || undefined,
                  }}
                  onStart={handleStartCrawl}
                  onStop={handleStopCrawl}
                  onRetry={handleRetryCrawl}
                />
              ))}
            </div>
          ) : (
            <Card>
              <CardContent className="flex items-center justify-center py-12">
                <div className="text-center">
                  <p className="text-muted-foreground mb-4">
                    {searchFilter ? "Сайты не найдены" : "Нет добавленных сайтов"}
                  </p>
                  {!searchFilter && (
                    <Button onClick={() => setShowAddForm(true)} variant="outline">
                      <Plus className="h-4 w-4 mr-2" />
                      Добавить первый сайт
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="crawling" className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {filteredStatuses.filter(s => s.status === "crawling").map((status) => (
              <CrawlStatusCard
                key={status.id}
                crawlStatus={{
                  ...status,
                  status: status.status as "idle" | "crawling" | "completed" | "failed",
                  progress: 0,
                  pagesFound: 0,
                  pagesIndexed: 0,
                  lastCrawled: status.lastCrawled || undefined,
                  nextCrawl: status.nextCrawl || undefined,
                  error: status.error || undefined,
                }}
                onStart={handleStartCrawl}
                onStop={handleStopCrawl}
                onRetry={handleRetryCrawl}
              />
            ))}
          </div>
        </TabsContent>

        <TabsContent value="completed" className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {filteredStatuses.filter(s => s.status === "completed").map((status) => (
              <CrawlStatusCard
                key={status.id}
                crawlStatus={{
                  ...status,
                  status: status.status as "idle" | "crawling" | "completed" | "failed",
                  progress: 0,
                  pagesFound: 0,
                  pagesIndexed: 0,
                  lastCrawled: status.lastCrawled || undefined,
                  nextCrawl: status.nextCrawl || undefined,
                  error: status.error || undefined,
                }}
                onStart={handleStartCrawl}
                onStop={handleStopCrawl}
                onRetry={handleRetryCrawl}
              />
            ))}
          </div>
        </TabsContent>

        <TabsContent value="failed" className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {filteredStatuses.filter(s => s.status === "failed").map((status) => (
              <CrawlStatusCard
                key={status.id}
                crawlStatus={{
                  ...status,
                  status: status.status as "idle" | "crawling" | "completed" | "failed",
                  progress: 0,
                  pagesFound: 0,
                  pagesIndexed: 0,
                  lastCrawled: status.lastCrawled || undefined,
                  nextCrawl: status.nextCrawl || undefined,
                  error: status.error || undefined,
                }}
                onStart={handleStartCrawl}
                onStop={handleStopCrawl}
                onRetry={handleRetryCrawl}
              />
            ))}
          </div>
        </TabsContent>
      </Tabs>

      {/* Statistics Overview */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Всего сайтов</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.sites?.total || 0}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Страниц найдено</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {stats?.pages?.total || 0}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Общий размер индекса</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {stats?.pages?.total || 0}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Активных краулингов</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {stats?.sites?.crawling || 0}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}