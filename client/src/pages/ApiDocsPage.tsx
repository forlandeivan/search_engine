import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { Copy, ExternalLink, Search, Database, Code } from "lucide-react";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";

export default function ApiDocsPage() {
  const { toast } = useToast();
  const [copiedEndpoint, setCopiedEndpoint] = useState<string | null>(null);

  const copyToClipboard = async (text: string, endpoint: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedEndpoint(endpoint);
      setTimeout(() => setCopiedEndpoint(null), 2000);
      toast({
        title: "Скопировано",
        description: "Код скопирован в буфер обмена",
      });
    } catch (err) {
      toast({
        title: "Ошибка",
        description: "Не удалось скопировать",
        variant: "destructive",
      });
    }
  };

  const apiBaseUrl = window.location.origin;

  return (
    <div className="container mx-auto p-6 max-w-6xl" data-testid="page-api-docs">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2" data-testid="heading-api-docs">
          API для интеграции с Тильдой
        </h1>
        <p className="text-muted-foreground text-lg" data-testid="text-api-description">
          Полная документация для подключения поискового движка к вашему сайту на Тильде
        </p>
      </div>

      <Tabs defaultValue="overview" className="space-y-6">
        <TabsList className="grid w-full grid-cols-4" data-testid="tabs-api-navigation">
          <TabsTrigger value="overview" data-testid="tab-overview">Обзор</TabsTrigger>
          <TabsTrigger value="search" data-testid="tab-search">Поиск</TabsTrigger>
          <TabsTrigger value="crawling" data-testid="tab-crawling">Краулинг</TabsTrigger>
          <TabsTrigger value="examples" data-testid="tab-examples">Примеры</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Database className="h-5 w-5" />
                Быстрый старт
              </CardTitle>
              <CardDescription>
                Подключите поисковый движок к вашему сайту на Тильде за несколько шагов
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <Card className="p-4">
                  <h3 className="font-semibold mb-2">1. Добавить сайт для краулинга</h3>
                  <p className="text-sm text-muted-foreground">
                    Зарегистрируйте ваш домен в админ-панели для начала индексации
                  </p>
                </Card>
                <Card className="p-4">
                  <h3 className="font-semibold mb-2">2. Дождаться индексации</h3>
                  <p className="text-sm text-muted-foreground">
                    Система автоматически проиндексирует все страницы вашего сайта
                  </p>
                </Card>
                <Card className="p-4">
                  <h3 className="font-semibold mb-2">3. Интегрировать поиск</h3>
                  <p className="text-sm text-muted-foreground">
                    Используйте API поиска для добавления функции поиска на сайт
                  </p>
                </Card>
                <Card className="p-4">
                  <h3 className="font-semibold mb-2">4. Настроить дизайн</h3>
                  <p className="text-sm text-muted-foreground">
                    Адаптируйте результаты поиска под дизайн вашего сайта
                  </p>
                </Card>
              </div>
              
              <Separator />
              
              <div className="bg-muted p-4 rounded-lg">
                <h4 className="font-semibold mb-2">Базовый URL API:</h4>
                <div className="flex items-center gap-2">
                  <code className="bg-background px-2 py-1 rounded text-sm flex-1" data-testid="text-base-url">
                    {apiBaseUrl}
                  </code>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => copyToClipboard(apiBaseUrl, 'baseUrl')}
                    data-testid="button-copy-base-url"
                  >
                    <Copy className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="search" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Search className="h-5 w-5" />
                API поиска
              </CardTitle>
              <CardDescription>
                Выполнение поисковых запросов по проиндексированному контенту
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-4">
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <Badge variant="default">GET</Badge>
                    <code className="text-sm">/api/search</code>
                  </div>
                  <p className="text-muted-foreground text-sm mb-4">
                    Основной endpoint для выполнения поисковых запросов
                  </p>
                </div>

                <div>
                  <h4 className="font-semibold mb-2">Параметры запроса:</h4>
                  <div className="space-y-2 text-sm">
                    <div className="grid grid-cols-4 gap-2 font-medium">
                      <span>Параметр</span>
                      <span>Тип</span>
                      <span>Обязательный</span>
                      <span>Описание</span>
                    </div>
                    <Separator />
                    <div className="grid grid-cols-4 gap-2">
                      <code>q</code>
                      <span>string</span>
                      <Badge variant="destructive" className="w-fit">Да</Badge>
                      <span>Поисковый запрос</span>
                    </div>
                    <div className="grid grid-cols-4 gap-2">
                      <code>limit</code>
                      <span>number</span>
                      <Badge variant="secondary" className="w-fit">Нет</Badge>
                      <span>Количество результатов (по умолчанию: 10)</span>
                    </div>
                    <div className="grid grid-cols-4 gap-2">
                      <code>offset</code>
                      <span>number</span>
                      <Badge variant="secondary" className="w-fit">Нет</Badge>
                      <span>Смещение для пагинации (по умолчанию: 0)</span>
                    </div>
                  </div>
                </div>

                <Separator />

                <div>
                  <h4 className="font-semibold mb-2">Пример запроса:</h4>
                  <div className="bg-muted p-4 rounded-lg relative">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="absolute top-2 right-2"
                      onClick={() => copyToClipboard(`${apiBaseUrl}/api/search?q=услуги&limit=5`, 'searchExample')}
                      data-testid="button-copy-search-example"
                    >
                      {copiedEndpoint === 'searchExample' ? 'Скопировано!' : <Copy className="h-3 w-3" />}
                    </Button>
                    <code className="text-sm" data-testid="code-search-example">
                      GET {apiBaseUrl}/api/search?q=услуги&limit=5
                    </code>
                  </div>
                </div>

                <div>
                  <h4 className="font-semibold mb-2">Пример ответа:</h4>
                  <ScrollArea className="h-64 w-full">
                    <div className="bg-muted p-4 rounded-lg relative">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="absolute top-2 right-2"
                        onClick={() => copyToClipboard(`{
  "results": [
    {
      "id": "abc123",
      "title": "Наши услуги",
      "url": "https://example.com/services",
      "content": "Мы предоставляем широкий спектр услуг...",
      "metaDescription": "Описание наших услуг и преимуществ",
      "siteId": "site123"
    }
  ],
  "total": 15,
  "query": "услуги",
  "limit": 5,
  "offset": 0
}`, 'searchResponse')}
                        data-testid="button-copy-search-response"
                      >
                        {copiedEndpoint === 'searchResponse' ? 'Скопировано!' : <Copy className="h-3 w-3" />}
                      </Button>
                      <pre className="text-xs" data-testid="code-search-response">
{`{
  "results": [
    {
      "id": "abc123",
      "title": "Наши услуги",
      "url": "https://example.com/services", 
      "content": "Мы предоставляем широкий спектр услуг...",
      "metaDescription": "Описание наших услуг и преимуществ",
      "siteId": "site123"
    }
  ],
  "total": 15,
  "query": "услуги",
  "limit": 5,
  "offset": 0
}`}
                      </pre>
                    </div>
                  </ScrollArea>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="crawling" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Database className="h-5 w-5" />
                API управления краулингом
              </CardTitle>
              <CardDescription>
                Управление процессом индексации сайтов
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-6">
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <Badge variant="default">POST</Badge>
                    <code className="text-sm">/api/sites</code>
                  </div>
                  <p className="text-muted-foreground text-sm mb-4">
                    Добавление нового сайта для индексации
                  </p>
                  
                  <div className="bg-muted p-4 rounded-lg relative">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="absolute top-2 right-2"
                      onClick={() => copyToClipboard(`{
  "url": "https://your-site.com",
  "crawlDepth": 3,
  "followExternalLinks": false,
  "crawlFrequency": "daily"
}`, 'addSite')}
                      data-testid="button-copy-add-site"
                    >
                      {copiedEndpoint === 'addSite' ? 'Скопировано!' : <Copy className="h-3 w-3" />}
                    </Button>
                    <pre className="text-xs" data-testid="code-add-site">
{`{
  "url": "https://your-site.com",
  "crawlDepth": 3,
  "followExternalLinks": false,
  "crawlFrequency": "daily"
}`}
                    </pre>
                  </div>
                </div>

                <Separator />

                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <Badge variant="default">GET</Badge>
                    <code className="text-sm">/api/sites</code>
                  </div>
                  <p className="text-muted-foreground text-sm">
                    Получение списка всех добавленных сайтов
                  </p>
                </div>

                <Separator />

                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <Badge variant="outline">POST</Badge>
                    <code className="text-sm">/api/crawl/:siteId</code>
                  </div>
                  <p className="text-muted-foreground text-sm">
                    Запуск процесса краулинга для конкретного сайта
                  </p>
                </div>

                <Separator />

                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <Badge variant="default">GET</Badge>
                    <code className="text-sm">/api/stats</code>
                  </div>
                  <p className="text-muted-foreground text-sm">
                    Получение статистики по индексации (количество сайтов, страниц и т.д.)
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="examples" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Code className="h-5 w-5" />
                Примеры интеграции с Тильдой
              </CardTitle>
              <CardDescription>
                Готовые решения для добавления поиска на ваш сайт
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-6">
                <div>
                  <h4 className="font-semibold mb-3">HTML + JavaScript (для вставки в блок T123)</h4>
                  <ScrollArea className="h-96 w-full">
                    <div className="bg-muted p-4 rounded-lg relative">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="absolute top-2 right-2"
                        onClick={() => copyToClipboard(`<!-- Стили для поиска -->
<style>
.search-container {
  max-width: 600px;
  margin: 20px auto;
  font-family: Arial, sans-serif;
}

.search-input {
  width: 100%;
  padding: 12px 16px;
  border: 2px solid #e1e5e9;
  border-radius: 8px;
  font-size: 16px;
  outline: none;
  transition: border-color 0.2s;
}

.search-input:focus {
  border-color: #007bff;
}

.search-results {
  margin-top: 20px;
}

.search-result {
  padding: 16px;
  border: 1px solid #e1e5e9;
  border-radius: 8px;
  margin-bottom: 12px;
  background: white;
}

.result-title {
  font-size: 18px;
  font-weight: bold;
  margin-bottom: 8px;
  color: #007bff;
  text-decoration: none;
}

.result-url {
  font-size: 14px;
  color: #28a745;
  margin-bottom: 8px;
}

.result-description {
  font-size: 14px;
  color: #6c757d;
  line-height: 1.4;
}

.search-loading {
  text-align: center;
  padding: 20px;
  color: #6c757d;
}

.search-stats {
  margin: 10px 0;
  font-size: 14px;
  color: #6c757d;
}
</style>

<!-- HTML разметка -->
<div class="search-container">
  <input 
    type="text" 
    id="searchInput" 
    class="search-input" 
    placeholder="Поиск по сайту..."
  >
  <div id="searchStats" class="search-stats"></div>
  <div id="searchResults" class="search-results"></div>
</div>

<script>
// Конфигурация
const API_BASE_URL = '${apiBaseUrl}';
let searchTimeout;

// Элементы DOM
const searchInput = document.getElementById('searchInput');
const searchResults = document.getElementById('searchResults');
const searchStats = document.getElementById('searchStats');

// Функция поиска
async function performSearch(query) {
  if (!query.trim()) {
    searchResults.innerHTML = '';
    searchStats.innerHTML = '';
    return;
  }

  try {
    searchResults.innerHTML = '<div class="search-loading">Поиск...</div>';
    
    const response = await fetch(\`\${API_BASE_URL}/api/search?q=\${encodeURIComponent(query)}&limit=10\`);
    const data = await response.json();
    
    // Отображение статистики
    searchStats.innerHTML = \`Найдено \${data.total} результатов\`;
    
    // Отображение результатов
    if (data.results.length === 0) {
      searchResults.innerHTML = '<div class="search-loading">Ничего не найдено</div>';
      return;
    }

    const resultsHTML = data.results.map(result => \`
      <div class="search-result">
        <a href="\${result.url}" class="result-title" target="_blank">
          \${result.title || 'Без названия'}
        </a>
        <div class="result-url">\${result.url}</div>
        <div class="result-description">
          \${result.metaDescription || result.content?.substring(0, 200) + '...' || ''}
        </div>
      </div>
    \`).join('');
    
    searchResults.innerHTML = resultsHTML;
  } catch (error) {
    console.error('Ошибка поиска:', error);
    searchResults.innerHTML = '<div class="search-loading">Ошибка при выполнении поиска</div>';
  }
}

// Обработчик ввода с задержкой
searchInput.addEventListener('input', (e) => {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => {
    performSearch(e.target.value);
  }, 300);
});

// Поиск по Enter
searchInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    clearTimeout(searchTimeout);
    performSearch(e.target.value);
  }
});
</script>`, 'tildeExample')}
                        data-testid="button-copy-tilde-example"
                      >
                        {copiedEndpoint === 'tildeExample' ? 'Скопировано!' : <Copy className="h-3 w-3" />}
                      </Button>
                      <pre className="text-xs" data-testid="code-tilde-example">
{`<!-- Стили для поиска -->
<style>
.search-container {
  max-width: 600px;
  margin: 20px auto;
  font-family: Arial, sans-serif;
}

.search-input {
  width: 100%;
  padding: 12px 16px;
  border: 2px solid #e1e5e9;
  border-radius: 8px;
  font-size: 16px;
  outline: none;
  transition: border-color 0.2s;
}

.search-input:focus {
  border-color: #007bff;
}

.search-results {
  margin-top: 20px;
}

.search-result {
  padding: 16px;
  border: 1px solid #e1e5e9;
  border-radius: 8px;
  margin-bottom: 12px;
  background: white;
}

.result-title {
  font-size: 18px;
  font-weight: bold;
  margin-bottom: 8px;
  color: #007bff;
  text-decoration: none;
}

.result-url {
  font-size: 14px;
  color: #28a745;
  margin-bottom: 8px;
}

.result-description {
  font-size: 14px;
  color: #6c757d;
  line-height: 1.4;
}

.search-loading {
  text-align: center;
  padding: 20px;
  color: #6c757d;
}

.search-stats {
  margin: 10px 0;
  font-size: 14px;
  color: #6c757d;
}
</style>

<!-- HTML разметка -->
<div class="search-container">
  <input 
    type="text" 
    id="searchInput" 
    class="search-input" 
    placeholder="Поиск по сайту..."
  >
  <div id="searchStats" class="search-stats"></div>
  <div id="searchResults" class="search-results"></div>
</div>

<script>
// Конфигурация
const API_BASE_URL = '${apiBaseUrl}';
let searchTimeout;

// Элементы DOM
const searchInput = document.getElementById('searchInput');
const searchResults = document.getElementById('searchResults');
const searchStats = document.getElementById('searchStats');

// Функция поиска
async function performSearch(query) {
  if (!query.trim()) {
    searchResults.innerHTML = '';
    searchStats.innerHTML = '';
    return;
  }

  try {
    searchResults.innerHTML = '<div class="search-loading">Поиск...</div>';
    
    const response = await fetch(\`\${API_BASE_URL}/api/search?q=\${encodeURIComponent(query)}&limit=10\`);
    const data = await response.json();
    
    // Отображение статистики
    searchStats.innerHTML = \`Найдено \${data.total} результатов\`;
    
    // Отображение результатов
    if (data.results.length === 0) {
      searchResults.innerHTML = '<div class="search-loading">Ничего не найдено</div>';
      return;
    }

    const resultsHTML = data.results.map(result => \`
      <div class="search-result">
        <a href="\${result.url}" class="result-title" target="_blank">
          \${result.title || 'Без названия'}
        </a>
        <div class="result-url">\${result.url}</div>
        <div class="result-description">
          \${result.metaDescription || result.content?.substring(0, 200) + '...' || ''}
        </div>
      </div>
    \`).join('');
    
    searchResults.innerHTML = resultsHTML;
  } catch (error) {
    console.error('Ошибка поиска:', error);
    searchResults.innerHTML = '<div class="search-loading">Ошибка при выполнении поиска</div>';
  }
}

// Обработчик ввода с задержкой
searchInput.addEventListener('input', (e) => {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => {
    performSearch(e.target.value);
  }, 300);
});

// Поиск по Enter
searchInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    clearTimeout(searchTimeout);
    performSearch(e.target.value);
  }
});
</script>`}
                      </pre>
                    </div>
                  </ScrollArea>
                </div>

                <Separator />

                <div>
                  <h4 className="font-semibold mb-3">Инструкция по добавлению в Тильду</h4>
                  <div className="space-y-3 text-sm">
                    <div className="flex items-start gap-3">
                      <Badge variant="outline" className="mt-0.5">1</Badge>
                      <div>
                        <strong>Создайте новую страницу</strong> или откройте существующую в редакторе Тильды
                      </div>
                    </div>
                    <div className="flex items-start gap-3">
                      <Badge variant="outline" className="mt-0.5">2</Badge>
                      <div>
                        <strong>Добавьте блок T123</strong> (HTML/CSS/JS код) на страницу
                      </div>
                    </div>
                    <div className="flex items-start gap-3">
                      <Badge variant="outline" className="mt-0.5">3</Badge>
                      <div>
                        <strong>Скопируйте код выше</strong> и вставьте его в блок T123
                      </div>
                    </div>
                    <div className="flex items-start gap-3">
                      <Badge variant="outline" className="mt-0.5">4</Badge>
                      <div>
                        <strong>Убедитесь</strong>, что ваш сайт уже добавлен для индексации в админ-панели
                      </div>
                    </div>
                    <div className="flex items-start gap-3">
                      <Badge variant="outline" className="mt-0.5">5</Badge>
                      <div>
                        <strong>Опубликуйте страницу</strong> и протестируйте поиск
                      </div>
                    </div>
                  </div>
                </div>

                <Separator />

                <div className="bg-blue-50 dark:bg-blue-950 p-4 rounded-lg">
                  <h4 className="font-semibold mb-2 text-blue-900 dark:text-blue-100">💡 Совет</h4>
                  <p className="text-sm text-blue-800 dark:text-blue-200">
                    Вы можете настроить стили CSS под дизайн вашего сайта. Измените цвета, шрифты и размеры в секции &lt;style&gt; для идеальной интеграции.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <div className="mt-8 text-center">
        <Button asChild data-testid="button-admin-panel">
          <a href="/admin">
            <ExternalLink className="h-4 w-4 mr-2" />
            Перейти в админ-панель
          </a>
        </Button>
      </div>
    </div>
  );
}