import { useState } from "react";
import AddSiteForm, { type SiteConfig } from "@/components/AddSiteForm";
import CrawlStatusCard, { type CrawlStatus } from "@/components/CrawlStatusCard";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Plus, Search, Filter } from "lucide-react";

export default function AdminPage() {
  const [showAddForm, setShowAddForm] = useState(false);
  const [searchFilter, setSearchFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "crawling" | "completed" | "failed">("all");

  //todo: remove mock functionality
  const [crawlStatuses, setCrawlStatuses] = useState<CrawlStatus[]>([
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
    const newCrawlStatus: CrawlStatus = {
      id: Date.now().toString(),
      url: config.url,
      status: "idle",
      progress: 0,
      pagesFound: 0,
      pagesIndexed: 0
    };
    setCrawlStatuses(prev => [...prev, newCrawlStatus]);
    setShowAddForm(false);
    console.log('Site added:', config);
  };

  const handleStartCrawl = (id: string) => {
    setCrawlStatuses(prev => prev.map(status => 
      status.id === id 
        ? { ...status, status: "crawling" as const, progress: 0 }
        : status
    ));
    console.log('Start crawl:', id);
  };

  const handleStopCrawl = (id: string) => {
    setCrawlStatuses(prev => prev.map(status => 
      status.id === id 
        ? { ...status, status: "idle" as const }
        : status
    ));
    console.log('Stop crawl:', id);
  };

  const handleRetryCrawl = (id: string) => {
    setCrawlStatuses(prev => prev.map(status => 
      status.id === id 
        ? { ...status, status: "crawling" as const, progress: 0, error: undefined }
        : status
    ));
    console.log('Retry crawl:', id);
  };

  const filteredStatuses = crawlStatuses.filter(status => {
    const matchesSearch = status.url.toLowerCase().includes(searchFilter.toLowerCase());
    const matchesStatus = statusFilter === "all" || status.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const getStatusCount = (status: CrawlStatus['status']) => {
    return crawlStatuses.filter(s => s.status === status).length;
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
            <div className="text-2xl font-bold">{crawlStatuses.length}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Страниц найдено</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {crawlStatuses.reduce((sum, status) => sum + status.pagesFound, 0)}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Проиндексировано</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {crawlStatuses.reduce((sum, status) => sum + status.pagesIndexed, 0)}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Активных краулингов</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {getStatusCount("crawling")}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}