import { useCallback, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import SearchBar from "@/components/SearchBar";
import SearchResultComponent, { type SearchResult } from "@/components/SearchResult";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ChevronLeft, ChevronRight } from "lucide-react";

export default function SearchPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [favorites, setFavorites] = useState(new Set<string>());
  
  // Real search API call with proper query parameters
  const { data: searchData, isLoading, error } = useQuery({
    queryKey: ['search', searchQuery, currentPage],
    queryFn: async () => {
      const params = new URLSearchParams({
        q: searchQuery,
        page: currentPage.toString(),
        limit: '10'
      });
      const response = await fetch(`/api/search?${params}`);
      if (!response.ok) {
        throw new Error(`Search failed: ${response.status}`);
      }
      return response.json();
    },
    enabled: !!searchQuery.trim(),
  });
  
  const handleSearch = useCallback((query: string) => {
    setSearchQuery(query);
    setCurrentPage(1);
  }, []);

  const handleToggleFavorite = (id: string) => {
    setFavorites(prev => {
      const newFavorites = new Set(prev);
      if (newFavorites.has(id)) {
        newFavorites.delete(id);
      } else {
        newFavorites.add(id);
      }
      return newFavorites;
    });
  };

  const handleRemoveResult = (id: string) => {
    console.log('Remove result:', id);
  };

  const searchResults: SearchResult[] = (searchData?.results as SearchResult[]) ?? [];
  const totalResults = searchData?.total || 0;
  const totalPages = searchData?.totalPages || 0;
  
  const currentResults = searchResults;

  const groupedResults = useMemo(() => {
    const groups = new Map<string, SearchResult[]>();

    currentResults.forEach(result => {
      const heading = result.title?.trim() || (() => {
        try {
          return new URL(result.url).hostname;
        } catch {
          return result.url;
        }
      })();

      const existing = groups.get(heading) ?? [];
      existing.push(result);
      groups.set(heading, existing);
    });

    return Array.from(groups.entries()).map(([heading, items]) => ({ heading, items }));
  }, [currentResults]);

  const pagination = useMemo(() => {
    const maxVisiblePages = 10;
    if (totalPages === 0) {
      return { pages: [], showFirst: false, showLast: false, showLeftEllipsis: false, showRightEllipsis: false };
    }

    if (totalPages <= maxVisiblePages) {
      return {
        pages: Array.from({ length: totalPages }, (_, i) => i + 1),
        showFirst: false,
        showLast: false,
        showLeftEllipsis: false,
        showRightEllipsis: false,
      };
    }

    let start = Math.max(1, currentPage - Math.floor(maxVisiblePages / 2));
    let end = start + maxVisiblePages - 1;

    if (end > totalPages) {
      end = totalPages;
      start = end - maxVisiblePages + 1;
    }

    const pages = Array.from({ length: end - start + 1 }, (_, i) => start + i);

    return {
      pages,
      showFirst: start > 1,
      showLast: end < totalPages,
      showLeftEllipsis: start > 2,
      showRightEllipsis: end < totalPages - 1,
    };
  }, [currentPage, totalPages]);

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b bg-card">
        <div className="container mx-auto px-4 py-6">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold mb-2">Поисковый движок</h1>
            <p className="text-muted-foreground">Найдите нужную информацию на ваших сайтах</p>
          </div>
          <SearchBar onSearch={handleSearch} defaultValue={searchQuery} />
        </div>
      </header>

      {/* Results */}
      <main className="container mx-auto px-4 py-8">
        {searchQuery && (
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-4">
              <h2 className="text-lg font-semibold">
                Результаты поиска: "{searchQuery}"
              </h2>
              <Badge variant="secondary" data-testid="text-results-count">
                {totalResults} результатов
              </Badge>
            </div>
            {totalPages > 1 && (
              <div className="text-sm text-muted-foreground">
                Страница {currentPage} из {totalPages}
              </div>
            )}
          </div>
        )}

        {isLoading ? (
          <div className="text-center py-12">
            <p className="text-muted-foreground text-lg">
              Поиск...
            </p>
          </div>
        ) : currentResults.length > 0 ? (
          <div className="space-y-6 mb-8">
            {groupedResults.map((group, index) => (
              <section key={`${group.heading}-${index}`} className="space-y-3">
                <h3 className="text-xl font-semibold text-foreground" data-testid={`heading-group-${index}`}>
                  {group.heading}
                </h3>
                <div className="space-y-3">
                  {group.items.map((result: SearchResult) => (
                    <SearchResultComponent
                      key={result.id}
                      result={{ ...result, isFavorite: favorites.has(result.id) }}
                      onToggleFavorite={handleToggleFavorite}
                      onRemove={handleRemoveResult}
                      searchQuery={searchQuery}
                      showTitle={false}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        ) : searchQuery ? (
          <div className="text-center py-12">
            <p className="text-muted-foreground text-lg mb-4">
              {error ? 'Ошибка поиска' : 'Ничего не найдено по запросу "' + searchQuery + '"'}
            </p>
            <p className="text-sm text-muted-foreground">
              {error ? 'Попробуйте позже' : 'Попробуйте использовать другие ключевые слова'}
            </p>
          </div>
        ) : (
          <div className="text-center py-12">
            <p className="text-muted-foreground text-lg">
              Введите поисковый запрос для начала работы
            </p>
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
              disabled={currentPage === 1}
              data-testid="button-prev-page"
            >
              <ChevronLeft className="h-4 w-4" />
              Предыдущая
            </Button>
            
            <div className="flex items-center gap-1">
              {pagination.showFirst && (
                <Button
                  variant={currentPage === 1 ? "default" : "outline"}
                  size="sm"
                  onClick={() => setCurrentPage(1)}
                  data-testid="button-page-1"
                >
                  1
                </Button>
              )}
              {pagination.showLeftEllipsis && <span className="px-2 py-1">...</span>}
              {pagination.pages.map(pageNum => (
                <Button
                  key={pageNum}
                  variant={currentPage === pageNum ? "default" : "outline"}
                  size="sm"
                  onClick={() => setCurrentPage(pageNum)}
                  data-testid={`button-page-${pageNum}`}
                >
                  {pageNum}
                </Button>
              ))}
              {pagination.showRightEllipsis && <span className="px-2 py-1">...</span>}
              {pagination.showLast && (
                <Button
                  variant={currentPage === totalPages ? "default" : "outline"}
                  size="sm"
                  onClick={() => setCurrentPage(totalPages)}
                  data-testid={`button-page-${totalPages}`}
                >
                  {totalPages}
                </Button>
              )}
            </div>

            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
              disabled={currentPage === totalPages}
              data-testid="button-next-page"
            >
              Следующая
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        )}
      </main>
    </div>
  );
}