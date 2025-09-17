import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Search, ExternalLink, FileText, Calendar, Hash, Trash2 } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { formatDistanceToNow } from "date-fns";
import { ru } from "date-fns/locale";

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
}

interface Site {
  id: string;
  url: string;
  status: string;
}

interface PagesBySite {
  site: Site;
  pages: Page[];
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
  });

  // Fetch sites for grouping
  const { data: sites = [] } = useQuery<Site[]>({
    queryKey: ['/api/sites'],
  });

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
          <h1 className="text-2xl font-bold">Индексированные страницы</h1>
          <p className="text-muted-foreground">
            Всего проиндексировано {totalPages} страниц с {totalSites} сайтов
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
                  {pages.map((page) => (
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
                          </div>
                        </div>
                        
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
                                  <pre className="text-sm bg-muted p-4 rounded-lg whitespace-pre-wrap">
                                    {page.content}
                                  </pre>
                                </div>
                              </div>
                            </ScrollArea>
                          </DialogContent>
                        </Dialog>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}