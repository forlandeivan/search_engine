import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Copy, ExternalLink, Search, Globe, Code2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function TildaApiPage() {
  const sections = [
    {
      id: "tilda",
      title: "Tilda",
      description: "Готовая интеграция для сайтов на Tilda.",
      icon: Globe,
    },
  ];
  const [activeSection, setActiveSection] = useState(sections[0].id);

  const currentDomain =
    typeof window !== "undefined" ? window.location.origin : "https://ваш-домен.replit.dev";
  const apiEndpoint = `${currentDomain}/api`;

  const zeroBlockHtml = `<div id="search-widget" class="search-container">
  <div class="search-box">
    <input type="text" id="search-input" placeholder="Поиск по сайту..." class="search-input">
    <button id="search-button" class="search-button">
      <svg class="search-icon" viewBox="0 0 24 24">
        <path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
      </svg>
    </button>
  </div>
  <div id="search-loading" class="search-loading hidden">
    <div class="loading-spinner"></div>
    <span>Поиск...</span>
  </div>
  <div id="search-results" class="search-results"></div>
  <div id="search-stats" class="search-stats hidden"></div>
  <div id="search-error" class="search-error hidden"></div>
</div>`;

  const zeroBlockCss = `<style>
.search-container {
  max-width: 600px;
  margin: 0 auto;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
}

.search-box {
  position: relative;
  display: flex;
  align-items: center;
  background: #ffffff;
  border: 2px solid #e5e7eb;
  border-radius: 12px;
  transition: all 0.2s ease;
  box-shadow: 0 2px 4px rgba(0,0,0,0.04);
}

.search-box:focus-within {
  border-color: #3b82f6;
  box-shadow: 0 4px 12px rgba(59,130,246,0.15);
}

.search-input {
  flex: 1;
  padding: 16px 20px;
  border: none;
  outline: none;
  font-size: 16px;
  background: transparent;
  color: #1f2937;
}

.search-input::placeholder {
  color: #9ca3af;
}

.search-button {
  padding: 12px;
  margin: 4px;
  background: #3b82f6;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.2s ease;
  display: flex;
  align-items: center;
  justify-content: center;
}

.search-button:hover {
  background: #2563eb;
}

.search-icon {
  width: 20px;
  height: 20px;
  stroke: white;
  stroke-width: 2;
  fill: none;
}

.search-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 20px;
  color: #6b7280;
}

.loading-spinner {
  width: 20px;
  height: 20px;
  border: 2px solid #e5e7eb;
  border-top: 2px solid #3b82f6;
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.search-results {
  margin-top: 24px;
}

.result-item {
  background: #ffffff;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 20px;
  margin-bottom: 16px;
  transition: all 0.2s ease;
  cursor: pointer;
}

.result-item:hover {
  border-color: #3b82f6;
  box-shadow: 0 4px 12px rgba(59,130,246,0.1);
}

.result-title {
  font-size: 18px;
  font-weight: 600;
  color: #1f2937;
  margin-bottom: 8px;
  text-decoration: none;
}

.result-title:hover {
  color: #3b82f6;
}

.result-url {
  font-size: 14px;
  color: #059669;
  margin-bottom: 8px;
  word-break: break-all;
}

.result-description {
  color: #4b5563;
  line-height: 1.5;
}

.search-stats {
  text-align: center;
  padding: 16px;
  color: #6b7280;
  font-size: 14px;
  background: #f9fafb;
  border-radius: 8px;
  margin-top: 16px;
}

.search-error {
  background: #fef2f2;
  border: 1px solid #fecaca;
  color: #dc2626;
  padding: 16px;
  border-radius: 8px;
  margin-top: 16px;
}

.hidden {
  display: none !important;
}

.no-results {
  text-align: center;
  padding: 40px 20px;
  color: #6b7280;
}

@media (max-width: 768px) {
  .search-container { margin: 0 16px; }
  .search-input { font-size: 16px; }
  .result-item { padding: 16px; }
}
</style>`;

  const zeroBlockJsLines = [
    "<script>",
    "const API_ENDPOINT = '__API_ENDPOINT__';",
    "",
    "class TildaSearchWidget {",
    "  constructor(apiEndpoint) {",
    "    this.apiEndpoint = apiEndpoint;",
    "    this.debounceTimeout = null;",
    "    this.currentQuery = '';",
    "    this.controller = null;",
    "    this.init();",
    "  }",
    "",
    "  init() {",
    "    this.searchInput = document.getElementById('search-input');",
    "    this.searchButton = document.getElementById('search-button');",
    "    this.loadingEl = document.getElementById('search-loading');",
    "    this.resultsEl = document.getElementById('search-results');",
    "    this.statsEl = document.getElementById('search-stats');",
    "    this.errorEl = document.getElementById('search-error');",
    "",
    "    if (!this.searchInput || !this.searchButton) {",
    "      console.error('Поисковый виджет не найден в DOM');",
    "      return;",
    "    }",
    "",
    "    this.searchInput.addEventListener('input', (event) => this.handleInput(event));",
    "    this.searchInput.addEventListener('keypress', (event) => {",
    "      if (event.key === 'Enter') {",
    "        event.preventDefault();",
    "        this.performSearch(event.target.value.trim());",
    "      }",
    "    });",
    "    this.searchButton.addEventListener('click', () => {",
    "      this.performSearch(this.searchInput.value.trim());",
    "    });",
    "  }",
    "",
    "  handleInput(event) {",
    "    const query = event.target.value.trim();",
    "    clearTimeout(this.debounceTimeout);",
    "",
    "    if (query.length === 0) {",
    "      this.clearResults();",
    "      return;",
    "    }",
    "",
    "    this.debounceTimeout = setTimeout(() => {",
    "      if (query.length >= 2) {",
    "        this.performSearch(query);",
    "      }",
    "    }, 300);",
    "  }",
    "",
    "  async performSearch(query) {",
    "    if (!query || query.length < 2) {",
    "      this.showError('Введите минимум 2 символа для поиска');",
    "      return;",
    "    }",
    "",
    "    this.currentQuery = query;",
    "    this.showLoading();",
    "    this.hideError();",
    "",
    "    if (this.controller) {",
    "      this.controller.abort();",
    "    }",
    "    this.controller = new AbortController();",
    "",
    "    try {",
    "      const response = await fetch(",
    "        this.apiEndpoint + '/search?q=' + encodeURIComponent(query) + '&limit=10',",
    "        { signal: this.controller.signal }",
    "      );",
    "",
    "      if (!response.ok) {",
    "        throw new Error('HTTP ' + response.status);",
    "      }",
    "",
    "      const data = await response.json();",
    "      this.displayResults(data, query);",
    "    } catch (error) {",
    "      if (error.name !== 'AbortError') {",
    "        this.showError('Ошибка поиска. Попробуйте позже.');",
    "        console.error('Search error:', error);",
    "      }",
    "    } finally {",
    "      this.hideLoading();",
    "    }",
    "  }",
    "",
    "  displayResults(data, query) {",
    "    const results = data.results || [];",
    "    const total = data.total || 0;",
    "",
    "    if (!results.length) {",
    "      this.resultsEl.innerHTML = `",
    "        <div class=\"no-results\">",
    "          <p>По запросу <strong>\"\\${this.escapeHtml(query)}\"</strong> ничего не найдено</p>",
    "        </div>",
    "      `;",
    "      this.hideStats();",
    "      return;",
    "    }",
    "",
    "    this.resultsEl.innerHTML = results.map((result) => this.renderResult(result, query)).join('');",
    "    this.showStats(total, query);",
    "  }",
    "",
    "  renderResult(result, query) {",
    "    const title = result.title || 'Без названия';",
    "    const description = this.truncateText(result.metaDescription || result.content || '', 200);",
    "",
    "    return `",
    "      <div class=\"result-item\" onclick=\"window.open('\\${result.url}', '_blank')\">",
    "        <a href=\"\\${result.url}\" target=\"_blank\" class=\"result-title\" onclick=\"event.stopPropagation()\">",
    "          \\${this.highlight(this.escapeHtml(title), query)}",
    "        </a>",
    "        <div class=\"result-url\">\\${this.escapeHtml(result.url)}</div>",
    "        <div class=\"result-description\">\\${this.highlight(this.escapeHtml(description), query)}</div>",
    "      </div>",
    "    `;",
    "  }",
    "",
    "  highlight(text, query) {",
    "    const words = query.split(/\\s+/).filter((word) => word.length > 1);",
    "    let highlighted = text;",
    "",
    "    words.forEach((word) => {",
    "      const regexp = new RegExp('(' + this.escapeRegex(word) + ')', 'gi');",
    "      highlighted = highlighted.replace(regexp, '<mark>$1</mark>');",
    "    });",
    "",
    "    return highlighted;",
    "  }",
    "",
    "  truncateText(text, max) {",
    "    return text.length <= max ? text : text.slice(0, max).replace(/\\s+\\S*$/, '') + '...';",
    "  }",
    "",
    "  escapeHtml(text) {",
    "    const helper = document.createElement('div');",
    "    helper.textContent = text;",
    "    return helper.innerHTML;",
    "  }",
    "",
    "  escapeRegex(text) {",
    "    return text.replace(/[.*+?^\\${}()|[\\]\\\\]/g, '\\\\$&');",
    "  }",
    "",
    "  showLoading() {",
    "    this.loadingEl.classList.remove('hidden');",
    "    this.resultsEl.innerHTML = '';",
    "    this.hideStats();",
    "  }",
    "",
    "  hideLoading() {",
    "    this.loadingEl.classList.add('hidden');",
    "  }",
    "",
    "  showStats(total, query) {",
    "    this.statsEl.innerHTML = 'Найдено <strong>' + total + '</strong> по запросу <strong>\"' + this.escapeHtml(query) + '\"</strong>';",
    "    this.statsEl.classList.remove('hidden');",
    "  }",
    "",
    "  hideStats() {",
    "    this.statsEl.classList.add('hidden');",
    "  }",
    "",
    "  showError(message) {",
    "    this.errorEl.innerHTML = message;",
    "    this.errorEl.classList.remove('hidden');",
    "    this.resultsEl.innerHTML = '';",
    "    this.hideStats();",
    "  }",
    "",
    "  hideError() {",
    "    this.errorEl.classList.add('hidden');",
    "  }",
    "",
    "  clearResults() {",
    "    this.resultsEl.innerHTML = '';",
    "    this.hideStats();",
    "    this.hideError();",
    "  }",
    "}",
    "",
    "document.addEventListener('DOMContentLoaded', function () {",
    "  const searchWidget = new TildaSearchWidget(API_ENDPOINT);",
    "  window.searchWidget = searchWidget;",
    "});",
    "</script>"
  ];
  let zeroBlockJs = zeroBlockJsLines.join("\n");
  zeroBlockJs = zeroBlockJs.replace('__API_ENDPOINT__', apiEndpoint);

  const zeroBlockFull = [zeroBlockHtml, '', zeroBlockCss, '', zeroBlockJs].join('\n');

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  return (
    <div className="container mx-auto p-6 max-w-6xl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2 flex items-center gap-2">
          <Code2 className="h-8 w-8" />
          Документация API
        </h1>
        <p className="text-lg text-muted-foreground">
          Выберите платформу, чтобы подключить поисковый движок и настроить интеграцию под свои задачи.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
        <Card className="h-fit">
          <CardHeader>
            <CardTitle>Разделы документации</CardTitle>
            <CardDescription>Инструкции по интеграциям и виджетам</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {sections.map((section) => {
              const Icon = section.icon;
              return (
                <Button
                  key={section.id}
                  variant={activeSection === section.id ? "secondary" : "ghost"}
                  className="w-full justify-start gap-3"
                  onClick={() => setActiveSection(section.id)}
                >
                  <Icon className="h-4 w-4" />
                  <div className="flex flex-col items-start">
                    <span className="font-semibold leading-tight">{section.title}</span>
                    <span className="text-xs text-muted-foreground">{section.description}</span>
                  </div>
                </Button>
              );
            })}
          </CardContent>
        </Card>

        {activeSection === "tilda" && (
          <div className="space-y-6">
            <div>
              <h2 className="text-3xl font-bold mb-2 flex items-center gap-2">
                <Globe className="h-8 w-8" />
                API для интеграции с Тильдой
              </h2>
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
              <div className="space-y-2">
                <h4 className="font-semibold text-lg">Zero блок с современным поисковым виджетом</h4>
                <p className="text-sm text-muted-foreground">
                  Скопируйте и вставьте HTML, CSS и JavaScript ниже в один блок T123 (HTML) на Тильде. Код
                  адаптирован под Zero блок и содержит все необходимые обработчики, чтобы поиск работал стабильно.
                </p>
                <p className="text-sm text-muted-foreground">
                  Текущий endpoint API уже подставлен: {" "}
                  <code className="bg-muted px-2 py-1 rounded text-xs">{apiEndpoint}</code>
                </p>
              </div>

              <Separator />

              <div>
                <h4 className="font-semibold mb-3">Шаг 1: HTML структура</h4>
                <p className="text-sm text-muted-foreground mb-3">
                  Разместите HTML-каркас виджета внутри Zero блока. Он отвечает за поля ввода, кнопку и зоны вывода
                  результатов.
                </p>
                <div className="relative">
                  <ScrollArea className="h-80">
                    <pre className="bg-muted p-4 rounded-lg text-sm">
                      <code>{zeroBlockHtml}</code>
                    </pre>
                  </ScrollArea>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="absolute top-2 right-2"
                    onClick={() => copyToClipboard(zeroBlockHtml)}
                    data-testid="button-copy-html"
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              <div>
                <h4 className="font-semibold mb-3">Шаг 2: Стилизация (CSS)</h4>
                <p className="text-sm text-muted-foreground mb-3">
                  Добавьте стили внутри того же блока. Они отвечают за адаптивность, подсветку и общий вид результата.
                </p>
                <div className="relative">
                  <ScrollArea className="h-80">
                    <pre className="bg-muted p-4 rounded-lg text-sm">
                      <code>{zeroBlockCss}</code>
                    </pre>
                  </ScrollArea>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="absolute top-2 right-2"
                    onClick={() => copyToClipboard(zeroBlockCss)}
                    data-testid="button-copy-css"
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              <div>
                <h4 className="font-semibold mb-3">Шаг 3: Логика поиска (JavaScript)</h4>
                <p className="text-sm text-muted-foreground mb-3">
                  Скрипт добавляет живой поиск с задержкой, подсветкой найденных фраз и обработкой ошибок. Вставьте код
                  в тот же блок сразу после HTML и CSS.
                </p>
                <div className="relative">
                  <ScrollArea className="h-[420px]">
                    <pre className="bg-muted p-4 rounded-lg text-sm">
                      <code>{zeroBlockJs}</code>
                    </pre>
                  </ScrollArea>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="absolute top-2 right-2"
                    onClick={() => copyToClipboard(zeroBlockJs)}
                    data-testid="button-copy-javascript"
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              <div>
                <h4 className="font-semibold mb-3">Шаг 4: Полный блок одним куском</h4>
                <p className="text-sm text-muted-foreground mb-3">
                  Если удобнее, скопируйте готовый комплект из HTML, CSS и JavaScript. Вставьте код целиком в Zero блок —
                  он сразу начнёт работать.
                </p>
                <div className="relative">
                  <ScrollArea className="h-[500px]">
                    <pre className="bg-muted p-4 rounded-lg text-sm">
                      <code>{zeroBlockFull}</code>
                    </pre>
                  </ScrollArea>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="absolute top-2 right-2"
                    onClick={() => copyToClipboard(zeroBlockFull)}
                    data-testid="button-copy-full-widget"
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              <Separator />

              <div>
                <h4 className="font-semibold mb-3">Особенности и улучшения</h4>
                <ul className="list-disc list-inside space-y-1 text-sm text-muted-foreground">
                  <li>Живой поиск с задержкой 300 мс и отменой предыдущих запросов.</li>
                  <li>Индикатор загрузки, информативные сообщения об ошибках и статистика найденных страниц.</li>
                  <li>Подсветка совпадений и аккуратные карточки результатов в стиле современного поиска.</li>
                  <li>Адаптивная вёрстка, корректно отображается на мобильных устройствах.</li>
                  <li>Скрипт автоматически использует endpoint {apiEndpoint} и готов к работе сразу после вставки.</li>
                </ul>
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
        )}
      </div>
    </div>
  );
}
