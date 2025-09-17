import { useState } from "react";
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
  
  const handleSearch = (query: string) => {
    setSearchQuery(query);
    setCurrentPage(1);
    console.log('Search performed:', query);
  };

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

  const searchResults = searchData?.results || [];
  const totalResults = searchData?.total || 0;
  const totalPages = searchData?.totalPages || 0;
  
  const currentResults = searchResults;

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
          <div className="space-y-4 mb-8">
            {currentResults.map((result: SearchResult) => (
              <SearchResultComponent
                key={result.id}
                result={{ ...result, isFavorite: favorites.has(result.id) }}
                onToggleFavorite={handleToggleFavorite}
                onRemove={handleRemoveResult}
                searchQuery={searchQuery}
              />
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
            
            <div className="flex gap-1">
              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                const pageNum = i + 1;
                return (
                  <Button
                    key={pageNum}
                    variant={currentPage === pageNum ? "default" : "outline"}
                    size="sm"
                    onClick={() => setCurrentPage(pageNum)}
                    data-testid={`button-page-${pageNum}`}
                  >
                    {pageNum}
                  </Button>
                );
              })}
              {totalPages > 5 && (
                <>
                  <span className="px-2 py-1">...</span>
                  <Button
                    variant={currentPage === totalPages ? "default" : "outline"}
                    size="sm"
                    onClick={() => setCurrentPage(totalPages)}
                    data-testid={`button-page-${totalPages}`}
                  >
                    {totalPages}
                  </Button>
                </>
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