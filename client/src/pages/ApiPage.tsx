import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Copy, Search, Globe, Code, ExternalLink } from "lucide-react";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";

export default function ApiPage() {
  const [copiedText, setCopiedText] = useState<string>("");
  const { toast } = useToast();

  const copyToClipboard = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedText(label);
      toast({
        title: "Скопировано!",
        description: `${label} скопирован в буфер обмена`,
      });
      setTimeout(() => setCopiedText(""), 2000);
    } catch (err) {
      toast({
        title: "Ошибка",
        description: "Не удалось скопировать текст",
        variant: "destructive",
      });
    }
  };

  const baseUrl = window.location.origin;

  const searchEndpoint = `${baseUrl}/api/search`;
  const searchExampleCode = `// Поиск по всем проиндексированным сайтам
const searchQuery = 'ваш запрос';
const response = await fetch('${searchEndpoint}?q=' + encodeURIComponent(searchQuery));
const results = await response.json();

console.log('Найдено результатов:', results.total);
results.results.forEach(page => {
  console.log(\`\${page.title} - \${page.url}\`);
});`;

  const tildaIntegrationCode = `<!-- Вставьте этот код в блок HTML Тильды -->
<div id="custom-search-container">
  <div class="search-box">
    <input 
      type="text" 
      id="search-input" 
      placeholder="Поиск по сайту..." 
      class="search-input"
    />
    <button onclick="performSearch()" class="search-button">Найти</button>
  </div>
  <div id="search-results" class="search-results"></div>
</div>

<style>
  .search-box {
    display: flex;
    max-width: 600px;
    margin: 20px auto;
    border: 2px solid #e0e0e0;
    border-radius: 25px;
    overflow: hidden;
    background: white;
  }
  
  .search-input {
    flex: 1;
    padding: 12px 20px;
    border: none;
    outline: none;
    font-size: 16px;
  }
  
  .search-button {
    padding: 12px 24px;
    background: #4CAF50;
    color: white;
    border: none;
    cursor: pointer;
    font-size: 16px;
  }
  
  .search-button:hover {
    background: #45a049;
  }
  
  .search-results {
    max-width: 600px;
    margin: 20px auto;
  }
  
  .search-result-item {
    padding: 15px;
    border-bottom: 1px solid #eee;
    background: white;
    margin: 5px 0;
    border-radius: 8px;
    box-shadow: 0 2px 4px rgba(0,0,0,0.1);
  }
  
  .search-result-title {
    font-size: 18px;
    font-weight: bold;
    color: #2c5aa0;
    text-decoration: none;
    display: block;
    margin-bottom: 5px;
  }
  
  .search-result-title:hover {
    text-decoration: underline;
  }
  
  .search-result-url {
    color: #006621;
    font-size: 14px;
    margin-bottom: 5px;
  }
  
  .search-result-description {
    color: #545454;
    line-height: 1.4;
  }
</style>

<script>
async function performSearch() {
  const query = document.getElementById('search-input').value.trim();
  const resultsContainer = document.getElementById('search-results');
  
  if (!query) {
    resultsContainer.innerHTML = '<p>Введите поисковый запрос</p>';
    return;
  }
  
  resultsContainer.innerHTML = '<p>Поиск...</p>';
  
  try {
    const response = await fetch('${searchEndpoint}?q=' + encodeURIComponent(query));
    const data = await response.json();
    
    if (data.results && data.results.length > 0) {
      let html = \`<h3>Найдено результатов: \${data.total}</h3>\`;
      
      data.results.forEach(result => {
        html += \`
          <div class="search-result-item">
            <a href="\${result.url}" class="search-result-title" target="_blank">
              \${result.title || 'Без названия'}
            </a>
            <div class="search-result-url">\${result.url}</div>
            \${result.metaDescription ? 
              \`<div class="search-result-description">\${result.metaDescription}</div>\` : 
              ''
            }
          </div>
        \`;
      });
      
      resultsContainer.innerHTML = html;
    } else {
      resultsContainer.innerHTML = '<p>По вашему запросу ничего не найдено</p>';
    }
  } catch (error) {
    console.error('Ошибка поиска:', error);
    resultsContainer.innerHTML = '<p>Произошла ошибка при поиске</p>';
  }
}

// Поиск по нажатию Enter
document.getElementById('search-input').addEventListener('keypress', function(e) {
  if (e.key === 'Enter') {
    performSearch();
  }
});
</script>`;

  return (
    <div className="container mx-auto p-6">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">API Документация</h1>
        <p className="text-lg text-muted-foreground">
          Интеграция поискового движка с Тильдой и другими платформами
        </p>
      </div>

      <Tabs defaultValue="search" className="space-y-6">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="search" data-testid="tab-search-api">
            <Search className="w-4 h-4 mr-2" />
            Search API
          </TabsTrigger>
          <TabsTrigger value="tilda" data-testid="tab-tilda-integration">
            <Globe className="w-4 h-4 mr-2" />
            Интеграция с Тильдой
          </TabsTrigger>
          <TabsTrigger value="endpoints" data-testid="tab-all-endpoints">
            <Code className="w-4 h-4 mr-2" />
            Все API
          </TabsTrigger>
          <TabsTrigger value="examples" data-testid="tab-examples">
            <ExternalLink className="w-4 h-4 mr-2" />
            Примеры
          </TabsTrigger>
        </TabsList>

        <TabsContent value="search" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Search className="w-5 h-5" />
                Search API
              </CardTitle>
              <CardDescription>
                Основной API для поиска по проиндексированному контенту
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <h4 className="font-semibold mb-2">Endpoint:</h4>
                  <div className="bg-muted p-3 rounded-md font-mono text-sm flex items-center justify-between">
                    <span>GET {searchEndpoint}</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => copyToClipboard(searchEndpoint, "Search API URL")}
                      data-testid="button-copy-search-endpoint"
                    >
                      <Copy className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
                <div>
                  <h4 className="font-semibold mb-2">Параметры:</h4>
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">q</Badge>
                      <span className="text-sm">Поисковый запрос (обязательный)</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary">limit</Badge>
                      <span className="text-sm">Количество результатов (по умолчанию: 10)</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary">offset</Badge>
                      <span className="text-sm">Смещение для пагинации (по умолчанию: 0)</span>
                    </div>
                  </div>
                </div>
              </div>

              <div>
                <h4 className="font-semibold mb-2">Пример ответа:</h4>
                <ScrollArea className="bg-muted p-4 rounded-md h-64">
                  <pre className="text-sm font-mono">
{`{
  "results": [
    {
      "id": "page-uuid",
      "title": "Заголовок страницы",
      "url": "https://example.com/page",
      "content": "Содержимое страницы...",
      "metaDescription": "Описание страницы",
      "statusCode": 200,
      "lastCrawled": "2024-01-15T10:30:00Z",
      "contentHash": "abc123...",
      "createdAt": "2024-01-15T10:30:00Z",
      "siteId": "site-uuid"
    }
  ],
  "total": 42,
  "limit": 10,
  "offset": 0
}`}
                  </pre>
                </ScrollArea>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="tilda" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Globe className="w-5 h-5" />
                Интеграция с Тильдой
              </CardTitle>
              <CardDescription>
                Готовый код для встраивания поиска в любой сайт на Тильде
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="bg-blue-50 dark:bg-blue-950 p-4 rounded-lg">
                <h4 className="font-semibold mb-2 text-blue-800 dark:text-blue-200">
                  📋 Инструкция по установке:
                </h4>
                <ol className="list-decimal list-inside space-y-1 text-sm text-blue-700 dark:text-blue-300">
                  <li>Откройте редактор Тильды</li>
                  <li>Добавьте блок "HTML" (T123)</li>
                  <li>Вставьте код ниже в блок HTML</li>
                  <li>Опубликуйте страницу</li>
                </ol>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <h4 className="font-semibold">Полный код для Тильды:</h4>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => copyToClipboard(tildaIntegrationCode, "Код для Тильды")}
                    data-testid="button-copy-tilda-code"
                  >
                    <Copy className="w-4 h-4 mr-2" />
                    Скопировать код
                  </Button>
                </div>
                <ScrollArea className="bg-muted p-4 rounded-md h-96">
                  <pre className="text-sm font-mono whitespace-pre-wrap">
                    {tildaIntegrationCode}
                  </pre>
                </ScrollArea>
              </div>

              <div className="bg-green-50 dark:bg-green-950 p-4 rounded-lg">
                <h4 className="font-semibold mb-2 text-green-800 dark:text-green-200">
                  ✅ Что получится:
                </h4>
                <ul className="list-disc list-inside space-y-1 text-sm text-green-700 dark:text-green-300">
                  <li>Красивое поле поиска с кнопкой</li>
                  <li>Мгновенный поиск по вашему сайту</li>
                  <li>Красиво оформленные результаты</li>
                  <li>Ссылки открываются в новой вкладке</li>
                  <li>Поиск работает по Enter и по клику</li>
                </ul>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="endpoints" className="space-y-4">
          <div className="grid gap-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">🔍 Поиск</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Badge>GET</Badge>
                    <span className="font-mono text-sm">/api/search</span>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Поиск по проиндексированному контенту
                  </p>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">📊 Статистика</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Badge>GET</Badge>
                    <span className="font-mono text-sm">/api/stats</span>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Общая статистика индексации
                  </p>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">🌐 Сайты</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Badge>GET</Badge>
                    <span className="font-mono text-sm">/api/sites</span>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Список всех проиндексированных сайтов
                  </p>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">📄 Страницы</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Badge>GET</Badge>
                    <span className="font-mono text-sm">/api/pages</span>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Список всех проиндексированных страниц
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="examples" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>JavaScript примеры</CardTitle>
              <CardDescription>
                Готовые примеры кода для интеграции
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h4 className="font-semibold">Простой поиск на JavaScript:</h4>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => copyToClipboard(searchExampleCode, "JavaScript код")}
                    data-testid="button-copy-js-example"
                  >
                    <Copy className="w-4 h-4 mr-2" />
                    Скопировать
                  </Button>
                </div>
                <ScrollArea className="bg-muted p-4 rounded-md h-48">
                  <pre className="text-sm font-mono">
                    {searchExampleCode}
                  </pre>
                </ScrollArea>
              </div>

              <div className="bg-yellow-50 dark:bg-yellow-950 p-4 rounded-lg">
                <h4 className="font-semibold mb-2 text-yellow-800 dark:text-yellow-200">
                  💡 Советы по интеграции:
                </h4>
                <ul className="list-disc list-inside space-y-1 text-sm text-yellow-700 dark:text-yellow-300">
                  <li>Используйте CORS-safe requests для кроссдоменных запросов</li>
                  <li>Добавьте debounce для живого поиска (300-500ms)</li>
                  <li>Кешируйте результаты для повышения производительности</li>
                  <li>Показывайте состояние загрузки для лучшего UX</li>
                  <li>Ограничьте количество результатов на странице (10-20)</li>
                </ul>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}