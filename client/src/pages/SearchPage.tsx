import { useState } from "react";
import SearchBar from "@/components/SearchBar";
import SearchResultComponent, { type SearchResult } from "@/components/SearchResult";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ChevronLeft, ChevronRight } from "lucide-react";

export default function SearchPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [favorites, setFavorites] = useState(new Set(["1", "3"]));
  
  //todo: remove mock functionality
  const mockResults: SearchResult[] = [
    {
      id: "1",
      title: "DateTime",
      description: "Работа со временем, datami и планировщиком. Библиотека для удобной работы с датами, временными зонами и форматирования временных данных.",
      url: "https://example.com/datetime",
      lastCrawled: new Date("2024-01-15"),
      isFavorite: favorites.has("1")
    },
    {
      id: "2", 
      title: "ConvertFromUnixTimeMilliseconds",
      description: "Работа со временем, datami и планировщиком. Конвертация временных меток Unix в удобочитаемый формат с поддержкой миллисекунд.",
      url: "https://example.com/convert-unix-time",
      lastCrawled: new Date("2024-01-14"),
      isFavorite: favorites.has("2")
    },
    {
      id: "3",
      title: "Бизнес-процессы",
      description: "Управление бизнес-процессами и автоматизация рабочих процессов. Создание, настройка и мониторинг бизнес-процессов в корпоративной среде.",
      url: "https://example.com/business-processes",
      lastCrawled: new Date("2024-01-13"),
      isFavorite: favorites.has("3")
    },
    {
      id: "4",
      title: "Работа со временем, datami и планировщиком",
      description: "Подробное руководство по работе с временными данными, календарями и планировщиками задач в различных системах и языках программирования.",
      url: "https://example.com/time-management",
      lastCrawled: new Date("2024-01-12"),
      isFavorite: favorites.has("4")
    },
    {
      id: "5",
      title: "HTTPRequest",
      description: "Внешние взаимодействия и интеграции. HTTP клиент для выполнения запросов к внешним API и сервисам с поддержкой различных методов.",
      url: "https://example.com/http-request",
      lastCrawled: new Date("2024-01-11"),
      isFavorite: favorites.has("5")
    },
    {
      id: "6",
      title: "AutomatonHTTPRequest",
      description: "Внешние взаимодействия и интеграции. Автоматизированные HTTP запросы с поддержкой retry логики и обработки ошибок.",
      url: "https://example.com/automaton-http",
      lastCrawled: new Date("2024-01-10"),
      isFavorite: favorites.has("6")
    },
    {
      id: "7",
      title: "Функции управления глобальными переменными",
      description: "Система управления глобальными переменными и конфигурацией приложения. Централизованное хранение и доступ к настройкам.",
      url: "https://example.com/global-variables",
      lastCrawled: new Date("2024-01-09"),
      isFavorite: favorites.has("7")
    }
  ];

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

  const filteredResults = searchQuery 
    ? mockResults.filter(result => 
        result.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        result.description.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : mockResults;

  const totalResults = filteredResults.length;
  const resultsPerPage = 10;
  const totalPages = Math.ceil(totalResults / resultsPerPage);
  
  const startIndex = (currentPage - 1) * resultsPerPage;
  const endIndex = startIndex + resultsPerPage;
  const currentResults = filteredResults.slice(startIndex, endIndex);

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

        {currentResults.length > 0 ? (
          <div className="space-y-4 mb-8">
            {currentResults.map((result) => (
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
              Ничего не найдено по запросу "{searchQuery}"
            </p>
            <p className="text-sm text-muted-foreground">
              Попробуйте использовать другие ключевые слова
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