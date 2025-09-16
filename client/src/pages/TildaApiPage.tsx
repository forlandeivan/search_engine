import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Copy, ExternalLink, Search, Globe, Code2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function TildaApiPage() {
  const currentDomain = window.location.origin;

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  return (
    <div className="container mx-auto p-6 max-w-6xl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2 flex items-center gap-2">
          <Code2 className="h-8 w-8" />
          API для интеграции с Тильдой
        </h1>
        <p className="text-lg text-muted-foreground">
          Подключите поисковый движок к вашему сайту на Тильде для обеспечения быстрого и релевантного поиска
        </p>
      </div>

      <Tabs defaultValue="overview" className="space-y-6">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="overview">Обзор</TabsTrigger>
          <TabsTrigger value="search">Поиск</TabsTrigger>
          <TabsTrigger value="integration">Интеграция</TabsTrigger>
          <TabsTrigger value="examples">Примеры</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Globe className="h-5 w-5" />
                Базовая информация
              </CardTitle>
              <CardDescription>
                Основные детали API поискового движка
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <h4 className="font-semibold mb-2">Базовый URL</h4>
                  <div className="flex items-center gap-2">
                    <code className="px-2 py-1 bg-muted rounded text-sm flex-1">
                      {currentDomain}/api
                    </code>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => copyToClipboard(`${currentDomain}/api`)}
                      data-testid="button-copy-base-url"
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                <div>
                  <h4 className="font-semibold mb-2">Формат ответов</h4>
                  <Badge variant="secondary">JSON</Badge>
                </div>
              </div>
              
              <Separator />
              
              <div>
                <h4 className="font-semibold mb-2">Особенности</h4>
                <ul className="list-disc list-inside space-y-1 text-sm text-muted-foreground">
                  <li>Полнотекстовый поиск по содержимому сайта</li>
                  <li>Автоматическая индексация страниц</li>
                  <li>Поддержка русского языка</li>
                  <li>Быстрые ответы (обычно &lt; 100ms)</li>
                  <li>Поиск по заголовкам, содержимому и мета-описаниям</li>
                </ul>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="search" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Search className="h-5 w-5" />
                Поиск по сайту
              </CardTitle>
              <CardDescription>
                Основной endpoint для выполнения поиска
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <Badge variant="default">GET</Badge>
                  <code className="text-sm">/api/search</code>
                </div>
                
                <h4 className="font-semibold mb-3">Параметры запроса</h4>
                <div className="space-y-3">
                  <div className="border rounded-lg p-4">
                    <div className="grid grid-cols-4 gap-4 text-sm">
                      <div className="font-mono font-semibold">q</div>
                      <div><Badge variant="destructive">обязательный</Badge></div>
                      <div>string</div>
                      <div>Поисковый запрос</div>
                    </div>
                  </div>
                  <div className="border rounded-lg p-4">
                    <div className="grid grid-cols-4 gap-4 text-sm">
                      <div className="font-mono font-semibold">limit</div>
                      <div><Badge variant="secondary">необязательный</Badge></div>
                      <div>number</div>
                      <div>Количество результатов (по умолчанию: 10, макс: 50)</div>
                    </div>
                  </div>
                  <div className="border rounded-lg p-4">
                    <div className="grid grid-cols-4 gap-4 text-sm">
                      <div className="font-mono font-semibold">offset</div>
                      <div><Badge variant="secondary">необязательный</Badge></div>
                      <div>number</div>
                      <div>Смещение для пагинации (по умолчанию: 0)</div>
                    </div>
                  </div>
                </div>
              </div>

              <Separator />

              <div>
                <h4 className="font-semibold mb-3">Пример запроса</h4>
                <div className="relative">
                  <pre className="bg-muted p-4 rounded-lg text-sm overflow-x-auto">
                    <code>{`GET ${currentDomain}/api/search?q=контакты&limit=5`}</code>
                  </pre>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="absolute top-2 right-2"
                    onClick={() => copyToClipboard(`${currentDomain}/api/search?q=контакты&limit=5`)}
                    data-testid="button-copy-search-example"
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              <div>
                <h4 className="font-semibold mb-3">Пример ответа</h4>
                <ScrollArea className="h-64">
                  <pre className="bg-muted p-4 rounded-lg text-sm">
                    <code>{JSON.stringify({
                      "results": [
                        {
                          "id": "page-123",
                          "url": "https://mysite.tilda.ws/contacts",
                          "title": "Контакты - Наша компания",
                          "content": "Свяжитесь с нами любым удобным способом...",
                          "metaDescription": "Контактная информация компании"
                        }
                      ],
                      "total": 1,
                      "query": "контакты",
                      "limit": 5,
                      "offset": 0
                    }, null, 2)}</code>
                  </pre>
                </ScrollArea>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="integration" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Интеграция с Тильдой</CardTitle>
              <CardDescription>
                Пошаговое руководство по подключению поиска на сайт
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div>
                <h4 className="font-semibold mb-3">Шаг 1: Добавьте HTML для поиска</h4>
                <p className="text-sm text-muted-foreground mb-3">
                  Добавьте это в блок T123 (HTML) на Тильде:
                </p>
                <div className="relative">
                  <pre className="bg-muted p-4 rounded-lg text-sm overflow-x-auto">
                    <code>{`<div id="search-container">
  <input type="text" id="search-input" placeholder="Поиск по сайту..." />
  <button id="search-button">Найти</button>
  <div id="search-results"></div>
</div>`}</code>
                  </pre>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="absolute top-2 right-2"
                    onClick={() => copyToClipboard(`<div id="search-container">
  <input type="text" id="search-input" placeholder="Поиск по сайту..." />
  <button id="search-button">Найти</button>
  <div id="search-results"></div>
</div>`)}
                    data-testid="button-copy-html"
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              <div>
                <h4 className="font-semibold mb-3">Шаг 2: Добавьте JavaScript</h4>
                <p className="text-sm text-muted-foreground mb-3">
                  Добавьте этот код в область &lt;head&gt; или перед &lt;/body&gt;:
                </p>
                <div className="relative">
                  <ScrollArea className="h-96">
                    <pre className="bg-muted p-4 rounded-lg text-sm">
                      <code>{`<script>
async function searchSite() {
  const query = document.getElementById('search-input').value;
  const resultsDiv = document.getElementById('search-results');
  
  if (!query.trim()) {
    resultsDiv.innerHTML = '';
    return;
  }
  
  try {
    const response = await fetch(\`${currentDomain}/api/search?q=\${encodeURIComponent(query)}&limit=10\`);
    const data = await response.json();
    
    if (data.results && data.results.length > 0) {
      resultsDiv.innerHTML = \`
        <div style="margin-top: 20px;">
          <h3>Найдено: \${data.total} результатов</h3>
          \${data.results.map(result => \`
            <div style="border: 1px solid #ddd; padding: 15px; margin: 10px 0; border-radius: 8px;">
              <h4><a href="\${result.url}" target="_blank">\${result.title}</a></h4>
              <p style="color: #666; font-size: 14px;">\${result.metaDescription || ''}</p>
              <p style="color: #999; font-size: 12px;">\${result.url}</p>
            </div>
          \`).join('')}
        </div>
      \`;
    } else {
      resultsDiv.innerHTML = '<p>Ничего не найдено</p>';
    }
  } catch (error) {
    resultsDiv.innerHTML = '<p>Ошибка поиска</p>';
    console.error('Search error:', error);
  }
}

document.addEventListener('DOMContentLoaded', function() {
  const searchButton = document.getElementById('search-button');
  const searchInput = document.getElementById('search-input');
  
  if (searchButton) {
    searchButton.addEventListener('click', searchSite);
  }
  
  if (searchInput) {
    searchInput.addEventListener('keypress', function(e) {
      if (e.key === 'Enter') {
        searchSite();
      }
    });
  }
});
</script>`}</code>
                    </pre>
                  </ScrollArea>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="absolute top-2 right-2"
                    onClick={() => copyToClipboard(`<script>
async function searchSite() {
  const query = document.getElementById('search-input').value;
  const resultsDiv = document.getElementById('search-results');
  
  if (!query.trim()) {
    resultsDiv.innerHTML = '';
    return;
  }
  
  try {
    const response = await fetch(\`${currentDomain}/api/search?q=\${encodeURIComponent(query)}&limit=10\`);
    const data = await response.json();
    
    if (data.results && data.results.length > 0) {
      resultsDiv.innerHTML = \`
        <div style="margin-top: 20px;">
          <h3>Найдено: \${data.total} результатов</h3>
          \${data.results.map(result => \`
            <div style="border: 1px solid #ddd; padding: 15px; margin: 10px 0; border-radius: 8px;">
              <h4><a href="\${result.url}" target="_blank">\${result.title}</a></h4>
              <p style="color: #666; font-size: 14px;">\${result.metaDescription || ''}</p>
              <p style="color: #999; font-size: 12px;">\${result.url}</p>
            </div>
          \`).join('')}
        </div>
      \`;
    } else {
      resultsDiv.innerHTML = '<p>Ничего не найдено</p>';
    }
  } catch (error) {
    resultsDiv.innerHTML = '<p>Ошибка поиска</p>';
    console.error('Search error:', error);
  }
}

document.addEventListener('DOMContentLoaded', function() {
  const searchButton = document.getElementById('search-button');
  const searchInput = document.getElementById('search-input');
  
  if (searchButton) {
    searchButton.addEventListener('click', searchSite);
  }
  
  if (searchInput) {
    searchInput.addEventListener('keypress', function(e) {
      if (e.key === 'Enter') {
        searchSite();
      }
    });
  }
});
</script>`)}
                    data-testid="button-copy-javascript"
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              <div>
                <h4 className="font-semibold mb-3">Шаг 3: Добавьте CSS (опционально)</h4>
                <p className="text-sm text-muted-foreground mb-3">
                  Стилизуйте поиск под дизайн вашего сайта:
                </p>
                <div className="relative">
                  <pre className="bg-muted p-4 rounded-lg text-sm overflow-x-auto">
                    <code>{`<style>
#search-container {
  max-width: 600px;
  margin: 20px auto;
}

#search-input {
  width: 70%;
  padding: 10px;
  border: 2px solid #ddd;
  border-radius: 8px 0 0 8px;
  font-size: 16px;
}

#search-button {
  width: 30%;
  padding: 10px;
  background: #007bff;
  color: white;
  border: none;
  border-radius: 0 8px 8px 0;
  cursor: pointer;
  font-size: 16px;
}

#search-button:hover {
  background: #0056b3;
}

#search-results {
  margin-top: 20px;
}
</style>`}</code>
                  </pre>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="absolute top-2 right-2"
                    onClick={() => copyToClipboard(`<style>
#search-container {
  max-width: 600px;
  margin: 20px auto;
}

#search-input {
  width: 70%;
  padding: 10px;
  border: 2px solid #ddd;
  border-radius: 8px 0 0 8px;
  font-size: 16px;
}

#search-button {
  width: 30%;
  padding: 10px;
  background: #007bff;
  color: white;
  border: none;
  border-radius: 0 8px 8px 0;
  cursor: pointer;
  font-size: 16px;
}

#search-button:hover {
  background: #0056b3;
}

#search-results {
  margin-top: 20px;
}
</style>`)}
                    data-testid="button-copy-css"
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="examples" className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle>Тестирование API</CardTitle>
                <CardDescription>
                  Проверьте работу поиска прямо сейчас
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div>
                    <h4 className="font-semibold mb-2">Попробуйте эти запросы:</h4>
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          asChild
                          data-testid="button-test-search-1"
                        >
                          <a href={`${currentDomain}/api/search?q=поиск`} target="_blank">
                            <ExternalLink className="h-4 w-4 mr-1" />
                            поиск
                          </a>
                        </Button>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          asChild
                          data-testid="button-test-search-2"
                        >
                          <a href={`${currentDomain}/api/search?q=страница`} target="_blank">
                            <ExternalLink className="h-4 w-4 mr-1" />
                            страница
                          </a>
                        </Button>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          asChild
                          data-testid="button-test-search-3"
                        >
                          <a href={`${currentDomain}/api/search?q=тест&limit=3`} target="_blank">
                            <ExternalLink className="h-4 w-4 mr-1" />
                            тест (лимит 3)
                          </a>
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Полезные ссылки</CardTitle>
                <CardDescription>
                  Дополнительные ресурсы для интеграции
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <div>
                    <h4 className="font-semibold text-sm">Документация Тильды</h4>
                    <Button variant="ghost" className="p-0 h-auto" asChild>
                      <a href="https://help.tilda.cc/html" target="_blank">
                        help.tilda.cc/html
                        <ExternalLink className="h-3 w-3 ml-1" />
                      </a>
                    </Button>
                  </div>
                  <div>
                    <h4 className="font-semibold text-sm">Добавление своего кода</h4>
                    <Button variant="ghost" className="p-0 h-auto" asChild>
                      <a href="https://help.tilda.cc/code" target="_blank">
                        help.tilda.cc/code
                        <ExternalLink className="h-3 w-3 ml-1" />
                      </a>
                    </Button>
                  </div>
                  <div>
                    <h4 className="font-semibold text-sm">Блок T123 (HTML)</h4>
                    <Button variant="ghost" className="p-0 h-auto" asChild>
                      <a href="https://help.tilda.cc/t123" target="_blank">
                        help.tilda.cc/t123
                        <ExternalLink className="h-3 w-3 ml-1" />
                      </a>
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}