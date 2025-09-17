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
import { Plus, Search } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";

export default function AdminPage() {
  const { toast } = useToast();
  const [showAddForm, setShowAddForm] = useState(false);
  const [searchFilter, setSearchFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "crawling" | "completed" | "failed">("all");

  // Fetch sites data
  const { data: sites = [], isLoading, error } = useQuery({
    queryKey: ['/api/sites'],
  });

  // Add site mutation
  const addSiteMutation = useMutation({
    mutationFn: async (siteData: SiteConfig) => {
      const response = await apiRequest('POST', '/api/sites', siteData);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/sites'] });
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

  // Delete site mutation
  const deleteSiteMutation = useMutation({
    mutationFn: async (siteId: string) => {
      const response = await apiRequest('DELETE', `/api/sites/${siteId}`);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/sites'] });
      toast({
        title: "Сайт удален",
        description: "Сайт и все его страницы успешно удалены",
      });
    },
    onError: () => {
      toast({
        title: "Ошибка",
        description: "Не удалось удалить сайт",
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
      toast({
        title: "Краулинг запущен",
        description: "Краулинг сайта успешно запущен",
      });
    },
  });

  const displaySites = Array.isArray(sites) ? sites : [];

  const handleAddSite = (config: SiteConfig) => {
    addSiteMutation.mutate(config);
  };

  const handleStartCrawl = (id: string) => {
    startCrawlMutation.mutate(id);
  };

  const handleStopCrawl = (id: string) => {
    console.log('Stop crawl:', id);
  };

  const handleRetryCrawl = (id: string) => {
    startCrawlMutation.mutate(id);
  };

  const handleDeleteSite = (id: string) => {
    deleteSiteMutation.mutate(id);
  };

  const filteredSites = displaySites.filter((site: any) => {
    const matchesSearch = site.url.toLowerCase().includes(searchFilter.toLowerCase());
    const matchesStatus = statusFilter === "all" || site.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  return (
    <div className="space-y-6 p-6">
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
        <AddSiteForm 
          onSubmit={handleAddSite}
          onCancel={() => setShowAddForm(false)}
        />
      )}

      <div className="flex items-center gap-4">
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

      {isLoading ? (
        <div className="text-center py-8">
          <p className="text-muted-foreground">Загрузка...</p>
        </div>
      ) : error ? (
        <div className="text-center py-8">
          <p className="text-muted-foreground">Ошибка загрузки данных.</p>
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {filteredSites.map((site: any) => (
          <CrawlStatusCard
            key={site.id}
            crawlStatus={site}
            onStart={handleStartCrawl}
            onStop={handleStopCrawl}
            onRetry={handleRetryCrawl}
            onDelete={handleDeleteSite}
          />
        ))}
      </div>

      {filteredSites.length === 0 && (
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

      {/* Statistics */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Всего сайтов</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{displaySites.length}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Активных краулингов</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {displaySites.filter((s: any) => s.status === 'crawling').length}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Завершено</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {displaySites.filter((s: any) => s.status === 'completed').length}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Проиндексировано страниц</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {displaySites.reduce((sum: number, s: any) => sum + (s.pagesIndexed || 0), 0)}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}