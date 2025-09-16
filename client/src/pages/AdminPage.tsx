import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import AddSiteForm, { type SiteConfig } from "@/components/AddSiteForm";
import CrawlStatusCard, { type CrawlStatus } from "@/components/CrawlStatusCard";
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

  // Fetch sites data
  const { data: sites = [], isLoading, refetch } = useQuery({
    queryKey: ['/api/sites'],
  });

  // Fetch stats
  const { data: stats } = useQuery({
    queryKey: ['/api/stats'],
  });

  // Add site mutation
  const addSiteMutation = useMutation({
    mutationFn: (siteData: SiteConfig) => apiRequest('/api/sites', {
      method: 'POST',
      body: JSON.stringify(siteData),
    }),
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
    mutationFn: (siteId: string) => apiRequest(`/api/sites/${siteId}/crawl`, {
      method: 'POST',
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/sites'] });
      toast({
        title: "Краулинг запущен",
        description: "Краулинг сайта успешно запущен",
      });
    },
  });

  // Stop crawl mutation
  const stopCrawlMutation = useMutation({
    mutationFn: (siteId: string) => apiRequest(`/api/sites/${siteId}/stop-crawl`, {
      method: 'POST',
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/sites'] });
      toast({
        title: "Краулинг остановлен",
        description: "Краулинг сайта остановлен",
      });
    },
  });

  //todo: remove mock functionality - keep for fallback demo
  const mockCrawlStatuses: CrawlStatus[] = [
    {
      id: "1",
      url: "https://example.com",
      status: "crawling",
      progress: 65,
      pagesFound: 24,
      pagesIndexed: 18,
      lastCrawled: new Date("2024-01-15T10:30:00"),
      nextCrawl: new Date("2024-01-16T10:30:00")
    },
    {
      id: "2", 
      url: "https://docs.example.com",
      status: "completed",
      progress: 100,
      pagesFound: 45,
      pagesIndexed: 45,
      lastCrawled: new Date("2024-01-15T09:15:00"),
      nextCrawl: new Date("2024-01-16T09:15:00")
    },
    {
      id: "3",
      url: "https://blog.example.com",
      status: "failed",
      progress: 0,
      pagesFound: 0,
      pagesIndexed: 0,
      lastCrawled: new Date("2024-01-14T15:45:00"),
      error: "Connection timeout"
    }
  ]);

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

  // Use real data or fallback to mock for demo
  const displaySites = sites.length > 0 ? sites : mockCrawlStatuses;
  
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
              Все ({crawlStatuses.length})
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
                  crawlStatus={status}
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
                crawlStatus={status}
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
                crawlStatus={status}
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
                crawlStatus={status}
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
            <div className="text-2xl font-bold">{stats?.sites?.total || displaySites.length}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Страниц найдено</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {stats?.pages?.total || displaySites.reduce((sum: number, status: any) => sum + (status.pagesFound || 0), 0)}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Проиндексировано</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {displaySites.reduce((sum: number, status: any) => sum + (status.pagesIndexed || 0), 0)}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Активных краулингов</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {stats?.sites?.crawling || getStatusCount("crawling")}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}